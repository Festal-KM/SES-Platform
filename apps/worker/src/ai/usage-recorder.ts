// apps/worker/src/ai/usage-recorder.ts
// 🔴 `packages/ai` の `AiUsageRecorder`（ポート）と `packages/db` の実装（`recordAiUsage` /
//    `countAiUnit`）を繋ぐアダプタ（docs/05 §7.3 / §7.9 ④ / §7.11）。T-07-03。
//
// ============================================================================
// 🔴 なぜここ（`apps/worker`）にあるのか
// ============================================================================
// `packages/ai` は `@ses/db` に依存できず、`packages/db` も `@ses/ai` に依存できない
// （CLAUDE.md §2.1。ESLint が両方向を落とす）。**束ねるのは `apps/*` の層だけ**である。
// このファイルが `AiUsageRecorder` を返すことで、「ポートの形」と「DB の実装の形」が
// 一致していることが**コンパイル時に**証明される（型の突合をここ以外に置く場所が無い）。
//
// ============================================================================
// 🔴 なぜジョブ識別（`JobIdentity`）を引数に取るのか
// ============================================================================
// `AiUsage` を書くには `HostTenantCtx` が要り、ワーカーでの唯一の生成経路は
// `systemTenantCtx(tenantId, job)` である（docs/05 §9.2）。`tenantId` は呼び出しごとに
// `AiUsageRecordInput` が持っているが、**ジョブ識別は持っていない**（`packages/ai` は
// ジョブを知らないし、知るべきでもない）。したがって記録器はジョブ単位で組み立てる。
//
// 🔴 `AiRuntime` の他の 3 ポート（client / costGuard / models）は起動時 1 回で足りる（docs/05 §7.9 ①）。
//    記録器だけがジョブ単位であり、`createRoleRunner` は**外部資源を持たない純粋な合成**なので、
//    ロールジョブが 1 回の実行につき 1 度呼んでも接続やクライアントは作り直されない。
//
// 🔴 `tenantId` の出所は `AiCallContext.tenantId`（＝ ジョブ payload の `tenantId`）である。
//    ワーカーはパートナー文脈を作れず（`systemTenantCtx` は常にホスト相当）、
//    HTTP のリクエスト入力がここへ届く経路は無い（`apps/web` は `systemTenantCtx` を呼べない。
//    `tests/static/auth-db-callers.test.ts`）。
import type { AiUsageRecorder } from '@ses/ai';
import { countAiUnit, recordAiUsage, systemTenantCtx, type JobIdentity } from '@ses/db';

/**
 * 🔴 `AiUsage` の記録器を、実行中のジョブに紐づけて組み立てる。
 *
 * 🔴 **失敗を握り潰さない。** `record` が投げると `runRole` は `AiUsageNotRecordedError` に
 *    包んで throw し（docs/05 §7.3 の実行時ガード 3）、成果物は保存されない。
 *    「記録できない呼び出しを成功にしない」がこの層の唯一の仕事である。
 */
export function createAiUsageRecorder(job: JobIdentity): AiUsageRecorder {
  return {
    async record(input) {
      const ctx = systemTenantCtx(input.tenantId, job);
      return recordAiUsage(ctx, {
        role: input.role,
        purpose: input.purpose,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        targetType: input.targetType,
        targetId: input.targetId,
        tokens: input.tokens,
        attemptNo: input.attemptNo,
        succeeded: input.succeeded,
        failureKind: input.failureKind,
        maskHits: input.maskHits,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      });
    },
    async countUnit(input) {
      const ctx = systemTenantCtx(input.tenantId, job);
      // 🔴 戻り値（加算後のカウンタ）は捨てる。ポートの契約は「加算する」ことであり、
      //    残量の表示は `F-027`（SP-10）が改めて読む。ここで返すと、呼び出し側が
      //    「残量が減ったかどうか」で分岐を書ける形になってしまう（上限判定は手順 3 の責務）。
      await countAiUnit(ctx, {
        role: input.role,
        output: input.output,
        occurredAt: input.occurredAt,
      });
    },
  };
}
