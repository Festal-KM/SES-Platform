// apps/worker/src/jobs/send-hold-release.ts
// `send.hold-release`（毎 10 分。docs/05 §9.4 / §10.4 / §8.3 / §8.3-Q）。T-04-04。
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
// ② **`ALLOW` の `headroom` 件だけ**、`heldAt` の**古い順**に復帰させる。全件戻すと、
//    戻した先で全件が再保留され、10 分ごとに往復するだけになる。
// ③ 🔴 **`Proposal` / `Contract` の `sendHoldReasonKey='PROVIDER_QUOTA'` と同じ枠を分け合う**
//    （§8.3-Q ⑥）。本タスクの時点では `send.*` 側が未実装のため `releaseSendHolds` を
//    **必須の seam** として受け取る（既定値を置かない = 実装が入るまで「配ったつもりで
//    配れていない」状態を作らない）。SP-09 T-09-06 がここに実装を挿す。
// ④ 招待・パスワード再設定は**平文トークンが残っていない**（payload と共に消えた）。
//    したがって復帰は**トークンの再発行**でしか行えない（§8.3 の手順を `HELD_DOMAIN_UNVERIFIED` と
//    共用する。CAS の `WHERE status` だけが違う）。実装は T-04-05 が `reissueAccountMail` に挿す。
// ⑤ 🔴 **再 enqueue されたジョブは §8.3-Q の判定を最初から通る**（`held_at` を NULL に戻す）。
//    保留を経たものだけが判定を免れる経路を作らない。
import type { HostOrPlatformDispatch, EmailSender, ProviderSendCounter } from '@ses/connectors';
import { isHostOrPlatformRecipientClass } from '@ses/connectors';
import {
  listHeldEmailDispatches,
  requeueHeldEmailDispatch,
  resolveVerifiedSendingDomain,
  systemTenantCtx,
  type HeldEmailDispatchRow,
  type SystemTenantCtx,
} from '@ses/db';
import {
  decideProviderQuota,
  isProviderQuotaWarning,
  providerQuotaUsage,
  type ProviderQuotaObservation,
} from '@ses/domain';
import { isAccountMailTemplateKey } from './account-mail.js';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const SEND_HOLD_RELEASE_JOB = 'send.hold-release';

