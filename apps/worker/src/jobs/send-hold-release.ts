// apps/worker/src/jobs/send-hold-release.ts
// `send.hold-release`（毎 10 分。docs/05 §9.4 / §10.4 / §8.3 / §8.3-Q）。T-04-04。✅ T-09-06 で `Proposal` 側を統合。
//
// ============================================================================
// 🔴 このジョブは外部 API を 1 つも呼ばない
// ============================================================================
// 保留の**再判定**と、解消したものの**再 enqueue** だけを行う。だから名前が `send.` で
// 始まるにもかかわらず `attempts: 3` でよい（docs/05 §9.1 / `packages/connectors/src/queues.ts`）。
// 🔴 逆に言えば、ここから `EmailSender.send` を呼んではならない —— 呼んだ瞬間に
//    「自動リトライしない」（`BR-22`）の根拠が崩れる。deps の型に送信の口を置いていない。
//
// ============================================================================
// 🔴 復帰の規律（docs/05 §9.4 の `send.hold-release` の行）
// ============================================================================
// ① **時刻で判定しない。** SES の枠はローリング 24 時間であり、固定時刻にリセットされない
//    （`docs/03` §3.2.4）。実行のたびに `decideProviderQuota` を**再評価**する。
// ② **`ALLOW` の `headroom` 件だけ**、古い順に復帰させる。全件戻すと、
//    戻した先で全件が再保留され、10 分ごとに往復するだけになる。
// ③ 🔴 **`Proposal` の `sendHoldReasonKey='PROVIDER_QUOTA'` と `EmailDispatch(HELD_PROVIDER_QUOTA)` は同じ枠を分け合う**
//    （§8.3-Q ⑥）。✅ T-09-06: `sendHoldSince` と `heldAt` を**1 本に混ぜて全体で古い順**に配る（`send-proposal-holds.ts`）。
//    `Contract`（Phase 3）は同じ列を持ち、同じ混ぜ方で加わる。
// ④ 招待・パスワード再設定は**平文トークンが残っていない**（payload と共に消えた）。
//    したがって復帰は**トークンの再発行**でしか行えない（§8.3 の手順を `HELD_DOMAIN_UNVERIFIED` と
//    共用する。CAS の `WHERE status` だけが違う）。実装は T-04-05 の `reissueAccountMail`。
// ⑤ 🔴 **再 enqueue されたジョブは §8.3-Q / §10.2 の判定を最初から通る**（`held_at` / 保留列を NULL に戻す）。
//    保留を経たものだけが判定を免れる経路を作らない。
// ⑥ 🔴 `Proposal` の `GATE_STALE` は対象外（§10.5。`listHeldProposalSends` が返さない）。人間が `S-021` / `S-022` から選ぶ。
import type {
  OperationalMailDispatch,
  EmailSender,
  ProviderQuotaNearingMarker,
  ProviderSendCounter,
} from '@ses/connectors';
import { isOperationalMailRecipientClass } from '@ses/connectors';
import {
  listHeldEmailDispatches,
  listHeldProposalSends,
  readEmailDailyCount,
  requeueHeldEmailDispatch,
  resolveTenantQuotas,
  resolveVerifiedSendingDomain,
  systemTenantCtx,
  withTenant,
  type HeldEmailDispatchRow,
  type HeldProposalSendRow,
  type SystemTenantCtx,
  type TenantQuotaDefaults,
} from '@ses/db';
import {
  decideProviderQuota,
  isExecutableTenantLifecycleState,
  isProviderQuotaWarning,
  providerQuotaUsage,
  tenantMachine,
  type ProviderQuotaObservation,
} from '@ses/domain';
import { isAccountMailTemplateKey } from './account-mail.js';
import { InvalidJobPayloadError, requireUuid } from './payload.js';
import {
  isProposalHoldResolved,
  releaseProposalSendHold,
  type ProposalHoldFacts,
  type ProposalHoldReleaseDeps,
} from './send-proposal-holds.js';

export const SEND_HOLD_RELEASE_JOB = 'send.hold-release';

/** 🔴 毎 10 分（docs/05 §9.4）。時刻の出所はここ 1 箇所。 */
export const SEND_HOLD_RELEASE_SCHEDULE = { cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' } as const;

/**
 * 1 回の実行で走査する保留行の上限（メール / 提案それぞれ）。
 * 🔴 復帰件数の上限ではない（それは `headroom`）。**1 回のジョブが DB を舐め続けないため**の
 *    ページサイズであり、残りは 10 分後の実行が古い順に拾う。
 */
export const HOLD_SCAN_LIMIT = 200;

export type SendHoldReleasePayload = { readonly tenantId: string };

export function parseSendHoldReleasePayload(raw: unknown): SendHoldReleasePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(SEND_HOLD_RELEASE_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(SEND_HOLD_RELEASE_JOB, 'tenantId', record.tenantId) };
}

