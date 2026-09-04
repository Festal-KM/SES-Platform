// packages/db/src/scope-settings.ts
// 第 1 防御（RLS）にテナント文脈を渡す唯一の SQL（docs/05 §4.3 実装の規約 1）。
//
// 🔴 トランザクションの先頭でのみ発行する。トランザクション外の `SET` を書かない
//    （コネクションプール〔PgBouncer の transaction モード / Prisma の内部プール〕では
//     セッション単位の `SET` が別リクエストに漏れる。docs/03 §2.2 懸念 1 / §4.3.1）。
//
// 🔴 `SET LOCAL app.tenant_id = $1` ではなく `set_config(..., is_local := true)` を使う理由:
//    `SET` はバインドパラメータを受け付けないため、値を文字列連結するしかなくなる。
//    `set_config(name, value, true)` は `SET LOCAL` と同一の意味（トランザクション終了で戻る）を持ち、
//    かつ値をパラメータとして送れる。分離キーを SQL 文字列に連結しないことを構造的に保証する。
import { Prisma } from '@prisma/client';

export type TenantScopeSettings = {
  readonly tenantId: string;
  /** 🔴 ホストは空文字を入れる。NULL を入れない（docs/05 §4.3 実装の規約 2）。 */
  readonly partnerCompanyId: string | null;
  readonly actorUserId: string;
};

export function tenantScopeSettingsSql(scope: TenantScopeSettings): Prisma.Sql {
  return Prisma.sql`SELECT
    set_config('app.tenant_id', ${scope.tenantId}, true),
    set_config('app.partner_company_id', ${scope.partnerCompanyId ?? ''}, true),
    set_config('app.actor_user_id', ${scope.actorUserId}, true),
    set_config('app.shared_scope', 'off', true)`;
}

/**
 * `withSystemScope()`（docs/05 §4.4.2）が発行する設定。
 *
 * 🔴 `app.tenant_id` を**空文字**で明示的に上書きする。`app_tenant_id()` が NULL になり、
 *    C0 SYSTEM_ONLY のポリシー（`app_tenant_id() IS NULL`）だけが真になる。
 *    「設定しない」ではなく「空で上書きする」のは、同じ物理接続で直前に走った
 *    トランザクションの値が残っていないことを、プールの実装に依存せず確定させるため。
 */
export function systemScopeSettingsSql(): Prisma.Sql {
  return Prisma.sql`SELECT
    set_config('app.tenant_id', '', true),
    set_config('app.partner_company_id', '', true),
    set_config('app.actor_user_id', '', true),
    set_config('app.shared_scope', 'off', true),
    set_config('app.auth_email', '', true),
    set_config('app.invitation_token_hash', '', true),
    set_config('app.password_reset_token_hash', '', true)`;
}

/**
 * 行由来コンテキスト（docs/05 §4.4.2）の第 1 段。資格情報だけを設定し、テナント文脈は空にする。
 *
 * 🔴 3 種類のうち 1 つだけに値が入り、残りは空文字で上書きされる。
 * 🔴 `app.tenant_id` が空 = `app_tenant_id()` が NULL のときにしか、対応する追加 SELECT ポリシーは
 *    真にならない（migration 20260903050000 の §12）。逆に言えば、通常の `withTenant` 文脈から
 *    この経路のポリシーが効くことはない。
 */
export type RowCredential =
  | { readonly kind: 'AUTH_EMAIL'; readonly value: string }
  | { readonly kind: 'INVITATION_TOKEN_HASH'; readonly value: string }
  | { readonly kind: 'PASSWORD_RESET_TOKEN_HASH'; readonly value: string };

export function rowCredentialScopeSql(credential: RowCredential): Prisma.Sql {
  const authEmail = credential.kind === 'AUTH_EMAIL' ? credential.value : '';
  const invitationTokenHash = credential.kind === 'INVITATION_TOKEN_HASH' ? credential.value : '';
  const passwordResetTokenHash =
    credential.kind === 'PASSWORD_RESET_TOKEN_HASH' ? credential.value : '';
  return Prisma.sql`SELECT
    set_config('app.tenant_id', '', true),
    set_config('app.partner_company_id', '', true),
    set_config('app.actor_user_id', '', true),
    set_config('app.shared_scope', 'off', true),
    set_config('app.auth_email', ${authEmail}, true),
    set_config('app.invitation_token_hash', ${invitationTokenHash}, true),
    set_config('app.password_reset_token_hash', ${passwordResetTokenHash}, true)`;
}

/**
 * 行由来コンテキスト（docs/05 §4.4.2）の第 2 段。
 * **読み出した行の値**でテナント文脈を立て直し、資格情報の GUC を消す。
 *
 * 🔴 分離キーはリクエスト入力ではなく DB の行から来る（CLAUDE.md §3.1）。
 *    この関数は引数の出どころを型で強制できないため、呼び出し元は `row-context.ts` の
 *    3 関数だけに限る（同ファイル冒頭のコメント参照）。
 */
