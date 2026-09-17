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
  createScanPollHandler,
  SCAN_POLL_JOB,
  SCAN_POLL_SCHEDULE,
  type ScanPollDeps,
} from './scan-poll.js';
import {
  createUsageSeatSnapshotHandler,
  USAGE_SEAT_SNAPSHOT_JOB,
  USAGE_SEAT_SNAPSHOT_SCHEDULE,
  type UsageSeatSnapshotDeps,
} from './usage-seat-snapshot.js';
import {
  createGateHoldReleaseHandler,
  GATE_HOLD_RELEASE_JOB,
  GATE_HOLD_RELEASE_SCHEDULE,
  type GateHoldReleaseDeps,
} from './gate-hold-release.js';
import {
  createProposalRequestExpireHandler,
  PROPOSAL_REQUEST_EXPIRE_JOB,
  PROPOSAL_REQUEST_EXPIRE_SCHEDULE,
  type ProposalRequestExpireDeps,
} from './proposal-request-expire.js';
import {
  createUsageDailyRollupHandler,
  USAGE_DAILY_ROLLUP_JOB,
  USAGE_DAILY_ROLLUP_SCHEDULE,
  type UsageDailyRollupDeps,
} from './usage-daily-rollup.js';
import {
  createUsageGapCheckHandler,
  USAGE_GAP_CHECK_JOB,
  USAGE_GAP_CHECK_SCHEDULE,
  type UsageGapCheckDeps,
} from './usage-gap-check.js';
import {
  createUsageStorageReconcileHandler,
  USAGE_STORAGE_RECONCILE_JOB,
  USAGE_STORAGE_RECONCILE_SCHEDULE,
  type UsageStorageReconcileDeps,
} from './usage-storage-reconcile.js';
import {
  COST_MONTHLY_ROLLUP_JOB,
  COST_MONTHLY_ROLLUP_SCHEDULE,
  createCostMonthlyRollupHandler,
  type CostMonthlyRollupDeps,
} from './cost-monthly-rollup.js';
import {
  createUsageLimitCheckHandler,
  USAGE_LIMIT_CHECK_JOB,
  USAGE_LIMIT_CHECK_SCHEDULE,
  type UsageLimitCheckDeps,
} from './usage-limit-check.js';
import {
  createSendSettleUnknownHandler,
  SEND_SETTLE_UNKNOWN_JOB,
  SEND_SETTLE_UNKNOWN_SCHEDULE,
  type SendSettleUnknownDeps,
} from './send-settle-unknown.js';

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
// 🔴 T-05-08: `email.dispatch` の差し込み値の実体（docs/05 §9.4 の `resolveTemplateParams`）。
//    SP-07 の配線はこれを渡す（渡さないと運用メールが空欄で届く）。
export {
  createOperationalMailParamsResolver,
  UnknownOperationalMailTemplateError,
} from './operational-mail-params.js';
export type { OperationalMailParamsDeps } from './operational-mail-params.js';
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
  SendHoldReleaseDeps,
  SendHoldReleaseHandler,
  SendHoldReleaseOutcome,
  SendHoldReleasePayload,
} from './send-hold-release.js';
// 🔴 T-09-06: 提案の送信（docs/05 §10.2 の実行順序そのもの。`F-022`）。**イベント起動**であり `SCHEDULED_JOBS` には
//    載らない。enqueue は #43 / #44（`apps/web`）と `send.hold-release`（同じ `attemptSeq` の再 enqueue）が行う。
//    🔴 `attempts: 1`（`packages/connectors/src/queues.ts`）。外部呼び出しの後に再試行しない（`BR-22`）。
export {
  createSendProposalHandler,
  parseSendProposalPayload,
  PROPOSAL_SEND_TRANSITIONS,
  PROPOSAL_SUBMISSION_TEMPLATE_KEY,
  resolveProposalSendingDomainFromDb,
  SEND_PROPOSAL_JOB,
  sendAttemptOriginOf,
} from './send-proposal.js';
export type { SendProposalDeps, SendProposalHandler, SendProposalOutcome, SendProposalPayload } from './send-proposal.js';
// 🔴 T-09-06: `send.hold-release` の `Proposal` 側（保留の解消判定と 1 件の復帰手順）。外部 API を呼ばない。
export { isProposalHoldResolved, releaseProposalSendHold } from './send-proposal-holds.js';
export type { ProposalHoldFacts, ProposalHoldReleaseDeps, ProposalHoldReleaseResult } from './send-proposal-holds.js';
// 🔴 T-09-07: `SUBMITTING` 滞留の確定（docs/05 §10.6「T-09-07 の実装の決着」。毎 10 分）。**外部 API を呼ばず、
//    `APPROVED` に戻さず、試行を作らない** —— 片道を完結させるだけ（自動リトライではない）。下の `SCHEDULED_JOBS` に載る。
export {
  createSendSettleUnknownHandler,
  parseSendSettleUnknownPayload,
  SEND_SETTLE_UNKNOWN_JOB,
  SEND_SETTLE_UNKNOWN_SCHEDULE,
} from './send-settle-unknown.js';
export type {
  SendSettleUnknownDeps,
  SendSettleUnknownHandler,
  SendSettleUnknownOutcome,
  SendSettleUnknownPayload,
} from './send-settle-unknown.js';
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
// 🔴 T-05-05: ウイルススキャン結果の適用（イベント起動）と滞留の保険（毎 5 分）。
//    docs/05 §8.5 / §9.6。どちらも外部への**書き込み**を行わない（`attempts: 3`）。
export {
  createScanApplyResultHandler,
  parseScanApplyResultPayload,
  SCAN_APPLY_RESULT_JOB,
} from './scan-apply-result.js';
export type {
  ScanApplyResultDeps,
  ScanApplyResultHandler,
  ScanApplyResultOutcome,
} from './scan-apply-result.js';
export {
  createScanPollHandler,
  parseScanPollPayload,
  SCAN_POLL_JOB,
  SCAN_POLL_LIMIT,
  SCAN_POLL_SCHEDULE,
} from './scan-poll.js';
export type { ScanPollDeps, ScanPollHandler, ScanPollOutcome, ScanPollPayload } from './scan-poll.js';
// 🔴 T-05-08: 隔離の周知（`docs/02` `F-011` 処理④）。`scan.apply-result` / `scan.poll` の
//    **両方**が同じ関数を通す（周知が片方の経路だけで落ちることを構造として防ぐ）。
export {
  notifyScanQuarantine,
  scanQuarantineTargetId,
  SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
} from './scan-quarantine-notice.js';
export type {
  ScanQuarantineNoticeDeps,
  ScanQuarantineNoticeOutcome,
} from './scan-quarantine-notice.js';
// 🔴 T-07-06: 品質ゲートのパイプライン（docs/05 §9.3 / §11。`F-020`）。**イベント起動**であり
//    `SCHEDULED_JOBS` には載らない（cron を持たない）。enqueue は #39（T-07-08）と
//    `gate.hold-release`（T-07-10）が行う。
// 🔴 `attempts: 1`（`packages/connectors/src/queues.ts`）。LLM の再試行は `runRole` の内部で完結する。
export {
  createGateRunHandler,
  GATE_RUN_JOB,
  parseGateRunPayload,
} from './gate-run.js';
export type { GateRunDeps, GateRunHandler, GateRunOutcome, GateRunPayload } from './gate-run.js';
// 🔴 T-07-10: AI の日次コスト上限で保留したゲートの**自動復帰**（docs/05 §9.3 / `F-027 AC-5`）。
//    毎 10 分のスケジュールジョブであり、下の `SCHEDULED_JOBS` に載る。
//    🔴 積める先は `gate.run` だけである（`tests/static/gate-hold-release-enqueue.test.ts`）。
export {
  createGateHoldReleaseHandler,
  GATE_HOLD_RELEASE_JOB,
  GATE_HOLD_RELEASE_SCHEDULE,
  GATE_HOLD_SCAN_LIMIT,
  parseGateHoldReleasePayload,
} from './gate-hold-release.js';
export type {
  GateHoldReleaseDeps,
  GateHoldReleaseHandler,
  GateHoldReleaseOutcome,
  GateHoldReleasePayload,
} from './gate-hold-release.js';
// 🔴 T-08-07: 提案依頼の期限切れ（docs/05 §9.5。毎日 03:20 JST）。**外部 API を呼ばない**（`attempts: 3`）。
//    本体は `packages/db` の `expireProposalRequests`（遷移表 + CAS + 監査）。下の `SCHEDULED_JOBS` に載る。
export {
  createProposalRequestExpireHandler,
  parseProposalRequestExpirePayload,
  PROPOSAL_REQUEST_EXPIRE_JOB,
  PROPOSAL_REQUEST_EXPIRE_SCHEDULE,
} from './proposal-request-expire.js';
export type {
  ProposalRequestExpireDeps,
  ProposalRequestExpireHandler,
  ProposalRequestExpireOutcome,
  ProposalRequestExpirePayload,
} from './proposal-request-expire.js';
// 🔴 T-10-02: 計測の突き合わせ・連続性の検査・検算・月次集計（docs/05 §9.8 / `F-026 AC-3`〜`AC-5`）。
//    4 本とも日次のスケジュールジョブで、下の `SCHEDULED_JOBS` に載る。**外部への書き込みを 1 つも行わない**
//    （`usage.storage-reconcile` はオブジェクトストアを読むだけ）。🔴 `AI_UNIT_*`（件数）はどのジョブも
//    数え直さない・書かない。
export {
  createUsageDailyRollupHandler,
  parseUsageDailyRollupPayload,
  USAGE_DAILY_ROLLUP_JOB,
  USAGE_DAILY_ROLLUP_SCHEDULE,
} from './usage-daily-rollup.js';
export type {
  UsageDailyRollupDeps,
  UsageDailyRollupHandler,
  UsageDailyRollupOutcome,
  UsageDailyRollupPayload,
} from './usage-daily-rollup.js';
export {
  createUsageGapCheckHandler,
  parseUsageGapCheckPayload,
  USAGE_GAP_CHECK_JOB,
  USAGE_GAP_CHECK_SCHEDULE,
} from './usage-gap-check.js';
export type {
  UsageGapCheckDeps,
  UsageGapCheckHandler,
  UsageGapCheckJobOutcome,
  UsageGapCheckPayload,
} from './usage-gap-check.js';
export {
  createUsageStorageReconcileHandler,
  parseUsageStorageReconcilePayload,
  USAGE_STORAGE_RECONCILE_JOB,
  USAGE_STORAGE_RECONCILE_SCHEDULE,
} from './usage-storage-reconcile.js';
export type {
  UsageStorageReconcileDeps,
  UsageStorageReconcileHandler,
  UsageStorageReconcileOutcome,
  UsageStorageReconcilePayload,
} from './usage-storage-reconcile.js';
export {
  billingTermsNotRecorded,
  COST_MONTHLY_ROLLUP_JOB,
  COST_MONTHLY_ROLLUP_SCHEDULE,
  createCostMonthlyRollupHandler,
  parseCostMonthlyRollupPayload,
  resolveEmailTenantsBillingPolicy,
} from './cost-monthly-rollup.js';
export type {
  BillingTermsReader,
  CostMonthlyRollupDeps,
  CostMonthlyRollupHandler,
  CostMonthlyRollupOutcome,
  CostMonthlyRollupPayload,
  EmailTenantsBillingPolicy,
} from './cost-monthly-rollup.js';
// 🔴 T-10-03: 上限到達の判定・記録・通知（docs/02 `F-027` 処理①〜⑤ / docs/05 §5.8）。毎 10 分のスケジュール
//    ジョブで、下の `SCHEDULED_JOBS` に載る。**LLM も外部 API も呼ばない**（`attempts: 3`）。通知は既存の
//    `email.dispatch` 経路（`notifyUsageLimit`）だけを使い、新しい送信経路を作らない。
export {
  createUsageLimitCheckHandler,
  parseUsageLimitCheckPayload,
  USAGE_LIMIT_CHECK_JOB,
  USAGE_LIMIT_CHECK_SCHEDULE,
} from './usage-limit-check.js';
export type {
  TenantUsageLimits,
  UsageLimitCheckDeps,
  UsageLimitCheckHandler,
  UsageLimitCheckOutcome,
  UsageLimitCheckPayload,
} from './usage-limit-check.js';
export {
  notifyUsageLimit,
  USAGE_LIMIT_NOTICE_TEMPLATE_KEY,
  usageLimitNoticeTargetId,
} from './usage-limit-notice.js';
export type { UsageLimitNoticeDeps, UsageLimitNoticeInput } from './usage-limit-notice.js';

