import { describe, expect, it } from 'vitest';
import { projectBasicInfoFields, type ProjectBasicInfo } from './basic-info';

function info(): ProjectBasicInfo {
  return {
    category: 'BACKEND', publicSummary: '業務システムのAPI開発', remoteMode: '一部リモート可',
    unitPriceMin: 700_000, unitPriceMax: 700_000, location: '東京都 / 神田駅 徒歩5分',
    startDate: '2026-11-01', endDate: '2027-03-31', headcount: 2,
    distributionLimit: '貴社所属まで', publicMemo: '週2回出社', updatedOn: '2026-10-26',
    host: { endClientName: '架空エンド', upperCompanyName: '架空上位会社',
      internalUnitPrice: 600_000, remarks: '経験による単価調整は相談', assignee: 'サンプル 太郎' },
  };
}

describe('案件の基本情報', () => {
  it('指定された16項目を指定順に表示し、固定の卸単価を使う', () => {
    const fields = projectBasicInfoFields(info());
    expect(fields.map((field) => field.label)).toEqual([
      'エンドクライアント', '上位会社', 'カテゴリ', '業務概要', '稼働形態', '卸単価',
      '想定仕入単価', '勤務地/最寄駅', '開始時期', '終了時期', '募集人数', '商流制限',
      '公開メモ', '備考', '担当者', '更新日',
    ]);
    expect(fields.find((field) => field.key === 'unitPrice')?.value).toBe('70 万円');
    expect(fields.find((field) => field.key === 'purchaseUnitPrice')?.value).toBe('60 万円');
  });
  it('取引先には公開メモを出し、商流・想定仕入単価・内部備考・担当者を出さない', () => {
    const fields = projectBasicInfoFields({ ...info(), host: null });
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.map((field) => field.key)).toContain('publicMemo');
    for (const key of ['endClientName', 'upperCompanyName', 'purchaseUnitPrice', 'remarks', 'assignee']) {
      expect(fields.map((field) => field.key)).not.toContain(key);
    }
    expect(JSON.stringify(fields)).not.toContain('架空エンド');
  });
  it('旧レンジは固定額と備考に分け、未設定と0を区別する', () => {
    const fields = projectBasicInfoFields({ ...info(), unitPriceMax: 800_000, endDate: null });
    expect(fields.find((field) => field.key === 'unitPrice')?.value).toBe('70 万円');
    expect(fields.find((field) => field.key === 'remarks')?.value).toContain('70〜80 万円');
    expect(fields.find((field) => field.key === 'endDate')?.value).toBe('—');
    expect(projectBasicInfoFields({ ...info(), unitPriceMin: 0, unitPriceMax: 0 })
      .find((field) => field.key === 'unitPrice')?.value).toBe('0 万円');
  });
});
