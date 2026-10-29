import { describe, expect, it } from 'vitest';
import { COPY_SUMMARY_EXCLUDED_FIELDS, projectCopyRequirementFields, projectCopySummary } from './copy-summary';
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
  it('取引先提出用の見出し・順序に整え、期間と場所をまとめる', () => {
    const text = projectCopySummary('受発注システム開発', fields());
    expect(text).toBe([
      '【案件】受発注システム開発',
      '【内容】\n受発注APIの設計\n既存機能の改善',
      '【期間】2026-11-01～2027-03-31',
      '【場所】東京都 / 神田駅 徒歩5分（一部リモート可）',
      '【単価】60 万円',
      '【募集】2 名',
      '【商流】貴社所属まで',
      '【備考】週2回出社',
    ].join('\n\n'));
    for (const label of ['カテゴリ', '想定仕入単価', '公開メモ', '卸単価', '開始時期', '終了時期']) {
      expect(text).not.toContain(`【${label}】`);
    }
  });
  it('必須・尚可を分け、4件以上の要件と経験年数・自由記述を省略しない', () => {
    const requirements = projectCopyRequirementFields([
      ...['SAP SD', 'SAP MM', '顧客折衝', 'ドキュメント作成'].map((skillName) => ({
        kind: 'MUST' as const, skillId: skillName, skillName, freeText: null, requiredYears: 3,
      })),
      { kind: 'NICE', skillId: null, skillName: null, freeText: '周辺システムとの連携経験\n生産管理の業務知見', requiredYears: null },
    ]);
    const text = projectCopySummary('SAP支援', [...fields(), ...requirements]);
    expect(text).toContain('【スキル】\n[必須]\n・SAP SD 3 年以上');
    expect(text).toContain('・ドキュメント作成 3 年以上');
    expect(text).toContain('[尚可]\n・周辺システムとの連携経験\n生産管理の業務知見');
    expect(text.indexOf('【スキル】')).toBeLessThan(text.indexOf('【期間】'));
  });
  it('内部情報とカテゴリはラベルと値の両方を除外する', () => {
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
    expect(text).toBe('【案件】案件');
  });
  it('取引先に渡された基本情報に無い想定仕入単価を補完しない', () => {
    const text = projectCopySummary('案件', fields().filter(f => f.key !== 'purchaseUnitPrice'));
    expect(text).not.toContain('【単価】');
    expect(text).not.toContain('60 万円');
  });
});