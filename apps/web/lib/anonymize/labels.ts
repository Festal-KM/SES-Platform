// apps/web/lib/anonymize/labels.ts
// 匿名候補（`CLAUDE.md` §3.1 経路 4）の**丸め後の区分 → 文言キー**の写像。T-08-02。
//
// 🔴 置き場所が機能モジュール（`lib/engineer-shares/**`）ではなく横断（`lib/anonymize/**`）で
//    あるのは、**同じ値を 2 つの画面が出す**ためである:
//      - `S-015`（取引先の開示プレビュー。T-08-02 = 本タスク）
//      - `S-016`（ホストの候補一覧。T-08-05）
//    `docs/04` §5-2 は「プレビューはホストの候補一覧と**同じ体裁**で表示する」と定めており、
//    写像が 2 本あると**「プレビューでは出ていないのに実際には出る」**ずれが生まれる
//    （`projectPublishPreview` が `S-011` と同じ組み立て関数を使っているのと同じ規律）。
//
// 🔴 **文言そのものは `packages/i18n` が唯一の出所**（`CLAUDE.md` §3.5）。ここは写像だけを持ち、
//    日本語の語を 1 つも書かない。
// 🔴 テンプレートリテラルでキーを組み立てない（`lib/engineers/labels.ts` と同じ規律）。
//    `Record<区分, MessageKey>` にすることで、**区分が増えたら文言の割り当てをコンパイラが
//    強制する** —— 割り当て漏れが「コードがそのまま画面に出る」形で表に出るのを防ぐ。
//
// 🔴 `engineers.remoteMode.*` と同じ意味の値だが**匿名候補側の文言キーを別に持つ**
//    （`PROJECT_REMOTE_MODE_MESSAGE_KEYS` と同じ判断）。台帳の「リモート可否」と
//    匿名候補の「リモート可否」は同じ語でも文脈が違い、片方だけ言い換えたくなったときに
//    キーが共有されていると両方が動く。
//
// 🔴 **ここに写像を足すことは開示項目を足すことに近い。** 本ファイルが扱ってよいのは
//    `RoundedAnonymousAttributes` のフィールドだけであり、それは 5 項目 + 更新日である
//    （`BR-54` / `CLAUDE.md` §8.6 = 人間の承認事項）。
import type {
  AnonymizedAvailabilityBand,
  AnonymizedPriceBand,
  AnonymizedRemoteMode,
  AnonymizedYearsBand,
  RoundedAnonymousAttributes,
} from '@ses/domain';
import { t, type MessageKey } from '@ses/i18n';
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

/** 未設定（台帳と同じく空欄にせず `—` を置く）。 */
function none(): string {
  return t('anonymousCandidate.valueNone');
}

/**
 * 単価レンジ（**万円**。`docs/02` A-04 ③）。
 *
 * 🔴 **円の生値を組み立てない。** 入力は `AnonymizedPriceBand`（万円の区分）だけであり、
 *    `Engineer.unitPriceMin` を受け取る形にしない —— 受け取れる形にした時点で、
 *    「丸める前の値を画面に出す」実装が書けてしまう（`docs/04` §5-2 の
 *    「丸める前の値を並置して見せない」）。
 * 🔴 `formatUnitPriceRange`（円・台帳用）と**別の関数**である。単位も打ち止めの概念も違う。
 */
export function formatAnonymizedPriceBand(band: AnonymizedPriceBand | null): string {
  if (band === null) return none();
  if (band.kind === 'OPEN') {
    return `${formatThousands(band.fromManYen)} ${t('anonymousCandidate.priceBand.orMore')}`;
  }
  return `${formatThousands(band.fromManYen)}〜${formatThousands(band.toManYen)} ${t('anonymousCandidate.priceBand.unit')}`;
}

/** 勤務地（都道府県のみ）とリモート可否を 1 つに畳む（`formatLocation` と同じ体裁）。 */
export function formatAnonymizedLocation(
  prefecture: RoundedAnonymousAttributes['prefecture'],
  remoteMode: AnonymizedRemoteMode | null,
): string {
  const parts = [
    prefecture === null ? null : t(PREFECTURE_MESSAGE_KEYS[prefecture]),
    remoteMode === null ? null : t(ANONYMIZED_REMOTE_MODE_MESSAGE_KEYS[remoteMode]),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? none() : parts.join('・');
}

/**
 * 開示プレビュー / 候補一覧の 1 行（**すべて文言化済みの文字列**）。
 *
 * 🔴 **このオブジェクトのフィールドが、画面に出せるものの全部である。**
 *    `RoundedAnonymousAttributes` と 1 対 1 であり、**実名・所属会社名・社内 ID・営業メモ・
 *    スキルシート・経験内容（`EngineerCareer`）のフィールドが存在しない**
 *    （`F-017 AC-1` / `F-008 AC-7` / `BR-55`。`undefined` ではなく型が違う）。
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
export function anonymizedAttributeRows(
  attributes: RoundedAnonymousAttributes,
): AnonymizedAttributeRows {
  return {
    skills: attributes.skills.map((skill) => skill.name),
    yearsBand:
      attributes.yearsBand === null
        ? none()
        : t(ANONYMIZED_YEARS_BAND_MESSAGE_KEYS[attributes.yearsBand]),
    priceBand: formatAnonymizedPriceBand(attributes.priceBand),
    availabilityBand:
      attributes.availabilityBand === null
        ? none()
        : t(ANONYMIZED_AVAILABILITY_BAND_MESSAGE_KEYS[attributes.availabilityBand]),
    location: formatAnonymizedLocation(attributes.prefecture, attributes.remoteMode),
    updatedOn: attributes.updatedOn,
  };
}
