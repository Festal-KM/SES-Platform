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
  InvalidJobPayloadError,
  parseUsageSeatSnapshotPayload,
  USAGE_SEAT_SNAPSHOT_JOB,
  USAGE_SEAT_SNAPSHOT_SCHEDULE,
} from './usage-seat-snapshot.js';
export type {
  UsageSeatSnapshotDeps,
  UsageSeatSnapshotHandler,
  UsageSeatSnapshotPayload,
} from './usage-seat-snapshot.js';

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
