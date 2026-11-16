import { describe, expect, it } from 'vitest';
import { intakeSkillsForAi } from './facts';

describe('登録文から AI に送る情報', () => {
  it('辞書にある技術名だけを取り出し、氏名や単価、連絡先を渡さない', () => {
    const raw = '氏名 山田太郎 / 単価 80万円 / 会社 例株式会社 / a@example.test / Java と AWS';
    const facts = intakeSkillsForAi(raw, ['Java', 'AWS', '山田太郎', 'a@example.test', '80万円', 'John Smith']);
    expect(facts).toEqual(['Java', 'AWS']);
    expect(JSON.stringify(facts)).not.toMatch(/山田|80万|株式会社|example/);
  });
  it('正規化と重複排除を行い、許可リストにない辞書の語を除く', () => {
    expect(intakeSkillsForAi('John Smith', ['John Smith'])).toEqual([]);
    expect(intakeSkillsForAi('Ｊａｖａ', ['Java', 'Java'])).toEqual(['Java']);
    expect(intakeSkillsForAi('C# と C++', ['C', 'C#', 'C++'])).toEqual(['C#', 'C++']);
  });
});
