// apps/web/lib/proposals/snapshot-diff-fields.ts
// #46b `GET /api/proposals/{id}/snapshot-diff` の応答の形と、その**純粋な**組み立て（docs/05 §6.5「#46b の境界と記録の確定」/
// `F-019 AC-2` / `docs/04` §S-006 セクション 5 / §5-6）。T-12-16。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **`fields` は 7 キーを常に全部、この順で返す**（`SNAPSHOT_DIFF_FIELD_KEYS`）。変更が無くても落とさない —— 落とすと
//      「無い = 変更なし」の解釈がクライアントに漏れる。
//   ② 🔴 **`frozen` と `current` を別のキーで返す。** マージして `changed: boolean` にしない（マージした瞬間、どちらが凍結側かが
//      フラグ 1 つの解釈に依存する）。**変更の有無は画面側（`lib/engineers/proposal-sections-rows.ts`）が `frozen` と `current` を
//      突き合わせて導き、API は判定を返さない。** そのための等値判定（`snapshotFieldEquals` / `careersEqual`）もここに置く
//      （API の応答には載らない。画面が呼ぶだけ）。
//   ③ 🔴 **`skills` は両側とも凍結の形 `{ skillId, name, years, level }[]` を `skillId` 昇順に揃える**（現在値を凍結の形に写す。
//      逆はしない。凍結側は保存時点で既にこの順 = `createProposalDraft` の `orderBy: [{ skillId: 'asc' }]`）。
//   ④ `affiliationLabel` / `skillSheetId` / `Proposal.offeredUnitPrice`（提案単価）は `fields` に無い（docs/05 §6.5。差分の対象は
//      **台帳 vs 凍結**だけであり、提案条件は #46 の `terms` で読む）。
//
// 🔴 I/O を持たない（`@ses/db` にも Prisma にも触れない）。`app/**` からも型として参照される。
import type { CareerRowView } from '../engineers/careers';
import type { EngineerSkillView } from '../engineers/service';
import type { FrozenCareerView, ProposalSnapshotSkillView } from './views';

/**
 * 🔴 `EngineerSnapshot` の比較可能列 7 つ（= `EngineerSnapshot` の列 ∩ `OwnEngineerDetailView`）。並びは固定。
 *    docs/05 §6.5「#46b の境界と記録の確定」の列挙をそのまま写す。増減は設計の改訂を要する。
 */
export const SNAPSHOT_DIFF_FIELD_KEYS = [
  'displayName',
  'skills',
  'unitPriceMin',
  'unitPriceMax',
  'availableFrom',
  'prefecture',
  'remoteMode',
] as const;

export type SnapshotDiffFieldKey = (typeof SNAPSHOT_DIFF_FIELD_KEYS)[number];

/** 凍結側・現在値のどちらも同じ形に揃えてから比べる（`skills` は凍結の形）。 */
export type SnapshotComparable = {
  readonly displayName: string;
  readonly skills: readonly ProposalSnapshotSkillView[];
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  /** `YYYY-MM-DD` または `null`。 */
  readonly availableFrom: string | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
};

/** `fields[]` の 1 件。🔴 `frozen` と `current` は別のキー（`changed` は無い）。 */
export type SnapshotDiffField =
  | { readonly key: 'displayName'; readonly frozen: string; readonly current: string }
  | { readonly key: 'skills'; readonly frozen: readonly ProposalSnapshotSkillView[]; readonly current: readonly ProposalSnapshotSkillView[] }
  | { readonly key: 'unitPriceMin'; readonly frozen: number | null; readonly current: number | null }
  | { readonly key: 'unitPriceMax'; readonly frozen: number | null; readonly current: number | null }
  | { readonly key: 'availableFrom'; readonly frozen: string | null; readonly current: string | null }
  | { readonly key: 'prefecture'; readonly frozen: string | null; readonly current: string | null }
  | { readonly key: 'remoteMode'; readonly frozen: string | null; readonly current: string | null };

/**
 * #46b の応答（docs/05 §6.5 #46b）。
 * 🔴 `engineerId` / `ownerPartnerCompanyId` / 提案先 / 本文 / `offeredUnitPrice` / `affiliationLabel` / `skillSheetId` を持たない。
 *    `careers.frozen`（`FrozenCareer[]`。行 ID 無し）と `careers.current`（#17 と同じ `CareerRowView[]`）は**別のキー**で、
 *    行の対応付けは返さない（凍結行に台帳の行 ID を持たない設計〔§3.6〕の帰結）。
 */
