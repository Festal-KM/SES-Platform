// apps/web/lib/api/errors.ts
// docs/05 §15.1 の例外階層と §15.2 の応答フォーマット。
//
// 🔴 本ファイルは T-03-01 で**必要な分だけ**を置いた土台である。
//    `withApiRoute` の共通ガードと残りの例外型（Conflict / Unprocessable / Quota / …）は
//    T-03-04 が同じ階層の上に足す。**階層と応答フォーマットを二重に作らない。**
//
// 🔴 `userMessageKey` は `@ses/i18n` の `MessageKey` に型で縛る（BR-32 / CLAUDE.md §3.5）。
//    サーバで文言を組み立てられない（キーしか返せない）ことをコンパイラが保証する。
//
// 🔴 `details` に入れてよいのは `ValidationError` のフィールドパスだけである（docs/05 §15.2）。
//    DB のエラー本文・SQL・スタックトレース・外部 API の生応答を入れない。
import { AuditLogWriteError } from '@ses/db';
import type { MessageKey } from '@ses/i18n';

export type ErrorLogLevel = 'warn' | 'error';

/** docs/05 §15.2 の応答ボディ。 */
export type ApiErrorBody = {
  readonly error: {
    readonly code: string;
    readonly messageKey: MessageKey;
    readonly retryable: boolean;
    readonly details?: readonly string[];
  };
};

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  abstract readonly userMessageKey: MessageKey;
  readonly logLevel: ErrorLogLevel = 'warn';
  readonly retryable: boolean = false;
  /** 🔴 `ValidationError` のフィールドパスのみ。 */
  readonly details?: readonly string[];
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION';
  readonly httpStatus = 400;
  readonly userMessageKey: MessageKey = 'error.validation';
  override readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super('リクエストの検証に失敗しました。');
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * 401。🔴 サインインの失敗理由（存在しない / パスワード不一致 / 無効化）を**区別しない**
 * （docs/04 §S-001「メールアドレスが存在しないとパスワードが違うを区別しない」）。
 */
export class AuthenticationError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly httpStatus = 401;
  readonly userMessageKey: MessageKey = 'error.unauthenticated';

  constructor() {
    super('認証されていません。');
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  readonly userMessageKey: MessageKey = 'error.forbidden';

  constructor() {
    super('この操作を実行する権限がありません。');
    this.name = 'ForbiddenError';
  }
}

/** 🔴 境界外の ID も必ずこれ（403 と区別しない。docs/05 §4.8）。対象 ID を含めない。 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  readonly userMessageKey: MessageKey = 'error.notFound';

  constructor() {
    super('対象が見つかりません。');
    this.name = 'NotFoundError';
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL';
  readonly httpStatus = 500;
  readonly userMessageKey: MessageKey = 'error.internal';
  override readonly logLevel: ErrorLogLevel = 'error';

  constructor(message = '内部エラーが発生しました。') {
    super(message);
    this.name = 'InternalError';
  }
}

/**
 * 🔴 監査ログの書き込みに失敗した（docs/05 §15.1 / §15.5 / F-005 / F-012 AC-2）。
 *    **これを捕捉して操作を続行してはならない。** 呼び出し側はトランザクションを
 *    ロールバックし、対象操作を成立させない（T-03-05 が `withApiRoute` に組み込む）。
 */
export class AuditWriteFailedError extends AppError {
  readonly code = 'AUDIT_WRITE_FAILED';
  readonly httpStatus = 500;
  readonly userMessageKey: MessageKey = 'error.internal';
  override readonly logLevel: ErrorLogLevel = 'error';

  constructor(readonly action: string) {
    super(`監査ログの書き込みに失敗しました（action=${action}）。操作は成立させません。`);
    this.name = 'AuditWriteFailedError';
  }
}

/** 未知の例外は内部エラーへ写像する（原因を応答に載せない。docs/05 §15.2）。 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  // 🔴 packages/db 側の監査書き込み失敗は、専用の型として保つ（500 に潰して原因を失わない）。
  if (error instanceof AuditLogWriteError) return new AuditWriteFailedError(error.action);
  return new InternalError();
}

export function toApiErrorBody(error: AppError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      messageKey: error.userMessageKey,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

export function errorResponse(error: unknown): Response {
  const appError = toAppError(error);
  return Response.json(toApiErrorBody(appError), { status: appError.httpStatus });
}
