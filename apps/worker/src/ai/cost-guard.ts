// apps/worker/src/ai/cost-guard.ts
// 🔴 `packages/ai` の `AiCostGuard`（ポート）と `packages/db` の実装（`reserveAiCost` /
//    `settleAiCost`）を繋ぐアダプタ（docs/05 §7.6 / §7.9 ④ / §7.12）。T-07-04。
//
// ============================================================================
// 🔴 なぜここ（`apps/worker`）にあるのか
// ============================================================================
// `packages/ai` は `@ses/db` に依存できず、`packages/db` も `@ses/ai` に依存できない
// （CLAUDE.md §2.1）。**束ねるのは `apps/*` の層だけ**である。このファイルが `AiCostGuard` を
// 返すことで、「ポートの形」と「DB の実装の形」が一致していることが**コンパイル時に**
// 証明される（`createAiUsageRecorder` と同じ位置づけ）。
//
// ============================================================================
// 🔴 例外への写像はここでしか行わない
// ============================================================================
// ポートの契約は「予約できなければ `AiCostLimitExceededError` を throw する」であり、
// `packages/db` はその型を知らない（値で `LIMIT_REACHED` を返す）。写像を 1 箇所に閉じることで、
// 🔴 **`AiCostLimitExceededError`（呼ばなかった → HELD）と `AiUsageFailureKind='SPEND_CAP'`
// （呼んで弾かれた → 失敗）の取り違え**（docs/05 §7.9 ④）が構造的に起きなくなる ——
// 後者は `packages/ai` のクライアントが分類するものであり、この経路には現れない。
//
// ============================================================================
// 🔴 なぜ記録器と同じく「ジョブ単位」なのか（docs/05 §7.11 ④ の読み替え）
// ============================================================================
// §7.11 ④ は「外部資源を持つ 3 ポート（client / costGuard / models）は起動時 1 回でよい」と
// 書いたが、**`costGuard` は DB を書く**（`usage_counters`）。DB を書くには `HostTenantCtx` が
// 要り、ワーカーでの唯一の生成経路は `systemTenantCtx(tenantId, job)` である（§9.2）。
// `tenantId` は呼び出しごとに引数で渡るが**ジョブ識別は渡らない**（`packages/ai` はジョブを
// 知らないし、知るべきでもない）。したがって記録器と同じくジョブ単位で組み立てる。
// `createRoleRunner` は外部資源を持たない純粋な合成なので、ジョブごとに呼んでも接続は増えない。
import { AiCostLimitExceededError, type AiCostGuard } from '@ses/ai';
import { reserveAiCost, settleAiCost, systemTenantCtx, type JobIdentity } from '@ses/db';

export type AiCostGuardOptions = {
  readonly job: JobIdentity;
  /**
   * 🔴 テナントの 1 日の AI コスト上限（USD の十進文字列）。
   *
   * 出所は `Plan.aiDailyCostLimitUsd`、無ければ `packages/config` の
   * `AI_DAILY_COST_LIMIT_USD_DEFAULT`（`CLAUDE.md` §3.4「既定値。`packages/config` で管理し、
   * プランごとに上書き可能」）。🔴 **ここで既定値を決め打ちしない** —— ジョブは自分のテナントを
   * 知っているので、プラン別の値が実装された時点で**この引数に渡すものが変わるだけ**であり、
   * 判定側（SQL / `decideAiDailyCost`）のコードは変わらない
   * （`decideStorageUpload` の `limitBytes` と同じ扱い）。
   */
  readonly dailyLimitUsd: string;
};

/**
 * 🔴 AI コスト上限のガードを、実行中のジョブに紐づけて組み立てる。
 *
 * 🔴 **握り潰さない。** 予約できなければ `AiCostLimitExceededError` が `runRole` から
 *    呼び出し側（`gate.run` 等）へ伝播し、そこで「保留（`HELD_AI_COST_LIMIT`）」になる
 *    （`F-027 AC-5`。`GATE_FAILED` にしない）。ここで catch して既定値を返す実装を書くと、
 *    上限が無いのと同じになる。
 */
export function createAiCostGuard(options: AiCostGuardOptions): AiCostGuard {
  return {
    async reserve(input) {
      const ctx = systemTenantCtx(input.tenantId, options.job);
      // 🔴 `input.role` は渡さない。1 日の上限は**6 ロール共通の遮断器**であり
      //    （`gate-inspector` を含む。docs/05 §7.6 / docs/03 §7.6.1 末尾）、ロール別の枠は
      //    存在しない。ここでロールを渡せる形にすると「このロールだけ上限を緩める」実装が
      //    書けるようになり、`F-027 AC-5`（上限到達でゲートも止まる）が崩れる。
      const outcome = await reserveAiCost(ctx, {
        modelId: input.modelId,
        estimatedInputTokens: input.estimatedInputTokens,
        maxOutputTokens: input.maxOutputTokens,
        limitUsd: options.dailyLimitUsd,
        now: input.now,
      });
      if (outcome.kind === 'LIMIT_REACHED') {
        // 🔴 金額（`limitUsd` / `remainingUsd`）は運営平面（`A-004`）だけが読む。主平面の API
        //    応答には `reasonKey` と `resetAt` しか載せない（`F-027 AC-6` / docs/05 §7.6）。
        throw new AiCostLimitExceededError({
          resetAt: outcome.resetAt,
          limitUsd: outcome.limitUsd,
          remainingUsd: outcome.headroomUsd,
        });
      }
      // 🔴 予約証だけを返す（`packages/ai` に金額を持たせない。docs/05 §7.9 ④）。
      return { handle: outcome.handle };
    },
    async settle(input) {
      const ctx = systemTenantCtx(input.tenantId, options.job);
      // 🔴 戻り値（補正後のカウンタ）は捨てる。ポートの契約は「補正する」ことであり、
      //    残量の判定は次の呼び出しの予約（原子的な SQL）が行う。ここで返すと、呼び出し側が
      //    「残っているかどうか」で分岐を書ける形になってしまう。
      await settleAiCost(ctx, {
        handle: input.reservation.handle,
        // 🔴 失敗した試行も含めて渡す（原価は発生している。docs/05 §7.4）。
        attempts: input.attempts,
        now: input.now,
      });
    },
  };
}
