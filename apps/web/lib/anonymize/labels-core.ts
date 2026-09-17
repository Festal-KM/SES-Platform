// apps/web/lib/anonymize/labels-core.ts
// 匿名候補（`CLAUDE.md` §3.1 経路 4）の**丸め後の区分 → 文言キー**の写像と、文言化の純関数。T-11-11。
//
// 🔴 `labels.ts`（T-08-02）から**写像と組み立てだけ**をここへ移し、文言の解決（`t()`）を引数
//    （`AnonymizedLabelLookup`）に外出しした。`labels.ts` は同じ export を保ったまま `t` を束ねて委譲する
//    （`S-016` の呼び出し側は 1 文字も変わらない）。
//
// なぜ分けるか: `S-015` の「次の 50 件」は**クライアント側**で `GET /api/engineer-shares` の続きを読み、
// 取得済みの行の下に追加する（`docs/04` §S-015 カーソルページング）。追加した行の 5 項目を文言化するのに、
// `'use client'` の画面から `@ses/i18n` の `t()` を呼ばせない規律（`share-props.ts` 冒頭。`*.render.test.tsx` が
// 「文言が無い状態の描画」を試せる状態を守る）があるため、**サーバが文言の表を渡し、クライアントは同じ
// 組み立て関数に表を注入して描く**。組み立てを 2 本にしない（`docs/04` §5-2「プレビューはホストの候補一覧と
// 同じ体裁」）ために、`labels.ts` と本モジュールで**関数は 1 つ**である。
//
// 🔴 **文言そのものは `packages/i18n` が唯一の出所**（`CLAUDE.md` §3.5）。ここは写像と組み立てだけを持ち、
//    日本語の語を 1 つも書かない。`@ses/i18n` は**型だけ**を import する（実行時依存を持たない）。
// 🔴 **ここに写像を足すことは開示項目を足すことに近い。** 本ファイルが扱ってよいのは
//    `RoundedAnonymousAttributes` のフィールドだけであり、それは 5 項目 + 更新日である
//    （`BR-54` / `CLAUDE.md` §8.6 = 人間の承認事項）。経験内容のフィールドは存在しない（`F-008 AC-7`）。
import type {
  AnonymizedAvailabilityBand,
  AnonymizedPriceBand,
  AnonymizedRemoteMode,
  AnonymizedYearsBand,
  RoundedAnonymousAttributes,
} from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import { formatThousands } from '../format/number';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';

/** 経験年数の 5 段階（`docs/02` A-04 ② / `F-017 AC-3`）。 */
export const ANONYMIZED_YEARS_BAND_MESSAGE_KEYS: Readonly<
  Record<AnonymizedYearsBand, MessageKey>
> = {
  LT_1Y: 'anonymousCandidate.yearsBand.LT_1Y',
  Y1_3: 'anonymousCandidate.yearsBand.Y1_3',
  Y3_5: 'anonymousCandidate.yearsBand.Y3_5',
  Y5_10: 'anonymousCandidate.yearsBand.Y5_10',
  GTE_10Y: 'anonymousCandidate.yearsBand.GTE_10Y',
};

/** 稼働可能時期の 5 段階（`docs/02` A-04 ④）。🔴 具体的な稼働開始日は出さない。 */
export const ANONYMIZED_AVAILABILITY_BAND_MESSAGE_KEYS: Readonly<
  Record<AnonymizedAvailabilityBand, MessageKey>
> = {
  IMMEDIATE: 'anonymousCandidate.availabilityBand.IMMEDIATE',
  THIS_MONTH: 'anonymousCandidate.availabilityBand.THIS_MONTH',
  NEXT_MONTH: 'anonymousCandidate.availabilityBand.NEXT_MONTH',
  MONTH_AFTER_NEXT: 'anonymousCandidate.availabilityBand.MONTH_AFTER_NEXT',
  THREE_MONTHS_OR_LATER: 'anonymousCandidate.availabilityBand.THREE_MONTHS_OR_LATER',
};

/** リモート可否 3 値（`docs/02` A-04 ⑤）。 */
export const ANONYMIZED_REMOTE_MODE_MESSAGE_KEYS: Readonly<
  Record<AnonymizedRemoteMode, MessageKey>
> = {
  FULL_REMOTE: 'anonymousCandidate.remoteMode.FULL_REMOTE',
  PARTIAL_REMOTE: 'anonymousCandidate.remoteMode.PARTIAL_REMOTE',
  ONSITE_ONLY: 'anonymousCandidate.remoteMode.ONSITE_ONLY',
};

const VALUE_NONE_KEY: MessageKey = 'anonymousCandidate.valueNone';
const PRICE_OR_MORE_KEY: MessageKey = 'anonymousCandidate.priceBand.orMore';
const PRICE_UNIT_KEY: MessageKey = 'anonymousCandidate.priceBand.unit';

/**
 * 🔴 本モジュールが参照しうる文言キーの**全部**。サーバがクライアントへ渡す表（`AnonymizedLabelCatalog`）は
 *    この配列から作る —— 配列に無いキーを組み立てが参照すると、表に無い（= 画面にキーがそのまま出る）。
 *    `labels.test.ts` が「組み立てが参照するキーはすべてこの配列にある」ことを固定する。
 */
