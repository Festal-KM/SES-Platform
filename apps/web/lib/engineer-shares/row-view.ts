// apps/web/lib/engineer-shares/row-view.ts
// `S-015` の 1 行の組み立て（`EngineerShareCandidateView` → 表示値）。T-08-02 の `share-props.ts` から
// 🔴 T-11-11 で切り出し、文言の解決を引数（`EngineerShareRowLabels`）に外出しした純関数にした。
//
// なぜここか: 初回ページはサーバ（`page.tsx` → `share-props.ts` が `t` で表を作る）、「次の 50 件」は
// クライアント（`engineer-share-screen.tsx` が `GET /api/engineer-shares` の続きを読む）で、**同じ関数**で
// 行を組み立てる。組み立てが 2 本になると、追加したページだけ表示が違う（`docs/04` §5-2 の「プレビューは
// ホストの候補一覧と同じ体裁」が 2 ページ目から破れる）。
//
// 🔴 **`@ses/i18n` を値 import しない**（型だけ）。`'use client'` の画面から import されるため、
//    `*.render.test.tsx` が「文言が無い状態の描画」を試せる状態を守る（`share-props.ts` 冒頭の規律）。
// 🔴 **行に出せる値は `EngineerShareCandidateView` にあるものだけ**である。丸める前の値（生の単価・稼働可能日・
//    市区町村）を受け取る引数が無いことが、「プレビューでは出ていないのに一覧には出る」ずれを作れない理由になる
//    （`docs/04` §5-2）。
import {
  anonymizedAttributeRowsWith,
  lookupFromCatalog,
  type AnonymizedAttributeRows,
  type AnonymizedLabelCatalog,
} from '../anonymize/labels-core';
import { formatThousands } from '../format/number';
import type { EngineerShareCandidateView, EngineerShareUpdateView } from './service';

/** 1 行分の表示値（すべて文言化済み。画面は組み立てをせず、そのまま描く）。 */
export type EngineerShareRowView = {
  readonly engineerId: string;
  readonly displayName: string;
  readonly shared: boolean;
  /** 共有開始日（`YYYY-MM-DD`）。共有していなければ `—`。 */
  readonly sharedOn: string;
  /** 受け取った提案依頼（`0 件`）。🔴 **自社宛だけ**である（`F-018 AC-6`）。 */
  readonly proposalRequestCount: string;
  /** 🔴 **丸めた稼働可能時期**（生の日付ではない）。 */
  readonly availability: string;
  readonly preview: AnonymizedAttributeRows;
};

/**
 * 行の組み立てに要る文言（サーバが `t` で解決してクライアントへ渡す）。
 * 🔴 `catalog` は匿名候補の 5 項目の文言だけ（`ANONYMIZED_LABEL_MESSAGE_KEYS`）。ここに氏名・経歴の語は無い。
 */
export type EngineerShareRowLabels = {
  readonly catalog: AnonymizedLabelCatalog;
  /** 未設定（台帳と同じく空欄にせず `—` を置く）。 */
  readonly valueNone: string;
  /** 件数の単位（`件`）。 */
  readonly countUnit: string;
};

export function engineerShareRow(
  view: EngineerShareCandidateView,
  labels: EngineerShareRowLabels,
): EngineerShareRowView {
  const preview = anonymizedAttributeRowsWith(view.previewedFields, lookupFromCatalog(labels.catalog));
  return {
    engineerId: view.engineerId,
    displayName: view.displayName,
    shared: view.shared,
    sharedOn: view.sharedOn ?? labels.valueNone,
    // 🔴 `0` を空欄に畳まない。「まだ 1 件も来ていない」ことも判断材料である。
    proposalRequestCount: `${formatThousands(view.proposalRequestCount)} ${labels.countUnit}`,
    // 🔴 一覧の「稼働可能時期」も**丸めた区分**を出す（生の日付を並置しない。`docs/04` §5-2）。
    availability: preview.availabilityBand,
    preview,
  };
}

export function engineerShareRows(
  items: readonly EngineerShareCandidateView[],
  labels: EngineerShareRowLabels,
): readonly EngineerShareRowView[] {
  return items.map((item) => engineerShareRow(item, labels));
}

/**
 * 🔴 `PUT /api/engineers/{id}/share` の応答で**当該行だけ**を描き直す（`docs/04` §S-015「操作と結果」）。
 *
 * 氏名と受け取った提案依頼の件数は操作で変わらないので既存の行から引き継ぎ、共有状態 / 共有開始日 /
 * 稼働可能時期 / プレビューは**サーバ応答**（`shared` / `sharedOn` / `previewedFields`）から作り直す。
 * 手元の現在時刻や「押した値」からは 1 つも組み立てない（サーバの状態だけが正）。
 */
export function redrawEngineerShareRow(
  row: EngineerShareRowView,
  updated: EngineerShareUpdateView,
  labels: EngineerShareRowLabels,
): EngineerShareRowView {
  if (row.engineerId !== updated.engineerId) return row;
  const preview = anonymizedAttributeRowsWith(updated.previewedFields, lookupFromCatalog(labels.catalog));
  return {
    ...row,
    shared: updated.shared,
    sharedOn: updated.sharedOn ?? labels.valueNone,
    availability: preview.availabilityBand,
    preview,
  };
}
