// packages/domain/src/ai/pricing.ts
// 🔴 AI 呼び出しの**推定コスト（USD）を算出する唯一の場所**（docs/05 §7.3 手順 6 / §7.9 ④ /
//    docs/03 §3.3.1 の単価表）。T-07-03。
//
// ============================================================================
// 🔴 なぜ `packages/ai` ではなく `packages/domain` に置くのか（§7.9 ④ の読み替え）
// ============================================================================
// docs/05 §7.9 ④ は「金額を持つのは 1 箇所」「単価表は**記録側**に置く」と決めた。
// その理由は「`docs/03` §3.3.1 の表・`packages/ai`・原価集計（`F-063`）の 3 箇所に単価が散る」
// ことの回避であり、**`packages/db` でなければならない**という意味ではない。
//
// 記録側の候補は 2 つあった:
//   ① `packages/db/src/ai-usage.ts`（INSERT する場所に単価も置く）
//   ② 🔴 `packages/domain`（純粋関数として置き、`packages/db` が呼ぶ）  ← **採用**
//
// ② を採る理由:
//   1. **単価 × トークン数 → USD は I/O を持たない決定的な計算**である。`packages/domain` の
//      定義（「純粋関数のみ。DB・ネットワーク・現在時刻を持ち込まない」。CLAUDE.md §2.1）に
//      そのまま合致し、**DB を立てずに単価と丸めを検証できる**（`pricing.test.ts`）。
//   2. **読む側が 1 つではない。** 記録（T-07-03）に加えて、**呼び出しの前**にコストを見積もる
//      `AiCostGuard.reserve`（T-07-04）と、`F-063` のロール別原価の按分・予測（SP-13）が
//      同じ単価を要る。①に置くと、`packages/db` の外から使いたくなった時点で 2 箇所目が生まれる。
//   3. 🔴 **`AI_ROLES` / `ROLE_PURPOSE` を domain に置いた判断（§7.9 ⑤）と同型**である。
//      「実行する側（`packages/ai`）と記録する側（`packages/db`）の共有点は domain しか無い」。
//
// 🔴 ただし §7.9 ④ の**禁止は維持する**: `packages/ai` はこのモジュールを参照しない
//    （`AiUsageRecordInput` に `estimatedCostUsd` が無い状態を保つ）。domain は `packages/ai` から
//    も import 可能なので、その規律は `tests/static/ai-usage-cost-single-path.test.ts` が
//    機械的に固定する。**型で塞げないものは静的テストで塞ぐ**（`masked-text-single-path` と同じ）。

/** 課金に効くトークン数（docs/05 §3.8 `AiUsage` の 4 列と 1:1）。 */
export type AiTokenCounts = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 🔴 キャッシュ読出は単価が基本入力の 10%（docs/03 §3.3.1）。入力と混ぜて数えない。 */
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

/**
 * 1 モデルの単価（**USD / 100 万トークン**）。値は docs/03 §3.3.1 の表そのものである。
 *
 * 🔴 小数第 2 位までしか取らない（表の全値がそう）。これにより「centi-USD / MTok」の整数へ
 *    可逆に落とせ、金額の計算から浮動小数点を完全に排除できる（下記 `toCenti`）。
 */
export type AiModelPrice = {
  readonly inputUsdPerMTok: string;
  readonly outputUsdPerMTok: string;
  /**
   * 🔴 **5 分キャッシュ書込**の単価である（docs/03 §3.3.1 の「5 分キャッシュ書込」列）。
   *
   * 1 時間キャッシュ書込は単価が別（Sonnet 5: $4 / Haiku 4.5: $2）だが、`AiTokenCounts` は
   * キャッシュ書込を 1 つしか数えない。**したがって `packages/ai` は 5 分キャッシュ以外を
   * 要求してはならない**（docs/03 §3.3.2 の適用方針も 5 分キャッシュである）。
   * 1 時間キャッシュを使うことになったら、**まず `AiTokenCounts` を分ける**こと ——
   * ここに 1 時間の単価だけを足すと、記録される原価が実費の 1/1.6 になる。
   */
  readonly cacheWrite5mUsdPerMTok: string;
  readonly cacheReadUsdPerMTok: string;
};

/**
 * 🔴 モデル ID → 単価（docs/03 §3.3.1。2026-08-31 時点の一次情報）。
 *
 * 🔴 **この表がコード上の唯一の単価である。** 値を更新するときは docs/03 §3.3.1 と
 *    §7.6.1（1 件あたり標準原価）も同時に直す（片方だけ直すと、利用者に見せる件数と実原価がずれる）。
 * 🔴 表に無いモデル ID は**推定できない**ので `UnknownAiModelPriceError` にする（下記の理由）。
 */
export const AI_MODEL_PRICING: Readonly<Record<string, AiModelPrice>> = {
  'claude-sonnet-5': {
    inputUsdPerMTok: '2',
    outputUsdPerMTok: '10',
    cacheWrite5mUsdPerMTok: '2.50',
    cacheReadUsdPerMTok: '0.20',
  },
  'claude-haiku-4-5-20251001': {
    inputUsdPerMTok: '1',
    outputUsdPerMTok: '5',
    cacheWrite5mUsdPerMTok: '1.25',
    cacheReadUsdPerMTok: '0.10',
  },
  // 参考値（docs/03 §3.3.1）。`CLAUDE.md` §2 の既定モデルではないが、`TenantRoleModel`（SP-14）で
  // 選ばれうるため、単価が引けない状態にしておかない。
  'claude-opus-5': {
    inputUsdPerMTok: '5',
    outputUsdPerMTok: '25',
    cacheWrite5mUsdPerMTok: '6.25',
    cacheReadUsdPerMTok: '0.50',
  },
};

