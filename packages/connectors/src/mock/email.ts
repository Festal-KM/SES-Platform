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
  /**
   * 🔴 T-09-11: **宛先ドメイン別**の台本。キーは宛先アドレスの `@` より後ろ（小文字）、値は `MockEmailStep[]`。
   *
   * `script` と違い**呼び出し順で消費しない**。引くのは `token.attemptSeq`（`SendAttemptToken`。1 始まり）で、
   * `steps[attemptSeq - 1]`（尽きたら最後の 1 つ）を返す。`DispatchToken`（運用メール。試行番号を持たない）は
   * 試行 1 として引く。該当するドメインが無ければ `script` の順序消費に戻る。
   *
   * 🔴 なぜ要るか: E2E ハーネスは **1 プロセスの worker を全 spec が共有する**（docs/05 §17.6）。呼び出し順で消費する
   *    台本だと「何番目の送信が応答不明になるか」が spec の実行順・絞り込み（`--grep` / 単一ファイル実行）で変わり、
   *    緑が根拠にならない。宛先ドメイン × 試行番号で引けば**無状態**であり、どの順序・どの部分集合で走らせても
   *    「そのドメインへの 1 回目は応答不明、再送（seq 2）は届く」が成立する（E2E #8。docs/05 §17.3）。
   * 🔴 モックが保持する記録（`calls`）は従来どおり伏せ字である。ここで見るのはドメインだけであり、平文の宛先を
   *    保持しない（`redactEmailAddress` がドメインを残す判断と同じ範囲）。
   */
  readonly scriptByRecipientDomain?: Readonly<Record<string, readonly MockEmailStep[]>>;
};

/** `local-part` を伏せる。ドメインは残す（宛先分類の妥当性を目視できる程度に留める）。 */
export function redactEmailAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 0) return '***';
  return `***${address.slice(at)}`;
}

/** 宛先アドレスのドメイン（小文字）。`@` が無ければ `null`。 */
function recipientDomainOf(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  return address.slice(at + 1).toLowerCase();
}

/** `SendAttemptToken`（試行番号あり）か `DispatchToken`（無し）か。無ければ試行 1 として扱う。 */
function attemptSeqOf(token: EmailSendInput['token']): number {
  return 'attemptSeq' in token && typeof token.attemptSeq === 'number' ? token.attemptSeq : 1;
}

export class MockEmailSender implements EmailSender {
  private readonly calls: MockEmailCall[] = [];
  private readonly script: readonly MockEmailStep[];
  private readonly scriptByRecipientDomain: ReadonlyMap<string, readonly MockEmailStep[]>;
  private cursor = 0;

  constructor(private readonly options: MockEmailSenderOptions = {}) {
    this.script = [...(options.script ?? [])];
    this.scriptByRecipientDomain = new Map(
      Object.entries(options.scriptByRecipientDomain ?? {}).map(([domain, steps]) => [domain.toLowerCase(), [...steps]]),
    );
  }

  async send(input: EmailSendInput): Promise<{ externalId: string }> {
    // 🔴 実装（SES）と同じ判定を通す。ここを緩めると `development` で通って `production` で
    //    落ちる（あるいは未検証のまま取引先へ届く）差分が生まれる。
    assertSendingDomainForRecipientClass(input);

    const step = this.stepFor(input);

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

  /**
   * この 1 通の振る舞い。🔴 宛先ドメイン別の台本があれば**試行番号で引き**（順序消費しない。`scriptByRecipientDomain` の注記）、
   * 無ければ `script` を呼び出し順に消費する。ドメイン別の台本で決まった送信は `script` のカーソルを進めない
   * （2 つの台本を同時に使う構成で、片方の消費が他方の位置を狂わせないため）。
   */
  private stepFor(input: EmailSendInput): MockEmailStep {
    const domain = recipientDomainOf(input.to);
    const byDomain = domain === null ? undefined : this.scriptByRecipientDomain.get(domain);
    if (byDomain !== undefined && byDomain.length > 0) {
      const index = Math.min(attemptSeqOf(input.token) - 1, byDomain.length - 1);
      return byDomain[Math.max(index, 0)] ?? { kind: 'deliver' };
    }
    return this.nextStep();
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
