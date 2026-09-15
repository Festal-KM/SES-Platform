// apps/web/lib/candidates/schemas.ts
// `GET /api/projects/{id}/candidates`（#30。`S-016`）と `GET /api/engineers?projectId=`（#15）の境界検証。
// T-08-05（docs/05 §6.4「#15 の実装の決着（T-08-05）」/ §6.5「#30 の実装の決着」）。
//
// 🔴 検索条件は `engineerListQuerySchema`（`lib/engineers/schemas.ts`）と**同じ項目・同じ制約**である。
//    `S-005` と `S-016` で「同じ名前の条件が別の意味を持つ」状態を作らないため、条件の定義は
//    1 か所（`engineerSearchCriteriaFields`）から引き、ここではカーソルの形だけを差し替える。
//
// 🔴 **カーソルは並びのキーそのもの**（`{bucket}:{YYYY-MM-DD}:{sortRef}`。docs/05 §4.6
//    「自社候補との混在の並びとページング」）。行の ID ではないので、ページの境目の行が消えても
//    次ページは「そのキーより後ろ」として決まる。形はスキーマで固定し、UUID（`S-005` のカーソル）
//    と混同した要求は 400 にする（黙って先頭に戻さない）。
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { cursorPageQuerySchema } from '../api/pagination';
import { optionalFilter } from '../api/query-filters';
import { CANDIDATE_REF_PATTERN } from '../anonymize/reference';
import { engineerSearchCriteriaFields } from '../engineers/schemas';

/** `sortRef`（base64url 22 文字）。匿名候補は `candidateRef`、自社候補も同じ関数の値である。 */
const SORT_REF_SOURCE = CANDIDATE_REF_PATTERN.source.replace(/^\^|\$$/g, '');

/** 並びのキー = カーソル。`bucket` は 0 か 1（`engineerSearchPlan(criteria).buckets` は最大 2 つ）。 */
export const CANDIDATE_CURSOR_PATTERN = new RegExp(
  `^(?<bucket>[01]):(?<updatedOn>\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])):(?<sortRef>${SORT_REF_SOURCE})$`,
);

export const candidateCursorSchema = z.string().regex(CANDIDATE_CURSOR_PATTERN);

/** 並びのキー（`compareCandidateSortKeys` の入力。`list.ts`）。 */
export type CandidateSortKey = {
  /** 何番目のバケットか（0 = 適合）。 */
  readonly bucket: 0 | 1;
  /** JST 暦日（`YYYY-MM-DD`）。 */
  readonly updatedOn: string;
  /** 案件スコープの参照子（base64url 22 文字）。 */
  readonly sortRef: string;
};

export function encodeCandidateCursor(key: CandidateSortKey): string {
  return `${key.bucket}:${key.updatedOn}:${key.sortRef}`;
}

/**
 * @throws RangeError 形が合わないとき。🔴 API 境界では `candidateCursorSchema` が先に 400 にするので、
 *         ここに届くのは実装ミス（画面が別の形の文字列を渡した）だけである。値は message に載せない。
 */
export function decodeCandidateCursor(cursor: string): CandidateSortKey {
  const match = CANDIDATE_CURSOR_PATTERN.exec(cursor);
  if (match === null || match.groups === undefined) {
    throw new RangeError('候補一覧のカーソルの形が不正です（docs/05 §4.6）。');
  }
  return {
    bucket: match.groups['bucket'] === '1' ? 1 : 0,
    updatedOn: match.groups['updatedOn'] ?? '',
    sortRef: match.groups['sortRef'] ?? '',
  };
}

/**
 * `GET /api/projects/{id}/candidates`（#30）の query。
 * 🔴 検索条件は `S-005` と同じ（`engineerSearchCriteriaFields`）。カーソルだけが並びのキーである。
 * 🔴 分離キーを持たない。`projectId` は path（`candidateProjectParamsSchema`）で受ける。
 */
export const projectCandidateListQuerySchema = cursorPageQuerySchema.extend({
  ...engineerSearchCriteriaFields,
  cursor: optionalFilter(candidateCursorSchema),
});

export type ProjectCandidateListQuery = z.infer<typeof projectCandidateListQuerySchema>;

export type ProjectCandidateListQueryIsolationGuard =
  AssertNoIsolationKeys<ProjectCandidateListQuery>;

assertNoIsolationKeys(
  Object.keys(projectCandidateListQuerySchema.shape),
  'projectCandidateListQuerySchema',
);

/** `GET /api/projects/{id}/candidates` の path params（`projectParamsSchema` と同じ形）。 */
export const candidateProjectParamsSchema = z.object({ id: z.uuid() });

export type CandidateProjectParams = z.infer<typeof candidateProjectParamsSchema>;

export type CandidateProjectParamsIsolationGuard = AssertNoIsolationKeys<CandidateProjectParams>;

assertNoIsolationKeys(Object.keys(candidateProjectParamsSchema.shape), 'candidateProjectParamsSchema');

/**
 * `GET /api/engineers`（#15）の query（T-08-05 で `projectId` を足した）。
 *
 * ⚠️ **暫定。[Issue #50](https://github.com/Festal-KM/SES-Platform/issues/50) で確認中（既定 A）**:
 *    匿名候補が混ざるのは **`projectId` が渡されたときだけ**であり、`S-005` は渡さない
 *    （参照子は案件スコープで、案件が無いと定義できない。docs/05 §6.4「#15 の実装の決着（T-08-05）」）。
 *    B（`S-005` に案件セレクタ）へ変えるときは、画面がこのキーを渡すだけで済む。
 * 🔴 `projectId` は**操作対象の指定**であって実行者のスコープではない（分離キーではない。
 *    `#27` の path `{id}` と同じ扱い）。見えない案件は 404 になる（docs/05 §4.8）。
 * 🔴 `cursor` は 2 通り（案件なし = 行の UUID / 案件あり = 並びのキー）。**組み合わせの検証は
 *    Route Handler が行う**（トップレベルの `.refine()` は `withApiRoute` の `assertBoundarySchema`
 *    が `.shape` を読めなくなるため使えない。`lib/engineers/schemas.ts` 冒頭）。
 */
export const engineerListApiQuerySchema = cursorPageQuerySchema.extend({
  ...engineerSearchCriteriaFields,
  projectId: optionalFilter(z.uuid()),
  cursor: optionalFilter(z.union([z.uuid(), candidateCursorSchema])),
});

export type EngineerListApiQuery = z.infer<typeof engineerListApiQuerySchema>;

export type EngineerListApiQueryIsolationGuard = AssertNoIsolationKeys<EngineerListApiQuery>;

assertNoIsolationKeys(Object.keys(engineerListApiQuerySchema.shape), 'engineerListApiQuerySchema');

/** 行の UUID か（`S-005` のカーソルの形。`idCursorPageQuerySchema` と同じ判定）。 */
export function isUuidCursor(cursor: string): boolean {
  return z.uuid().safeParse(cursor).success;
}