/**
 * ジョブの合成に要る値（起動時に 1 度だけ解決する。`CLAUDE.md` §11.1 / docs/05 §13.1）。
 *
 * 🔴 交差型にする（合併にしない）。スケジュール宣言は 1 つの `deps` を全ハンドラへ渡すため、
 *    どのジョブが何を要るかを型が積み上げる。**足りない値のまま起動できない**ことが要点である
 *    （足りなければ SP-07 の配線がコンパイルエラーになる）。
 */
export type ScheduledJobDeps = UsageSeatSnapshotDeps &
  DomainVerifyDeps &
  SendHoldReleaseDeps &
  ScanPollDeps &
  // 🔴 T-07-10: `gate.hold-release` が要るのは「モデル解決」「日次上限」「`gate.run` の enqueue 先」。
  //    交差型なので、配線がこの 3 つを渡し忘れたらコンパイルエラーになる（渡し忘れたまま
  //    「スケジュールされているのに 1 件も復帰しない」状態を作らない）。
  GateHoldReleaseDeps &
  // T-08-07: `proposal-request.expire` が要るのは `now` だけ（既に `UsageSeatSnapshotDeps` が持つ）。
  ProposalRequestExpireDeps &
  // 🔴 T-10-02: 計測の 4 本。`usage.gap-check` は遡る日数、`usage.storage-reconcile` はオブジェクトストア、
  //    `cost.monthly-rollup` は契約条件の seam・SES Tenants 課金の方針・単価表の版を要る。
  //    交差型なので配線が渡し忘れたらコンパイルエラーになる。
  UsageDailyRollupDeps &
  UsageGapCheckDeps &
  UsageStorageReconcileDeps &
  CostMonthlyRollupDeps &
  // 🔴 T-10-03: `usage.limit-check` が要るのは「モデル解決」「日次上限」（`gate.hold-release` と共有）に加えて
  //    「件数 4 単位 / メール / ストレージの上限値と 80% の閾値」「`email.dispatch` の enqueue 先」。
  UsageLimitCheckDeps &
  // 🔴 T-09-07: `send.settle-unknown` が要るのは `SUBMITTING_STALL_ALERT_MINUTES` だけ（`A-005` 項目 2 と同じ閾値）。
  //    **`EmailSender` を要らない**ことが「外部を呼ばない」の型での表明である。
  SendSettleUnknownDeps;

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
  // 🔴 T-05-05: スキャン結果が届かなかったときの保険（docs/05 §8.5）。**これが無いと
  //    `SCANNING` のまま滞留したファイルに誰も気づけない**（EventBridge の一度きりの
  //    取りこぼしが、そのファイルの共有不能として恒久的に残る）。
  {
    name: SCAN_POLL_JOB,
    cron: SCAN_POLL_SCHEDULE.cron,
    timeZone: SCAN_POLL_SCHEDULE.timeZone,
    createHandler: (deps) => createScanPollHandler(deps),
  },
  // 🔴 T-07-10: AI の日次コスト上限で保留したゲートの自動復帰（`F-027 AC-5`）。**これが無いと
  //    上限に当たった対象は `GATE_RUNNING` のまま**で、利用者が気づいて手動で再依頼するまで
  //    承認も修正もできない（`docs/02` `F-027 AC-5` は自動復帰を要件として書いている）。
  {
    name: GATE_HOLD_RELEASE_JOB,
    cron: GATE_HOLD_RELEASE_SCHEDULE.cron,
    timeZone: GATE_HOLD_RELEASE_SCHEDULE.timeZone,
    createHandler: (deps) => createGateHoldReleaseHandler(deps),
  },
  // 🔴 T-08-07: 提案依頼の期限切れ（docs/05 §9.5 / `F-018` 処理⑤）。**これが無いと `REQUESTED` は期限を過ぎても
  //    残り続け**、取引先の一覧に「返答待ち」として出続ける（`EXPIRED` は `DECLINED` とも取り下げとも別の終端。
  //    `F-018 AC-5`）。
  {
    name: PROPOSAL_REQUEST_EXPIRE_JOB,
    cron: PROPOSAL_REQUEST_EXPIRE_SCHEDULE.cron,
    timeZone: PROPOSAL_REQUEST_EXPIRE_SCHEDULE.timeZone,
    createHandler: (deps) => createProposalRequestExpireHandler(deps),
  },
  // 🔴 T-10-02: 計測の 4 本（docs/05 §9.8。01:10 / 01:20 / 01:30 / 01:40 JST の順）。**これらが無いと**
  //    `AI_COST_USD` の乖離は直らず、欠測は誰にも見えず（`F-026 AC-4`）、`TenantMonthlyCost` は 1 行も
  //    埋まらない（`F-026 AC-5` / `CLAUDE.md` §10.2「月次を待たずに検知」）。
  {
    name: USAGE_DAILY_ROLLUP_JOB,
    cron: USAGE_DAILY_ROLLUP_SCHEDULE.cron,
    timeZone: USAGE_DAILY_ROLLUP_SCHEDULE.timeZone,
    createHandler: (deps) => createUsageDailyRollupHandler(deps),
  },
  {
    name: USAGE_GAP_CHECK_JOB,
    cron: USAGE_GAP_CHECK_SCHEDULE.cron,
    timeZone: USAGE_GAP_CHECK_SCHEDULE.timeZone,
    createHandler: (deps) => createUsageGapCheckHandler(deps),
  },
  {
    name: USAGE_STORAGE_RECONCILE_JOB,
    cron: USAGE_STORAGE_RECONCILE_SCHEDULE.cron,
    timeZone: USAGE_STORAGE_RECONCILE_SCHEDULE.timeZone,
    createHandler: (deps) => createUsageStorageReconcileHandler(deps),
  },
  {
    name: COST_MONTHLY_ROLLUP_JOB,
    cron: COST_MONTHLY_ROLLUP_SCHEDULE.cron,
    timeZone: COST_MONTHLY_ROLLUP_SCHEDULE.timeZone,
    createHandler: (deps) => createCostMonthlyRollupHandler(deps),
  },
  // 🔴 T-10-03: 上限に対する水準の評価・記録・通知（docs/02 `F-027`。毎 10 分）。**これが無いと**
  //    到達（停止）が `S-038` / `#70` に現れず、80% の通知も監査ログの到達・解除も 1 件も出ない
  //    （`F-027 AC-1` / `AC-4` / 処理⑤）。
  {
    name: USAGE_LIMIT_CHECK_JOB,
    cron: USAGE_LIMIT_CHECK_SCHEDULE.cron,
    timeZone: USAGE_LIMIT_CHECK_SCHEDULE.timeZone,
    createHandler: (deps) => createUsageLimitCheckHandler(deps),
  },
  // 🔴 T-09-07: `SUBMITTING` 滞留の確定（docs/05 §10.6。毎 10 分）。**これが無いと**⑤ の後にプロセスが消えた提案は
  //    `SUBMITTING` のまま誰にも確定されず（`F-022 AC-2` 違反）、利用者の `S-022` には出ず、運営者は read-only で
  //    手が出せない。外部を呼ばず `APPROVED` にも戻さない（自動リトライではない）。
  {
    name: SEND_SETTLE_UNKNOWN_JOB,
    cron: SEND_SETTLE_UNKNOWN_SCHEDULE.cron,
    timeZone: SEND_SETTLE_UNKNOWN_SCHEDULE.timeZone,
    createHandler: (deps) => createSendSettleUnknownHandler(deps),
  },
];
