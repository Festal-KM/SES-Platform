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
