// packages/domain/src/audit/mask-summary.test.ts
// `maskAuditSummary`（docs/05 §5.5 第 2 層 / `F-058 AC-1` / `AC-3`。T-11-03）。
//
// 🔴 ここで固定するのは「運営者に見せてよい形しか出ない」ことである:
//   ① 内容キー（本文・件名・メモ・理由）はキーごと落ちる（`AC-3`）
//   ② 身元キー（氏名・メール・電話・生年月日）は `[masked]` になる（`AC-1`）
//   ③ キー名が無害でも、値がメール / 電話 / 生年月日のパターンなら `[masked]`
//   ④ トークン形状（ID / 列挙値 / ISO 日時 / 件数）だけが素通りする。日本語や空白を含む文字列は伏せる
//   ⑤ 入れ子・配列にも同じ規則が効き、深さの上限を超えた枝は落ちる
//   ⑥ 決定的（同じ入力に同じ出力。キーは辞書順）
import { describe, expect, it } from 'vitest';
import { MASKED_VALUE, maskAuditSummary } from './mask-summary.js';

describe('① 内容キーはキーごと落ちる（F-058 AC-3）', () => {
  it.each([
    'body',
    'subject',
    'note',
    'text',
    'content',
    'message',
    'draftBody',
    'messageBody',
    'decline_reason',
    'reason',
    'description',
    'title',
    'payload',
    'findings',
    'aiWarnings',
    'skills',
    'careers',
  ])('🔴 %s が結果に現れない', (key) => {
    const masked = maskAuditSummary({ [key]: 'partner1 からの本文', operation: 'SEND' });
    expect(Object.keys(masked)).toEqual(['operation']);
  });

  it('🔴 落としたキーの値は `[masked]` としても残らない（存在の痕跡も出さない）', () => {
    const masked = maskAuditSummary({ body: 'x', subject: 'y' });
    expect(masked).toEqual({});
    expect(JSON.stringify(masked)).not.toContain(MASKED_VALUE);
  });
});

describe('② 身元キー・商流キーは値が `[masked]` になる（F-058 AC-1 / BR-40）', () => {
  it.each([
    'displayName',
    'fullName',
    'name',
    'email',
    'recipientEmail',
    'contact_email',
    'phone',
    'contactPhone',
    'tel',
    'birthDate',
    'birth_date',
    'dateOfBirth',
    'address',
    'recipient',
    'signers',
    'fileName',
    'endClientName',
    'recipientCompanyName',
    'unitPrice',
    'unit_price',
    'amount',
    'offeredUnitPrice',
    // 🔴 T-11-03 レビュー指摘: docs/05 §5.5 の非開示列と同名のキー（末尾が min / max / key のもの）
    'unitPriceMin',
    'unit_price_max',
    'priceMax',
    'budget',
    'objectKey',
    'object_key',
    'attachment_key',
    'attachmentKey',
    'downloadUrl',
  ])('🔴 %s の値が伏せられる（キーは残る）', (key) => {
    const masked = maskAuditSummary({ [key]: 'anything', count: 3 });
    expect(masked).toEqual({ [key]: MASKED_VALUE, count: 3 });
  });

  it('🔴 身元キーは値が数値・真偽値・配列でも伏せる（型で抜け道を作らない）', () => {
    expect(maskAuditSummary({ unitPrice: 800000 })).toEqual({ unitPrice: MASKED_VALUE });
    // 🔴 レビューのプローブ入力（修正前はすべて生値で素通りしていた）
    expect(
      maskAuditSummary({
        unitPriceMin: 600000,
        unitPriceMax: 800000,
        priceMax: 900000,
        budget: 700000,
        objectKey: 'tenants/a1/engineers/e1/yamada-taro.xlsx',
        attachmentKey: 'chat/t1/yamada_taro_resume.pdf',
      }),
    ).toEqual({
      unitPriceMin: MASKED_VALUE,
      unitPriceMax: MASKED_VALUE,
      priceMax: MASKED_VALUE,
      budget: MASKED_VALUE,
      objectKey: MASKED_VALUE,
      attachmentKey: MASKED_VALUE,
    });
    expect(maskAuditSummary({ signers: ['a', 'b'] })).toEqual({ signers: MASKED_VALUE });
    expect(maskAuditSummary({ email: { a: 1 } })).toEqual({ email: MASKED_VALUE });
  });

  it('`null` は「記録されていない」の意味を保つため `null` のまま', () => {
    expect(maskAuditSummary({ displayName: null })).toEqual({ displayName: null });
  });

  it('🔴 `ipAddress` は身元キーの例外（列としても返す表示項目）', () => {
    expect(maskAuditSummary({ ipAddress: '203.0.113.10' })).toEqual({ ipAddress: '203.0.113.10' });
  });

  it('`toState` / `fromState` / `context` は誤って身元・内容と判定されない（語で見る）', () => {
    expect(maskAuditSummary({ fromState: 'DRAFT', toState: 'APPROVED', context: 'GATE' })).toEqual({
      context: 'GATE',
      fromState: 'DRAFT',
      toState: 'APPROVED',
    });
  });
});

