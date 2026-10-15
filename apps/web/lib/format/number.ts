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
  return formatRange(min, max, labels, formatThousands);
}

/** 片側の扱いを 1 本にするための内部関数（円 / 万円で条件分岐を 2 つ持たない）。 */
function formatRange(
  min: number | null,
  max: number | null,
  labels: UnitPriceRangeLabels,
  format: (value: number) => string,
): string {
  if (min !== null && max !== null) {
    return `${format(min)}〜${format(max)} ${labels.unit}`;
  }
  if (min !== null) return `${format(min)} ${labels.orMore}`;
  if (max !== null) return `${format(max)} ${labels.orLess}`;
  return labels.none;
}

/**
 * ✅ **2026-10-15: 万円に丸める**（[Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101) の
 * 回答 **C「値の表記を短くする」**）。`660,000 円` は **9 文字**あり、レンジにすると
 * 1 列で 160px を占める —— これが案件一覧の幅を決めていた（`#101` の実測）。
 *
 * 🔴 **単位の語はここに書かない**（このモジュールの冒頭の 🔴）。返すのは数字だけである。
 * 🔴 **1,000 円未満は丸まる（小数第 1 位まで）。** 入力の刻みが 10,000 円（`step`）なので
 *    実務の値は整数の万になるが、丸める以上 **これを使ってよいのは「走査のための面」だけ**である
 *    （一覧の表とその要点パネル）。🔴 **金額を確定させる面（`S-011` 詳細 / 提案の承認 /
 *    提案の編集 / 凍結スナップショット）では円表記の `formatUnitPriceRange` を使う** ——
 *    単価交渉の根拠になる数字を丸めない（`#101` の C 自身が「金額の読み違いが単価交渉に
 *    直結する」と書いている）。
 */
export function formatManYen(value: number): string {
  // 🔴 浮動小数点を経由しない（`66.50000000000001` のような表示を作らない）。
  //    1,000 円 = 0.1 万円 なので、整数の「0.1 万円単位」に丸めてから組み立てる。
  const tenths = Math.round(value / 1000);
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(tenths);
  const whole = Math.trunc(abs / 10);
  const frac = abs % 10;
  return `${sign}${formatThousands(whole)}${frac === 0 ? '' : `.${String(frac)}`}`;
}

/**
 * ✅ **2026-10-15: 万円表記の単価レンジ**（`#101` の C）。
 *
 * 🔴 **判断（片側だけを未設定に畳まない / 0 を未設定にしない）は `formatUnitPriceRange` と
 *    1 文字も違わない。** 違うのは数値の丸め方だけであり、**条件分岐を 2 つ持たない**ために
 *    共通の内部関数に書式を渡す形にしてある（片側の扱いが 2 本に分かれると、どちらかだけが
 *    「—」に畳まる差分が忍び込む）。
 */
export function formatUnitPriceRangeManYen(
  min: number | null,
  max: number | null,
  labels: UnitPriceRangeLabels,
): string {
  return formatRange(min, max, labels, formatManYen);
}

