// packages/connectors/src/email/ses/errors.ts
// 🔴 SES のエラーを**内部型に正規化する**（`CLAUDE.md` §3.4 / docs/05 §15.4 / docs/03 §3.2.9）。
//    サービス固有の例外名をドメイン層・ジョブ層へ漏らさない。
//
// 🔴 分類を誤ると事故になる（docs/05 §8.3-Q ⑤）:
//    - `Daily message quota exceeded`（**日次枠**）→ `ProviderQuotaExceededError` = **保留**。
//      送信は 1 通も行われていないので、枠が戻ったら送ってよい。
//    - `Maximum sending rate exceeded`（**秒間レート**）→ **一時的**。§8.7 のトークンバケットと
//      再試行の領分であり、保留ではない。
//    この 2 つは例外名（`TooManyRequestsException` 等）が同じことがあるため、**メッセージで見分ける**。
//    見分けを間違えると、秒間レートで一日中保留されるか、日次枠を失敗として扱ってしまう。
//
// 🔴 **もう 1 つの軸は「操作の種類」である**（`SesOperationKind`。iteration 2 の修正）:
//    同じ 5xx でも、`getAccount`（読み取り）は「もう一度読めばよい」= `TRANSIENT` だが、
//    `sendEmail`（送信）は **「SES が受理していない」ことを保証しない** = `UNKNOWN` である。
//    送信で 5xx を `TRANSIENT` にすると `email.dispatch` の `attempts: 3` に乗り、
//    **「実は送信済み → 5 秒後に再送 = 2 通」**が起こる（`CLAUDE.md` §3.4 / `BR-21` /
//    docs/05 §15.4 の「応答不明 → 再試行禁止」/ docs/03 §3.2.9 の「送信系は再試行しない」）。

import { ProviderQuotaExceededError } from '../../errors.js';

/** 正規化後の失敗の種別（docs/05 §15.4 の 3 分類）。 */
export const EXTERNAL_SEND_FAILURE_KINDS = ['TRANSIENT', 'PERMANENT', 'UNKNOWN'] as const;

export type ExternalSendFailureKind = (typeof EXTERNAL_SEND_FAILURE_KINDS)[number];

/**
 * 外部送信の失敗（正規化済み）。
 *
 * 🔴 `kind` の意味（docs/05 §15.4）:
 *   - `TRANSIENT`: 🔴 **リクエストが受理されなかったことが確定している**もの
 *     （`ThrottlingException` / 秒間レート超過 / 読み取り系の 5xx）。再試行してよい。
 *   - `PERMANENT`: `MessageRejected` / `MailFromDomainNotVerifiedException` /
 *     `AccountSuspendedException` / `SendingPausedException`。人間の対応が要る。
 *   - `UNKNOWN`: 🔴 **届いたかどうかが分からない**もの（送信リクエストのタイムアウト、
 *     **送信経路での 5xx**）。**絶対に再試行しない**（§10.6 の隔離）。
 */
export class ExternalSendError extends Error {
  constructor(
    readonly kind: ExternalSendFailureKind,
    /** SES の例外名（`MessageRejected` 等）。🔴 宛先・本文は含めない。 */
    readonly providerCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalSendError';
  }
}

/** SES の日次枠超過を示すメッセージ（docs/05 §8.3-Q ⑤。v1 の `Throttling` 相当）。 */
const DAILY_QUOTA_MESSAGE = 'daily message quota exceeded';
/** 🔴 秒間レート超過。日次枠とは**別物**であり保留に倒さない。 */
const SENDING_RATE_MESSAGE = 'maximum sending rate exceeded';

/** 恒久的（人間対応）に確定する SES の例外名（docs/03 §3.2.9）。 */
const PERMANENT_CODES = new Set([
  'MessageRejected',
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'SendingPausedException',
  'BadRequestException',
  'NotFoundException',
]);

/**
 * 🔴 **リクエストが受理されていないことが確定する**拒否（スロットリング / 上限。HTTP 4xx 相当）。
 *
 * SES が「受け取らなかった」と明言しているので、**送信経路でも再試行してよい**
 * （もう一度送っても二重にならない）。秒間レート超過はここに属する（docs/05 §8.7）。
 */
const THROTTLED_CODES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'LimitExceededException',
]);

/**
 * 🔴 サーバ側エラー（5xx）。**分類は操作の種類で変わる**（本ファイルの要点）:
 *
 *   - 読み取り（`getAccount`）→ `TRANSIENT`。何度呼んでも副作用が無いので再試行してよい。
 *   - 🔴 **送信（`sendEmail`）→ `UNKNOWN`**。5xx は「SES が受理していない」ことを**保証しない** ——
 *     内部で受理された後に応答生成で落ちた可能性があり、**届いているかどうかが分からない**。
 *     ここを `TRANSIENT` にすると `email.dispatch` の `attempts: 3` に乗り、
 *     「実は送信済み → 5 秒後に再送 = 2 通」の経路が開く（`CLAUDE.md` §3.4 / `BR-21`）。
 *     docs/05 §15.4 の「応答不明 → 再試行**禁止**」がそのまま当てはまる。
 */
const SERVER_ERROR_CODES = new Set(['InternalServiceErrorException', 'ServiceUnavailableException']);