export const ANONYMIZED_LABEL_MESSAGE_KEYS: readonly MessageKey[] = [
  VALUE_NONE_KEY,
  PRICE_OR_MORE_KEY,
  PRICE_UNIT_KEY,
  ...Object.values(ANONYMIZED_YEARS_BAND_MESSAGE_KEYS),
  ...Object.values(ANONYMIZED_AVAILABILITY_BAND_MESSAGE_KEYS),
  ...Object.values(ANONYMIZED_REMOTE_MODE_MESSAGE_KEYS),
  ...Object.values(PREFECTURE_MESSAGE_KEYS),
];

/** 文言キー → 文言。サーバでは `t`、クライアントでは `AnonymizedLabelCatalog` を引く関数。 */
export type AnonymizedLabelLookup = (key: MessageKey) => string;

/**
 * クライアントへ渡す文言の表（`ANONYMIZED_LABEL_MESSAGE_KEYS` の分だけ）。
 * 🔴 `Partial` なのは、型上「全キーが揃っている」と言い切れないためである。引くときは `lookupFromCatalog`
 *    を通す（無いキーは**キー名をそのまま返す** —— 黙って空欄にせず、欠落が画面で見える）。
 */
export type AnonymizedLabelCatalog = Readonly<Partial<Record<MessageKey, string>>>;

export function lookupFromCatalog(catalog: AnonymizedLabelCatalog): AnonymizedLabelLookup {
  return (key) => catalog[key] ?? key;
}

/**
 * 単価レンジ（**万円**。`docs/02` A-04 ③）。
 *
 * 🔴 **円の生値を組み立てない。** 入力は `AnonymizedPriceBand`（万円の区分）だけであり、
 *    `Engineer.unitPriceMin` を受け取る形にしない —— 受け取れる形にした時点で、
 *    「丸める前の値を画面に出す」実装が書けてしまう（`docs/04` §5-2 の「丸める前の値を並置して見せない」）。
 * 🔴 `formatUnitPriceRange`（円・台帳用）と**別の関数**である。単位も打ち止めの概念も違う。
 */
export function formatAnonymizedPriceBandWith(
  band: AnonymizedPriceBand | null,
  lookup: AnonymizedLabelLookup,
): string {
  if (band === null) return lookup(VALUE_NONE_KEY);
  if (band.kind === 'OPEN') {
    return `${formatThousands(band.fromManYen)} ${lookup(PRICE_OR_MORE_KEY)}`;
  }
  return `${formatThousands(band.fromManYen)}〜${formatThousands(band.toManYen)} ${lookup(PRICE_UNIT_KEY)}`;
}

/** 勤務地（都道府県のみ）とリモート可否を 1 つに畳む（`formatLocation` と同じ体裁）。 */
export function formatAnonymizedLocationWith(
  prefecture: RoundedAnonymousAttributes['prefecture'],
  remoteMode: AnonymizedRemoteMode | null,
  lookup: AnonymizedLabelLookup,
): string {
  const parts = [
    prefecture === null ? null : lookup(PREFECTURE_MESSAGE_KEYS[prefecture]),
    remoteMode === null ? null : lookup(ANONYMIZED_REMOTE_MODE_MESSAGE_KEYS[remoteMode]),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? lookup(VALUE_NONE_KEY) : parts.join('・');
}

/**
 * 開示プレビュー / 候補一覧の 1 行（**すべて文言化済みの文字列**）。
 *
 * 🔴 **このオブジェクトのフィールドが、画面に出せるものの全部である。**
 *    `RoundedAnonymousAttributes` と 1 対 1 であり、**実名・所属会社名・社内 ID・営業メモ・
 *    スキルシート・経験内容のフィールドが存在しない**（`F-017 AC-1` / `F-008 AC-7` / `BR-55`。
 *    `undefined` ではなく型が違う）。
 */
export type AnonymizedAttributeRows = {
  /** 辞書の正規化済み名称（最大 8 件）。0 件なら空配列。 */
  readonly skills: readonly string[];
  readonly yearsBand: string;
  readonly priceBand: string;
  readonly availabilityBand: string;
  readonly location: string;
  /** 日単位に丸めた更新日（`YYYY-MM-DD`）。 */
  readonly updatedOn: string;
};

/**
 * 丸め済みの 5 項目を表示文字列にする。
 * 🔴 引数は `RoundedAnonymousAttributes` だけである ——
 *    **丸める前の値をここへ渡せない**ことが、プレビューに生値が混ざらない最後の 1 枚になる。
 */
export function anonymizedAttributeRowsWith(
  attributes: RoundedAnonymousAttributes,
  lookup: AnonymizedLabelLookup,
): AnonymizedAttributeRows {
  return {
    skills: attributes.skills.map((skill) => skill.name),
    yearsBand:
      attributes.yearsBand === null
        ? lookup(VALUE_NONE_KEY)
        : lookup(ANONYMIZED_YEARS_BAND_MESSAGE_KEYS[attributes.yearsBand]),
    priceBand: formatAnonymizedPriceBandWith(attributes.priceBand, lookup),
    availabilityBand:
      attributes.availabilityBand === null
        ? lookup(VALUE_NONE_KEY)
        : lookup(ANONYMIZED_AVAILABILITY_BAND_MESSAGE_KEYS[attributes.availabilityBand]),
    location: formatAnonymizedLocationWith(attributes.prefecture, attributes.remoteMode, lookup),
    updatedOn: attributes.updatedOn,
  };
}
