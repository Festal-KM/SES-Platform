// 案件の登録と検索で共有する値。表示文言はi18nに置く。
export const PROJECT_DEVELOPMENT_PHASES = ['PLANNING', 'REQUIREMENTS', 'BASIC_DESIGN', 'DETAIL_DESIGN', 'INTEGRATION_TEST', 'SYSTEM_TEST', 'OPERATIONS'] as const;
export const PROJECT_DEVELOPMENT_METHODS = ['WATERFALL', 'AGILE'] as const;

export type ProjectKeywordGroup = { readonly mode: 'AND' | 'OR'; readonly terms: readonly string[] };

/** 保存済みの配列形式も受け、過大・不正な条件は採用しない。 */
export function parseProjectKeywordGroups(value: unknown): readonly ProjectKeywordGroup[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const result: ProjectKeywordGroup[] = [];
  for (const raw of value) {
    const group = Array.isArray(raw) ? { mode: 'OR', terms: raw } : raw as { mode?: unknown; terms?: unknown } | null;
    if (!group || !['AND', 'OR'].includes(String(group.mode)) || !Array.isArray(group.terms) || group.terms.length > 10 || group.terms.some(term => typeof term !== 'string' || term.length > 200)) return null;
    const terms = [...new Set((group.terms as string[]).map(term => term.trim()).filter(Boolean))];
    result.push({ mode: group.mode as 'AND' | 'OR', terms });
  }
  return result;
}

export const PROJECT_UTILIZATION_BANDS = ['FULL', 'HALF_TO_FULL', 'UNDER_HALF'] as const;
