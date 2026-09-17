// apps/web/lib/candidates/list-rows.ts
// `S-016` 候補検索（案件起点）の表示値の組み立て（docs/04 §S-016）。T-08-05。
//
// 🔴 画面（`app/(main)/projects/[id]/candidates/**`）ではなくここに置く理由は `lib/engineers/list-rows.ts` と
//    同じである: `app/**` はユニットテストの対象外であり、「匿名候補の行に実名・所属会社名・稼働状況の
//    フィールドが**型として無い**こと」「URL の組み立て」を固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは**日本語の語を書かない**。
//
// 🔴 **匿名候補の行（`AnonymousCandidateRowView`）は `AnonymousCandidateView` の 5 項目 + 更新日だけから
//    組む。** `displayName` / `availability`（稼働状況）/ `id` のフィールドが**存在しない**（`undefined` では
//    なく型が違う。`F-017 AC-1`）。自社候補の行と `kind` で判別し、画面は判別した枝の中でしか
//    そのフィールドに触れない。表示文字列の組み立ては `S-015`（取引先の開示プレビュー）と**同じ関数**
//    （`anonymizedAttributeRows`）を通す —— プレビューと候補一覧で見え方がずれない（`docs/04` §5-2）。
import { PAGE_SIZE_DEFAULT } from '@ses/config';
import { ENGINEER_SKILL_MODE_DEFAULT } from '@ses/db';
import { t } from '@ses/i18n';
import { anonymizedAttributeRows } from '../anonymize/labels';
import type { AnonymousCandidateView } from '../anonymize/candidate-view';
import { formatUnitPriceRange } from '../engineers/detail';
import { ENGINEER_AVAILABILITY_MESSAGE_KEYS } from '../engineers/labels';
import {
  activeEngineerFilters,
  formatLocation,
  PRIMARY_SKILL_LIMIT,
  type EngineerActiveFilterView,
} from '../engineers/list-rows';
import { formatThousands } from '../format/number';
import { isAnonymousCandidateView, type CandidateListItem, type OwnCandidateView } from './list';
import type { ProjectCandidateListQuery } from './schemas';

/** `S-016` の入口（`/projects/{id}/candidates`）。 */
export function projectCandidatesPath(projectId: string): string {
  return `/projects/${projectId}/candidates`;
}

/** 未設定（`docs/04` §S-006 と同じく、空欄にせず `—` を置く）。 */
function none(): string {
  return t('anonymousCandidate.valueNone');
}

/**
 * 自社候補の 1 行（すべて文言化済み。画面は組み立てをせず、そのまま描く）。
 * 🔴 `key` は React の `key` / `data-testid` / 右パネルの選択に使う（行の ID）。
 */
export type OwnCandidateRowView = {
  readonly kind: 'OWN';
  readonly key: string;
  readonly id: string;
  readonly displayName: string;
  /** 一覧に出すスキル（上位 3 件）。超過は `moreSkills`。 */
  readonly skills: readonly string[];
  readonly moreSkills: string | null;
  /**
   * 登録スキルの総数（`skills.length + 超過件数`）。🔴 `S-016` のスキル列が 1 行に収まる件数まで減らしたとき、
   * `+N` を「隠した件数」で描き直すために持つ（`docs/04` §S-016 列幅配分「幅が足りなければ件数を減らす」。T-11-12）。
   */
  readonly skillCount: number;
  /** 経験年数の集約値（最大。「7 年」）。未設定は `—`。 */
  readonly years: string;
  readonly unitPrice: string;
  readonly availableFrom: string;
  readonly location: string;
  /** 稼働状況（🔴 自社候補にだけ在る。右パネルで出す。列には置かない〔`docs/04` §S-016 実装の補足〕）。 */
  readonly availabilityStatus: string;
  readonly updatedOn: string;
};

/**
 * 匿名候補の 1 行。🔴 **`displayName` / `availabilityStatus` / `id` を持たない**（型が違う）。
 * `key` は `candidateRef`（案件スコープ。応答に載っている値そのもの）。
 */
export type AnonymousCandidateRowView = {
  readonly kind: 'ANONYMOUS';
  readonly key: string;
  readonly candidateRef: string;
  /** 一覧に出すスキル（上位 3 件）。超過は `moreSkills`。右パネルは `allSkills`（最大 8 件）を出す。 */
  readonly skills: readonly string[];
  readonly moreSkills: string | null;
  /** 開示されたスキルの総数（= `allSkills.length`。上限 8。用途は `OwnCandidateRowView.skillCount` と同じ）。 */
  readonly skillCount: number;
  readonly allSkills: readonly string[];
  /** 経験年数の区分（「5〜10 年」）。 */
  readonly years: string;
  readonly unitPrice: string;
  readonly availableFrom: string;
  readonly location: string;
  readonly updatedOn: string;
};

export type CandidateRowView = OwnCandidateRowView | AnonymousCandidateRowView;

/** 一覧のスキル列に出す件数（`S-005` と同じ上限。超過は `+N`）。 */
function splitSkills(names: readonly string[]): {
  readonly skills: readonly string[];
  readonly moreSkills: string | null;
  readonly skillCount: number;
} {
  const more = Math.max(names.length - PRIMARY_SKILL_LIMIT, 0);
  return {
    skills: names.slice(0, PRIMARY_SKILL_LIMIT),
    moreSkills: more === 0 ? null : `+${more}`,
    skillCount: names.length,
  };
}

