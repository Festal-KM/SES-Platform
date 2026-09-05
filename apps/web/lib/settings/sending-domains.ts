// apps/web/lib/settings/sending-domains.ts
// docs/05 §6.3 #71 `GET/POST /api/settings/sending-domains` / #72 `POST .../{id}/verify`。T-04-04。
//
// 🔴 **状態であってエラーではない**（`docs/04` `program-design` 申し送り 8 / `S-036`）。
//    未検証は「壊れている」ではなく「取引先へ送信できない状態」であり、理由と設定すべき
//    DNS レコードを添えて返す。HTTP のエラーにしない。
//
// 🔴 `sandbox` は共通ドメインで動く（`docs/03` §3.2.7-4）。#72 は `{ state: 'NOT_REQUIRED' }` を
//    返し、検証ジョブを起動しない。**試用中のテナントに DNS 作業を求めない。**
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/connectors` / `@ses/i18n` のみ）。
//    結合テストがサーバを立てずに同じ経路を実行できるようにするため（`settings/organization.ts` と同じ方針）。
import {
  buildDkimCnameRecords,
  buildMailFromRecords,
  mailFromDomainFor,
  type SendingDomainDnsRecord,
} from '@ses/connectors';
import {
  listSendingDomains,
  readSendingDomain,
  registerSendingDomain,
  type AuthenticatedTenantCtx,
  type SendingDomainRow,
  type TenantSendingDomainState,
} from '@ses/db';
import type { MessageKey } from '@ses/i18n';
import { NotFoundError } from '../api/errors';
import { requireDomainJobQueue, type DomainJobQueue } from '../jobs/domain-jobs';

/**
 * 🔴 `sandbox` を含む「検証を求めない」状態（`docs/03` §3.2.7-4）。
 *    `TenantSendingDomainState` の 4 値に**足さない**（DB の CHECK は 4 値のままである）。
 *    これは応答上の状態であり、行の状態ではない。
 */
export const SENDING_DOMAIN_NOT_REQUIRED = 'NOT_REQUIRED';

export type SendingDomainResponseState = TenantSendingDomainState | typeof SENDING_DOMAIN_NOT_REQUIRED;

/**
 * 🔴 送信ドメインの検証状態が影響する画面（docs/05 §6.3 #71 の `affects`）。
 *    「何ができないのか」を利用者に示すためのもの（機能を隠さない。`docs/02` `ui-design` 申し送り 13）。
 */
export const SENDING_DOMAIN_AFFECTS = ['S-021', 'S-024', 'S-026', 'S-014'] as const;

/** #71 の 1 件分の応答。 */
export type SendingDomainView = {
  readonly id: string;
  readonly domain: string;
  readonly state: SendingDomainResponseState;
  /** Easy DKIM の CNAME 3 本（provision 前は空）。 */
  readonly dkimRecords: readonly SendingDomainDnsRecord[];
  /** Custom MAIL FROM の MX / TXT。 */
  readonly mailFromRecords: readonly SendingDomainDnsRecord[];
  readonly verifiedAt: string | null;
  readonly lastCheckedAt: string | null;
  /** 🔴 文言そのものではなくキー（`CLAUDE.md` §3.5 / `BR-32`）。 */
  readonly failureReasonKey: MessageKey | null;
  readonly affects: readonly string[];
};

export type SendingDomainListView = {
  readonly domains: readonly SendingDomainView[];
  /**
   * 🔴 この環境で独自ドメインの検証が要るか（`docs/03` §3.2.7-4 / -5）。
   *    `false` なら共通ドメインで動く（`sandbox` / `demo` / `development`）。
   *    **「できない」ではなく「不要」**であることを画面が示せるようにする。
   */
  readonly required: boolean;
};

/** #72 の応答（docs/05 §6.3 #72）。 */
export type SendingDomainVerifyView = {
  readonly state: SendingDomainResponseState;
  readonly failureReasonKey?: MessageKey;
};

export type SendingDomainRuntime = {
  /** `AWS_REGION`（`packages/config`）。MAIL FROM の MX の値に入る。 */
  readonly region: string;
  /**
   * 🔴 独自ドメインの検証がこの環境で要るか（起動時に解決した `APP_ENV` から決める）。
   *    **リクエストごとに `APP_ENV` を分岐しない**（`CLAUDE.md` §11.1）。
   */
  readonly verificationRequired: boolean;
  /** enqueue 先（未登録なら例外。`CLAUDE.md` §11.1）。 */
  readonly queue?: DomainJobQueue;
};

/** 🔴 失敗理由のコード → i18n キー。**コードを画面へそのまま出さない。** */
const FAILURE_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  DKIM_NOT_VERIFIED: 'settings.sendingDomain.failure.DKIM_NOT_VERIFIED',
  MAIL_FROM_NOT_VERIFIED: 'settings.sendingDomain.failure.MAIL_FROM_NOT_VERIFIED',
  MAIL_FROM_NOT_CONFIGURED: 'settings.sendingDomain.failure.MAIL_FROM_NOT_CONFIGURED',
  IDENTITY_NOT_VERIFIED: 'settings.sendingDomain.failure.IDENTITY_NOT_VERIFIED',
};

/**
 * 🔴 未知のコードを画面へ素通しせず `null` にする。
 *    コードは内部表現であり、そのまま出すと利用者に意味の分からない文字列が見える。
 */
export function failureMessageKeyOf(code: string | null): MessageKey | null {
  if (code === null) return null;
  return FAILURE_MESSAGE_KEYS[code] ?? null;
}

export function toSendingDomainView(row: SendingDomainRow, region: string): SendingDomainView {
  const mailFromDomain = row.mailFromDomain ?? mailFromDomainFor(row.domain);
  return {
    id: row.id,
    domain: row.domain,
    state: row.state,
    dkimRecords: buildDkimCnameRecords(row.domain, row.dkimTokens),
    // 🔴 MAIL FROM のレコードは provision 前でも提示できる（値がドメインから決まるため）。
    //    先に DNS へ入れておけるほうが、検証完了までの往復が 1 回減る。
    mailFromRecords: buildMailFromRecords(mailFromDomain, region),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    failureReasonKey: failureMessageKeyOf(row.lastFailureReason),
    affects: SENDING_DOMAIN_AFFECTS,
  };
}

/** `GET /api/settings/sending-domains`（#71）。 */
export async function readSendingDomainSettings(
  ctx: AuthenticatedTenantCtx,
  runtime: SendingDomainRuntime,
): Promise<SendingDomainListView> {
  const rows = await listSendingDomains(ctx);
  return {
    domains: rows.map((row) => toSendingDomainView(row, runtime.region)),
    required: runtime.verificationRequired,
  };
}

/**
 * `POST /api/settings/sending-domains`（#71）。
 *
 * 🔴 **冪等**である（同じドメインを 2 回登録しても行は 1 つ）。DKIM トークンを作り直すと、
 *    利用者が既に DNS へ入れた CNAME が無効になる（`registerSendingDomain` / `domain.provision`）。
 * 🔴 enqueue に失敗したら**操作ごと失敗させる**（`CLAUDE.md` §11.1）。行だけ作って
 *    「レコードが永久に出てこない」状態にしない。
 */
export async function registerSendingDomainSettings(
  ctx: AuthenticatedTenantCtx,
  input: { readonly domain: string; readonly observedAt: Date },
  runtime: SendingDomainRuntime,
): Promise<SendingDomainView> {
  // 🔴 副作用（行の作成）の**前**にキューの登録を確かめる（`lib/jobs/account-mail.ts` と同じ規律）。
  const queue = runtime.queue ?? requireDomainJobQueue();

  const { row } = await registerSendingDomain(ctx, input);
  await queue.enqueueProvision({ tenantId: ctx.tenantId, sendingDomainId: row.id });
  return toSendingDomainView(row, runtime.region);
}

/**
 * `POST /api/settings/sending-domains/{id}/verify`（#72）。
 *
 * 🔴 `sandbox` では `{ state: 'NOT_REQUIRED' }` を返し、ジョブを起動しない（`docs/03` §3.2.7-4）。
 * 🔴 回数制限を設けない（#72）。DNS の反映待ちは利用者が何度でも確かめてよい ——
 *    確かめられないと「待っているのか壊れているのか」が分からない。
 * 🔴 応答は**現在の状態**である。検証は非同期（`domain.verify`）なので、この応答が
 *    `VERIFIED` に変わるのは次の照会からである。
 */
export async function requestSendingDomainVerification(
  ctx: AuthenticatedTenantCtx,
  input: { readonly sendingDomainId: string },
  runtime: SendingDomainRuntime,
): Promise<SendingDomainVerifyView> {
  if (!runtime.verificationRequired) {
    return { state: SENDING_DOMAIN_NOT_REQUIRED };
  }

  const queue = runtime.queue ?? requireDomainJobQueue();
  // 🔴 存在しない / 他テナントの ID は 404（見えない = 存在しない。docs/05 §4.8）。
  const row = await readSendingDomain(ctx, input.sendingDomainId);
  if (row === null) throw new NotFoundError();

  await queue.enqueueVerify({ tenantId: ctx.tenantId, sendingDomainId: row.id });

  const failureReasonKey = failureMessageKeyOf(row.lastFailureReason);
  return failureReasonKey === null ? { state: row.state } : { state: row.state, failureReasonKey };
}