/**
 * 🔴 管理平面の認証経路（T-03-07。`packages/db/src/platform-auth.ts` 専用）が発行する設定。
 *
 * 主平面の `rowCredentialScopeSql` / `rowDerivedTenantScopeSql` と同じ 2 段構えである:
 *   - 第 1 段（`kind: 'EMAIL'`）: メールアドレスの完全一致で `platform_users` を 1 行だけ可視にする
 *   - 第 2 段（`kind: 'SUBJECT'`）: **読み出した行 / セッション Cookie 由来の主体 ID**で、
 *     本人の `platform_users` / `two_factor_credentials` / `audit_logs` だけを可視にする
 *
 * 🔴 `app.platform_user_id` を**空で上書きする**。この GUC は T-03-08 の
 *    `withPlatformRead` / `withPlatformWrite` が使うものであり、認証トランザクションの中で
 *    `tenants` / `invitations` / `tenant_sending_domains` の provisioning ポリシーが
 *    1 つも真にならないことを、コードではなく設定値で保証する。
 * 🔴 主平面のテナント GUC（`app.tenant_id` ほか）も空で上書きする。管理平面の接続は
 *    `app_platform_write` ロールであり主平面のポリシーは適用されないが、同じ物理接続の
 *    直前のトランザクションの値が残らないことをプールの実装に依存せず確定させる。
 */
export type PlatformAuthCredential =
  | { readonly kind: 'EMAIL'; readonly value: string }
  | { readonly kind: 'SUBJECT'; readonly value: string };

export function platformAuthScopeSql(credential: PlatformAuthCredential): Prisma.Sql {
  const email = credential.kind === 'EMAIL' ? credential.value : '';
  const subjectId = credential.kind === 'SUBJECT' ? credential.value : '';
  return Prisma.sql`SELECT
    set_config('app.tenant_id', '', true),
    set_config('app.partner_company_id', '', true),
    set_config('app.actor_user_id', '', true),
    set_config('app.shared_scope', 'off', true),
    set_config('app.platform_user_id', '', true),
    set_config('app.target_tenant_id', '', true),
    set_config('app.platform_auth_email', ${email}, true),
    set_config('app.platform_auth_subject_id', ${subjectId}, true)`;
}

/**
 * 🔴 管理平面の分離バイパス（T-03-08。`packages/db/src/platform.ts` 専用）が発行する設定。
 *    docs/05 §5.3 の SQL をそのまま表す。
 *
 * ```
 * SET LOCAL app.platform_user_id      = $1;
 * SET LOCAL app.target_tenant_id      = $2;   -- 🔴 横断は ''
 * SET LOCAL app.platform_auth_email       = '';  -- 🔴 空で上書き
 * SET LOCAL app.platform_auth_subject_id  = '';  -- 🔴 空で上書き
 * ```
 *
 * 🔴 `app.platform_auth_email` / `app.platform_auth_subject_id` を**空で上書きする**（§5.3 の注記）。
 *    `platform-auth.ts` が `app.platform_user_id` を空で上書きするのと対称の担保であり、
 *    これにより認証専用ポリシー（`platform_users_auth_self_select` /
 *    `two_factor_credentials_platform_auth_*`）が管理平面の通常操作の接続で誤って真にならない。
 *    「同じ物理接続で直前に走ったトランザクションの値が残っていないこと」を、
 *    プールの実装に依存せず確定させる（§4.3 実装の規約 1 と同じ方針）。
 * 🔴 主平面のテナント GUC も空で上書きする（同じ理由）。
 */
export type PlatformScopeSettings = {
  readonly platformUserId: string;
  /** 🔴 横断（`F-058` の監査ログ横断検索・`F-059` の集計）は `null`。空文字で設定される。 */
  readonly targetTenantId: string | null;
};

export function platformScopeSql(scope: PlatformScopeSettings): Prisma.Sql {
  return Prisma.sql`SELECT
    set_config('app.platform_user_id', ${scope.platformUserId}, true),
    set_config('app.target_tenant_id', ${scope.targetTenantId ?? ''}, true),
    set_config('app.platform_auth_email', '', true),
    set_config('app.platform_auth_subject_id', '', true),
    set_config('app.tenant_id', '', true),
    set_config('app.partner_company_id', '', true),
    set_config('app.actor_user_id', '', true),
    set_config('app.shared_scope', 'off', true)`;
}

export function rowDerivedTenantScopeSql(scope: TenantScopeSettings): Prisma.Sql {
  return Prisma.sql`SELECT
    set_config('app.tenant_id', ${scope.tenantId}, true),
    set_config('app.partner_company_id', ${scope.partnerCompanyId ?? ''}, true),
    set_config('app.actor_user_id', ${scope.actorUserId}, true),
    set_config('app.shared_scope', 'off', true),
    set_config('app.auth_email', '', true),
    set_config('app.invitation_token_hash', '', true),
    set_config('app.password_reset_token_hash', '', true)`;
}
