// apps/worker/src/jobs/index.ts
// 🔴 スケジュール登録の**唯一の一覧**（docs/05 §9.1「全 Repeatable Job は `runScheduled` の
//    ラッパを通して登録する」）。T-03-10 で `usage.seat-snapshot` の 1 本を置いた。
//
// 🔴 ここに載っていないジョブはスケジュールされない。ジョブを足すときは
//    「ハンドラを書く」だけでなく「この配列に足す」ことが必須になる構造にしてある
//    （登録漏れが「実装したのに一度も走らない」形で本番まで残らないようにするため）。
//
// 🔴 BullMQ の `Queue` / `Worker` をここで作らない（SP-07）。この配列は**宣言**であり、
//    キュー実体への登録は起動処理（T-03-12 以降）が行う。宣言と登録を分けることで、
//    「スケジュール定義」だけを DB もキューも無しにテストできる。
import {
  createDomainRecheckHandler,
  DOMAIN_RECHECK_JOB,
  DOMAIN_RECHECK_SCHEDULE,
  type DomainVerifyDeps,
} from './domain-verify.js';
import {
  createSendHoldReleaseHandler,
  SEND_HOLD_RELEASE_JOB,
  SEND_HOLD_RELEASE_SCHEDULE,
  type SendHoldReleaseDeps,
} from './send-hold-release.js';
import {
  createUsageSeatSnapshotHandler,
  USAGE_SEAT_SNAPSHOT_JOB,
  USAGE_SEAT_SNAPSHOT_SCHEDULE,
  type UsageSeatSnapshotDeps,
} from './usage-seat-snapshot.js';

export {
  createUsageSeatSnapshotHandler,
  parseUsageSeatSnapshotPayload,
  USAGE_SEAT_SNAPSHOT_JOB,
  USAGE_SEAT_SNAPSHOT_SCHEDULE,
} from './usage-seat-snapshot.js';
export type {
  UsageSeatSnapshotDeps,
  UsageSeatSnapshotHandler,
  UsageSeatSnapshotPayload,
} from './usage-seat-snapshot.js';
export { InvalidJobPayloadError, requireNonEmptyString, requireUuid } from './payload.js';
// 🔴 T-04-03: 運用メールと Webhook 受信後の処理（docs/05 §9.4 / §8.5）。
//    いずれも**イベント起動**であり `SCHEDULED_JOBS` には載らない（cron を持たない）。
//    キュー実体（BullMQ）への登録は SP-07 の配線が `QUEUE_DEFINITIONS` を読んで行う。
export {
  createEmailDispatchHandler,
  EMAIL_DISPATCH_JOB,
  parseEmailDispatchPayload,
  PlatformDispatchNotSupportedError,
} from './email-dispatch.js';
export type { EmailDispatchDeps, EmailDispatchHandler } from './email-dispatch.js';
export {
  ACCOUNT_MAIL_JOB,
  ACCOUNT_MAIL_TEMPLATE_KEY,
  buildAccountMailLink,
  createAccountMailHandler,
  isAccountMailTemplateKey,
  parseAccountMailPayload,
} from './account-mail.js';
export type { AccountMailDeps, AccountMailHandler } from './account-mail.js';
export { performEmailSend, resolveSendingDomainFromDb } from './email-send.js';
export type { EmailSendDeps, EmailSendOutcome, EmailSendRequest } from './email-send.js';
// 🔴 T-04-04: 送信元ドメインの登録・検証（docs/05 §8.3 / §9.9）。`domain.provision` /
//    `domain.verify` はイベント起動（API-A4 / #71 / #72）、`domain.recheck` は日次で
//    `SCHEDULED_JOBS` に載る。
export {
  createDomainProvisionHandler,
  DOMAIN_PROVISION_JOB,
  parseDomainProvisionPayload,
} from './domain-provision.js';
export type {
  DomainProvisionDeps,
  DomainProvisionHandler,
  DomainProvisionOutcome,
  DomainProvisionPayload,
} from './domain-provision.js';
export {
  createDomainRecheckHandler,
  createDomainVerifyHandler,
  DOMAIN_RECHECK_JOB,
  DOMAIN_RECHECK_SCHEDULE,
  DOMAIN_VERIFY_JOB,
  parseDomainRecheckPayload,
  parseDomainVerifyPayload,
} from './domain-verify.js';
export type {
  DomainRecheckHandler,
  DomainRecheckOutcome,
  DomainRecheckPayload,
  DomainVerifyDeps,
  DomainVerifyHandler,
  DomainVerifyOutcome,
  DomainVerifyPayload,
} from './domain-verify.js';
// 🔴 T-04-04: 保留の自動復帰（docs/05 §9.4 / §8.3-Q）。外部 API を呼ばない。
export {
  createSendHoldReleaseHandler,
  HOLD_SCAN_LIMIT,
  parseSendHoldReleasePayload,
  SEND_HOLD_RELEASE_JOB,
  SEND_HOLD_RELEASE_SCHEDULE,
} from './send-hold-release.js';
export type {
  AccountMailReissue,
  SendHoldRelease,
  SendHoldReleaseDeps,
  SendHoldReleaseHandler,
  SendHoldReleaseOutcome,
  SendHoldReleasePayload,
} from './send-hold-release.js';
// 🔴 T-04-05: `reissueAccountMail` seam の実体（docs/05 §8.3 の復帰手順）。
//    SP-07 の配線は `createAccountMailReissue(...)` の戻り値を `SendHoldReleaseDeps` に渡す
//    （既定値を置かない = 渡し忘れたらコンパイルエラーになる）。
export {
  createAccountMailReissue,
  UnparsableAccountMailDedupeKeyError,
} from './account-mail-reissue.js';
export type { AccountMailReissueDeps } from './account-mail-reissue.js';
export {
  createWebhookProcessHandler,
  parseWebhookProcessPayload,
  WEBHOOK_PROCESS_JOB,
} from './webhook-process.js';
export type { WebhookProcessDeps, WebhookProcessHandler, WebhookProcessOutcome } from './webhook-process.js';