/** 🔴 毎 10 分（docs/05 §9.4）。時刻の出所はここ 1 箇所。 */
export const SEND_HOLD_RELEASE_SCHEDULE = { cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' } as const;

/**
 * 1 回の実行で走査する保留行の上限。
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

/**
 * 🔴 `Proposal` / `Contract` 側の `sendHoldReasonKey='PROVIDER_QUOTA'` 保留を復帰させる seam
 *    （§8.3-Q ⑥ / SP-04 完了判定 8-③）。
 *
 * @param headroom この実行で使える枠（`decideProviderQuota` の `ALLOW` のときのみ 1 以上）
 * @returns 実際に使った件数（残りをメール側が使う）
 *
 * 🔴 SP-09 T-09-06 は **`decideProviderQuota` を再利用する**こと（2 実装にしない）。
 *    その際、`sendHoldSince` と `heldAt` を突き合わせて**全体で古い順**に配ること
 *    （現状はメールより先に `send.*` へ配る = 送信系を優先する。取引先へ届く提案・契約書の
 *    ほうが業務上の期限に近いため、暫定の優先順としてはこちらが安全側である）。
 */
export type SendHoldRelease = (input: { readonly headroom: number }) => Promise<number>;

export type SendHoldReleaseDeps = {
  /** 🔴 `getQuota()` のためだけに受け取る。**`send` を呼ばない**（このジョブは外部へ送らない）。 */
  readonly emailSender: Pick<EmailSender, 'getQuota'>;
  readonly providerDailyQuota: number;
  /** `MAIL_PROVIDER_QUOTA_WARN_RATIO`（`packages/config`。既定 0.8）。`A-005` 項目 13 の接近判定。 */
  readonly providerQuotaWarnRatio: number;
  /** 🔴 `SesEmailSender` に渡したものと同一のインスタンス（`email-send.ts` と同じ規律）。 */
  readonly providerSentCounter: ProviderSendCounter;
  /** 保留中の運用メールを `email.dispatch` へ戻す。 */
  readonly enqueueEmailDispatch: (job: HostOrPlatformDispatch) => Promise<void>;
  /** 🔴 T-04-05 が実装する（既定値を置かない）。 */
  readonly reissueAccountMail: AccountMailReissue;
  /** 🔴 SP-09 T-09-06 が実装する（既定値を置かない）。 */
  readonly releaseSendHolds: SendHoldRelease;
  readonly now: () => Date;
  readonly scanLimit?: number;
};

export type SendHoldReleaseOutcome = {
  /** 走査した保留行の数。 */
  readonly scanned: number;
  /** `HELD_DOMAIN_UNVERIFIED` から復帰させた数（ドメインが検証済みになったもの）。 */
  readonly domainReleased: number;
  /** `HELD_PROVIDER_QUOTA` から復帰させた数（メール）。 */
  readonly quotaReleased: number;
  /** `send.*`（`Proposal` / `Contract`）側が使った枠。 */
  readonly sendHoldsReleased: number;
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

export type SendHoldReleaseHandler = (payload: unknown, jobId: string) => Promise<SendHoldReleaseOutcome>;

export function createSendHoldReleaseHandler(deps: SendHoldReleaseDeps): SendHoldReleaseHandler {
  return async (payload, jobId) => {
    const job = parseSendHoldReleasePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: SEND_HOLD_RELEASE_JOB, jobId });
    const now = deps.now();

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

    // ② 🔴 `send.*` と同じ枠を分け合う（§8.3-Q ⑥）。使われた分だけメール側の取り分が減る。
    const sendHoldsReleased = headroom === 0 ? 0 : await deps.releaseSendHolds({ headroom });
    let remaining = Math.max(0, headroom - sendHoldsReleased);

    const rows = await listHeldEmailDispatches(ctx, { limit: deps.scanLimit ?? HOLD_SCAN_LIMIT });

    // 🔴 ドメイン検証の状態は 1 回だけ読む（行ごとに読むと、走査中に変わって
    //    「同じ実行の中で判断が割れる」ことが起きる）。
    const domainVerified = (await resolveVerifiedSendingDomain(ctx)) !== null;

    let domainReleased = 0;
    let quotaReleased = 0;

    // ③ `heldAt` の古い順（`listHeldEmailDispatches` が保証する）。
    for (const row of rows) {
      if (row.status === 'HELD_DOMAIN_UNVERIFIED') {
        // 🔴 解消していなければ触らない（保留のまま次回へ）。
        if (!domainVerified) continue;
        if (await releaseOne(deps, ctx, row)) domainReleased += 1;
        continue;
      }
      // `HELD_PROVIDER_QUOTA`。🔴 枠の分だけ。残りは次回に持ち越す。
      if (remaining <= 0) continue;
      if (await releaseOne(deps, ctx, row)) {
        quotaReleased += 1;
        remaining -= 1;
      }
    }

    return {
      scanned: rows.length,
      domainReleased,
      quotaReleased,
      sendHoldsReleased,
      headroom,
      warning: isProviderQuotaWarning(usage, deps.providerQuotaWarnRatio),
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

  // 🔴 `email.dispatch` の payload は分類 1 / 分類外しか載せられない（`HostOrPlatformDispatch`）。
  //    分類 2 / 3 / 4 の運用メールは存在しない（`account.mail` 側に入る）ため、ここで
  //    分類が合わないことは実装バグである。**黙って送らずに落とす**（型の前提が崩れている）。
  // 🔴 CAS の**前**に判定する。後ろに置くと「`QUEUED` に戻したのに enqueue しない行」が残り、
  //    保留にも戻らないので `send.hold-release` の走査対象から外れる（永久に届かない）。
  if (!isHostOrPlatformRecipientClass(row.recipientClass)) {
    throw new Error(
      `保留の復帰で宛先分類 '${row.recipientClass}' の運用メールが現れました（docs/05 §9.4）。` +
        'email.dispatch は分類 1 / 分類外しか運べません。',
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
