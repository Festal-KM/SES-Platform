/** 実際に公開された相手と、現在登録されている相手の数から表示を決める。 */
export function projectVisibilityLabel(visibleCount: number, partnerCount: number): 'UNPUBLISHED' | 'PUBLISHED' | 'PARTIAL' {
  if (visibleCount === 0) return 'UNPUBLISHED';
  return partnerCount > 0 && visibleCount === partnerCount ? 'PUBLISHED' : 'PARTIAL';
}
