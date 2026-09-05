// apps/worker/src/jobs/domain-verify.ts
// `domain.verify`（#72）と `domain.recheck`（毎日 05:30 JST）。docs/05 §8.3「検証」/ §9.9。T-04-04。
//
// 🔴 2 つを 1 ファイルに置く理由: **判定の本体が同じ**だからである
//    （`GetEmailIdentity` → `decideSendingDomainVerification` → DB へ反映）。
//    違うのは対象の選び方（1 件 / `state='VERIFIED'` の全件）だけであり、判定を 2 箇所に書くと
//    「利用者の再確認では通るのに、日次の再確認では失効する」ような食い違いが生まれる。
//
// 🔴 `state` は 4 値の**状態であってエラーではない**（`docs/04` 申し送り 8 / `S-036`）。
//    `FAILED` の最も多い原因は「DNS がまだ反映されていない」であり、障害ではない。
//    したがってこのジョブは**未検証でも throw しない**（正常終了して状態を返す）。
//
// 🔴 このジョブもメールを 1 通も送らない（deps は `SesIdentityApi` であり `sendEmail` を持たない）。
import { decideSendingDomainVerification, type DomainJob, type SesIdentityApi } from '@ses/connectors';
import {
  expireSendingDomain,
  listVerifiedSendingDomains,
  markSendingDomainVerified,
  readSendingDomain,
  systemTenantCtx,
  type SendingDomainRow,
  type SystemTenantCtx,
  type TenantSendingDomainState,
} from '@ses/db';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const DOMAIN_VERIFY_JOB = 'domain.verify';
export const DOMAIN_RECHECK_JOB = 'domain.recheck';

/** 🔴 毎日 05:30 JST（docs/05 §9.9）。時刻の出所はここ 1 箇所。 */
export const DOMAIN_RECHECK_SCHEDULE = { cron: '30 5 * * *', timeZone: 'Asia/Tokyo' } as const;

/** 🔴 payload の形は `@ses/connectors` の `DomainJob` が正（enqueue 側と共有する契約）。 */
export type DomainVerifyPayload = DomainJob;

export function parseDomainVerifyPayload(raw: unknown): DomainVerifyPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(DOMAIN_VERIFY_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return {
    tenantId: requireUuid(DOMAIN_VERIFY_JOB, 'tenantId', record.tenantId),
    sendingDomainId: requireUuid(DOMAIN_VERIFY_JOB, 'sendingDomainId', record.sendingDomainId),
  };
}

export type DomainRecheckPayload = { readonly tenantId: string };

export function parseDomainRecheckPayload(raw: unknown): DomainRecheckPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(DOMAIN_RECHECK_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(DOMAIN_RECHECK_JOB, 'tenantId', record.tenantId) };
}

export type DomainVerifyDeps = {
  readonly identityApi: SesIdentityApi;
  readonly now: () => Date;
};

/** #72 の応答（docs/05 §6.3 #72 の `{ state, failureReasonKey? }` の元になる）。 */
export type DomainVerifyOutcome = {
  readonly state: TenantSendingDomainState;
  /** 🔴 文言ではなく**コード**（`SendingDomainFailureReason`）。画面が i18n キーへ写像する。 */
  readonly failureReason: string | null;
};

/**
 * 1 件の検証（`domain.verify` / `domain.recheck` の共通本体）。
 *
 * 🔴 「すべて `SUCCESS`」でのみ検証済みにする（`decideSendingDomainVerification`）。
 *    部分的に成立していても送信を許さない —— DKIM だけ通った状態で送ると SPF が失敗し、
 *    迷惑メール判定される（`docs/03` §3.2.7 の「検証状態の確認を送信前に行う」）。
 */
