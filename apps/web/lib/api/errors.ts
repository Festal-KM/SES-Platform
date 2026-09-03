// apps/web/lib/api/errors.ts
// docs/05 §15.1 の例外階層と §15.2 の応答フォーマット。
//
// 🔴 本ファイルは T-03-01 で**必要な分だけ**を置いた土台であり、T-03-04 が
//    共通ガードの例外型（`ViewerNotAllowedError` / `TenantNotExecutableError` /
//    `InvalidStateTransitionError`）を同じ階層の上に足した。残り（Quota / Connector / …）も
//    ここに足す。**階層と応答フォーマットを二重に作らない。**
//
// 🔴 `userMessageKey` は `@ses/i18n` の `MessageKey` に型で縛る（BR-32 / CLAUDE.md §3.5）。
//    サーバで文言を組み立てられない（キーしか返せない）ことをコンパイラが保証する。
//
// 🔴 `details` に入れてよいのは `ValidationError` のフィールドパスだけである（docs/05 §15.2）。
//    DB のエラー本文・SQL・スタックトレース・外部 API の生応答を入れない。
import {
  AuditLogWriteError,
  HostOnlyContextError,
  TwoFactorRequiredError as DbTwoFactorRequiredError,
} from '@ses/db';
import type { TenantLifecycleState, TwoFactorRequirementReason } from '@ses/db';
import { InvalidStateTransitionError as DomainInvalidStateTransitionError } from '@ses/domain';
import type { StateMachineEntity } from '@ses/domain';
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
  // 🔴 派生（TwoFactorCodeInvalidError）が別のコードを名乗れるよう、リテラル型に固定しない。
  readonly code: string = 'UNAUTHENTICATED';
  readonly httpStatus = 401;
  readonly userMessageKey: MessageKey = 'error.unauthenticated';

  constructor() {
    super('認証されていません。');
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends AppError {
  // 🔴 派生（ViewerNotAllowedError / TwoFactorRequiredError）が別のコードを名乗れるようにする。
  readonly code: string = 'FORBIDDEN';
  readonly httpStatus = 403;
  readonly userMessageKey: MessageKey = 'error.forbidden';

  constructor() {
    super('この操作を実行する権限がありません。');
    this.name = 'ForbiddenError';
  }
}

/**
 * 🔴 `VIEWER` が実行系（承認 / 送信 / ダウンロード / エクスポート）を呼んだ
 *    （docs/05 §15.1 / §6.2 / `BR-31` / `F-004 AC-6`）。403。
 *
 * 🔴 `ForbiddenError` と別コードにする理由: `VIEWER` の拒否は**ロールの設計どおりの結果**であり、
 *    「権限が足りない（＝ 昇格すれば実行できる）」とは別の意味を持つ。画面は文言を出し分ける
 *    （`error.viewer.notAllowed`）。区別しても情報境界は緩まない —— 自分のロールは本人が知っている。
 */
export class ViewerNotAllowedError extends ForbiddenError {
  override readonly code = 'VIEWER_NOT_ALLOWED';
  override readonly userMessageKey: MessageKey = 'error.viewer.notAllowed';

  constructor() {
    super();
    this.name = 'ViewerNotAllowedError';
  }
}

/**
 * 🔴 2 要素認証が未充足（docs/05 §15.1 / §6.2 / `BR-30` / `F-003 AC-2`）。403。
 *
 * `resolveTenantCtx`（packages/db）が投げた `TwoFactorRequiredError` を API 応答へ写像する。
 * 🔴 `reason` は**遷移先を決めるためだけ**の情報である（設定ウィザードか、コード入力か）。
 *    参照範囲・権限には一切影響しない。
 */
export class TwoFactorRequiredError extends ForbiddenError {
  override readonly code = 'TWO_FACTOR_REQUIRED';
  override readonly userMessageKey: MessageKey = 'error.2fa.required';

  constructor(readonly reason: TwoFactorRequirementReason) {
    super();
    this.name = 'TwoFactorRequiredError';
  }
}

/**
 * 🔴 2 要素認証のコードが一致しない（401）。docs/05 §15.1 の `AuthenticationError` 配下に置く
 *    （同節が `ForbiddenError` 配下に `ViewerNotAllowedError` 等を並べているのと同じ入れ子）。
 *
 * 🔴 「TOTP が違う」と「リカバリコードが違う」を区別しない（どちらも同じ応答）。
 *    区別すると、どちらの要素が有効かを試行から推測できてしまう。
 */
export class TwoFactorCodeInvalidError extends AuthenticationError {
  override readonly code = 'TWO_FACTOR_CODE_INVALID';
  override readonly userMessageKey: MessageKey = 'error.2fa.invalidCode';

  constructor() {
    super();
    this.name = 'TwoFactorCodeInvalidError';
  }
}

/**
 * 🔴 2 要素認証の試行回数が上限に達した（429）。docs/04 §S-001「ロックアウトは残り時間を明示」。
 *
 * docs/05 §15.1 の `QuotaExceededError`（429）と同じ段に置く。**コードを検証せずに拒否した**ことを
 * 表すため、`AuthenticationError`（コードが違う）とは別の型にする。
 * 🔴 応答からは「資格情報があるか」「TOTP とリカバリコードのどちらが有効か」を推測させない
 *    （返すのは残り時間だけ）。残り時間は `Retry-After` ヘッダで返す（本文の形は §15.2 のまま）。
 */
export class TwoFactorThrottledError extends AppError {
  readonly code = 'TWO_FACTOR_THROTTLED';
  readonly httpStatus = 429;
  readonly userMessageKey: MessageKey = 'error.2fa.throttled';
  override readonly retryable = true;

  constructor(readonly retryAfterSeconds: number) {
    super('2 要素認証の試行回数が上限に達しました。');
    this.name = 'TwoFactorThrottledError';
  }
}

/**
 * 409。docs/05 §15.1 の `ConflictError` 段。
 * 🔴 T-03-04 が `TenantNotExecutableError` 等を同じ段に足す。**409 の基底を二重に作らない。**
 */
export class ConflictError extends AppError {
  readonly code: string = 'CONFLICT';
  readonly httpStatus = 409;
  readonly userMessageKey: MessageKey = 'error.conflict';

  constructor(message = '現在の状態では実行できません。') {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * 🔴 テナントのライフサイクル状態が実行系を許さない（docs/05 §15.1 / §6.2 /
 *    `F-004 AC-7`〜`AC-9`）。409。
 *
 * 🔴 これは**ロールの権限より優先する**（`F-004` 処理⑤）。`OWNER` でも拒否される。
 * 🔴 `userMessageKey` を状態ごとに変える（`F-004 AC-9`「拒否の理由が利用者に表示される」）。
 *    どの状態にどのキーを割り当てるかは `lib/api/guards.ts` の 1 つの表が決める
 *    （**この型は判定を持たない**。判定の出所が 2 箇所に分かれると、片方だけ緩む）。
 */
export class TenantNotExecutableError extends ConflictError {
  override readonly code = 'TENANT_NOT_EXECUTABLE';
  override readonly userMessageKey: MessageKey;

  constructor(
    /** 🔴 応答ボディには載せない（内部ログ用。docs/05 §15.2）。 */
    readonly lifecycleState: TenantLifecycleState,
    userMessageKey: MessageKey,
  ) {
    super(`テナントの状態（${lifecycleState}）では実行系の操作を行えません。`);
    this.name = 'TenantNotExecutableError';
    this.userMessageKey = userMessageKey;
  }
}

/**
 * 🔴 招待を受諾できない（docs/05 §6.3 #7。`acceptedAt` の CAS が 0 件）。
 *
 * 受諾済み / 取消済み / 期限切れ / トークン不一致 / 同時受諾に負けた、を**区別しない**。
 * 区別すると、無効なトークンを総当たりした側に「そのトークンは実在する」ことが伝わる。
 * 画面（`S-002`）が出し分ける文言は `#6` の応答（トークンを持つ本人にだけ返る）から決める。
 */
export class InvitationNotAcceptableError extends ConflictError {
  override readonly code = 'INVITATION_NOT_ACCEPTABLE';
  override readonly userMessageKey: MessageKey = 'error.invitation.notAcceptable';

  constructor() {
    super('この招待は受諾できません。');
    this.name = 'InvitationNotAcceptableError';
  }
}

/**
 * 422。docs/05 §15.1 の `UnprocessableError` 段。
 * 🔴 T-03-04 以降が `InvalidStateTransitionError` / `SendingDomainNotVerifiedError` を同じ段に足す。
 */
export class UnprocessableError extends AppError {
  readonly code: string = 'UNPROCESSABLE';
  readonly httpStatus = 422;
  readonly userMessageKey: MessageKey = 'error.unprocessable';

  constructor(message = 'この内容では処理できません。') {
    super(message);
    this.name = 'UnprocessableError';
  }
}

/**
 * 🔴 `CLAUDE.md` §4.2 の遷移表に無い状態遷移（docs/05 §15.1 / §15.3 / `BR-33`）。422。
 *
 * 🔴 **状態機械そのものは `packages/domain` に 1 つだけある。** ここにあるのは
 *    その例外（`@ses/domain` の `InvalidStateTransitionError`）を HTTP に写像する型である。
 *    `packages/domain` は何にも依存できない（`CLAUDE.md` §2.1）ため `AppError` を継承できず、
 *    写像は API 境界の責務になる（`toAppError` が唯一の変換点）。**判定を二重に持たない。**
 */
export class InvalidStateTransitionError extends UnprocessableError {
  override readonly code = 'INVALID_STATE_TRANSITION';
  override readonly userMessageKey: MessageKey = 'error.state.invalidTransition';

  constructor(
    /** 🔴 いずれも応答ボディには載せない（内部ログ用。docs/05 §15.2）。 */
    readonly entity: StateMachineEntity,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${entity}: ${from} -> ${to} は遷移表にありません。`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * 🔴 取引先の担当者への招待は **Phase 0 では発行しない**（`docs/sprints/SP-03` T-03-03。
 *    「Phase 0 はホストロール宛のみ。取引先招待は SP-04」）。
 *
 * なぜ「作れてしまう」より「拒否する」なのか: 取引先へ届くメールは
 * **テナント独自ドメインの検証が前提**（`F-007 AC-5` / `BR-71` / docs/05 §8.3）であり、
 * その判定（`requireVerifiedSendingDomain`）と保留（`HELD_DOMAIN_UNVERIFIED`）は SP-04 の実装である。
 * 判定の無いまま招待だけ作れると、**未検証のドメインから取引先へ送る経路**が一時的に開く。
 */
export class PartnerInvitationNotAvailableError extends UnprocessableError {
  override readonly code = 'PARTNER_INVITATION_NOT_AVAILABLE';
  override readonly userMessageKey: MessageKey = 'error.invitation.partnerNotAvailable';

  constructor() {
    super('取引先の担当者への招待は、この段階では発行できません（SP-04）。');
    this.name = 'PartnerInvitationNotAvailableError';
  }
}

/**
 * 🔴 招待先のメールアドレスの利用者が、すでにそのテナントに存在する（`users` の
 *    `@@unique([tenantId, email])`。docs/05 §3.3）。422。
 *
 * なぜ 404 / 409 に畳まず存在を明かすか: このエラーを受け取るのは**招待を発行できる
 * `OWNER` / `ADMIN`**（`F-002` 関連ロール）だけであり、自テナントのメンバー一覧を
 * 見られる立場である。したがって情報境界（`CLAUDE.md` §3.1）の観点で新たに漏れるものは無く、
 * 「招待ではなくロール変更が要る」という次の行動を伝えられる方が価値が高い。
 * 🔴 **未認証経路（#6 / #7）ではこの型を使わない**（そちらは常に 409 で理由を区別しない）。
 */
export class InvitationEmailAlreadyMemberError extends UnprocessableError {
  override readonly code = 'INVITATION_EMAIL_ALREADY_MEMBER';
  override readonly userMessageKey: MessageKey = 'error.invitation.emailAlreadyMember';

  constructor() {
    super('このメールアドレスの利用者はすでにこのテナントに存在します。');
    this.name = 'InvitationEmailAlreadyMemberError';
  }
}

/**
 * 🔴 パスワード再設定トークンが無効（docs/05 §6.3 #5b「トークン列の CAS で 1 回限り、
 *    期限超過は 400」）。
 *
 * 不一致・期限切れ・使用済みを**区別しない**（区別するとトークンの実在が漏れる）。
 */
export class PasswordResetTokenInvalidError extends AppError {
  readonly code = 'PASSWORD_RESET_TOKEN_INVALID';
  readonly httpStatus = 400;
  readonly userMessageKey: MessageKey = 'error.passwordReset.invalidToken';

  constructor() {
    super('パスワード再設定のリンクが無効です。');
    this.name = 'PasswordResetTokenInvalidError';
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

/**
 * 🔴 「見えない ＝ 存在しない」を**呼び出し側で書き分けさせない**ための唯一のヘルパ
 *    （docs/05 §4.8 / `F-004 AC-4`）。
 *
 * 境界の外の ID は `withTenant` の中で **RLS と Prisma 拡張が 0 件に落とす**ため、
 * ハンドラの手元には `null` として届く。そこで 403 を返すか 404 を返すかを各ハンドラが
 * 判断する構造にすると、いつか「存在はするが権限が無い」と答える実装が混ざる。
 * **`null` を受け取ったら必ず 404** に畳む経路をここに 1 本だけ用意する。
 */
export function requireFound<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new NotFoundError();
  return value;
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
  // 🔴 2FA 未充足は 403 として利用者に返す（500 に潰すと、設定すれば解決することが伝わらない）。
  if (error instanceof DbTwoFactorRequiredError) return new TwoFactorRequiredError(error.reason);
  // 🔴 ホスト専用の経路にパートナー文脈が入った ＝ **404**（403 と区別しない。docs/05 §4.8 /
  //    packages/db の `HostOnlyContextError` のコメント）。403 にすると「その機能は存在するが
  //    あなたには使えない」ことが伝わり、ホスト側の業務の存在を示唆する。
  if (error instanceof HostOnlyContextError) return new NotFoundError();
  // 🔴 遷移表に無い状態遷移は **422**（サイレントに無視しない。docs/05 §15.3 / `BR-33`）。
  if (error instanceof DomainInvalidStateTransitionError) {
    return new InvalidStateTransitionError(error.entity, error.from, error.to);
  }
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
  return Response.json(toApiErrorBody(appError), {
    status: appError.httpStatus,
    // 🔴 残り時間は標準ヘッダで返す（本文の形は §15.2 のまま変えない）。
    headers:
      appError instanceof TwoFactorThrottledError
        ? { 'retry-after': String(appError.retryAfterSeconds) }
        : {},
  });
}