export type ProposalSnapshotDiffView = {
  /** ISO 8601（UTC）。#46 の `snapshot.frozenAt` と同じ値。 */
  readonly frozenAt: string;
  readonly fields: readonly SnapshotDiffField[];
  readonly careers: {
    readonly frozen: readonly FrozenCareerView[];
    readonly current: readonly CareerRowView[];
  };
};

/** 応答の最上位キー（結合テストがキー集合を固定するための対照）。 */
export const PROPOSAL_SNAPSHOT_DIFF_VIEW_KEYS = ['frozenAt', 'fields', 'careers'] as const satisfies readonly (keyof ProposalSnapshotDiffView)[];

function compareSkillId(a: ProposalSnapshotSkillView, b: ProposalSnapshotSkillView): number {
  // uuid の文字列比較（Postgres の `uuid` 順と一致する。凍結側の並びと同じ規則）。
  if (a.skillId < b.skillId) return -1;
  if (a.skillId > b.skillId) return 1;
  return 0;
}

/**
 * 🔴 台帳のスキル（`EngineerSkillView`。#17 の形）を**凍結の形**に写す（`years` = `yearsOfExperience`。`skillId` 昇順）。
 *    現在値を凍結の形に写す（逆はしない）。
 */
export function toFrozenSkillShape(skills: readonly EngineerSkillView[]): readonly ProposalSnapshotSkillView[] {
  return skills
    .map((skill) => ({ skillId: skill.skillId, name: skill.name, years: skill.yearsOfExperience, level: skill.level }))
    .sort(compareSkillId);
}

/**
 * 🔴 7 キーを常に全部、固定の順で返す。入力の両側は既に同じ形（`SnapshotComparable`）に揃っていること。
 */
export function buildSnapshotDiffFields(frozen: SnapshotComparable, current: SnapshotComparable): readonly SnapshotDiffField[] {
  return [
    { key: 'displayName', frozen: frozen.displayName, current: current.displayName },
    { key: 'skills', frozen: frozen.skills, current: current.skills },
    { key: 'unitPriceMin', frozen: frozen.unitPriceMin, current: current.unitPriceMin },
    { key: 'unitPriceMax', frozen: frozen.unitPriceMax, current: current.unitPriceMax },
    { key: 'availableFrom', frozen: frozen.availableFrom, current: current.availableFrom },
    { key: 'prefecture', frozen: frozen.prefecture, current: current.prefecture },
    { key: 'remoteMode', frozen: frozen.remoteMode, current: current.remoteMode },
  ];
}

function skillsEqual(a: readonly ProposalSnapshotSkillView[], b: readonly ProposalSnapshotSkillView[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((skill, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      skill.skillId === other.skillId &&
      skill.name === other.name &&
      skill.years === other.years &&
      skill.level === other.level
    );
  });
}

/**
 * 🔴 「提案後に変更」の唯一の判定（画面側）。API はこの結果を返さない（docs/05 §6.5「変更の有無は画面側の純粋関数が導く」）。
 */
export function snapshotFieldEquals(field: SnapshotDiffField): boolean {
  return field.key === 'skills' ? skillsEqual(field.frozen, field.current) : field.frozen === field.current;
}

/**
 * 経歴の凍結側と現在値の**列としての**等値（行数と各行の 5 項目。配列順 = 表示順なので順序も含めて比べる）。
 * 🔴 行の対応付け（どの凍結行がどの現在行か）は導かない —— 凍結行に台帳の行 ID が無い以上、内容の類似で結び付けると
 *    「変更」と「削除 + 追加」が実行のたびに入れ替わる（`docs/04` §5-6）。画面はこの結果を見出しの注記にだけ使う。
 */
export function careersEqual(frozen: readonly FrozenCareerView[], current: readonly CareerRowView[]): boolean {
  if (frozen.length !== current.length) return false;
  return frozen.every((row, index) => {
    const other = current[index];
    return (
      other !== undefined &&
      row.periodFrom === other.periodFrom &&
      row.periodTo === other.periodTo &&
      row.role === other.role &&
      row.description === other.description &&
      row.technologies === other.technologies
    );
  });
}