async function verifyOne(
  deps: DomainVerifyDeps,
  ctx: SystemTenantCtx,
  row: SendingDomainRow,
): Promise<DomainVerifyOutcome> {
  const verification = decideSendingDomainVerification(await deps.identityApi.getEmailIdentity(row.domain));
  const now = deps.now();

  if (verification.verified) {
    await markSendingDomainVerified(ctx, {
      id: row.id,
      verifiedAt: now,
      dkimTokens: verification.dkimTokens,
      mailFromDomain: verification.mailFromDomain,
    });
    return { state: 'VERIFIED', failureReason: null };
  }

  // 🔴 未検証は `state='FAILED'` + `verified_at=NULL`（docs/05 §8.3「検証」）。
  //    検証済みだった行がここへ来た場合は**失効**であり、以後の送信は保留になる
  //    （`A-005` 項目 11 に載る = `state='VERIFIED'` の行が無くなる）。
  await expireSendingDomain(ctx, {
    id: row.id,
    failureReason: verification.failureReason,
    checkedAt: now,
  });
  return { state: 'FAILED', failureReason: verification.failureReason };
}

export type DomainVerifyHandler = (payload: unknown, jobId: string) => Promise<DomainVerifyOutcome>;

export function createDomainVerifyHandler(deps: DomainVerifyDeps): DomainVerifyHandler {
  return async (payload, jobId) => {
    const job = parseDomainVerifyPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: DOMAIN_VERIFY_JOB, jobId });

    const row = await readSendingDomain(ctx, job.sendingDomainId);
    if (row === null) {
      throw new InvalidJobPayloadError(DOMAIN_VERIFY_JOB, 'sendingDomainId に対応する行がありません');
    }
    return verifyOne(deps, ctx, row);
  };
}

export type DomainRecheckOutcome = {
  readonly checked: number;
  /** 🔴 失効したドメイン（`A-005` 項目 11 とテナント管理者への通知の対象。通知は SP-11 / SP-15）。 */
  readonly expired: readonly { readonly id: string; readonly domain: string; readonly failureReason: string }[];
};

export type DomainRecheckHandler = (payload: unknown, jobId: string) => Promise<DomainRecheckOutcome>;

/**
 * `domain.recheck`（毎日 05:30 JST。docs/05 §9.9）。
 *
 * 🔴 **なぜ日次で再確認するか**: DNS レコードは利用者が消せる。消えたまま送り続けると
 *    SPF / DKIM が失敗して迷惑メール判定され、テナント全体のレピュテーションを落とす。
 *    失効させれば以後の送信は保留（`HELD_DOMAIN_UNVERIFIED`）になり、**送ってしまう前に止まる**。
 * 🔴 `GetEmailIdentity` が失敗したら**そのまま throw する**（握り潰して「失効」にしない）。
 *    引けなかったことは「DNS レコードが消えた」の根拠にならず、失効させると送信が
 *    理由なく止まる。`attempts: 3` の再試行で拾い、それでも駄目なら失敗ジョブとして
 *    `A-005` に出す（§9.10）。再実行は冪等である（検証済みは検証済みのまま更新される）。
 * 🔴 部分 UNIQUE `(tenant_id) WHERE state='VERIFIED'` により対象は 1 テナント最大 1 件であり、
 *    「途中で落ちて残りが再確認されない」範囲は構造的に 1 件に収まる。
 */
export function createDomainRecheckHandler(deps: DomainVerifyDeps): DomainRecheckHandler {
  return async (payload, jobId) => {
    const job = parseDomainRecheckPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: DOMAIN_RECHECK_JOB, jobId });

    const rows = await listVerifiedSendingDomains(ctx);
    const expired: { id: string; domain: string; failureReason: string }[] = [];
    for (const row of rows) {
      const outcome = await verifyOne(deps, ctx, row);
      if (outcome.state !== 'VERIFIED' && outcome.failureReason !== null) {
        expired.push({ id: row.id, domain: row.domain, failureReason: outcome.failureReason });
      }
    }
    return { checked: rows.length, expired };
  };
}
