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
import type { AnonymizedPriceBand, AnonymizedRemoteMode, RoundedAnonymousAttributes } from '@ses/domain';
import { t } from '@ses/i18n';
import {
  ANONYMIZED_LABEL_MESSAGE_KEYS,
  anonymizedAttributeRowsWith,
  formatAnonymizedLocationWith,
  formatAnonymizedPriceBandWith,
  type AnonymizedAttributeRows,
  type AnonymizedLabelCatalog,
} from './labels-core';

// 🔴 T-11-11: 写像と組み立ての本体は `labels-core.ts`（文言の解決を引数に外出しした純関数）へ移した。
//    本ファイルは **`t` を束ねた同じ export** を保つ（`S-016` の呼び出し側は変わらない）。理由は
//    `labels-core.ts` 冒頭 —— `S-015` の「次の 50 件」がクライアント側で同じ組み立てを使うため。
export {
  ANONYMIZED_AVAILABILITY_BAND_MESSAGE_KEYS,
  ANONYMIZED_REMOTE_MODE_MESSAGE_KEYS,
  ANONYMIZED_YEARS_BAND_MESSAGE_KEYS,
} from './labels-core';
export type { AnonymizedAttributeRows, AnonymizedLabelCatalog } from './labels-core';

/**
 * 単価レンジ（**万円**。`docs/02` A-04 ③）。組み立ては `formatAnonymizedPriceBandWith`（`labels-core.ts`）。
 * 🔴 円の生値を組み立てない（`labels-core.ts` の注記）。
 */
export function formatAnonymizedPriceBand(band: AnonymizedPriceBand | null): string {
  return formatAnonymizedPriceBandWith(band, t);
}

/** 勤務地（都道府県のみ）とリモート可否を 1 つに畳む（`formatLocation` と同じ体裁）。 */
export function formatAnonymizedLocation(
  prefecture: RoundedAnonymousAttributes['prefecture'],
  remoteMode: AnonymizedRemoteMode | null,
): string {
  return formatAnonymizedLocationWith(prefecture, remoteMode, t);
}

/**
 * 丸め済みの 5 項目を表示文字列にする（サーバ側。`t` で解決する）。
 * 🔴 引数は `RoundedAnonymousAttributes` だけである（`labels-core.ts` の注記）。
 */
export function anonymizedAttributeRows(
  attributes: RoundedAnonymousAttributes,
): AnonymizedAttributeRows {
  return anonymizedAttributeRowsWith(attributes, t);
}

/**
 * 🔴 クライアントへ渡す文言の表（`S-015` の「次の 50 件」用。T-11-11）。
 *    `ANONYMIZED_LABEL_MESSAGE_KEYS` の全キーを `t` で解決した**文字列だけ**のオブジェクトであり、
 *    丸め前の値も、5 項目以外の語も含まない。クライアントは `lookupFromCatalog(catalog)` を
 *    `anonymizedAttributeRowsWith` に渡す —— サーバ（`t`）と**同じ関数**で同じ結果になる。
 */
export function anonymizedLabelCatalog(): AnonymizedLabelCatalog {
  return Object.fromEntries(ANONYMIZED_LABEL_MESSAGE_KEYS.map((key) => [key, t(key)]));
}
