// packages/db/src/scheduler-run.ts
// 🔴 スケジュール実行の「1 slot につき 1 回」を担保する DB 側（docs/05 §9.1 / §4.4.2）。T-07-11。
//
// ============================================================================
// 🔴 なぜ BullMQ の重複排除だけでは足りないのか
// ============================================================================
// Repeatable Job（Job Scheduler）は「その slot のジョブを 1 本だけ作る」ところまでは Redis が
// 保証するが、**Redis が飛べば作り直されるし、ワーカーを 2 プロセス起動すれば `attempts` の
// 再試行と重なって同じ slot が 2 回処理されうる**。スケジュールジョブは日次の席数記録
// （`usage.seat-snapshot`）のように「同じ日に 2 回走ってはいけない」ものを含むため、
// **多重実行の最終的な防波堤は DB（`scheduler_runs.run_key` の UNIQUE）に置く**（docs/05 §9.1）。
//
// ============================================================================
// 🔴 `scheduler_runs` を書くのはこのファイルだけである（docs/05 §4.4.2）
// ============================================================================
// 個々のジョブハンドラは `SchedulerRun` に触れない。触れると「記録せずに走るジョブ」が
// 書けるようになり、`A-005`（§16.5）の滞留検知が母集団を失う。
// 🔴 `withSystemScope()` の呼び出し元は docs/05 §4.4.2 の 3 箇所に限られており、その 1 つが
//    `runScheduled()`（`apps/worker/src/scheduler.ts`）である。本ファイルはその DB 側であり、
//    `apps/worker` から見た入口は `claimSchedulerRun` / `finishSchedulerRun` の 2 本だけである。

import type { SchedulerRunStatus } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import { withSystemScope } from './with-tenant.js';

/**
 * 実行権の取得の帰結。
 *
 * - `CLAIMED` … この実行が slot を取った。**ハンドラを呼んでよいのはこの場合だけ**である
 * - 🔴 `ALREADY_RUNNING` … 別の実行が同じ slot を走らせている（または走らせて成功した）。
 *   **ハンドラを呼ばない。** 二重起動でハンドラが 1 回になるのはこの枝である
 */
export type SchedulerRunClaim =
  | { readonly kind: 'CLAIMED'; readonly runId: string }
  | { readonly kind: 'ALREADY_RUNNING' };

/**
 * 🔴 slot の実行権を取る（docs/05 §9.1「`run_key` に INSERT できた場合だけ handler を呼ぶ」）。
 *
 * 🔴 **失敗した slot は取り直せる。** `run_key` の UNIQUE に当たったとき、既存行が
 *    `status='FAILED'` なら `RUNNING` へ CAS で戻して実行権を渡す。理由は 2 つある:
 *      ① スケジュールジョブの多くは `attempts: 3`（`QUEUE_DEFINITIONS`）である。取り直せないと
 *         **2 回目以降の試行が「何もせずに正常終了」になり、BullMQ の失敗記録が消える** ——
 *         §16.5 の失敗ジョブ数から落ち、壊れているのに誰も気づかない（`CLAUDE.md` §11.1）
 *      ② 失敗した実行は副作用を完遂していない。全ジョブが冪等である以上（docs/05 §9.1）、
 *         同じ slot をやり直すほうが「その slot を丸ごと落とす」より安全側である
 * 🔴 `RUNNING` は取り直さない（走っているものに割り込まない）。`OK` も取り直さない
 *    （完了した slot をもう一度走らせない ＝ 二重起動の防波堤そのもの）。
 */
export async function claimSchedulerRun(input: {
  readonly jobName: string;
  readonly runKey: string;
  readonly startedAt: Date;
}): Promise<SchedulerRunClaim> {
  const id = uuidV7(input.startedAt);
  return withSystemScope(async (db) => {
    // 🔴 例外を起こさずに 0 件挿入として受け取る（`webhook-delivery.ts` 冒頭の罠と同じ理由:
    //    PostgreSQL は一意制約違反でトランザクションを中断状態にするため、try/catch で
    //    受けて同一トランザクションを続けることはできない）。
    const inserted = await db.schedulerRun.createMany({
      data: [
        {
          id,
          jobName: input.jobName,
          runKey: input.runKey,
          startedAt: input.startedAt,
          status: 'RUNNING' satisfies SchedulerRunStatus,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { kind: 'CLAIMED', runId: id };

    // 🔴 CAS。`status='FAILED'` の行だけを `RUNNING` に戻す（0 件なら実行権は渡らない）。
    const reclaimed = await db.schedulerRun.updateMany({
      where: { runKey: input.runKey, status: 'FAILED' satisfies SchedulerRunStatus },
      data: {
        status: 'RUNNING' satisfies SchedulerRunStatus,
        startedAt: input.startedAt,
        finishedAt: null,
      },
    });
    if (reclaimed.count === 0) return { kind: 'ALREADY_RUNNING' };

    const row = await db.schedulerRun.findFirst({
      where: { runKey: input.runKey },
      select: { id: true },
    });
    if (row === null) {
      // CAS が 1 件更新したのに行が見えない ＝ 不変条件違反。握り潰さない。
      throw new Error(`SchedulerRun を取り直せませんでした（runKey=${input.runKey}）。`);
    }
    return { kind: 'CLAIMED', runId: row.id };
  });
}

/**
 * 実行の終了を記録する。
 *
 * 🔴 `detail` は**件数と状態だけ**（docs/05 §16.2）。ハンドラの戻り値をそのまま入れるが、
 *    ジョブの `*Outcome` はいずれも件数・真偽・ID しか持たない（PII を持つ形が無い）。
 * 🔴 `FAILED` のとき行を消さない —— 消すと「失敗した記録」が残らず、`A-005` から追えなくなる。
 *    取り直しは `claimSchedulerRun` の CAS が行う。
 */
export async function finishSchedulerRun(input: {
  readonly runId: string;
  readonly status: Extract<SchedulerRunStatus, 'OK' | 'FAILED'>;
  readonly finishedAt: Date;
  readonly detail: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await withSystemScope(async (db) => {
    await db.schedulerRun.updateMany({
      where: { id: input.runId },
      data: { status: input.status, finishedAt: input.finishedAt, detail: input.detail },
    });
  });
}
