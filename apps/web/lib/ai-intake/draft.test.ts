import { describe, expect, it } from 'vitest';
import { intakeDraftFromText } from './draft';

describe('登録文の下書き', () => {
  it('明示された案件情報だけを入力欄の値として取り出す', () => {
    expect(intakeDraftFromText('案件名：データ基盤\n内容：SQL開発\n開始日：2027/1/5\n単価：60〜80万円', 'PROJECT')).toEqual({
      name: 'データ基盤', summary: 'SQL開発', availableFrom: '2027-01-05', priceMin: 600000, priceMax: 800000,
    });
  });
  it('ラベルのない個人情報を他の項目として推測しない', () => {
    expect(intakeDraftFromText('山田太郎\nexample@example.test', 'ENGINEER')).toEqual({});
  });
});
