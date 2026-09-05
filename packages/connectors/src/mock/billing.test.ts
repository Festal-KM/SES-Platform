// packages/connectors/src/mock/billing.test.ts
import { describe, expect, it } from 'vitest';

import type { MeterSubmissionToken } from '../types.js';
import { MockBillingProvider } from './billing.js';

function token(identifier: string): MeterSubmissionToken {
  return { submissionId: identifier, identifier } as unknown as MeterSubmissionToken;
}

describe('MockBillingProvider', () => {
  it('🔴 同一 identifier の 2 回目は「重複」として区別され、受理は 1 件のまま', async () => {
    const billing = new MockBillingProvider();
    const input = { customerId: 'cus_1', eventName: 'ai_unit_sheet_parse', value: 3 };

    await billing.submitMeterEvent(input, token('2026-08:t1:ai_unit_sheet_parse'));
    await billing.submitMeterEvent(input, token('2026-08:t1:ai_unit_sheet_parse'));

    // 🔴 呼び出し自体は隠さない（二重呼び出しの検出をモックが潰さない）。
    expect(billing.callCount()).toBe(2);
    expect(billing.acceptedCount()).toBe(1);
    const records = billing.submissionsOf('ai_unit_sheet_parse');
    expect(records.map((r) => r.duplicate)).toEqual([false, true]);
  });

  it('identifier が違えば別イベントとして受理する', async () => {
    const billing = new MockBillingProvider();
    await billing.submitMeterEvent(
      { customerId: 'cus_1', eventName: 'ai_unit_sheet_parse', value: 1 },
      token('2026-08:t1:ai_unit_sheet_parse'),
    );
    await billing.submitMeterEvent(
      { customerId: 'cus_1', eventName: 'ai_unit_proposal_draft', value: 2 },
      token('2026-08:t1:ai_unit_proposal_draft'),
    );
    expect(billing.acceptedCount()).toBe(2);
  });

  it('金額は 10 進の文字列で返す（浮動小数で持たない）', async () => {
    const billing = new MockBillingProvider();
    const totals = await billing.fetchInvoiceTotals('cus_1', {
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(typeof totals.amountJpy).toBe('string');
  });
});
