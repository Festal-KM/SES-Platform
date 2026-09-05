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
  buildAccountMailLink,
  createAccountMailHandler,
  parseAccountMailPayload,
} from './account-mail.js';
export type { AccountMailDeps, AccountMailHandler } from './account-mail.js';
export { performEmailSend } from './email-send.js';
export type { EmailSendDeps, EmailSendOutcome, EmailSendRequest } from './email-send.js';
export {
  createWebhookProcessHandler,
  parseWebhookProcessPayload,
  WEBHOOK_PROCESS_JOB,
} from './webhook-process.js';
export type { WebhookProcessDeps, WebhookProcessHandler, WebhookProcessOutcome } from './webhook-process.js';

/** ジョブの合成に要る値（起動時に 1 度だけ解決する。`CLAUDE.md` §11.1 / docs/05 §13.1）。 */
export type ScheduledJobDeps = UsageSeatSnapshotDeps;

/**
 * スケジュール実行するジョブの宣言。
 *
 * 🔴 `payload` は含まない。`usage.seat-snapshot` は**テナントごとに 1 ジョブ**であり
 *    （docs/05 §9.1「payload に `tenantId` を必ず含める」）、テナントの列挙と
 *    ファンアウトはキューを配線する SP-07 の責務である。ここが持つのは
 *    「いつ・何という名前で・どのハンドラが走るか」までである。
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
];