/** 応答不明（届いたか分からない）に分類するネットワーク層のエラー名。 */
const UNKNOWN_CODES = new Set([
  'TimeoutError',
  'RequestTimeout',
  'RequestAbortedError',
  'AbortError',
  'ECONNRESET',
  'ETIMEDOUT',
]);

type ProviderErrorShape = {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: unknown };
};

function providerCodeOf(error: ProviderErrorShape): string {
  if (typeof error.name === 'string' && error.name !== '' && error.name !== 'Error') return error.name;
  if (typeof error.code === 'string' && error.code !== '') return error.code;
  return 'UnknownError';
}

function messageOf(error: ProviderErrorShape): string {
  return typeof error.message === 'string' ? error.message : '';
}

function httpStatusOf(error: ProviderErrorShape): number | null {
  const status = error.$metadata?.httpStatusCode;
  return typeof status === 'number' ? status : null;
}

/**
 * 呼び出した操作の種類。
 *
 * 🔴 **分類がこれで変わる**（本ファイルの要点）。同じ 5xx でも、読み取りは「もう一度読めばよい」
 *    が、送信は「届いたか分からない」である。区別せずに 1 つの表で分類すると、
 *    どちらかが必ず間違う（docs/05 §15.4 の「一時的」と「応答不明」は別の行である）。
 */
export type SesOperationKind = 'send' | 'read';

/**
 * 🔴 SES の例外を内部型へ正規化する唯一の関数（docs/05 §15.4 / §8.3-Q ⑤）。
 *
 * 日次枠超過だけは `ProviderQuotaExceededError`（**保留**）として返す。それ以外は
 * `ExternalSendError`（`TRANSIENT` / `PERMANENT` / `UNKNOWN`）になる。
 *
 * 🔴 **`operation` を必須引数にしてある。** 既定値を置くと、新しい呼び出し側が
 *    「送信なのに読み取りの分類」を黙って引き当てる（＝ 5xx で再送する）。
 * 🔴 メッセージの中身を握り潰さない。ただし返す文言に**宛先・本文・トークンを含めない**
 *    （SES の例外メッセージ自体は宛先を含みうるため、`providerCode` と定型文だけを載せる）。
 */
export function normalizeSesError(
  error: unknown,
  operation: SesOperationKind,
): ProviderQuotaExceededError | ExternalSendError {
  const shape: ProviderErrorShape = typeof error === 'object' && error !== null ? error : {};
  const providerCode = providerCodeOf(shape);
  const lowerMessage = messageOf(shape).toLowerCase();

  /**
   * 🔴 サーバ側エラー（5xx）の分類。送信は**応答不明**（再試行禁止）、読み取りは一時的。
   */
  const serverError = (detail: string): ExternalSendError =>
    operation === 'send'
      ? new ExternalSendError(
          'UNKNOWN',
          providerCode,
          `${detail} 送信が受理されたかどうかを判定できません。再試行してはなりません。`,
        )
      : new ExternalSendError('TRANSIENT', providerCode, detail);

  // 🔴 日次枠（保留）と秒間レート（一時的）の見分けは**メッセージが先**である。
  //    例外名（`TooManyRequestsException` / `LimitExceededException`）は両者で共通しうる。
  if (lowerMessage.includes(DAILY_QUOTA_MESSAGE)) {
    return new ProviderQuotaExceededError(
      `送信基盤の 24 時間あたりの送信数上限に到達しています（${providerCode}）。`,
    );
  }
  if (lowerMessage.includes(SENDING_RATE_MESSAGE)) {
    return new ExternalSendError(
      'TRANSIENT',
      providerCode,
      `SES の秒間送信レートを超過しました（${providerCode}）。`,
    );
  }

  if (UNKNOWN_CODES.has(providerCode)) {
    return new ExternalSendError(
      'UNKNOWN',
      providerCode,
      `SES への送信要求が応答不明で終了しました（${providerCode}）。再試行してはなりません。`,
    );
  }
  if (PERMANENT_CODES.has(providerCode)) {
    return new ExternalSendError('PERMANENT', providerCode, `SES が送信を拒否しました（${providerCode}）。`);
  }
  // 🔴 受理されなかったことが確定する拒否（スロットリング）だけが、送信経路でも `TRANSIENT` になる。
  if (THROTTLED_CODES.has(providerCode)) {
    return new ExternalSendError('TRANSIENT', providerCode, `SES が要求を拒否しました（${providerCode}）。`);
  }
  if (SERVER_ERROR_CODES.has(providerCode)) {
    return serverError(`SES がサーバ側エラーを返しました（${providerCode}）。`);
  }

  const status = httpStatusOf(shape);
  if (status !== null && status >= 500) {
    return serverError(`SES が ${status} を返しました（${providerCode}）。`);
  }
  if (status !== null && status >= 400) {
    return new ExternalSendError('PERMANENT', providerCode, `SES が ${status} を返しました（${providerCode}）。`);
  }
  // 🔴 分類できないものを「一時的」に倒さない。届いたか分からない扱い（再試行しない）が安全側。
  return new ExternalSendError(
    'UNKNOWN',
    providerCode,
    `SES への送信で分類できないエラーが発生しました（${providerCode}）。再試行してはなりません。`,
  );
}
