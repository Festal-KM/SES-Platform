/** 公開本文・勤務地の詳細・公開メモを、ハッシュと検査で同じ順序にまとめる。 */
export function projectPublicContent(project: {
  readonly publicSummary: string | null;
  readonly locationDetail?: string | null;
  readonly publicMemo?: string | null;
}): string | null {
  const texts = [project.publicSummary, project.locationDetail, project.publicMemo]
    .filter((text): text is string => text !== null && text !== undefined && text !== '');
  return texts.length === 0 ? null : texts.join('\n');
}