export function ownCandidateRow(view: OwnCandidateView): OwnCandidateRowView {
  return {
    kind: 'OWN',
    key: view.id,
    id: view.id,
    displayName: view.displayName,
    skills: view.primarySkills.map((skill) => skill.name),
    moreSkills: view.moreSkillCount === 0 ? null : `+${view.moreSkillCount}`,
    skillCount: view.primarySkills.length + view.moreSkillCount,
    years:
      view.yearsMax === null
        ? none()
        : `${String(view.yearsMax)} ${t('engineers.detail.years.unit')}`,
    unitPrice: formatUnitPriceRange(view.unitPriceMin, view.unitPriceMax),
    availableFrom: view.availableFrom ?? none(),
    location: formatLocation(view.prefecture, view.remoteMode),
    availabilityStatus: t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[view.availability]),
    updatedOn: view.updatedOn,
  };
}

/**
 * 🔴 引数は `AnonymousCandidateView` だけである —— 丸める前の値を渡せない（`labels.ts` と同じ最後の 1 枚）。
 */
export function anonymousCandidateRow(view: AnonymousCandidateView): AnonymousCandidateRowView {
  const rows = anonymizedAttributeRows(view);
  return {
    kind: 'ANONYMOUS',
    key: view.candidateRef,
    candidateRef: view.candidateRef,
    ...splitSkills(rows.skills),
    allSkills: rows.skills,
    years: rows.yearsBand,
    unitPrice: rows.priceBand,
    availableFrom: rows.availabilityBand,
    location: rows.location,
    updatedOn: rows.updatedOn,
  };
}

export function candidateListRows(items: readonly CandidateListItem[]): readonly CandidateRowView[] {
  return items.map((item) =>
    isAnonymousCandidateView(item) ? anonymousCandidateRow(item) : ownCandidateRow(item),
  );
}

/**
 * 🔴 母集団の明示（`docs/04` §3.2 項目 2 / §S-016 空状態）。ホストは**混在した総件数だけ**
 *    （「候補 12 件（自社台帳と共有候補）」）。共有候補の件数を別に出さない。
 *    取引先は「御社が登録した人材 N 件」（`S-005` と同じ語）。出所は `ctx.partnerCompanyId`。
 */
export function candidatePopulationLabel(partnerCompanyId: string | null, total: number): string {
  const count = `${formatThousands(total)} ${t('candidates.population.unit')}`;
  return partnerCompanyId === null
    ? `${t('candidates.population.host')} ${count}${t('candidates.population.hostScope')}`
    : `${t('candidates.population.partner')} ${count}`;
}

/**
 * 検索条件を保ったままの `S-016` へのリンク（`engineerListHref` と同じ規律: パラメータの並びは固定、
 * 既定値は載せない、`cursor` は明示）。
 * 🔴 **この関数が返す URL は必ずクエリ文字列を持つ**（明示的な条件を表す）。素の URL（案件の要件を初期値に
 *    する）は `projectCandidatesPath` が返す —— 画面の判定は「クエリ文字列のキーが 0 個か」である。
 */
export function projectCandidatesHref(
  projectId: string,
  query: ProjectCandidateListQuery,
  cursor: string | null,
): string {
  const params = new URLSearchParams();
  for (const skillId of query.skills ?? []) params.append('skills', skillId);
  if (query.skillMode !== ENGINEER_SKILL_MODE_DEFAULT) params.set('skillMode', query.skillMode);
  if (query.yearsMin !== undefined) params.set('yearsMin', String(query.yearsMin));
  if (query.priceMin !== undefined) params.set('priceMin', String(query.priceMin));
  if (query.priceMax !== undefined) params.set('priceMax', String(query.priceMax));
  if (query.availableBy !== undefined) params.set('availableBy', query.availableBy);
  if (query.prefecture !== undefined) params.set('prefecture', query.prefecture);
  if (query.remote !== undefined) params.set('remote', query.remote);
  if (query.availability !== undefined) params.set('availability', query.availability);
  if (query.q !== undefined) params.set('q', query.q);
  if (query.onlyInTime) params.set('onlyInTime', '1');
  if (query.onlyCommutable) params.set('onlyCommutable', '1');
  if (query.limit !== PAGE_SIZE_DEFAULT) params.set('limit', String(query.limit));
  if (cursor !== null) params.set('cursor', cursor);
  // 🔴 条件が 1 つも無い（明示的に空の検索）とき、素の URL にすると画面は「案件の要件を初期値にする」と
  //    読んでしまう（`page.tsx`）。既定値のキー 1 つ（`skillMode`）を残して「明示的な条件がある」ことを
  //    URL に保つ。母集団も並びも変わらない（既定値そのもの）。
  if (params.size === 0) params.set('skillMode', query.skillMode);
  return `${projectCandidatesPath(projectId)}?${params.toString()}`;
}

/**
 * 🔴 効いている条件を 1 つずつ外せる導線（`docs/04` §S-016 空状態「絞り込み 0 件 → 条件の解除導線」）。
 *    条件の列挙は `S-005` と**同じ 1 本**（`activeEngineerFilters`）で、URL の組み立て先だけを差し替える。
 * 🔴 `cursor` の形が違う（`S-005` = UUID / `S-016` = 並びのキー）が、解除の導線は常に**先頭ページ**へ
 *    戻すので `cursor` は捨てる（`activeEngineerFilters` が `cursor: undefined` にして渡す）。
 */
export function activeCandidateFilters(
  projectId: string,
  query: ProjectCandidateListQuery,
  skillNames: ReadonlyMap<string, string>,
): readonly EngineerActiveFilterView[] {
  return activeEngineerFilters(query, skillNames, (next) =>
    projectCandidatesHref(projectId, next, null),
  );
}

/** 絞り込みが 1 つでも効いているか（`hasEngineerListFilters` と同じ定義）。 */
export function hasCandidateFilters(query: ProjectCandidateListQuery): boolean {
  return activeCandidateFilters('', query, new Map()).length > 0;
}
