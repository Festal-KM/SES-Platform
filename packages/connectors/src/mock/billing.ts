// packages/connectors/src/mock/billing.ts
// docs/05 §13.2 / §9.8。`development` / `demo` で使う（`sandbox` の billing は `real`。docs/05 §13.1）。

import type { BillingProvider } from '../interfaces.js';
import type { DecimalString, MeterEventInput, MeterSubmissionToken, Period } from '../types.js';

export type MockMeterEventRecord = {
  readonly identifier: string;
  readonly customerId: string;
  readonly eventName: string;
  readonly value: number;
  /** 🔴 同一 `identifier` の 2 回目以降（プロバイダ側が重複として捨てる分）。 */
  readonly duplicate: boolean;
};

export class MockBillingProvider implements BillingProvider {
  private readonly submissions: MockMeterEventRecord[] = [];
  private readonly acceptedIdentifiers = new Set<string>();
  private readonly invoiceQueries: { customerId: string; period: Period }[] = [];
  private calls = 0;

  /**
   * 🔴 呼び出しは**すべて記録する**（`callCount()` が増える）。プロバイダ側の重複排除
   *    （Stripe の Meter Event は `identifier` で冪等）は `duplicate: true` として区別するだけで、
   *    握り潰さない。「二重に呼ばれていないこと」は `BillingMeterSubmission` の INSERT
   *    （docs/05 §9.8）が担保すべきであり、モックが隠すとその防御を検証できなくなる。
   */
  async submitMeterEvent(input: MeterEventInput, token: MeterSubmissionToken): Promise<void> {
    this.calls += 1;
    const duplicate = this.acceptedIdentifiers.has(token.identifier);
    if (!duplicate) this.acceptedIdentifiers.add(token.identifier);
    this.submissions.push({
      identifier: token.identifier,
      customerId: input.customerId,
      eventName: input.eventName,
      value: input.value,
      duplicate,
    });
  }

  async fetchInvoiceTotals(customerId: string, period: Period): Promise<{ amountJpy: DecimalString }> {
    this.calls += 1;
    this.invoiceQueries.push({ customerId, period });
    // 🔴 金額は 10 進の文字列（`number` で持たない。docs/05 §5.9 / `DecimalString`）。
    return { amountJpy: '0' };
  }

  callCount(): number {
    return this.calls;
  }

  /** プロバイダが受理した（重複でない）件数。 */
  acceptedCount(): number {
    return this.acceptedIdentifiers.size;
  }

  submissionsOf(eventName: string): readonly MockMeterEventRecord[] {
    return this.submissions.filter((record) => record.eventName === eventName);
  }

  /** 請求額を照会した内容（読み取り系の呼び出しも隠さない）。 */
  invoiceQueriesOf(customerId: string): readonly { customerId: string; period: Period }[] {
    return this.invoiceQueries.filter((query) => query.customerId === customerId);
  }
}
