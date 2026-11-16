import { isSafeIntakeSkill } from '@ses/domain';

/** 登録文そのものを AI に渡さず、スキル辞書に存在する安全な語だけを取り出す。 */
export function intakeSkillsForAi(text: string, skillNames: readonly string[]): readonly string[] {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en-US');
  const result = new Set<string>();
  for (const name of skillNames) {
    const clean = name.normalize('NFKC').trim();
    // 辞書に連絡先や氏名が誤登録されても、そのまま外部に出さない。
    if (!isSafeIntakeSkill(clean)) continue;
    const escaped = clean.toLocaleLowerCase('en-US').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    if (pattern.test(normalized)) result.add(clean);
    if (result.size >= 50) break;
  }
  return [...result];
}
