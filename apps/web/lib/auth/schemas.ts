// apps/web/lib/auth/schemas.ts
// docs/05 §6.3 #1 の request スキーマ。
//
// 🔴 `tenantId` / `partnerCompanyId` を**キーとして持たない**（F-003 AC-1 / F-004 AC-2）。
//    加えて `z.object()` の既定（strip）により、body に混ぜられた未知のキーは
//    **黙って捨てられる**。`strict()` にして 400 を返す実装は採らない —— それだと
//    「入力を改変すると応答が変わる」ことになり、AC-1 の「結果が変わらない」を
//    かえって満たさなくなる（改変の有無を攻撃者が判別できてしまう）。
import { z } from 'zod';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@ses/config';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/**
 * RFC 5321 の上限。長大な入力でハッシュ計算に持ち込まないための実務上の上限。
 * 🔴 T-03-03 で `packages/config` の `limits.ts`（期限・長さの単一の出所）へ移した。
 *    ここで別の値を持たない。
 */
const MAX_EMAIL_LENGTH = EMAIL_MAX_LENGTH;
const MAX_PASSWORD_LENGTH = PASSWORD_MAX_LENGTH;

/**
 * `POST /api/auth/signin`（docs/05 §6.3 #1）の body。
 * 🔴 メールは小文字化して照合する（`users_auth_lookup_select` ポリシーが `lower(email)` で比較する）。
 */
export const signInBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(MAX_EMAIL_LENGTH),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export type SignInBody = z.infer<typeof signInBodySchema>;

/** 🔴 分離キーが混入したらここでコンパイルエラーになる。 */
export type SignInBodyIsolationGuard = AssertNoIsolationKeys<SignInBody>;

/** 🔴 実行時の対照（型テストの空振り検知）。モジュール読み込み時に 1 回だけ走る。 */
assertNoIsolationKeys(Object.keys(signInBodySchema.shape), 'signInBodySchema');

/**
 * `POST /api/auth/2fa/verify`（docs/05 §6.3 #2）の body。
 *
 * 🔴 受け取るのは `code` だけである。**「誰の 2FA を検証するか」を入力で指定させない**
 *    （主体はセッションからのみ決まる。CLAUDE.md §3.1 / `BR-03`）。
 * 🔴 TOTP（6 桁）とリカバリコード（区切り付き）の両方が来るため、長さの上限だけを置き、
 *    形式の判定は検証側（`totp.ts` / `recovery-codes.ts`）が行う。
 */
const MAX_TWO_FACTOR_CODE_LENGTH = 64;

export const twoFactorVerifyBodySchema = z.object({
  code: z.string().trim().min(1).max(MAX_TWO_FACTOR_CODE_LENGTH),
});

export type TwoFactorVerifyBody = z.infer<typeof twoFactorVerifyBodySchema>;

export type TwoFactorVerifyBodyIsolationGuard = AssertNoIsolationKeys<TwoFactorVerifyBody>;

assertNoIsolationKeys(Object.keys(twoFactorVerifyBodySchema.shape), 'twoFactorVerifyBodySchema');

/**
 * `POST /api/auth/password-reset`（docs/05 §6.3 #5）の body。
 * 🔴 応答は常に 204 であり、このスキーマの検証結果もアカウントの存在を示さない。
 */
export const passwordResetRequestBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(MAX_EMAIL_LENGTH).email(),
});

export type PasswordResetRequestBody = z.infer<typeof passwordResetRequestBodySchema>;

export type PasswordResetRequestBodyIsolationGuard =
  AssertNoIsolationKeys<PasswordResetRequestBody>;

assertNoIsolationKeys(
  Object.keys(passwordResetRequestBodySchema.shape),
  'passwordResetRequestBodySchema',
);

/** 再設定トークンの長さの上限（生成は base64url 43 文字。余裕を見た境界）。 */
const MAX_RESET_TOKEN_LENGTH = 256;

/**
 * `POST /api/auth/password-reset/confirm`（docs/05 §6.3 #5b）の body。
 * 🔴 新しいパスワードは**設定時のポリシー**（`PASSWORD_MIN_LENGTH`）を満たすこと。
 *    サインイン（#1）には適用しない（既存パスワードで入れなくなるため）。
 */
export const passwordResetConfirmBodySchema = z.object({
  token: z.string().trim().min(1).max(MAX_RESET_TOKEN_LENGTH),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export type PasswordResetConfirmBody = z.infer<typeof passwordResetConfirmBodySchema>;

export type PasswordResetConfirmBodyIsolationGuard =
  AssertNoIsolationKeys<PasswordResetConfirmBody>;

assertNoIsolationKeys(
  Object.keys(passwordResetConfirmBodySchema.shape),
  'passwordResetConfirmBodySchema',
);
