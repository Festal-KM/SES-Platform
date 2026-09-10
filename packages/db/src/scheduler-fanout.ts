// packages/db/src/scheduler-fanout.ts
// 🔴 スケジュールジョブのテナントファンアウトの母集団（docs/05 §9.1 / §4.4.2）。T-07-11。
//
// ============================================================================
// 🔴 この 1 関数が「テナント文脈を持たずに tenants を読む」唯一の経路である
// ============================================================================
// docs/05 §9.1 は「payload に `tenantId` を必ず含め、ハンドラ冒頭で `withTenant` の ctx を
// 組み立てる」と定める。ジョブ本体はテナント文脈に閉じるので RLS が効くが、**その手前の
// 「どのテナントへ配るか」だけはテナント文脈を持てない**（どのテナントかを決める処理だから）。
//
// 🔴 採った形は §4.5 / §4.4.1 / §8.5 と同型（専用ロール + SECURITY DEFINER + 列レベル GRANT）:
//   - `app_scheduler_probe`（NOLOGIN / NOBYPASSRLS）が `tenants(id, lifecycle_state)` の 2 列だけを読む
//   - 関数 `app_list_scheduler_tenants()` は **`setof uuid`** を返す（名前も環境も返らない）
//   - 呼び出しには `app.scheduler_scope='on'` と `app_tenant_id() IS NULL` の**両方**が要る
//     （どちらが欠けても例外。migration 20260915000000）
// 🔴 母集団の条件（`SANDBOX` / `ACTIVE` だけ）は **SQL 関数の中**にある。ここに `where` を
//    書き足さないこと —— 条件が 2 箇所に分かれると、片方だけが更新されて「停止中テナントに
//    配り続ける」状態が静かに残る（判断の記録は migration の判断事項 3 と docs/05 §9.1）。
//
// 🔴 呼び出し元は `apps/worker/src/runtime.ts`（スケジュールの配線）1 箇所である
//    （`tests/static/auth-db-callers.test.ts` が固定する）。

import { Prisma } from '@prisma/client';
import { getBaseClient } from './client.js';

/**
 * ファンアウト用の GUC。
 *
 * 🔴 `systemScopeSettingsSql()` を流用せず専用の 1 文にしている理由: あちらは
 *    「C0 SYSTEM_ONLY の 4 表だけを見せる」ための設定であり、`app.scheduler_scope` を
 *    足すと `withSystemScope`（Webhook 受信も通る）から本関数が呼べるようになる。
 *    **スケジューラの経路だけ**が立てる GUC にしておく。
 */
function schedulerScopeSettingsSql(): Prisma.Sql {
  return Prisma.sql`SELECT
    set_config('app.tenant_id', '', true),
    set_config('app.partner_company_id', '', true),
    set_config('app.actor_user_id', '', true),
    set_config('app.shared_scope', 'off', true),
    set_config('app.scheduler_scope', 'on', true)`;
}

/**
 * 🔴 スケジュールジョブを配るテナントの ID（`SANDBOX` / `ACTIVE` のみ。docs/05 §9.1）。
 *
 * 🔴 返すのは ID だけである。ジョブ側はこの ID から `systemTenantCtx` を組み立て、以降は
 *    通常の RLS の下で動く（テナント境界はそこで課される）。
 */
export async function listSchedulerFanoutTenants(): Promise<readonly string[]> {
  return getBaseClient().$transaction(async (tx) => {
    await tx.$queryRaw(schedulerScopeSettingsSql());
    const rows = await tx.$queryRaw<Array<{ tenant_id: string }>>(
      Prisma.sql`SELECT app_list_scheduler_tenants() AS tenant_id`,
    );
    return rows.map((row) => row.tenant_id);
  });
}
