// apps/web/lib/projects/publish-preview.test.ts
// `S-013` セクション 3 の商流情報の混入警告（docs/04 §S-013 / §5-2）。T-06-06。
//
// 🔴 ここで固定するのは**警告の規則**であり、**合否ではない**（合否は `F-020` のゲートが出す）。
import { describe, expect, it } from 'vitest';
import { findCommerceLeakWarnings, PUBLISHED_FIELDS } from './publish-preview';

const END_CLIENT = '架空エンド株式会社';

describe('🔴 docs/04 §S-013: 外部に出る欄に商流情報が混ざっていれば警告する', () => {
  it('外部公開用の記載にエンド企業名が入っていれば、その欄が指摘される', () => {
    expect(
      findCommerceLeakWarnings({
        texts: [
          { field: 'name', value: '合成案件' },
          { field: 'publicSummary', value: `${END_CLIENT} の基幹システム刷新` },
        ],
        endClientName: END_CLIENT,
        internalUnitPrice: null,
      }),
    ).toEqual([{ field: 'publicSummary', kind: 'END_CLIENT_NAME' }]);
  });

  it('案件名に自社単価が入っていれば指摘される（3 桁区切りでも拾う）', () => {
    const warnings = findCommerceLeakWarnings({
      texts: [{ field: 'name', value: '刷新支援（自社 987,654 円）' }],
      endClientName: null,
      internalUnitPrice: 987_654,
    });

    expect(warnings).toEqual([{ field: 'name', kind: 'INTERNAL_UNIT_PRICE' }]);
  });

  it('区切りなしの表記も拾う', () => {
    const warnings = findCommerceLeakWarnings({
      texts: [{ field: 'publicSummary', value: '予算 987654 円' }],
      endClientName: null,
      internalUnitPrice: 987_654,
    });

    expect(warnings).toEqual([{ field: 'publicSummary', kind: 'INTERNAL_UNIT_PRICE' }]);
  });

  it('要件の自由記述も対象である（外部に出る欄だから）', () => {
    const warnings = findCommerceLeakWarnings({
      texts: [
        { field: 'requirement', value: '他社の経験' },
        { field: 'requirement', value: `${END_CLIENT} での常駐経験` },
      ],
      endClientName: END_CLIENT,
      internalUnitPrice: null,
    });

    expect(warnings).toEqual([{ field: 'requirement', kind: 'END_CLIENT_NAME' }]);
  });

  it('英字の商号は大文字小文字を無視して拾う', () => {
    expect(
      findCommerceLeakWarnings({
        texts: [{ field: 'publicSummary', value: 'acme corp の案件' }],
        endClientName: 'ACME Corp',
        internalUnitPrice: null,
      }),
    ).toEqual([{ field: 'publicSummary', kind: 'END_CLIENT_NAME' }]);
  });
});

describe('🔴 誤検知を作らない（警告が信用されなくなる）', () => {
  it('商流情報が未設定なら警告は 0 件', () => {
    expect(
      findCommerceLeakWarnings({
        texts: [
          { field: 'name', value: '合成案件' },
          { field: 'publicSummary', value: '一般的な業務内容' },
        ],
        endClientName: null,
        internalUnitPrice: null,
      }),
    ).toEqual([]);
  });

  it('🔴 1 文字の商号は照合しない（部分一致がほぼ確実に誤検知になる）', () => {
    expect(
      findCommerceLeakWarnings({
        texts: [{ field: 'publicSummary', value: 'A 社の案件ではありません' }],
        endClientName: 'A',
        internalUnitPrice: null,
      }),
    ).toEqual([]);
  });

  it('値が `null` の欄は照合対象にならない', () => {
    expect(
      findCommerceLeakWarnings({
        texts: [{ field: 'publicSummary', value: null }],
        endClientName: END_CLIENT,
        internalUnitPrice: 987_654,
      }),
    ).toEqual([]);
  });
});

describe('🔴 決定的である（同じ入力なら同じ並び）', () => {
  it('欄の順 → 種別の順で返る', () => {
    const input = {
      texts: [
        { field: 'name' as const, value: `${END_CLIENT} 987,654` },
        { field: 'publicSummary' as const, value: `${END_CLIENT}` },
      ],
      endClientName: END_CLIENT,
      internalUnitPrice: 987_654,
    };

    expect(findCommerceLeakWarnings(input)).toEqual([
      { field: 'name', kind: 'END_CLIENT_NAME' },
      { field: 'name', kind: 'INTERNAL_UNIT_PRICE' },
      { field: 'publicSummary', kind: 'END_CLIENT_NAME' },
    ]);
    // 2 回呼んでも同じ（AI を呼ばない ＝ 実行のたびに揺れない）。
    expect(findCommerceLeakWarnings(input)).toEqual(findCommerceLeakWarnings(input));
  });

  it('外部に出る欄は 3 つだけである（増やすときは取引先向けの `select` と一緒に見直す）', () => {
    expect([...PUBLISHED_FIELDS]).toEqual(['name', 'publicSummary', 'requirement']);
  });
});
