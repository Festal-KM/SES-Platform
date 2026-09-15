// apps/web/lib/proposals/recipient.test.ts
// 🔴 「提案先が設定されているか」の 1 判定を固定する（docs/05 §6.5「T-09-01 の決着」/ SP-08 の申し送り②）。T-09-01。
import { describe, expect, it } from 'vitest';
import { hasProposalRecipient } from './recipient';

describe('hasProposalRecipient', () => {
  it('経路 4 の応諾が作る空文字（2 列とも）は未設定', () => {
    expect(hasProposalRecipient({ recipientCompanyName: '', recipientEmail: '' })).toBe(false);
  });

  it('片方だけ埋まっていても未設定（提案先は会社名とメールアドレスの組である）', () => {
    expect(hasProposalRecipient({ recipientCompanyName: '架空エンド株式会社', recipientEmail: '' })).toBe(false);
    expect(hasProposalRecipient({ recipientCompanyName: '', recipientEmail: 'to@example.test' })).toBe(false);
  });

  it('空白だけは未設定とみなす（無言で通さない）', () => {
    expect(hasProposalRecipient({ recipientCompanyName: '   ', recipientEmail: '\t' })).toBe(false);
  });

  it('両方が埋まっていれば設定済み', () => {
    expect(hasProposalRecipient({ recipientCompanyName: '架空エンド株式会社', recipientEmail: 'to@example.test' })).toBe(true);
  });
});