/**
 * 🔴 保留中の `account.mail` 由来の行を、**トークンの再発行**で置き換える（docs/05 §8.3 / §9.4）。
 *
 * 実装（`Invitation.tokenHash` の差し替えと期限判定）は **T-04-05** が挿す。
 * 🔴 既定値（no-op）を置かない —— 置くと「復帰したつもりで永久に届かない招待」が生まれる
 *    （`CLAUDE.md` §11.1 の「成功したように見えて実際には起きていない」）。
 *
 * 戻り値:
 *  - `'REISSUED'` … 新しいトークンで `account.mail` を enqueue した（旧リンクは失効）
 *  - `'EXPIRED'`  … 受諾期限を過ぎていたので再発行しなかった（再招待は #14 の明示操作）
 *  - `'SKIPPED'`  … CAS が 0 件（他の実行が処理済み）
 */
export type AccountMailReissue = (
  ctx: SystemTenantCtx,
  dispatch: HeldEmailDispatchRow,
) => Promise<'REISSUED' | 'EXPIRED' | 'SKIPPED'>;

export type SendHoldReleaseDeps = ProposalHoldReleaseDeps & {
  /** 🔴 `getQuota()` のためだけに受け取る。**`send` を呼ばない**（このジョブは外部へ送らない）。 */
  readonly emailSender: Pick<EmailSender, 'getQuota'>;
  readonly providerDailyQuota: number;
  /** `MAIL_PROVIDER_QUOTA_WARN_RATIO`（`packages/config`。既定 0.8）。`A-005` 項目 13 の接近判定。 */
  readonly providerQuotaWarnRatio: number;
  /** 🔴 `SesEmailSender` に渡したものと同一のインスタンス（`email-send.ts` と同じ規律）。 */
  readonly providerSentCounter: ProviderSendCounter;
  /**
   * 🔴 T-12-17 ⑤: 接近（`warning`）の目印 `mail:provider:nearingSince`（docs/05 §16.5 項目 13 ③）。**表示専用の揮発値**で、
   *    毎 10 分の本ジョブが `observe()` することで、誰も `A-005` を開かなくても「最初に接近を観測した時刻」が
   *    TTL 24h で消えずに維持される。判定（`decideProviderQuota` / `isProviderQuotaWarning`）には使わない。
   */
  readonly nearingMarker: ProviderQuotaNearingMarker;
  /**
   * 🔴 T-09-06 → T-12-12: 上書きが無いときの上限（`packages/config`）。`RATE_LIMIT` の保留が解消したか
   *    （暦日が変わった / 上限が上がった）の判定は `resolveTenantQuotas(ctx, { now, defaults })` の `emailDailyLimit`
   *    で行う —— 送信ジョブ（`email-send.ts` / `send-proposal.ts`）と**同じ関数・同じ既定値**であり、「上限を上げたのに
   *    保留が解けない」経路を作らない。固定の `emailDailyLimit: number` を渡す口は無い。
   */
  readonly quotaDefaults: TenantQuotaDefaults;
  /** 保留中の運用メールを `email.dispatch` へ戻す。 */
  readonly enqueueEmailDispatch: (job: OperationalMailDispatch) => Promise<void>;
  /** 🔴 T-04-05 が実装する（既定値を置かない）。 */
  readonly reissueAccountMail: AccountMailReissue;
  readonly scanLimit?: number;
};

export type SendHoldReleaseOutcome = {
  /** 走査した保留行の数（メール）。 */
  readonly scanned: number;
  /** `HELD_DOMAIN_UNVERIFIED` から復帰させた数（ドメインが検証済みになったもの）。 */
  readonly domainReleased: number;
  /** `HELD_PROVIDER_QUOTA` から復帰させた数（メール）。 */
  readonly quotaReleased: number;
  /** 🔴 T-09-06: 走査した保留中の提案の数（`GATE_STALE` を含まない）。 */
  readonly proposalsScanned: number;
  /** 🔴 T-09-06: 復帰させた提案の数（理由を問わず。再 enqueue が成立したもの）。 */
  readonly sendHoldsReleased: number;
  /** 🔴 T-09-06: 同じ `jobId` の `failed` 記録に阻まれた提案の数（保留は元に戻した。運用が失敗記録を消すまで繰り返す）。 */
  readonly sendHoldsBlocked: number;
  /** この実行で使えた枠（`HOLD` なら 0）。`A-005` 項目 13 の根拠。 */
  readonly headroom: number;
  /** 🔴 上限への**接近**（到達とは別物。送信は止まっていない）。 */
  readonly warning: boolean;
};