/**
 * 🔴 単価が分からないモデルで AI を呼ぼうとした（docs/05 §7.3）。
 *
 * **握り潰して 0 円で記録しない。** 0 で記録すると ①`§10.2` の粗利が実態より良く見える
 * ②`F-027` の 1 日コスト上限が実質的に無効になる（いくら使っても加算されない）——
 * どちらも「動いているのに数字が合わない」という最悪の壊れ方である。
 *
 * 🔴 **この例外は呼び出しの「前」に出る。** `AiCostGuard.reserve`（T-07-04。手順 3）が
 *    同じ関数で見積もるため、単価未登録のモデルは LLM を呼ぶ前に落ちる（原価だけが出ることはない）。
 *    `TenantRoleModel`（SP-14）の保存時も、この表を通してから受理すること。
 */
export class UnknownAiModelPriceError extends Error {
  constructor(readonly modelId: string) {
    super(
      `モデル ${modelId} の単価が未登録です（packages/domain/src/ai/pricing.ts の AI_MODEL_PRICING）。` +
        '単価が分からない呼び出しは記録できないため実行しません（docs/05 §7.3 / docs/03 §3.3.1）。',
    );
    this.name = 'UnknownAiModelPriceError';
  }
}

/** 応答が返すスナップショット ID（`{モデル}-YYYYMMDD`）の日付部分。 */
const SNAPSHOT_SUFFIX = /-\d{8}$/;

/** 単価表の値（USD/MTok。小数 2 桁まで）。 */
const PRICE_PATTERN = /^\d{1,4}(\.\d{1,2})?$/;

/**
 * 単価文字列 → centi-USD / MTok（整数）。
 *
 * 🔴 `Number` を経由しない。`0.1 + 0.2` の世界で原価と請求根拠を作らないため、
 *    金額は最初から最後まで整数（bigint）で扱う。
 */
function toCenti(usdPerMTok: string): bigint {
  if (!PRICE_PATTERN.test(usdPerMTok)) {
    throw new RangeError(
      `単価の書式が不正です（${usdPerMTok}）。USD / MTok を小数 2 桁までの十進数で書いてください。`,
    );
  }
  const [whole = '0', fraction = ''] = usdPerMTok.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/**
 * 🔴 モデル ID から単価を引く（純粋関数）。
 *
 * 完全一致 → **日付スナップショット接尾辞を落として**もう一度完全一致、の 2 段だけである。
 * 前方一致で緩く拾わない: `claude-sonnet-5` と `claude-sonnet-5-5`（将来）は別料金でありうるため、
 * 前方一致は「静かに間違った単価で記録する」経路になる。
 *
 * 🔴 2 段目が要るのは、応答が要求と違う ID（`claude-sonnet-5-20260514` のような固定版）を
 *    返しうるためである。`AiUsage.modelId` には**応答側の ID** を記録する（docs/05 §7.3）。
 */
export function resolveAiModelPrice(modelId: string): AiModelPrice {
  const exact = AI_MODEL_PRICING[modelId];
  if (exact !== undefined) return exact;

  const withoutSnapshot = modelId.replace(SNAPSHOT_SUFFIX, '');
  const family = withoutSnapshot === modelId ? undefined : AI_MODEL_PRICING[withoutSnapshot];
  if (family !== undefined) return family;

  throw new UnknownAiModelPriceError(modelId);
}

function assertTokenCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

/** micro-USD（`Decimal(12,6)` の最小単位）→ 十進文字列。 */
function formatMicroUsd(microUsd: bigint): string {
  const whole = microUsd / 1_000_000n;
  const fraction = (microUsd % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${fraction}`;
}

/**
 * 🔴 1 回の試行の推定コスト（USD）を算出する（純粋関数）。docs/05 §3.8 `AiUsage.estimatedCostUsd`。
 *
 * 🔴 戻り値は**十進文字列**である（`Decimal(12,6)` にそのまま入る形）。`number` で返すと
 *    呼び出し側が丸め誤差を持ち込む余地が生まれ、原価と請求根拠がずれる。
 *
 * 計算は整数だけで閉じている:
 *   コスト(USD) = トークン数 × 単価(USD/MTok) ÷ 1,000,000
 *   ⇒ コスト(micro-USD) = トークン数 × 単価(centi-USD/MTok) ÷ 100
 * 端数（1 micro-USD 未満）は**四捨五入**する。切り捨てだと安価な試行が常に 0 円として積まれ、
 * 切り上げだと呼び出し回数だけ原価が水増しされる。
 */
export function estimateAiCostUsd(input: {
  readonly modelId: string;
  readonly tokens: AiTokenCounts;
}): string {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = input.tokens;
  assertTokenCount('inputTokens', inputTokens);
  assertTokenCount('outputTokens', outputTokens);
  assertTokenCount('cacheReadTokens', cacheReadTokens);
  assertTokenCount('cacheWriteTokens', cacheWriteTokens);

  const price = resolveAiModelPrice(input.modelId);
  const totalCenti =
    BigInt(inputTokens) * toCenti(price.inputUsdPerMTok) +
    BigInt(outputTokens) * toCenti(price.outputUsdPerMTok) +
    BigInt(cacheReadTokens) * toCenti(price.cacheReadUsdPerMTok) +
    BigInt(cacheWriteTokens) * toCenti(price.cacheWrite5mUsdPerMTok);

  // 四捨五入（値は常に非負なので +50 の切り捨てで足りる）。
  return formatMicroUsd((totalCenti + 50n) / 100n);
}
