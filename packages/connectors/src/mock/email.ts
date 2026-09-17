// packages/connectors/src/mock/email.ts
// docs/05 §13.2。🔴 **`development` / `demo` / E2E がそのまま使う実装**であり、
// テスト専用の別モックを `tests/` に書かない（二重メンテを避け「デモで動く = E2E が通る」を担保する）。

import { randomUUID } from 'node:crypto';

import { MOCK_EMAIL_PROVIDER_CODES, type MockEmailStep } from '../email/mock-script.js';
import { ExternalSendError } from '../email/ses/errors.js';
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
  /**
   * 🔴 T-09-07: 呼び出し順に消費される台本（`email/mock-script.ts`。`MockAnthropicClient` の `script` と同型）。
   *    尽きたら**最後の 1 つを繰り返す**。空 / 省略は「常に `deliver`」（`development` / `demo` の常用の形）。
   *    応答不明（`unknown`）は**記録してから**投げる = 外部には届いた可能性がある（`callCount()` に数える）。
   *    ネットワーク断（`unreachable`）は**記録せずに**投げる = 届いていない。
   */
  readonly script?: readonly MockEmailStep[];
};

/** `local-part` を伏せる。ドメインは残す（宛先分類の妥当性を目視できる程度に留める）。 */
export function redactEmailAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 0) return '***';
  return `***${address.slice(at)}`;
}

export class MockEmailSender implements EmailSender {
  private readonly calls: MockEmailCall[] = [];
  private readonly script: readonly MockEmailStep[];
  private cursor = 0;

  constructor(private readonly options: MockEmailSenderOptions = {}) {
    this.script = [...(options.script ?? [])];
  }

  async send(input: EmailSendInput): Promise<{ externalId: string }> {
    // 🔴 実装（SES）と同じ判定を通す。ここを緩めると `development` で通って `production` で
    //    落ちる（あるいは未検証のまま取引先へ届く）差分が生まれる。
    assertSendingDomainForRecipientClass(input);

    const step = this.nextStep();

    // 🔴 送る前に失敗した（接続拒否 / DNS 不達）。要求は外部に到達していないので**記録しない**
    //    （送っていないのに送ったことにしない。`callCount()` 不変）。受理されなかったことが確定している
    //    ので分類は `TRANSIENT`（docs/05 §15.4）。送信ジョブ側に再試行は無く `FAILED` に確定する。
    if (step.kind === 'unreachable') {
      const code = step.providerCode ?? MOCK_EMAIL_PROVIDER_CODES.unreachable;
      throw new ExternalSendError('TRANSIENT', code, `モック: 送信基盤に到達できませんでした（${code}）。要求は送られていません。`);
    }

    this.calls.push({
      at: this.now(),
      recipientClass: input.recipientClass,
      to: redactEmailAddress(input.to),
      templateKey: input.templateKey,
      tenantId: input.tenantId,
    });

    // 送信基盤が明示的に拒否した。要求は届いた（`callCount()` に数える）がメールは出ていない（sink に書かない）。
    if (step.kind === 'reject') {
      const code = step.providerCode ?? MOCK_EMAIL_PROVIDER_CODES.reject;
      throw new ExternalSendError('PERMANENT', code, `モック: 送信基盤が送信を拒否しました（${code}）。`);
    }

    await this.options.sink?.write(input);

    // 🔴 受け付けた後に応答が返らなかった。**メールは出ている可能性がある**（記録済み・sink にも書いた）ので、
    //    呼び出し側は「届いたかどうか分からない」として隔離する（`UNKNOWN`。docs/05 §10.6。再試行してはならない）。
    if (step.kind === 'unknown') {
      const code = step.providerCode ?? MOCK_EMAIL_PROVIDER_CODES.unknown;
      throw new ExternalSendError(
        'UNKNOWN',
        code,
        `モック: 送信要求が応答不明で終了しました（${code}）。届いた可能性があり、再試行してはなりません。`,
      );
    }

    return { externalId: `mock-${randomUUID()}` };
  }

  /** 台本の次の 1 手。尽きたら最後の 1 つを繰り返し、台本が無ければ常に `deliver`。 */
  private nextStep(): MockEmailStep {
    if (this.script.length === 0) return { kind: 'deliver' };
    const index = Math.min(this.cursor, this.script.length - 1);
    this.cursor += 1;
    return this.script[index] ?? { kind: 'deliver' };
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