async function readProviderQuota(
  deps: SendHoldReleaseDeps,
): Promise<ProviderQuotaObservation | null> {
  try {
    return await deps.emailSender.getQuota();
  } catch {
    // 🔴 `email-send.ts` と同じ規律 —— 取得できないことは判定をやめる理由にならない。
    return null;
  }
}

/**
 * 🔴 T-12-12: `RATE_LIMIT` の解消判定。上限は `resolveTenantQuotas`（既定値 + `tenant_quota_overrides`。判定・表示・送信ジョブと
 *    同じ 1 関数）から解く。上書きで上限が上がれば同じ暦日のうちに解消し、翌日以降の引き下げは適用日から効く（`effective_from` の
 *    評価も同じ関数に閉じる）。
 */
async function readDailyQuotaHasRoom(deps: SendHoldReleaseDeps, ctx: SystemTenantCtx, now: Date): Promise<boolean> {
  const { emailDailyLimit } = await resolveTenantQuotas(ctx, { now, defaults: deps.quotaDefaults });
  return (await readEmailDailyCount(ctx, now)) < emailDailyLimit;
}

/** 🔴 テナント状態は `tenants` から読む（`ctx.lifecycleState` は常に `'ACTIVE'` 固定。読めなければ fail-closed）。 */
async function readTenantExecutable(ctx: SystemTenantCtx): Promise<boolean> {
  const tenant = await withTenant(ctx, (db) => db.tenant.findFirst({ select: { lifecycleState: true } }));
  const raw: unknown = tenant?.lifecycleState;
  return tenantMachine.isState(raw) && isExecutableTenantLifecycleState(raw);
}

/** 枠（`headroom`）を分け合う候補。🔴 提案とメールを 1 本に混ぜて `at` の古い順に並べる。 */
type QuotaCandidate =
  | { readonly kind: 'PROPOSAL'; readonly at: Date; readonly row: HeldProposalSendRow }
  | { readonly kind: 'EMAIL'; readonly at: Date; readonly row: HeldEmailDispatchRow };

export type SendHoldReleaseHandler = (payload: unknown, jobId: string) => Promise<SendHoldReleaseOutcome>;

