// packages/connectors/src/mock/email.ts
// docs/05 §13.2。🔴 **`development` / `demo` / E2E がそのまま使う実装**であり、
// テスト専用の別モックを `tests/` に書かない（二重メンテを避け「デモで動く = E2E が通る」を担保する）。

import { randomUUID } from 'node:crypto';

import { assertSendingDomainForRecipientClass, type EmailSendInput, type EmailSender } from '../interfaces.js';
import type { ProviderQuota, RecipientClass } from '../types.js';

/**
 * モックが保持する 1 通分の記録。
 *
 * 🔴 **宛先は伏せ字にして保持する**（CLAUDE.md §3.5 / docs/05 §8.6 の denylist に `email` /
 *    `recipientEmail` がある）。件数と分類が分かれば環境分離の検証（docs/05 §17.4）には足りる。
 *    平文の宛先が要る用途（MailHog での受信確認など）は `MockEmailSink` を差し込む。
 */
export type MockEmailCall = {
  readonly at: Date;
  readonly recipientClass: RecipientClass;
  /** 伏せ字（`***@example.co.jp`）。 */
  readonly to: string;
  readonly templateKey: string;
  readonly tenantId: string | null;
};

/**
 * 疑似送信の書き出し先（任意）。`development` の MailHog、`demo` / `sandbox` の
 * `EmailDispatch(status='MOCKED')` の記録はここに差し込む。
 *
 * 🔴 モック自身が DB に書かない（`packages/connectors` は `@ses/db` に依存できない。CLAUDE.md §2.1）。
 *    永続化はジョブハンドラ側の責務であり、その方が「外部応答を正規化してから永続化する」
 *    （CLAUDE.md §3.4）という規律とも整合する。
 */
export interface MockEmailSink {
  write(input: EmailSendInput): Promise<void>;
}

export type MockEmailSenderOptions = {
  readonly sink?: MockEmailSink;
  /**
   * 送信基盤側の 24h 枠。
   *
   * 🔴 既定は `Number.MAX_SAFE_INTEGER`（= モック自身には枠が無い）。`decideProviderQuota` が
   *    `limit = min(envLimit, provider.max24h)` を取るため（docs/05 §8.3-Q ②）、**実効上限は
   *    `MAIL_PROVIDER_DAILY_QUOTA` になる**。E2E は環境変数を小さくするだけで上限到達を再現でき、
   *    テスト専用フックを作らずに済む（docs/05 §13.2 の注記）。
   */
  readonly max24h?: number;
  /** 時刻の注入（テストの決定性のため）。既定は `new Date()`。 */
  readonly now?: () => Date;
};

/** `local-part` を伏せる。ドメインは残す（宛先分類の妥当性を目視できる程度に留める）。 */
export function redactEmailAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 0) return '***';
  return `***${address.slice(at)}`;
}

export class MockEmailSender implements EmailSender {
  private readonly calls: MockEmailCall[] = [];

  constructor(private readonly options: MockEmailSenderOptions = {}) {}

  async send(input: EmailSendInput): Promise<{ externalId: string }> {
    // 🔴 実装（SES）と同じ判定を通す。ここを緩めると `development` で通って `production` で
    //    落ちる（あるいは未検証のまま取引先へ届く）差分が生まれる。
    assertSendingDomainForRecipientClass(input);

    this.calls.push({
      at: this.now(),
      recipientClass: input.recipientClass,
      to: redactEmailAddress(input.to),
      templateKey: input.templateKey,
      tenantId: input.tenantId,
    });

    await this.options.sink?.write(input);

    return { externalId: `mock-${randomUUID()}` };
  }

  callCount(): number {
    return this.calls.length;
  }

  /** 宛先分類ごとの記録（環境分離の検証。docs/05 §17.4）。 */
  callsOf(recipientClass: RecipientClass): readonly MockEmailCall[] {
    return this.calls.filter((call) => call.recipientClass === recipientClass);
  }

  async getQuota(): Promise<ProviderQuota> {
    const now = this.now();
    const since = now.getTime() - 24 * 60 * 60 * 1000;
    return {
      max24h: this.options.max24h ?? Number.MAX_SAFE_INTEGER,
      sentLast24h: this.calls.filter((call) => call.at.getTime() > since).length,
      observedAt: now,
    };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
