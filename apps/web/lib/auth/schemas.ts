// apps/web/lib/auth/schemas.ts
// docs/05 §6.3 #1 の request スキーマ。
//
// 🔴 `tenantId` / `partnerCompanyId` を**キーとして持たない**（F-003 AC-1 / F-004 AC-2）。
//    加えて `z.object()` の既定（strip）により、body に混ぜられた未知のキーは
//    **黙って捨てられる**。`strict()` にして 400 を返す実装は採らない —— それだと
//    「入力を改変すると応答が変わる」ことになり、AC-1 の「結果が変わらない」を
//    かえって満たさなくなる（改変の有無を攻撃者が判別できてしまう）。
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/** RFC 5321 の上限。長大な入力でハッシュ計算に持ち込まないための実務上の上限。 */
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 512;

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
