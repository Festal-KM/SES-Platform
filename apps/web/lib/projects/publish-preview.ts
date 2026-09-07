// apps/web/lib/projects/publish-preview.ts
// `S-013` セクション 3「公開されたときの見え方のプレビュー」（docs/04 §S-013 / §5-2）。T-06-06。
//
// 🔴 **これはゲートではない。** 合否を出すのは `F-020`（`ReviewGate`）だけであり、本モジュールが
//    返すのは**警告**である（docs/04 §S-013「エンド企業名・内部単価が含まれていればその箇所を
//    ハイライトして警告」/ `docs/04` §S-012「入力中に商流層の観点を注意書きで示す。ただし
//    合否はここでは判定しない」）。**「警告 0 件だから公開してよい」を意味しない。**
//    `CLAUDE.md` §3.3 の 3 層は最後まで `gate-inspector` + 機械的照合が判定する。
//
// 🔴 判定は**機械的な文字列照合だけ**である（AI を呼ばない）。したがって同じ入力に対して
//    常に同じ結果になり、画面が再読み込みのたびに揺れない。
//
// ⚠️ **文字単位のハイライト（オフセット）を作らない。** docs/04 は「その箇所をハイライト」と
//    書いているが、オフセット付きの指摘（`GateFinding.offsetStart` / `offsetEnd`。docs/05 §11.7）は
//    ゲートの表現であり、**ゲートより先に別実装のオフセットを作ると、`S-013` の 2 つの表示
//    （プレビューの印とゲートの指摘）が別の位置を指しうる**。本タスクは「どの欄に混ざっているか」
//    までを出し、該当欄そのものを強調する（docs/04 §S-013 に ⚠️ を追記済み）。
//
// 🔴 本モジュールは I/O も文言も持たない（純粋関数）。語は `packages/i18n`、描画は画面の責務。

/** 公開時に外へ出る欄（`PartnerProjectDetailView` に写る値と 1 対 1）。 */
export const PUBLISHED_FIELDS = ['name', 'publicSummary', 'requirement'] as const;

export type PublishedField = (typeof PUBLISHED_FIELDS)[number];

/** 混入していた商流情報の種別（`F-013 AC-2` の 2 列に対応）。 */
export const COMMERCE_TERM_KINDS = ['END_CLIENT_NAME', 'INTERNAL_UNIT_PRICE'] as const;

export type CommerceTermKind = (typeof COMMERCE_TERM_KINDS)[number];

/** 1 件の警告（どの欄に、どの商流情報が混ざっているか）。 */
export type CommerceLeakWarning = {
  readonly field: PublishedField;
  readonly kind: CommerceTermKind;
};

/** 照合の対象になる、公開時に外へ出る文字列 1 つ。 */
export type PublishedText = {
  readonly field: PublishedField;
  readonly value: string | null;
};

/**
 * 🔴 **1 文字の一致を警告にしない。** 商号が 1 文字の取引先はまず無い一方、1 文字での部分一致は
 *    ほぼ確実に誤検知になる。誤検知が並ぶと利用者は警告そのものを読まなくなり、
 *    本物の混入を見落とす（ゲートの指摘まで同じ扱いをされてしまう）。
 */
const MIN_TERM_LENGTH = 2;

/**
 * 単価の照合に使う表記。
 * 🔴 素の数字（`987654`）と 3 桁区切り（`987,654`）の**両方**を見る —— 画面の入力欄は素の数字だが、
 *    外部公開用の記載には整形して書かれることが多く、片方だけだと素通りする。
 */
function unitPriceTerms(internalUnitPrice: number | null): readonly string[] {
  if (internalUnitPrice === null) return [];
  const raw = String(internalUnitPrice);
  const grouped = raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return raw === grouped ? [raw] : [raw, grouped];
}

function includesTerm(haystack: string, term: string): boolean {
  const normalized = term.trim();
  if (normalized.length < MIN_TERM_LENGTH) return false;
  // 🔴 大文字小文字を無視する（英字の商号が別表記で書かれても拾う）。
  return haystack.toLowerCase().includes(normalized.toLowerCase());
}

/**
 * 公開時に外へ出る文字列に、商流情報（エンド企業名 / 自社単価）が混ざっていないかを見る。
 *
 * 🔴 呼び出せるのは**ホストの画面だけ**である（引数に商流情報を渡す時点で、取引先の文脈からは
 *    呼べない —— `PartnerProjectDetailView` に 2 列が存在しないため）。
 * 🔴 出力は**決定的**（欄の順 → 種別の順）。同じ入力なら同じ並びになる。
 */
export function findCommerceLeakWarnings(input: {
  readonly texts: readonly PublishedText[];
  readonly endClientName: string | null;
  readonly internalUnitPrice: number | null;
}): readonly CommerceLeakWarning[] {
  const priceTerms = unitPriceTerms(input.internalUnitPrice);
  const warnings: CommerceLeakWarning[] = [];

  for (const field of PUBLISHED_FIELDS) {
    const values = input.texts
      .filter((text) => text.field === field)
      .flatMap((text) => (text.value === null ? [] : [text.value]));
    if (values.length === 0) continue;

    if (
      input.endClientName !== null &&
      values.some((value) => includesTerm(value, input.endClientName ?? ''))
    ) {
      warnings.push({ field, kind: 'END_CLIENT_NAME' });
    }
    if (priceTerms.some((term) => values.some((value) => includesTerm(value, term)))) {
      warnings.push({ field, kind: 'INTERNAL_UNIT_PRICE' });
    }
  }

  return warnings;
}
