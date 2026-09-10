// apps/worker/src/scheduler.ts
// 🔴 スケジュール実行のラッパ（docs/05 §9.1「全 Repeatable Job は `runScheduled` の
//    ラッパを通して登録する」）。T-07-11。
//
// ============================================================================
// 🔴 このファイルが持つ責務は 3 つだけである
// ============================================================================
//   ① BullMQ が作った tick のジョブ ID から **slot**（発火予定時刻）を取り出す
//   ② `SchedulerRun.runKey`（`{jobName}:{slot}`）の UNIQUE で **1 slot 1 回**にする
//   ③ ハンドラの結果 / 例外を `SchedulerRun` に確定させる
//
// 🔴 **テナントのファンアウトはここに書かない**（`runtime.ts` の `fanOutToTenants`）。
//    分けている理由は、①〜③が「いつ 1 回走るか」の話であり、ファンアウトが「誰に配るか」の
//    話だからである。混ぜると、母集団の条件（docs/05 §9.1 の 🔴）が多重実行防止のコードに
//    埋もれて読めなくなる。
//
// 🔴 `scheduler_runs` に触れるのはこのファイルだけである（docs/05 §4.4.2 の許可先）。
//    個々のジョブハンドラは `SchedulerRun` を知らない。

import { claimSchedulerRun, finishSchedulerRun } from '@ses/db';

/** `SchedulerRun.detail` に載せてよい値（🔴 件数・状態・真偽だけ。docs/05 §16.2）。 */
export type SchedulerRunDetail = Record<string, string | number | boolean | null>;

/**
 * 🔴 tick のジョブ ID が BullMQ の Job Scheduler の形（`repeat:{schedulerId}:{millis}`）でない。
 *
 * **推測して現在時刻で slot を作らない。** そうすると、同じ tick を処理した 2 つのプロセスが
 * 別々の `runKey` を作り、**UNIQUE が効かずにハンドラが 2 回走る**（この仕組みが唯一防ごうと
 * しているもの）。到達するのは「スケジューラを経ずに手で積んだ」場合だけであり、
 * それは設計上存在しない経路である（docs/05 §9.1）。
 */
export class InvalidSchedulerJobIdError extends Error {
  constructor(jobName: string, jobId: string) {
    super(
      `${jobName}: スケジュールジョブの jobId が想定の形（repeat:{schedulerId}:{millis}）ではありません: ${jobId}` +
        '（docs/05 §9.1。slot を現在時刻で代用すると多重実行防止が無効になります）',
    );
    this.name = 'InvalidSchedulerJobIdError';
  }
}

/** BullMQ の Job Scheduler が付ける ID の形（`bullmq@6` の `addJobScheduler` が Lua で組み立てる）。 */
const REPEAT_JOB_ID_PATTERN = /^repeat:(?<schedulerId>.+):(?<millis>\d+)$/u;

/** JST の固定オフセット（docs/05 §9.1「`Asia/Tokyo` 固定。組織別に持たない」）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const JST_OFFSET_SUFFIX = '+09:00';

/**
 * 🔴 tick の発火予定時刻（ミリ秒）を jobId から取り出す。
 *
 * **現在時刻を使わない理由**: 同じ tick を複数プロセスが処理しうる（再試行 / 二重起動）。
 * `jobId` は BullMQ が Redis の Lua スクリプトで組み立てた**その tick 固有の値**であり、
 * どのプロセスから見ても同一である。ここが slot の唯一の出所である。
 */
export function schedulerSlotMillis(jobName: string, jobId: string): number {
  const matched = REPEAT_JOB_ID_PATTERN.exec(jobId);
  const millis = matched?.groups?.millis;
  if (millis === undefined) throw new InvalidSchedulerJobIdError(jobName, jobId);
  const parsed = Number.parseInt(millis, 10);
  if (!Number.isFinite(parsed)) throw new InvalidSchedulerJobIdError(jobName, jobId);
  return parsed;
}

/**
 * slot を JST の ISO 8601 で表す（docs/05 §3.10 `SchedulerRun.run_key` のコメント）。
 *
 * 🔴 `Intl` に依存しない固定オフセットで組み立てる。`Asia/Tokyo` は夏時間を持たないため
 *    オフセットは常に +09:00 であり、**同じ入力から常に同じ文字列**になる（`runKey` は
 *    プロセスをまたいで一致しなければならない）。
 */
export function schedulerSlotIso(millis: number): string {
  return `${new Date(millis + JST_OFFSET_MS).toISOString().replace('Z', '')}${JST_OFFSET_SUFFIX}`;
}

/** 🔴 `run_key = '{jobName}:{slot}'`（docs/05 §9.1）。組み立てはここ 1 箇所である。 */
export function schedulerRunKey(jobName: string, jobId: string): string {
  return `${jobName}:${schedulerSlotIso(schedulerSlotMillis(jobName, jobId))}`;
}

/**
 * 1 回の tick の帰結。
 *
 * - `RAN` … この実行が slot を取り、ハンドラを走らせた
 * - 🔴 `SKIPPED` … 別の実行が同じ slot を取っている（二重起動）。**ハンドラを呼んでいない**
 */
export type ScheduledRunOutcome =
  | { readonly kind: 'RAN'; readonly runId: string; readonly detail: SchedulerRunDetail }
  | { readonly kind: 'SKIPPED'; readonly runKey: string };

/**
 * 🔴 スケジュールジョブの唯一の起動口（docs/05 §9.1）。
 *
 * 手順:
 *   1. `jobId` から slot を作る（推測しない。壊れていたら例外）
 *   2. `SchedulerRun` に `RUNNING` で INSERT できたときだけ `handler` を呼ぶ
 *   3. 成功なら `OK`、例外なら `FAILED` を記録して**再 throw する**
 *
 * 🔴 例外を握り潰さない。握り潰すと BullMQ から見て成功になり、`A-005`（docs/05 §16.5）の
 *    失敗ジョブ数から消える ——「壊れているのに誰も気づかない」（`CLAUDE.md` §11.1）。
 * 🔴 `FAILED` を記録してから throw する順序を変えない。先に throw すると、行が `RUNNING` の
 *    まま残り、`claimSchedulerRun` の CAS（`FAILED` だけを取り直す）が再試行に渡らなくなる。
 */
export async function runScheduled(input: {
  readonly jobName: string;
  readonly jobId: string;
  readonly now: () => Date;
  readonly handler: () => Promise<SchedulerRunDetail>;
}): Promise<ScheduledRunOutcome> {
  const runKey = schedulerRunKey(input.jobName, input.jobId);
  const claim = await claimSchedulerRun({
    jobName: input.jobName,
    runKey,
    startedAt: input.now(),
  });
  if (claim.kind === 'ALREADY_RUNNING') return { kind: 'SKIPPED', runKey };

  let detail: SchedulerRunDetail;
  try {
    detail = await input.handler();
  } catch (error) {
    await finishSchedulerRun({
      runId: claim.runId,
      status: 'FAILED',
      finishedAt: input.now(),
      // 🔴 例外の**名前だけ**を残す（メッセージには対象の値が混ざりうる。docs/05 §16.2）。
      detail: { error: error instanceof Error ? error.name : 'UnknownError' },
    });
    throw error;
  }
  await finishSchedulerRun({
    runId: claim.runId,
    status: 'OK',
    finishedAt: input.now(),
    detail,
  });
  return { kind: 'RAN', runId: claim.runId, detail };
}
