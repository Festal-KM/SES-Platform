// apps/web/lib/format/number.ts
// 数値の表示書式（3 桁区切りと単価レンジ）。T-06-02。
//
// 🔴 **T-05-02 で `lib/engineers/detail.ts` に置いた 2 関数をここへ移した。** 案件詳細（`S-011`）も
//    同じ書式で単価を出すため、「エンジニアの detail から案件の detail が import する」形にすると
//    機能モジュール間に意味の無い依存が生まれる（`lib/format/db-values.ts` を切り出したときと
//    まったく同じ判断。docs/05 §6.4「#26 の実装の決着」の最終項）。
//    **書式の規則は 1 つしか無いので、置き場所も 1 つにする** —— 2 本になると、同じ単価が
//    画面によって別の見え方をする。
//
// 🔴 文言（単位・接尾辞・未設定記号）はここに書かない。呼び出し側が `packages/i18n` から引いて
//    渡す（`CLAUDE.md` §3.5）。**画面ごとに語彙が違う**（人材の「単価レンジ」と案件の
//    「単価レンジ（外部公開用）」は同じ語でも文脈が別）ため、書式だけを共有して語は共有しない。

/**
 * 3 桁区切り。
 * 🔴 `toLocaleString` を使わない —— 実行環境の ICU の有無で桁区切りが変わると、
 *    サーバ描画とクライアント描画で文字列がずれる（`lib/format/datetime.ts` と同じ理由）。
 */
export function formatThousands(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = Math.abs(Math.trunc(value)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 単価レンジの表示に要る語（すべて呼び出し側が `t()` で解決して渡す）。 */
export type UnitPriceRangeLabels = {
  /** 両端がそろっているときの単位（例: 「円」）。 */
  readonly unit: string;
  /** 下限だけのときの接尾辞（例: 「円以上」）。 */
  readonly orMore: string;
  /** 上限だけのときの接尾辞（例: 「円以下」）。 */
  readonly orLess: string;
  /** 未設定（例: 「—」）。 */
  readonly none: string;
};

/**
 * 単価レンジ（月額・円）。
 * 🔴 **片側しか登録されていないレンジを未設定に畳まない。** 「60 万円以上」は営業判断に使える
 *    情報であり、両側そろっていないことを理由に隠すと `docs/01` §1.2-2 の「見えていない候補」に
 *    逆戻りする。
 * 🔴 **0 を未設定として畳まない**（無償の合意も情報である）。
 */
export function formatUnitPriceRange(
  min: number | null,
  max: number | null,
  labels: UnitPriceRangeLabels,
): string {
  if (min !== null && max !== null) {
    return `${formatThousands(min)}〜${formatThousands(max)} ${labels.unit}`;
  }
  if (min !== null) return `${formatThousands(min)} ${labels.orMore}`;
  if (max !== null) return `${formatThousands(max)} ${labels.orLess}`;
  return labels.none;
}
