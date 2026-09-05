// packages/connectors/src/email/ses/errors.test.ts
// 🔴 docs/05 §8.3-Q ⑤ / §15.4: **日次枠超過（保留）と秒間レート超過（一時的）を取り違えない**。
//    取り違えると、一日中保留され続けるか、逆に枠超過を障害として `FAILED` に落としてしまう。
import { describe, expect, it } from 'vitest';
import { ProviderQuotaExceededError } from '../../errors.js';
import { ExternalSendError, normalizeSesError } from './errors.js';

function sesError(name: string, message: string, httpStatusCode?: number): unknown {
  return { name, message, $metadata: httpStatusCode === undefined ? {} : { httpStatusCode } };
}

describe('normalizeSesError（docs/05 §15.4 / §8.3-Q ⑤）', () => {
  it('🔴 日次枠超過は ProviderQuotaExceededError（= 保留）になる', () => {
    const normalized = normalizeSesError(
      sesError('TooManyRequestsException', 'Daily message quota exceeded', 429),
      'send',
    );
    expect(normalized).toBeInstanceOf(ProviderQuotaExceededError);
  });

  it('🔴 例外名が LimitExceededException でも、メッセージが日次枠なら保留になる', () => {
    const normalized = normalizeSesError(
      sesError('LimitExceededException', 'Daily message quota exceeded for the account', 400),
      'send',
    );
    expect(normalized).toBeInstanceOf(ProviderQuotaExceededError);
  });

  it('🔴 秒間レート超過は保留ではなく一時的（§8.7 の再試行の領分。受理されていないことが確定する）', () => {
    const normalized = normalizeSesError(
      sesError('TooManyRequestsException', 'Maximum sending rate exceeded', 429),
      'send',
    );
    expect(normalized).toBeInstanceOf(ExternalSendError);
    expect((normalized as ExternalSendError).kind).toBe('TRANSIENT');
  });

  it.each([
    'MessageRejected',
    'MailFromDomainNotVerifiedException',
    'AccountSuspendedException',
    'SendingPausedException',
  ])('%s は恒久的（人間対応）に確定する', (name) => {
    const normalized = normalizeSesError(sesError(name, 'rejected'), 'send');
    expect((normalized as ExternalSendError).kind).toBe('PERMANENT');
  });

  it.each(['ThrottlingException', 'TooManyRequestsException', 'LimitExceededException'])(
    '🔴 %s（受理されなかったことが確定する拒否）は送信経路でも一時的でよい',
    (name) => {
      expect((normalizeSesError(sesError(name, 'oops', 429), 'send') as ExternalSendError).kind).toBe(
        'TRANSIENT',
      );
    },
  );

  it('🔴 タイムアウトは応答不明（再試行してはならない）', () => {
    const normalized = normalizeSesError(sesError('TimeoutError', 'socket hang up'), 'send');
    expect((normalized as ExternalSendError).kind).toBe('UNKNOWN');
  });

  it('4xx は恒久的（例外名で分類できない場合の HTTP ステータス）', () => {
    expect((normalizeSesError(sesError('X', 'x', 422), 'send') as ExternalSendError).kind).toBe(
      'PERMANENT',
    );
    expect((normalizeSesError(sesError('X', 'x', 422), 'read') as ExternalSendError).kind).toBe(
      'PERMANENT',
    );
  });

  it('🔴 分類できないものを「一時的」に倒さない（安全側 = 再試行しない）', () => {
    expect((normalizeSesError(sesError('X', 'x'), 'send') as ExternalSendError).kind).toBe('UNKNOWN');
    expect((normalizeSesError(null, 'send') as ExternalSendError).kind).toBe('UNKNOWN');
    expect((normalizeSesError('boom', 'send') as ExternalSendError).kind).toBe('UNKNOWN');
  });

  it('🔴 正規化後のメッセージに SES の生メッセージ（宛先が入りうる）を載せない', () => {
    const normalized = normalizeSesError(
      sesError('MessageRejected', 'Email address is not verified: alice@example.co.jp'),
      'send',
    );
    expect(normalized.message).not.toContain('alice@example.co.jp');
    expect(normalized.message).toContain('MessageRejected');
  });
});

/**
 * 🔴 iteration 2 の修正点。**5xx は「SES が受理していない」ことを保証しない。**
 *    送信経路でこれを `TRANSIENT` にすると `email.dispatch` の `attempts: 3` に乗り、
 *    「実は送信済み → 5 秒後に再送 = 2 通」の経路が開く（`CLAUDE.md` §3.4 / `BR-21`）。
 */
describe('🔴 5xx の分類は操作の種類で変わる（docs/05 §15.4 / docs/03 §3.2.9）', () => {
  it.each(['InternalServiceErrorException', 'ServiceUnavailableException'])(
    '🔴 送信経路の %s は UNKNOWN（再試行禁止 = その場で確定させる）',
    (name) => {
      expect((normalizeSesError(sesError(name, 'oops', 500), 'send') as ExternalSendError).kind).toBe(
        'UNKNOWN',
      );
    },
  );

  it.each(['InternalServiceErrorException', 'ServiceUnavailableException'])(
    '読み取り経路の %s は TRANSIENT（何度読んでも副作用が無い）',
    (name) => {
      expect((normalizeSesError(sesError(name, 'oops', 500), 'read') as ExternalSendError).kind).toBe(
        'TRANSIENT',
      );
    },
  );

  it.each([500, 502, 503, 504])('🔴 送信経路の HTTP %d は UNKNOWN', (status) => {
    expect((normalizeSesError(sesError('X', 'x', status), 'send') as ExternalSendError).kind).toBe(
      'UNKNOWN',
    );
  });

  it.each([500, 502, 503, 504])('読み取り経路の HTTP %d は TRANSIENT', (status) => {
    expect((normalizeSesError(sesError('X', 'x', status), 'read') as ExternalSendError).kind).toBe(
      'TRANSIENT',
    );
  });

  it('送信経路の 5xx のメッセージは「受理されたか判定できない」ことを述べる', () => {
    const normalized = normalizeSesError(sesError('X', 'x', 503), 'send');
    expect(normalized.message).toContain('再試行してはなりません');
  });
});
