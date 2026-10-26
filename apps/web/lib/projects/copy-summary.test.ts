import { describe, expect, it } from 'vitest';
import { COPY_SUMMARY_EXCLUDED_FIELDS, projectCopySummary } from './copy-summary';
import { projectBasicInfoFields, type ProjectBasicInfo } from './basic-info';

function fields() {
  const info: ProjectBasicInfo = {
    category: 'BACKEND', publicSummary: '受発注APIの設計\n既存機能の改善', remoteMode: '一部リモート可',
    unitPriceMin: 700000, unitPriceMax: 700000, location: '東京都 / 神田駅 徒歩5分',
    startDate: '2026-11-01', endDate: '2027-03-31', headcount: 2,
    distributionLimit: '貴社所属まで', publicMemo: '週2回出社', updatedOn: '2026-10-26',
    host: { endClientName: '架空エンド', upperCompanyName: '架空上位会社', internalUnitPrice: 600000,
      remarks: '内部の備考', assignee: 'サンプル担当者' },
  };
  return projectBasicInfoFields(info);
}

describe('基本情報から作るコピペ用サマリ', () => {
  it('案件名と対象の基本情報を同じ順番で含め、想定仕入単価を残す', () => {
    const text = projectCopySummary('受発注システム開発', fields());
    expect(text.split('\n')[0]).toBe('【案件名】受発注システム開発');
    expect([...text.matchAll(/【([^】]+)】/g)].map(m => m[1])).toEqual([
      '案件名', 'カテゴリ', '業務概要', '稼働形態', '想定仕入単価', '勤務地/最寄駅',
      '開始時期', '終了時期', '募集人数', '商流制限', '公開メモ',
    ]);
    expect(text).toContain('【想定仕入単価】60 万円');
    expect(text).toContain('【業務概要】\n受発注APIの設計\n既存機能の改善');
    expect(text).toContain('【公開メモ】週2回出社');
  });
  it('指定の6項目はラベルと値の両方を除外する', () => {
    const text = projectCopySummary('受発注システム開発', fields());
    for (const key of COPY_SUMMARY_EXCLUDED_FIELDS) {
      const field = fields().find(f => f.key === key);
      expect(field).toBeDefined();
      expect(text).not.toContain(`【${field?.label}】`);
      expect(text).not.toContain(field?.value);
    }
  });
  it('未設定項目と将来追加される未知の項目を含めない', () => {
    const text = projectCopySummary('案件', [
      {key:'endDate',label:'終了時期',value:'—'},
      {key:'publicMemo',label:'公開メモ',value:''},
      {key:'unknownSecret',label:'新しい内部情報',value:'非公開の値'},
    ]);
    expect(text).toBe('【案件名】案件');
  });
  it('取引先に渡された基本情報に無い想定仕入単価を補完しない', () => {
    const text = projectCopySummary('案件', fields().filter(f => f.key !== 'purchaseUnitPrice'));
    expect(text).not.toContain('想定仕入単価');
    expect(text).not.toContain('60 万円');
  });
});