/**
 * ジョブの合成に要る値（起動時に 1 度だけ解決する。`CLAUDE.md` §11.1 / docs/05 §13.1）。
 *
 * 🔴 交差型にする（合併にしない）。スケジュール宣言は 1 つの `deps` を全ハンドラへ渡すため、
 *    どのジョブが何を要るかを型が積み上げる。**足りない値のまま起動できない**ことが要点である
 *    （足りなければ SP-07 の配線がコンパイルエラーになる）。
 */
export type ScheduledJobDeps = UsageSeatSnapshotDeps & DomainVerifyDeps & SendHoldReleaseDeps;

/**
 * スケジュール実行するジョブの宣言。
 *
 * 🔴 `payload` は含まない。**スケジュールジョブはいずれもテナントごとに 1 ジョブ**であり
 *    （docs/05 §9.1「payload に `tenantId` を必ず含める」）、テナントの列挙と
 *    ファンアウトはキューを配線する SP-07 の責務である。ここが持つのは
 *    「いつ・何という名前で・どのハンドラが走るか」までである。
 *
 * 🔴 `domain.recheck`（docs/05 §9.9 は「`state='VERIFIED'` の全ドメイン」と書く）も
 *    `send.hold-release`（同 §9.4）も、テナント単位のファンアウトで全体を覆う。
 *    ジョブ本体をテナント文脈（`systemTenantCtx`）に閉じることで、RLS の外側で全テナントを
 *    横断するクエリを 1 つも書かずに済む（`CLAUDE.md` §3.1）。
 */
export type ScheduledJobDeclaration = {
  readonly name: string;
  readonly cron: string;
  readonly timeZone: string;
  readonly createHandler: (deps: ScheduledJobDeps) => (payload: unknown, jobId: string) => Promise<unknown>;
};

export const SCHEDULED_JOBS: readonly ScheduledJobDeclaration[] = [
  {
    name: USAGE_SEAT_SNAPSHOT_JOB,
    cron: USAGE_SEAT_SNAPSHOT_SCHEDULE.cron,
    timeZone: USAGE_SEAT_SNAPSHOT_SCHEDULE.timeZone,
    createHandler: (deps) => createUsageSeatSnapshotHandler(deps),
  },
  // 🔴 T-04-04: 検証済みドメインの日次再確認（docs/05 §9.9）。DNS レコードが消えたまま
  //    送り続けると SPF / DKIM が失敗して迷惑メール判定される。失効させれば以後の送信は
  //    保留になり、**送ってしまう前に止まる**。
  {
    name: DOMAIN_RECHECK_JOB,
    cron: DOMAIN_RECHECK_SCHEDULE.cron,
    timeZone: DOMAIN_RECHECK_SCHEDULE.timeZone,
    createHandler: (deps) => createDomainRecheckHandler(deps),
  },
  // 🔴 T-04-04: 保留の自動復帰（docs/05 §9.4）。**これが無いと `HELD_*` は永久に届かない。**
  //    `F-054 AC-9` / `F-064 AC-10` はメールの到達を前提に完了判定を書いている（SP-04 §T-04-04）。
  {
    name: SEND_HOLD_RELEASE_JOB,
    cron: SEND_HOLD_RELEASE_SCHEDULE.cron,
    timeZone: SEND_HOLD_RELEASE_SCHEDULE.timeZone,
    createHandler: (deps) => createSendHoldReleaseHandler(deps),
  },
];
