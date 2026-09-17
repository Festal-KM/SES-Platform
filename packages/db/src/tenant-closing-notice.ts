// packages/db/src/tenant-closing-notice.ts
// 🔴 削除予告（`tenant.closing-notify`）の**材料の読み取り**と、🔴 **配送済み判定の 1 関数**
//    （docs/05 §9.7 / `docs/02` `F-064 AC-10` / 章 7.7-④）。T-10-12。
//
// ============================================================================
// 🔴 このファイルの位置づけ
// ============================================================================
//   - 判定の定義は `@ses/domain`（`retention/closing-notice.ts`。純粋関数）にあり、ここは**テナント文脈で材料を読んで
//     渡すだけ**である。`EmailDispatch` を書くのは `email-dispatch.ts` の `reserveEmailDispatch`（唯一の経路）。
//   - 🔴 `readClosingNoticeDelivery` は **`tenant.purge-scan`（enqueue 条件）と `tenant.purge`（開始時の再評価）の両方が
//     呼ぶ 1 関数**である（T-10-09）。2 箇所に別々の判定を書かない（片方だけ緩むと「保留中に削除」が成立する）。
//   - 🔴 `MOCKED` を配送済みとみなすかは**起動時に解決した `APP_ENV`** から `isAllMockEmailEnv`（`packages/config`）で
//     決める。呼び出し側に真偽値を書かせない（`true` をベタ書きした呼び出しが `sandbox` に入ると、届いていない
//     予告を根拠に削除が進む）。
//
// 🔴 `tenants` の読み取りはテナント文脈（RLS C1。`systemTenantCtx` はホスト相当）で行う。`ctx.lifecycleState` は
//    `SystemTenantCtx` では常に `'ACTIVE'` の固定値であり判定に使えない（`context.ts` の注記）—— 行を読む。

import { Prisma } from '@prisma/client';
import { isAllMockEmailEnv, type AppEnvKind } from '@ses/config';
import {
  classifyClosingNoticeDelivery,
  closingNoticeTargetIdPrefix,
  TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
  type ClosingNoticeDelivery,
  type TenantClosingNoticePhase,
  type TenantLifecycleState,
} from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import type { EmailDispatchStatus } from './schema-value-sets.js';
import { runInTenantTransaction } from './with-tenant.js';

/** 予告の材料になる `tenants` の 3 列（名前は本文に載せる。件数・内容は読まない）。 */
export type TenantClosingSchedule = {
  readonly name: string;
  readonly lifecycleState: TenantLifecycleState;
  /** `CLOSING` に入った時刻。`CLOSING` 以外では `null` でありうる。 */
  readonly closingEnteredAt: Date | null;
};

/**
 * 自テナントの契約状態と `CLOSING` に入った時刻を読む。
 *
 * 🔴 RLS で自テナントの行が見えない = ジョブ文脈が壊れている。0 件を「対象外」として成功にしない
 *    （`usage-gap-check.ts` と同じ規律）。
 */
export async function readTenantClosingSchedule(ctx: HostTenantCtx): Promise<TenantClosingSchedule> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { name: true, lifecycleState: true, closingEnteredAt: true },
      });
      if (tenant === null) {
        throw new Error('tenant.closing-notify: テナント行を読めませんでした（ジョブ文脈が不正です）。');
      }
      return {
        name: tenant.name,
        lifecycleState: tenant.lifecycleState as TenantLifecycleState,
        closingEnteredAt: tenant.closingEnteredAt,
      };
    },
  );
}

type StatusRow = { readonly status: string };

/** 自テナントの `TENANT_CLOSING_NOTICE` の行の状態。`prefix` を渡すと `dedupe_key` の `targetId` の接頭辞で絞る。 */
async function readClosingNoticeStatuses(
  ctx: HostTenantCtx,
  prefix: string | null,
): Promise<readonly EmailDispatchStatus[]> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      // 🔴 `LIKE` を使わない: `starts_with` はパターン文字（`%` / `_`）の意味を持たないので、接頭辞に
      //    含まれる値（UUID / 段名）をエスケープする必要が無い。RLS（C2 HOST_ONLY）が自テナントに絞るが、
      //    `tenant_id` も明示して「テナント文脈の外で流用されたら 0 件」ではなく意図を SQL に残す。
      const rows =
        prefix === null
          ? await tx.$queryRaw<StatusRow[]>(Prisma.sql`
              SELECT status FROM email_dispatches
               WHERE tenant_id = ${ctx.tenantId}::uuid
                 AND template_key = ${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}`)
          : await tx.$queryRaw<StatusRow[]>(Prisma.sql`
              SELECT status FROM email_dispatches
               WHERE tenant_id = ${ctx.tenantId}::uuid
                 AND template_key = ${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}
                 AND starts_with(dedupe_key, ${prefix})`);
      return rows.map((row) => row.status as EmailDispatchStatus);
    },
  );
}

/**
 * その段（`ENTERED` / `D7`）の予告行の状態（全起票日ぶん）。
 * 起票側（`tenant.closing-notify`）が「未処理か」を `isClosingNoticePhaseFiled` で判定するための材料。
 */
export async function readClosingNoticePhaseStatuses(
  ctx: HostTenantCtx,
  phase: TenantClosingNoticePhase,
): Promise<readonly EmailDispatchStatus[]> {
  const prefix = `${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}:${closingNoticeTargetIdPrefix({ tenantId: ctx.tenantId, phase })}`;
  return readClosingNoticeStatuses(ctx, prefix);
}

export type ClosingNoticeDeliveryInput = {
  /**
   * 🔴 起動時に解決した `APP_ENV`（`RuntimeConfig.env.APP_ENV`）。`MOCKED` を配送済みとみなすのは
   *    `isAllMockEmailEnv(appEnv)` が真の環境（`development` / `demo`）だけ。`sandbox` / `staging` / `production` では
   *    `MOCKED` を配送済みにしない。
   */
  readonly appEnv: AppEnvKind;
};

/**
 * 🔴 **削除予告が配送済みか**（docs/05 §9.7 `tenant.purge-scan` の enqueue 条件 / `tenant.purge` の開始時の再評価）。
 *
 * `email_dispatches(tenant_id = 自テナント, template_key = 'TENANT_CLOSING_NOTICE')` の状態集合を
 * `classifyClosingNoticeDelivery` に渡す。`delivered` が真になるのは
 *   - `SENT`（全モック環境では `MOCKED` も）が 1 件以上、かつ
 *   - `QUEUED` / `HELD_*` が 0 件
 * のときだけである。🔴 **保留は通知済みではない**（`docs/02` 章 7.7-④）。予告行が 1 件も無ければ偽。
 *
 * 🔴 T-10-09 への契約: `tenant.purge-scan` は `delivered === false` なら enqueue せず次回へ持ち越し、`tenant.purge` は
 *    開始時にもう一度これを呼び `false` なら**何もせず正常終了**する（二重の確認）。
 */
export async function readClosingNoticeDelivery(
  ctx: HostTenantCtx,
  input: ClosingNoticeDeliveryInput,
): Promise<ClosingNoticeDelivery> {
  const statuses = await readClosingNoticeStatuses(ctx, null);
  return classifyClosingNoticeDelivery(statuses, { mockedCountsAsDelivered: isAllMockEmailEnv(input.appEnv) });
}