export function createSendHoldReleaseHandler(deps: SendHoldReleaseDeps): SendHoldReleaseHandler {
  return async (payload, jobId) => {
    const job = parseSendHoldReleasePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: SEND_HOLD_RELEASE_JOB, jobId });
    const now = deps.now();
    const limit = deps.scanLimit ?? HOLD_SCAN_LIMIT;

    // ① 枠の再評価（🔴 時刻ではなく `decideProviderQuota` で判定する）。
    const quotaInput = {
      envLimit: deps.providerDailyQuota,
      provider: await readProviderQuota(deps),
      localSent24h: await deps.providerSentCounter.countLast24h(now),
      now,
    };
    const decision = decideProviderQuota(quotaInput);
    const usage = providerQuotaUsage(quotaInput);
    const headroom = decision.kind === 'ALLOW' ? decision.headroom : 0;

    const rows = await listHeldEmailDispatches(ctx, { limit });
    const proposals = await listHeldProposalSends(ctx, { limit });

    // 🔴 判定材料は 1 回だけ読む（行ごとに読むと、走査中に変わって「同じ実行の中で判断が割れる」ことが起きる）。
    const domainVerified = (await resolveVerifiedSendingDomain(ctx)) !== null;
    const facts: ProposalHoldFacts = {
      domainVerified,
      tenantExecutable: proposals.length === 0 ? true : await readTenantExecutable(ctx),
      dailyQuotaHasRoom: proposals.length === 0 ? true : await readDailyQuotaHasRoom(deps, ctx, now),
    };

    let domainReleased = 0;
    let quotaReleased = 0;
    let sendHoldsReleased = 0;
    let sendHoldsBlocked = 0;
    const quotaCandidates: QuotaCandidate[] = [];

    // ② 提案の保留（`PROVIDER_QUOTA` 以外）。解消していれば同じ `attemptSeq` で再 enqueue。
    for (const row of proposals) {
      if (row.reasonKey === 'PROVIDER_QUOTA') {
        quotaCandidates.push({ kind: 'PROPOSAL', at: row.since, row });
        continue;
      }
      if (!isProposalHoldResolved(row.reasonKey, facts)) continue;
      const result = await releaseProposalSendHold(ctx, deps, row);
      if (result === 'RELEASED') sendHoldsReleased += 1;
      if (result === 'BLOCKED') sendHoldsBlocked += 1;
    }

    // ③ メールの保留。`HELD_DOMAIN_UNVERIFIED` はドメイン、`HELD_PROVIDER_QUOTA` は枠の配分へ。
    for (const row of rows) {
      if (row.status === 'HELD_DOMAIN_UNVERIFIED') {
        // 🔴 解消していなければ触らない（保留のまま次回へ）。
        if (!domainVerified) continue;
        if (await releaseOne(deps, ctx, row)) domainReleased += 1;
        continue;
      }
      // `heldAt` は保留行では常に入っている（`holdEmailDispatch` が同時に書く）。無ければ最も古い扱い（0）にして先に配る。
      quotaCandidates.push({ kind: 'EMAIL', at: row.heldAt ?? new Date(0), row });
    }

    // ④ 🔴 送信基盤の枠は提案とメールで**同じ枠**（§8.3-Q ⑥）。全体で古い順に `headroom` 件だけ。残りは次回。
    quotaCandidates.sort((a, b) => a.at.getTime() - b.at.getTime());
    let remaining = headroom;
    for (const candidate of quotaCandidates) {
      if (remaining <= 0) break;
      if (candidate.kind === 'PROPOSAL') {
        const result = await releaseProposalSendHold(ctx, deps, candidate.row);
        if (result === 'BLOCKED') sendHoldsBlocked += 1;
        if (result !== 'RELEASED') continue;
        sendHoldsReleased += 1;
        remaining -= 1;
        continue;
      }
      if (await releaseOne(deps, ctx, candidate.row)) {
        quotaReleased += 1;
        remaining -= 1;
      }
    }

    const warning = isProviderQuotaWarning(usage, deps.providerQuotaWarnRatio);
    // ⑤ 🔴 接近の目印を維持する（T-12-17 ⑤）。表示専用なので、目印を書けなくても復帰の結果は変えない
    //    （`A-005` は `nearingSince: null` で項目 13 を成立させる。`mail-provider-quota.ts` と同じ扱い）。
    try {
      await deps.nearingMarker.observe(warning, now);
    } catch {
      // 表示専用の揮発値。失敗はこのジョブの失敗にしない。
    }

    return {
      scanned: rows.length,
      domainReleased,
      quotaReleased,
      proposalsScanned: proposals.length,
      sendHoldsReleased,
      sendHoldsBlocked,
      headroom,
      warning,
    };
  };
}

/**
 * 1 行の復帰（docs/05 §9.4 の復帰手順）。
 *
 * 🔴 分岐は「平文トークンが残っているか」の一点である:
 *    - `account.mail` 由来（招待 / 再設定）… 残っていない → **トークン再発行**
 *    - それ以外の運用メール          … 本文は DB 側にある → `QUEUED` へ戻して再 enqueue
 * 🔴 どちらも CAS（`WHERE status = 保留状態`）で 1 回に収束する。0 件は「他の実行が処理済み」
 *    であり正常系（10 分ごとに走るジョブが重なりうる）。
 */
async function releaseOne(
  deps: SendHoldReleaseDeps,
  ctx: SystemTenantCtx,
  row: HeldEmailDispatchRow,
): Promise<boolean> {
  if (isAccountMailTemplateKey(row.templateKey)) {
    return (await deps.reissueAccountMail(ctx, row)) === 'REISSUED';
  }

  // 🔴 `email.dispatch` の payload は分類 1 / 2 / 分類外しか載せられない
  //    （`OperationalMailDispatch`）。業務上の外部送信（分類 3 / 4）の運用メールは存在しない
  //    ため、ここで分類が合わないことは実装バグである。**黙って送らずに落とす**
  //    （型の前提が崩れている）。
  // 🔴 CAS の**前**に判定する。後ろに置くと「`QUEUED` に戻したのに enqueue しない行」が残り、
  //    保留にも戻らないので `send.hold-release` の走査対象から外れる（永久に届かない）。
  if (!isOperationalMailRecipientClass(row.recipientClass)) {
    throw new Error(
      `保留の復帰で宛先分類 '${row.recipientClass}' の運用メールが現れました（docs/05 §9.4）。` +
        'email.dispatch は分類 1 / 2 / 分類外しか運べません。',
    );
  }

  if (!(await requeueHeldEmailDispatch(ctx, { dispatchId: row.dispatchId, fromStatus: row.status }))) {
    return false;
  }

  await deps.enqueueEmailDispatch({
    dispatchId: row.dispatchId,
    tenantId: ctx.tenantId,
    recipientClass: row.recipientClass,
  });
  return true;
}
