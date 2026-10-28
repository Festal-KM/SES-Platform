import { describe, expect, it } from 'vitest';
import { projectPublicContent } from './project-public-content.js';

describe('案件の公開検査対象', () => {
  it('公開メモや勤務地の変更が検査本文に反映される', () => {
    const before = projectPublicContent({ publicSummary: '概要', locationDetail: '神田駅', publicMemo: '週2回出社' });
    expect(before).toBe('概要\n神田駅\n週2回出社');
    expect(projectPublicContent({ publicSummary: '概要', locationDetail: '品川駅', publicMemo: '週2回出社' })).not.toBe(before);
    expect(projectPublicContent({ publicSummary: '概要', locationDetail: '神田駅', publicMemo: 'エンド企業名' })).not.toBe(before);
  });
  it('新しい欄が空なら既存の検査内容を変えない', () => {
    expect(projectPublicContent({ publicSummary: '既存本文' })).toBe('既存本文');
    expect(projectPublicContent({ publicSummary: null, publicMemo: null })).toBeNull();
  });
});
