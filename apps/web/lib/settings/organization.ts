// apps/web/lib/settings/organization.ts
// docs/05 §6.3 #64 `GET/PATCH /api/settings/organization`（`F-001` / `F-021` / `S-035`）。T-03-10。
//
// 🔴 `lifecycleState` は**読み取り専用**である（docs/05 §6.3 #64）。
//    テナント側のどのロール（`OWNER` を含む）からも変更できない（`CLAUDE.md` §4.2 /
//    docs/02 章 5.4「テナント側のロールはこの状態を変更できない」）。担保は 3 枚:
//      ① Zod スキーマに `lifecycleState` のキーが無い（`schemas.ts`）
//      ② 本モジュールが `data` に載せる列を 3 つに固定している（下記）
//      ③ 🔴 **DB の列レベル `GRANT`**（migration 20260905000000）。`app_tenant` は
//         `name` / `auto_approve_enabled` / `pii_retention_years` の 3 列しか `UPDATE` できず、
//         ①②が緩んでも `permission denied` になる（**これが主たる担保**）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストが
//    サーバを立てずに同じ経路を実行できるようにするため（`invitations/service.ts` と同じ方針）。
import { withTenant, type AuthenticatedTenantCtx, type TenantLifecycleState } from '@ses/db';
import { NotFoundError } from '../api/errors';

/** `#64` の応答（docs/05 §6.3 #64）。 */
export type OrganizationSettingsView = {
  readonly name: string;
  /** テナントの種別（`production` / `sandbox` / `demo`）。🔴 変更不可（開設時にしか書けない）。 */
  readonly environment: string;
  /** 🔴 読み取り専用（PATCH の body に持たない）。 */
  readonly lifecycleState: TenantLifecycleState;
  readonly autoApproveEnabled: boolean;
  readonly piiRetentionYears: number;
  readonly timezone: string;
};

/** `PATCH` で変更できる項目（docs/05 §6.3 #64 の body）。**この 3 つがすべてである。** */
export type OrganizationSettingsPatch = {
  readonly name?: string;
  readonly autoApproveEnabled?: boolean;
  readonly piiRetentionYears?: number;
};

const SELECT = {
  name: true,
  environment: true,
  lifecycleState: true,
  autoApproveEnabled: true,
  piiRetentionYears: true,
  timezone: true,
} as const;

type TenantSettingsRow = {
  readonly name: string;
  readonly environment: string;
  readonly lifecycleState: string;
  readonly autoApproveEnabled: boolean;
  readonly piiRetentionYears: number;
  readonly timezone: string;
};

function toView(row: TenantSettingsRow): OrganizationSettingsView {
  return {
    name: row.name,
    environment: row.environment,
    lifecycleState: row.lifecycleState as TenantLifecycleState,
    autoApproveEnabled: row.autoApproveEnabled,
    piiRetentionYears: row.piiRetentionYears,
    timezone: row.timezone,
  };
}

/**
 * `GET /api/settings/organization`（#64）。
 *
 * 🔴 `findFirst` を使う（`findUnique` ではない）。第 2 防御（Prisma 拡張）は `where` に
 *    テナントスコープを `AND` で注入するため、一意条件しか受け付けない `findUnique` とは
 *    形が合わない。**絞り込みは ctx 由来のスコープが行う**（アプリが `id` を書かない）。
 */
export async function readOrganizationSettings(
  ctx: AuthenticatedTenantCtx,
): Promise<OrganizationSettingsView> {
  const row = await withTenant(ctx, (db) => db.tenant.findFirst({ select: SELECT }));
  // 🔴 自テナントの行が見えないことは通常あり得ない（RLS が 1 行に閉じている）。
  //    0 件を既定値で埋めず 404 にする（黙って空の設定を見せない）。
  if (row === null) throw new NotFoundError();
  return toView(row);
}

/**
 * `PATCH /api/settings/organization`（#64）。
 *
 * 🔴 `updateMany` を使う（`update` ではない）。理由は `readOrganizationSettings` と同じで、
 *    スコープは注入された `where` が決める。**`where` に `id` を書かない**（書けると、
 *    リクエスト入力から対象を選べる実装への入口になる）。
 * 🔴 監査は `withApiRoute` の `audit` オプション（`tenant.update`）が**ハンドラの前に**書く
 *    （docs/05 §16.1 の `*.update`）。記録に失敗したらこの関数は呼ばれない。
 */
export async function updateOrganizationSettings(
  ctx: AuthenticatedTenantCtx,
  patch: OrganizationSettingsPatch,
): Promise<OrganizationSettingsView> {
  return withTenant(ctx, async (db) => {
    // 🔴 `data` に載せてよい列の**唯一の一覧**。`lifecycleState` はここに現れない。
    const data = {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.autoApproveEnabled === undefined
        ? {}
        : { autoApproveEnabled: patch.autoApproveEnabled }),
      ...(patch.piiRetentionYears === undefined
        ? {}
        : { piiRetentionYears: patch.piiRetentionYears }),
    };

    if (Object.keys(data).length > 0) {
      const updated = await db.tenant.updateMany({ data });
      if (updated.count !== 1) throw new NotFoundError();
    }

    const row = await db.tenant.findFirst({ select: SELECT });
    if (row === null) throw new NotFoundError();
    return toView(row);
  });
}
