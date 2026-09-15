// apps/web/lib/proposal-requests/message-check.test.ts
// 依頼メッセージの商流検証（docs/05 §3.6 / §6.5「#31 の実装の決着」/ `F-018` 入力 / `BR-58`）。T-08-06。
//
// 🔴 固定するもの:
//   ① 単価の表記（`65万円` / `¥650,000` / `650,000円` / 案件の既知値）が含まれると `UNIT_PRICE` で落ちる
//   ② 案件のエンド企業名（法人格の略記を含む）が含まれると `END_CLIENT` で落ちる
//   ③ 商流に触れない依頼文は通る（開始時期・面談日・経験年数・期間は通る —— `BR-11` が LLM に渡してよいと
//      した情報を弾かない）
//   ④ PII（メール・電話）は**この照合の対象外**である（ホスト自身の連絡先は商流情報ではない）
//   ⑤ 戻り値に本文・一致した文字列が載らない（種別だけ）
import { describe, expect, it } from 'vitest';
import { checkProposalRequestMessage, type ProposalRequestMessageContext } from './message-check';

const PROJECT: ProposalRequestMessageContext = {
  endClientName: '株式会社エンドクライアント',
  internalUnitPrice: 900000,
  unitPriceMin: 700000,
  unitPriceMax: 800000,
};

const EMPTY_CONTEXT: ProposalRequestMessageContext = {
  endClientName: null,
  internalUnitPrice: null,
  unitPriceMin: null,
  unitPriceMax: null,
};

describe('🔴 商流情報（単価）を含む依頼文は通らない（UNIT_PRICE）', () => {
  it.each([
    ['万円の表記', '単価は65万円でお願いできますか。'],
    ['円マーク', '¥650,000 を想定しています。'],
    ['円の表記', '650,000円が上限です。'],
    ['案件の内部単価の既知値（万表記）', '弊社の受注は 90万 です。'],
    ['案件の公開単価レンジの既知値', '案件の単価は 700000 から 800000 の範囲です。'],
  ])('%s', (_label, message) => {
    const result = checkProposalRequestMessage(message, PROJECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.categories).toContain('UNIT_PRICE');
  });
});

describe('🔴 商流情報（エンド企業名）を含む依頼文は通らない（END_CLIENT）', () => {
  it.each([
    ['正式名称', '株式会社エンドクライアント様の案件です。'],
    ['法人格の略記', '（株）エンドクライアントの現場です。'],
  ])('%s', (_label, message) => {
    const result = checkProposalRequestMessage(message, PROJECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.categories).toEqual(['END_CLIENT']);
  });

  it('既知値が無ければ（エンド企業名未登録）会社名は弾かれない —— 一般の会社名検出は持たない', () => {
    expect(checkProposalRequestMessage('株式会社エンドクライアント様の案件です。', EMPTY_CONTEXT)).toEqual({
      ok: true,
    });
  });
});

describe('商流に触れない依頼文は通る', () => {
  it.each([
    ['開始時期と面談', '11 月上旬の開始を希望しています。面談は来週中に設定可能です。'],
    ['経験年数と期間（BR-11 が許す情報）', 'TypeScript 5 年以上の方を想定しています。期間は 2026-11-01 から 6 か月です。'],
    ['ホスト自身の連絡先（商流ではない）', 'ご不明点は 03-1234-5678 または host@example.test までご連絡ください。'],
    ['単価という語だけ（数値を伴わない）', '単価のご相談は提案の作成後にお願いします。'],
  ])('%s', (_label, message) => {
    expect(checkProposalRequestMessage(message, PROJECT)).toEqual({ ok: true });
  });
});

describe('戻り値の形', () => {
  it('両方含む本文では 2 種別が固定の順で返り、本文も一致した文字列も載らない', () => {
    const message = '株式会社エンドクライアント向け、65万円で。';
    const result = checkProposalRequestMessage(message, PROJECT);
    expect(result).toEqual({ ok: false, categories: ['UNIT_PRICE', 'END_CLIENT'] });
    expect(JSON.stringify(result)).not.toContain('65万円');
    expect(JSON.stringify(result)).not.toContain('エンドクライアント');
  });
});
