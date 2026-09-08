// packages/domain/src/quota/ai-cost.ts
// 🔴 テナントの「1 日の AI コスト上限」の判定（`CLAUDE.md` §3.4 / docs/05 §7.6 / docs/03 §4.5 /
//    `F-027 AC-1` `AC-5`）。T-07-04。
//
// ============================================================================
// 🔴 これは遮断器であって、利用者に見せる残量ではない
// ============================================================================
// 金額（USD）は**運営者の内部指標**であり、テナント利用者の画面・通知・エクスポートには
// 1 つも出さない（`F-027 AC-6` / [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)）。
// 利用者に見せるのは件数（`UsageCounter(MONTH,'AI_UNIT_*')`）と、停止したときの
// **理由とリセット時刻**だけである。したがって本関数の戻り値も「停止したか」と
// 「いつ再開するか」が主であり、`headroomUsd` は `A-004` / `A-005`（運営平面）向けである。
//
// ============================================================================
// 🔴 メール（`decideEmailRate`）・ストレージ（`decideStorageUpload`）と別の関数にする
// ============================================================================
// 単位も、超過したときの意味も、解消のしかたも違う:
//   - メールの分次超過は「待てば送れる」（`DEFER`）
//   - ストレージ超過は「消すまで解消しない」（`BLOCK`。時間で解けない）
//   - 🔴 AI の日次コスト超過は「**翌 0 時（JST）に解ける保留**」であり、対象を
//     `GATE_FAILED` にしてはならない（`F-027 AC-5`。失敗と保留を混同しない）
// 同じ形に畳むと、利用者への案内（次に何をすれば動くのか）と監視（障害か保留か）が誤る。
//
// 🔴 **判定であって消費ではない。** 実際の枠の確保は `packages/db` の `reserveAiCost`
//    （`INSERT ... ON CONFLICT DO UPDATE ... WHERE` の原子的な予約）が行う。並行呼び出しでの
//    取りこぼしはそちらが閉じる（`decideEmailRate` と `reserveEmailDailyQuota` の関係と同じ）。
import { formatUsdMicros, parseUsdMicros } from '../usage/usd.js';

/**
 * 判定結果。
 *
 * - `ALLOW`: 予約してよい（実際に予約できたかは `reserveAiCost` の戻り値が決める）。
 * - `BLOCK`: 🔴 **LLM を呼ばない**。呼び出し側は `AiCostLimitExceededError`（HTTP 429）へ写像し、
 *   `gate.run` はこれを受けて `ReviewGate(execution='HELD_AI_COST_LIMIT')` で保持する
 *   （対象は `GATE_RUNNING` のまま。`GATE_FAILED` にしない）。
 *
 * 🔴 `DEFER`（待機）を持たない。日次の枠は「いつ空くか」が確定している（JST の翌 0 時）ため、
 *    秒単位の再スケジュールではなく**保留と自動復帰**（`gate.hold-release`。§9.3）で扱う。
 *
 * 🔴 **リセット時刻（`resetAt`）をここでは返さない。** `Date` の生成は `packages/domain` の
 *    純粋性検査（docs/05 §17.2 #14）が禁じている（引数から決定的に組み立てる場合も例外が無い）。
 *    JST の翌 0 時は `packages/db` の `usagePeriodResetAt` が出す —— 表示に必要なのは
 *    「停止したという事実・理由・再開時刻」であり、その 3 つ目だけが暦を要る。
 */
export type AiDailyCostDecision =
  | { readonly kind: 'ALLOW'; readonly headroomUsd: string }
  | {
      readonly kind: 'BLOCK';
      readonly reason: 'AI_DAILY_COST';
      readonly headroomUsd: string;
      readonly limitUsd: string;
    };

export type AiDailyCostInput = {
  /**
   * その日の上限（USD）。`Plan.aiDailyCostLimitUsd` か、その既定値
   * （`packages/config` の `AI_DAILY_COST_LIMIT_USD_DEFAULT`）。
   */
  readonly limitUsd: string;
  /** 🔴 `UsageCounter(DAY,'AI_COST_USD').value` の確定値（＝ 補正済みの実コスト）。 */
  readonly usedUsd: string;
  /** 🔴 同 `.reserved_value`（呼び出し中・未補正の予約）。**判定に必ず含める**。 */
  readonly reservedUsd: string;
  /** これから予約しようとしている見積り額。 */
  readonly requestedUsd: string;
};

function assertNonNegative(name: string, micros: bigint): void {
  if (micros < 0n) {
    throw new RangeError(`${name} は 0 以上である必要があります（受け取った値: ${micros}）。`);
  }
}

/**
 * 🔴 1 日の AI コスト上限の判定（純粋関数）。
 *
 * 判定式は **`used + reserved + requested <= limit`** である。3 つすべてを足す:
 *   - `used` だけを見ると、呼び出し中（予約済み・未補正）の分が二重に許可される
 *   - `reserved` を見ないと、並行して走る呼び出しが全部「まだ余裕がある」と判断する
 *     （docs/03 §4.5 の競合状態そのもの）
 *
 * 🔴 上限ちょうどは許す（`decideStorageUpload` と同じ規約）。「超えたら止める」の定義を
 *    プロダクト全体でそろえる。
 *
 * 🔴 `headroomUsd` は**予約前の残り枠**（`max(0, limit − used − reserved)`）であり、
 *    両方の分岐で同じ意味を持つ。分岐ごとに意味が変わる値を返すと、表示側が誤って使う。
 */
export function decideAiDailyCost(input: AiDailyCostInput): AiDailyCostDecision {
  const limit = parseUsdMicros(input.limitUsd);
  if (limit <= 0n) {
    throw new RangeError(`limitUsd は 0 より大きい必要があります（受け取った値: ${input.limitUsd}）。`);
  }
  const used = parseUsdMicros(input.usedUsd);
  const reserved = parseUsdMicros(input.reservedUsd);
  const requested = parseUsdMicros(input.requestedUsd);
  assertNonNegative('usedUsd', used);
  assertNonNegative('reservedUsd', reserved);
  assertNonNegative('requestedUsd', requested);

  const headroom = limit - used - reserved;
  const headroomUsd = formatUsdMicros(headroom > 0n ? headroom : 0n);

  if (requested > headroom) {
    return { kind: 'BLOCK', reason: 'AI_DAILY_COST', headroomUsd, limitUsd: input.limitUsd };
  }
  return { kind: 'ALLOW', headroomUsd };
}