describe('③ キー名が無害でも、値のパターンで伏せる', () => {
  it.each([
    ['taro.yamada@example.co.jp', 'メールアドレス'],
    ['TARO@EXAMPLE.COM', 'メールアドレス（大文字）'],
    ['090-1234-5678', '電話（ハイフン）'],
    ['09012345678', '電話（ハイフン無し 11 桁）'],
    ['03-1234-5678', '電話（固定 10 桁）'],
    ['+81-90-1234-5678', '電話（国際）'],
    ['+81 90 1234 5678', '電話（国際・空白）'],
    ['TEL: 090-1234-5678', '電話（ラベル付き）'],
    ['1990-01-02 生', '生年月日（文脈語）'],
    ['生年月日: 1990/01/02', '生年月日（ラベル）'],
  ])('🔴 %s（%s）→ [masked]', (value) => {
    expect(maskAuditSummary({ via: value })).toEqual({ via: MASKED_VALUE });
  });
});

describe('④ トークン形状だけが素通りする', () => {
  it.each([
    '01930000-0000-7000-8000-0000000000a1',
    // 🔴 数字だけの UUID（区切りが 4 つ）が電話番号に誤検出されない。
    '01930000-0000-7000-8000-000000000101',
    'PASSWORD_MISMATCH',
    'credentials',
    'A-014',
    '2026-09-16T00:00:00.000Z',
    '2026-09-16',
    'example.co.jp',
    'proposal.submit',
    '42',
    'v3',
  ])('%s はそのまま残る', (value) => {
    expect(maskAuditSummary({ key: value })).toEqual({ key: value });
  });

  it.each([
    ['山田 太郎', '日本語（人名）'],
    ['Taro Yamada', '空白を含む（人名）'],
    ['株式会社サンプル', '日本語（会社名）'],
    ['a'.repeat(65), '65 文字（自由記述の長さ）'],
    ['line1\nline2', '改行を含む'],
    ['tab\tseparated', 'タブを含む'],
  ])('🔴 %s（%s）→ [masked]', (value) => {
    expect(maskAuditSummary({ key: value })).toEqual({ key: MASKED_VALUE });
  });

  it('数値・真偽値・null は素通りする。NaN / Infinity は null に畳む', () => {
    expect(maskAuditSummary({ n: 3, b: false, z: null, nan: Number.NaN, inf: Infinity })).toEqual({
      b: false,
      inf: null,
      n: 3,
      nan: null,
      z: null,
    });
  });

  it('空文字はそのまま（伏せる中身が無い）', () => {
    expect(maskAuditSummary({ key: '' })).toEqual({ key: '' });
  });
});

describe('⑤ 入れ子・配列', () => {
  it('配列の各要素と入れ子オブジェクトに同じ規則が効く', () => {
    expect(
      maskAuditSummary({
        fields: ['subject', 'body', 'offeredUnitPrice'],
        actors: ['taro@example.com', 'PLATFORM_OWNER'],
        before: { displayName: '山田', state: 'ACTIVE', note: 'x' },
      }),
    ).toEqual({
      actors: [MASKED_VALUE, 'PLATFORM_OWNER'],
      before: { displayName: MASKED_VALUE, state: 'ACTIVE' },
      fields: ['subject', 'body', 'offeredUnitPrice'],
    });
  });

  it('深さの上限（3）を超えた枝は落ちる', () => {
    const masked = maskAuditSummary({ a: { b: { c: { d: { e: 'x' } } } } });
    expect(masked).toEqual({ a: { b: { c: {} } } });
  });

  it('オブジェクト以外（文字列・配列・null・undefined）は空オブジェクトになる', () => {
    expect(maskAuditSummary('本文')).toEqual({});
    expect(maskAuditSummary(['x'])).toEqual({});
    expect(maskAuditSummary(null)).toEqual({});
    expect(maskAuditSummary(undefined)).toEqual({});
  });
});

describe('⑥ 決定性', () => {
  it('キーは辞書順に並び、同じ入力に同じ出力を返す', () => {
    const input = { z: 1, a: 'A', m: { y: 2, b: 'B' } };
    const first = maskAuditSummary(input);
    const second = maskAuditSummary(input);
    expect(Object.keys(first)).toEqual(['a', 'm', 'z']);
    expect(Object.keys(first['m'] as Record<string, unknown>)).toEqual(['b', 'y']);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('🔴 スナップショット: 氏名・メール・電話・本文を含む実物に近い summary', () => {
    expect(
      maskAuditSummary({
        operation: 'SEND',
        fromState: 'APPROVED',
        toState: 'SUBMITTED',
        recipientEmail: 'sales@partner.example.jp',
        recipientCompanyName: '株式会社パートナー',
        displayName: '山田 太郎',
        contactPhone: '090-1234-5678',
        birthDate: '1990-01-02',
        subject: 'ご提案（Java エンジニア）',
        body: '山田太郎をご提案します。単価 80 万円。',
        offeredUnitPrice: 800000,
        engineerId: '01930000-0000-7000-8000-0000000000e1',
        via: 'taro@example.com',
        note: 'メモ',
        platformRole: 'PLATFORM_SUPPORT',
      }),
    ).toMatchInlineSnapshot(`
      {
        "birthDate": "[masked]",
        "contactPhone": "[masked]",
        "displayName": "[masked]",
        "engineerId": "01930000-0000-7000-8000-0000000000e1",
        "fromState": "APPROVED",
        "offeredUnitPrice": "[masked]",
        "operation": "SEND",
        "platformRole": "PLATFORM_SUPPORT",
        "recipientCompanyName": "[masked]",
        "recipientEmail": "[masked]",
        "toState": "SUBMITTED",
        "via": "[masked]",
      }
    `);
  });
});
