// apps/web/lib/settings/account.ts
// `S-048` アカウント設定（2026-10-16。[Issue #95](https://github.com/Festal-KM/SES-Platform/issues/95)
// への人間の回答「サイドバー下部のところをクリッカブルにして、サインアウトとアカウント設定
// （アイコン画像、表示名、役職、メールアドレス、PW、等）ができるようにしよう」）。
//
// ============================================================================
// 🔴🔴 このモジュールが守るもの —— **「自分の 1 行だけ」はここでしか守られない**
// ============================================================================
// `users` の RLS は `users_c3_update`（migration 20260903050000）であり、式は
//
//   tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
//
// である。つまり **RLS は「自分の所属スコープの行すべて」を更新させる** —— 同僚の行も、
// ホスト所属なら他のホスト利用者（`OWNER` を含む）の行も通る。これは招待の受諾や
// メンバー管理が同じ経路を使うために必要な広さであり、**狭める方向の変更は別の機能を壊す**。
//
// 🔴 **したがって「自分の 1 行」はアプリ層が絞る。** 本モジュールは `where` に必ず
//    `id: ctx.userId` を置き、**利用者 ID を引数で受け取らない**（API の body にも無い）。
//    この性質は `account.test.ts` が構造として固定する（`where` に `id` が無い呼び出しを作れない）。
// 🔴 **`passwordHash` を外に出さない。** `SELECT` で読むのはパスワードの照合のときだけで、
//    ビューには載せない（`tests/support/admin-forbidden-keys.ts` の群 C と同じ語である）。
// 🔴 **メールアドレスは読み取り専用である**（下の `AccountSettingsView` の 🔴）。
// 🔴 **Next.js / Auth.js に依存しない**（`@ses/db` と `../auth/password` のみ）——
//    結合テストがサーバを立てずに同じ経路を実行できるようにするため（`organization.ts` と同じ方針）。
import { withTenant, type AuthenticatedTenantCtx, type TenantRole } from '@ses/db';
import { NotFoundError, ValidationError } from '../api/errors';
import { hashPassword, verifyPassword } from '../auth/password';

/** `S-048` が描く自分の情報。 */
export type AccountSettingsView = {
  readonly displayName: string;
  /** 役職。`null` = 未設定（画面は「未設定」と出し、空文字で埋めない）。 */
  readonly jobTitle: string | null;
  /**
   * 🔴 **読み取り専用である。** サインインの識別子であり、変更するには
   *    **新しいアドレスの到達確認（確認メール）** が要る —— それを持たずに書き換えられると、
   *    他人のアドレスを自分の口座に登録できてしまい、以後の通知がそこへ飛ぶ。
   *    確認メールの導線は別タスク（Issue #95 に申し送り）。
   */
  readonly email: string;
  /** 🔴 ロールは `ctx` が持つ（DB を読まない）。「なぜこの操作ができないか」の一次説明である。 */
  readonly role: TenantRole;
};

/** 本人が変更できる項目。**この 2 つがすべてである。** */
export type AccountSettingsPatch = {
  readonly displayName?: string;
  /** 空文字は「未設定に戻す」として `null` を書く（下の `toJobTitleColumn`）。 */
  readonly jobTitle?: string | null;
};

const SELECT = { displayName: true, jobTitle: true, email: true } as const;

type AccountRow = {
  readonly displayName: string;
  readonly jobTitle: string | null;
  readonly email: string;
};

function toView(row: AccountRow, ctx: AuthenticatedTenantCtx): AccountSettingsView {
  return { displayName: row.displayName, jobTitle: row.jobTitle, email: row.email, role: ctx.role };
}

/**
 * 🔴 **空文字と空白だけの入力は「未設定」として `null` にする。** 空文字を保存すると
 *    「設定されているが空」という第 3 の状態ができ、画面が「未設定」と書けなくなる。
 */
function toJobTitleColumn(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function readAccountSettings(
  ctx: AuthenticatedTenantCtx,
): Promise<AccountSettingsView> {
  return withTenant(ctx, async (db) => {
    // 🔴 `id: ctx.userId` —— 自分の 1 行だけ（ファイル冒頭の 🔴🔴）。
    const row = await db.user.findFirst({ where: { id: ctx.userId }, select: SELECT });
    if (row === null) throw new NotFoundError();
    return toView(row, ctx);
  });
}

export async function updateAccountSettings(
  ctx: AuthenticatedTenantCtx,
  patch: AccountSettingsPatch,
): Promise<AccountSettingsView> {
  const jobTitle = toJobTitleColumn(patch.jobTitle);
  return withTenant(ctx, async (db) => {
    // 🔴 `updateMany` + `where.id` にする（`update` の `where` は一意キーしか受けず、
    //    テナント横断の一意キー〔`id`〕だけで引くと RLS 任せになる）。**件数で結果を確かめる。**
    const result = await db.user.updateMany({
      where: { id: ctx.userId },
      data: {
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName.trim() }),
        ...(jobTitle === undefined ? {} : { jobTitle }),
      },
    });
    if (result.count === 0) throw new NotFoundError();
    const row = await db.user.findFirst({ where: { id: ctx.userId }, select: SELECT });
    if (row === null) throw new NotFoundError();
    return toView(row, ctx);
  });
}

/**
 * パスワードの変更（`S-048`）。
 *
 * 🔴 **現在のパスワードの照合を必須にする。** セッションを奪われたときに、そのまま乗っ取りへ
 *    進める（パスワードを変えて本人を追い出す）導線を作らないため。
 * 🔴 **失敗の理由を区別しない**（`docs/04` §S-001 と同じ規律）—— 「現在のパスワードが違う」と
 *    「利用者が見つからない」を同じ応答にする。
 * 🔴 **新しいパスワードの強さは Zod（`PASSWORD_MIN_LENGTH`）が見る**（`../auth/schemas.ts` と
 *    同じ値を使う。ここで 2 つ目のポリシーを作らない）。
 * 🔴 **平文はこのモジュールの外へ出さない**（`packages/db` にはハッシュだけを渡す。
 *    `../auth/password.ts` 冒頭の 🔴 と同じ）。
 */
export async function changeAccountPassword(
  ctx: AuthenticatedTenantCtx,
  input: { readonly currentPassword: string; readonly newPassword: string },
): Promise<void> {
  const nextHash = await hashPassword(input.newPassword);
  await withTenant(ctx, async (db) => {
    const row = await db.user.findFirst({
      where: { id: ctx.userId },
      select: { passwordHash: true },
    });
    // 🔴 理由を区別しない（上の 🔴）。
    if (row === null || !(await verifyPassword(input.currentPassword, row.passwordHash))) {
      throw new ValidationError(['現在のパスワードが正しくありません。']);
    }
    const result = await db.user.updateMany({
      where: { id: ctx.userId },
      // 🔴 **再設定トークンを同時に無効化する。** パスワードを変えた時点で、発行済みの
      //    再設定リンクは使えてはならない（変更した本人以外が握っている可能性がある）。
      data: { passwordHash: nextHash, passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
    if (result.count === 0) throw new ValidationError(['現在のパスワードが正しくありません。']);
  });
}
