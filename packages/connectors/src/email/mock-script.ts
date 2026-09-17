// packages/connectors/src/email/mock-script.ts
// 🔴 T-09-07: モックの `EmailSender` に「応答不明」「ネットワーク断」「明示的拒否」を**再現させる**ための台本
//    （docs/05 §13.2 / §10.6 / §15.4 / `F-022 AC-2` `AC-3`）。`MockAnthropicClientOptions.script`（`packages/ai`）と同型。
//
// 🔴 なぜ `mock/**` の外に置くか: `packages/connectors/src/mock/**` は `index.ts` 以外から import できない
//    （ESLint `no-restricted-imports` / docs/05 §13.1）。台本の**型**は起動時 DI（`createEmailSender` の
//    `ConnectorRuntimeOptions.mockEmail`）と E2E ハーネス（T-09-11）が参照するため、モック実装とは別のファイルに置く。
//    ここにあるのは型と検証だけであり、モックの実装（`MockEmailSender`）はこの型を**受け取る**側である。
//
// 🔴 台本があってもモック実装が選ばれる環境は変わらない（`resolveConnectorSelection` = `packages/config` の 1 箇所）。
//    `production` / `staging`（`email: 'real'`）に台本を渡すと `createEmailSender` が起動時に throw する
//    （`MockEmailScriptNotApplicableError`。黙って無視しない = 「モックのつもりで実送信」の逆も作らない）。

/**
 * 1 回の `send()` に対する振る舞い。
 *
 * - `deliver` … 既定。記録して `externalId` を返す（届いた）。
 * - `unknown` … 🔴 **受け付けた後に応答が返らなかった**（タイムアウト / 送信経路の 5xx 相当）。**外部には届いた
 *   可能性がある**ので `callCount()` は加算し、sink にも書いたうえで `ExternalSendError('UNKNOWN', …)` を投げる。
 *   送信ジョブはこれを `SendAttempt.UNKNOWN` + `SUBMIT_FAILED` に確定する（docs/05 §10.6 の隔離）。
 * - `unreachable` … 🔴 **送る前に失敗した**（接続拒否 / DNS 不達）。**外部には届いていない**ので `callCount()` は
 *   加算せず、sink にも書かずに `ExternalSendError('TRANSIENT', …)` を投げる（受理されなかったことが確定している。
 *   §15.4）。送信ジョブは `FAILED` + `SUBMIT_FAILED` に確定する（`send.*` に再試行は無い。`attempts: 1`）。
 * - `reject` … 送信基盤が**明示的に拒否**した（`MessageRejected` 等）。要求は届いたので `callCount()` は加算するが
 *   メールは出ていない（sink には書かない）。`ExternalSendError('PERMANENT', …)`。
 *
 * `providerCode` は `ExternalSendError.providerCode`（`failureKind` の後半 `UNKNOWN:<code>` に載る）。省略時は
 * 下の既定値。🔴 宛先・本文をここに載せない（`failure_detail` に写るため）。
 */
export type MockEmailStep =
  | { readonly kind: 'deliver' }
  | { readonly kind: 'unknown'; readonly providerCode?: string }
  | { readonly kind: 'unreachable'; readonly providerCode?: string }
  | { readonly kind: 'reject'; readonly providerCode?: string };

export type MockEmailStepKind = MockEmailStep['kind'];

export const MOCK_EMAIL_STEP_KINDS = ['deliver', 'unknown', 'unreachable', 'reject'] as const satisfies readonly MockEmailStepKind[];

/**
 * 既定の `providerCode`。SES の正規化（`email/ses/errors.ts`）が同じ種別に分類する語を使い、
 * `S-022` の畳み込み（`classifySendFailureKind`）が実装と同じ区分に落ちるようにする。
 */
export const MOCK_EMAIL_PROVIDER_CODES = {
  unknown: 'TimeoutError',
  unreachable: 'ECONNREFUSED',
  reject: 'MessageRejected',
} as const;

/** 台本の形が不正（E2E / 起動時の注入が壊れている）。既定値で補完せず落とす。 */
export class MockEmailScriptError extends Error {
  constructor(message: string) {
    super(`MockEmailSender の台本が不正です: ${message}`);
    this.name = 'MockEmailScriptError';
  }
}

function isStepKind(value: unknown): value is MockEmailStepKind {
  return typeof value === 'string' && (MOCK_EMAIL_STEP_KINDS as readonly string[]).includes(value);
}

/**
 * 🔴 環境変数 / JSON から渡された台本の検証（T-09-11 が worker プロセスへ注入するときの入口）。
 *
 * 受け付けるのは `MockEmailStep[]` の形だけ。未知の `kind` / `providerCode` が文字列でない / 配列でない、は例外。
 * 🔴 空配列は「常に `deliver`」（`MockEmailSender` の既定と同じ）であり、`MockAnthropicClient` と違って未設定を
 *    例外にしない —— メールのモックは `development` / `demo` が台本なしで常用する実装だからである。
 */
export function parseMockEmailScript(raw: unknown): MockEmailStep[] {
  if (!Array.isArray(raw)) throw new MockEmailScriptError('配列ではありません');
  return raw.map((entry, index): MockEmailStep => {
    if (typeof entry !== 'object' || entry === null) throw new MockEmailScriptError(`[${String(index)}] がオブジェクトではありません`);
    const record = entry as Record<string, unknown>;
    if (!isStepKind(record.kind)) {
      throw new MockEmailScriptError(`[${String(index)}].kind が ${MOCK_EMAIL_STEP_KINDS.join(' / ')} のいずれでもありません`);
    }
    if (record.kind === 'deliver') return { kind: 'deliver' };
    const providerCode = record.providerCode;
    if (providerCode !== undefined && (typeof providerCode !== 'string' || providerCode.trim() === '')) {
      throw new MockEmailScriptError(`[${String(index)}].providerCode が空でない文字列ではありません`);
    }
    return providerCode === undefined ? { kind: record.kind } : { kind: record.kind, providerCode };
  });
}
