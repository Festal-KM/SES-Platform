// packages/db/src/tenant-purge.ts
// 🔴 `CLOSING → PURGED` の削除の実行（docs/05 §9.7 `tenant.purge` / docs/02 `F-064 AC-1`〜`AC-4` / `CLAUDE.md` §4.2 `Tenant`）。T-10-09。
//
// ============================================================================
// 🔴 このファイルの位置づけ
// ============================================================================
//   - **何を消すか**は `packages/config` の `PURGE_SPEC` が唯一の出所である。ここは spec を SQL に写すだけで、表名・列名・
//     消去値を 1 つも独自に持たない（`buildPurgeStatements` は純粋関数。ユニットテストが SQL の形を固定する）。
//   - **どこまで届くか**は削除スコープ（`app.purge_scope = 'on'`。migration 20260927000000 ④）が決める。ジョブのホスト文脈は
//     C3 OWNER_SCOPED の取引先所有行を見られないため、この GUC が無いと取引先エンジニアの連絡先が `PURGED` 後に残る。
//     GUC を立てるのは `withPurgeScope`（本ファイル）だけであり、`index.ts` から export しない。
//   - **順序**は ①S3 の `DeleteObject`（`listPurgeObjectKeys` → 呼び出し側〔ワーカー〕が消す）→ ②DB の列の消去（`applyPurgeSpec`）
//     → ③`CLOSING → PURGED`（`completeTenantPurge` = `transition()` + `app_complete_tenant_purge()`）。①が失敗したら②に進まない
//     のは呼び出し側（`apps/worker/src/jobs/tenant-purge.ts`）の責務で、ここは各段を関数として分けて提供する。
//   - 🔴 **配送確認（`readClosingNoticeDelivery`）はここに無い。** 呼び出し側が開始時に再評価する（`tenant.purge-scan` と同じ 1 関数）。
//
// 🔴 `retention.delete`（`F-046`。Phase 2）も `PURGE_SPEC` を読むが、**1 エンジニア分に絞る述語**はこの spec に無い（T-10-09 の申し送り）。

import { Prisma } from '@prisma/client';
import {
  isPurgeRowsSpec,
  PURGE_SPEC,
  purgeColumnErasure,
  purgeColumnName,
  type PurgeDeleteSpec,
  type PurgeErasure,
} from '@ses/config';
import { tenantIdFromObjectKey, tenantMachine, type TenantLifecycleState } from '@ses/domain';
import { writeAuditLog } from './audit.js';
import { getBaseClient } from './client.js';
import type { AuthenticatedTenantCtx, SystemTenantCtx } from './context.js';
import { tenantScopeExtension } from './extension.js';
import { purgeScopeSettingsSql, type TenantScopeSettings } from './scope-settings.js';
import type { TenantPurgeStatus } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction, type TenantTransactionClient } from './with-tenant.js';

/** docs/05 §16.1 の `tenant.purge`（`actorKind='SYSTEM'`。件数と対象種別のみ）。 */
export const TENANT_PURGE_AUDIT_ACTION = 'tenant.purge';
export const TENANT_PURGE_CAUSE = 'TENANT_PURGED';

// ---------------------------------------------------------------------------
// spec → SQL（純粋。`Prisma.Sql` を組むだけで DB に触れない）
// ---------------------------------------------------------------------------

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

/** 🔴 識別子は `PURGE_SPEC` の定数だけが来る。形を検査してから `Prisma.raw` で埋める（`"` で囲む）。 */
function identifier(name: string): Prisma.Sql {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`tenant-purge: 不正な識別子です（${name}）。PURGE_SPEC の表名・列名は snake_case でなければなりません。`);
  }
  return Prisma.raw(`"${name}"`);
}

/** 消去後の値（`PurgeErasure`）を SQL 式に写す。NULL 化は `null`。 */
function erasedValueSql(erase: PurgeErasure | null): Prisma.Sql {
  switch (erase) {
    case null:
      return Prisma.sql`NULL`;
    case 'EMPTY_TEXT':
      return Prisma.sql`''`;
    case 'EMPTY_JSON_ARRAY':
      return Prisma.sql`'[]'::jsonb`;
    case 'EMPTY_JSON_OBJECT':
      return Prisma.sql`'{}'::jsonb`;
    case 'ROW_ID_TOKEN':
      return Prisma.sql`'purged:' || "id"::text`;
  }
}

/** 「まだ消えていない」述語（列 1 つ分）。消去値と同じ形で比較する。 */
function pendingPredicateSql(column: Prisma.Sql, erase: PurgeErasure | null): Prisma.Sql {
  return erase === null ? Prisma.sql`${column} IS NOT NULL` : Prisma.sql`${column} <> ${erasedValueSql(erase)}`;
}

export type PurgeStatements = {
  /** 消去（UPDATE）または行削除（DELETE）。実行結果の件数が `counts[table]` になる。 */
  readonly apply: Prisma.Sql;
  /** 未処理の行数（`S-042` の削除予定と、二重実行の 0 件確認）。 */
  readonly pendingCount: Prisma.Sql;
};

/**
 * 🔴 `PURGE_SPEC.delete` の 1 要素を SQL に写す（純粋）。
 *
 * - 列の消去: `UPDATE t SET c1 = NULL, c2 = '' [, purged_at = $now] WHERE tenant_id = $tenant AND (<未処理述語>)`
 *   未処理述語は `purgedAtColumn` があれば `purged_at IS NULL`、無ければ各列の `IS NOT NULL` / `<> 消去値` の OR。
 *   これにより**再実行は 0 件**になる（冪等）。
 * - 行の削除: `DELETE FROM t WHERE tenant_id = $tenant`。
 * 🔴 `tenant_id = $tenant` を SQL にも書く（RLS が絞るが、意図を SQL に残す。`tenant-closing-notice.ts` と同じ）。
 */
export function buildPurgeStatements(spec: PurgeDeleteSpec, tenantId: string, now: Date): PurgeStatements {
  const table = identifier(spec.table);
  const tenantPredicate = Prisma.sql`"tenant_id" = ${tenantId}::uuid`;
  if (isPurgeRowsSpec(spec)) {
    return {
      apply: Prisma.sql`DELETE FROM ${table} WHERE ${tenantPredicate}`,
      pendingCount: Prisma.sql`SELECT count(*)::int AS count FROM ${table} WHERE ${tenantPredicate}`,
    };
  }
  if (spec.columns.length === 0) {
    throw new Error(`tenant-purge: ${spec.table} の消去列が空です（PURGE_SPEC）。`);
  }
  const assignments = spec.columns.map(
    (column) => Prisma.sql`${identifier(purgeColumnName(column))} = ${erasedValueSql(purgeColumnErasure(column))}`,
  );
  if (spec.purgedAtColumn !== undefined) {
    assignments.push(Prisma.sql`${identifier(spec.purgedAtColumn)} = ${now}`);
  }
  const pending =
    spec.purgedAtColumn !== undefined
      ? Prisma.sql`${identifier(spec.purgedAtColumn)} IS NULL`
      : Prisma.join(
          spec.columns.map((column) =>
            pendingPredicateSql(identifier(purgeColumnName(column)), purgeColumnErasure(column)),
          ),
          ' OR ',
        );
  return {
    apply: Prisma.sql`UPDATE ${table} SET ${Prisma.join(assignments, ', ')} WHERE ${tenantPredicate} AND (${pending})`,
    pendingCount: Prisma.sql`SELECT count(*)::int AS count FROM ${table} WHERE ${tenantPredicate} AND (${pending})`,
  };
}

// ---------------------------------------------------------------------------
// 削除スコープのトランザクション（🔴 `app.purge_scope = 'on'` を立てる唯一の場所）
// ---------------------------------------------------------------------------

function scopeOf(ctx: SystemTenantCtx): TenantScopeSettings {
  return { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId };
}

/**
 * 🔴 削除スコープでトランザクションを開く。**ジョブ文脈（`SystemTenantCtx`）でしか開けない**（型）。
 *    `index.ts` から export しない。呼び出し元は本ファイルの 4 関数（`listPurgeObjectKeys` / `applyPurgeSpec` /
 *    `countPurgePending` / `completeTenantPurge`）だけである（`tests/static/purge-scope-single-path.test.ts` が
 *    `purgeScopeSettingsSql` の呼び出し元をこのファイルに固定し、`tests/static/auth-db-callers.test.ts` が 4 関数の
 *    `apps/**` からの呼び出し元を固定する）。
 */
async function withPurgeScope<T>(ctx: SystemTenantCtx, fn: (tx: TenantTransactionClient) => Promise<T>): Promise<T> {
  const scope = scopeOf(ctx);
  const scoped = getBaseClient().$extends(
    tenantScopeExtension({ tenantId: scope.tenantId, partnerCompanyId: scope.partnerCompanyId }),
  );
  return scoped.$transaction(async (tx) => {
    await tx.$queryRaw(purgeScopeSettingsSql(scope));
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// TenantPurgeRun（開始 CAS / 完了 / 失敗）
// ---------------------------------------------------------------------------

export type TenantPurgeRunStart =
  | { readonly kind: 'STARTED'; readonly runId: string }
  /** 同一テナントに `RUNNING` がある（部分一意索引 `tenant_purge_runs_one_running_idx`）。何もしない。 */
  | { readonly kind: 'ALREADY_RUNNING' }
  /** すでに `COMPLETED` がある = 削除済み。何もしない。 */
  | { readonly kind: 'ALREADY_COMPLETED' };

/** `TenantPurgeRun(cause='TENANT_PURGED')` に `COMPLETED` があるか（`tenant.purge-scan` の「未処理」判定）。 */
export async function hasCompletedTenantPurge(ctx: SystemTenantCtx): Promise<boolean> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const count = await tx.tenantPurgeRun.count({
      where: { tenantId: ctx.tenantId, cause: TENANT_PURGE_CAUSE, status: 'COMPLETED' },
    });
    return count > 0;
  });
}

/**
 * 🔴 `TenantPurgeRun(cause='TENANT_PURGED', status='RUNNING')` を CAS で作る。
 *    先に `COMPLETED` / `RUNNING` を読んで区別し、INSERT は部分一意索引が最後の防御線（並行の 2 本目は例外 → `ALREADY_RUNNING`）。
 */
export async function startTenantPurgeRun(ctx: SystemTenantCtx, now: Date): Promise<TenantPurgeRunStart> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const existing = await tx.tenantPurgeRun.findMany({
      where: { tenantId: ctx.tenantId, cause: TENANT_PURGE_CAUSE, status: { in: ['RUNNING', 'COMPLETED'] } },
      select: { status: true },
    });
    if (existing.some((row) => row.status === 'COMPLETED')) return { kind: 'ALREADY_COMPLETED' };
    if (existing.some((row) => row.status === 'RUNNING')) return { kind: 'ALREADY_RUNNING' };
    const runId = uuidV7(now);
    try {
      await tx.tenantPurgeRun.create({
        data: { id: runId, tenantId: ctx.tenantId, cause: TENANT_PURGE_CAUSE, status: 'RUNNING', startedAt: now, counts: {} },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { kind: 'ALREADY_RUNNING' };
      }
      throw error;
    }
    return { kind: 'STARTED', runId };
  });
}

export type TenantPurgeCounts = Readonly<Record<string, number>>;

/**
 * 🔴 `PURGED` の失敗理由（`TenantPurgeRun.failure_reason`）。**自由文を書かない** —— 短い列挙値 + 例外クラス名だけ
 *    （`A-005` 項目 7 は `failure_reason` を返さないが、列に PII や S3 のキーが入る経路をそもそも作らない）。
 */
export type TenantPurgeFailureStage = 'OBJECT_DELETE' | 'COLUMN_ERASE' | 'STATE_TRANSITION' | 'UNKNOWN';

export function tenantPurgeFailureReason(stage: TenantPurgeFailureStage, error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return `${stage}:${name}`;
}

export type TenantPurgeRunFinish =
  | { readonly status: 'COMPLETED'; readonly counts: TenantPurgeCounts; readonly completedAt: Date }
  | { readonly status: 'FAILED'; readonly failureReason: string; readonly completedAt: Date };

/**
 * `TenantPurgeRun` を確定させる（`RUNNING` からの CAS。0 件なら例外 = 誰かが先に確定させた）。
 * `COMPLETED` のときは同じトランザクションで `AuditLog(tenant.purge)` を書く（`F-064 AC-8`。件数と種別のみ）。
 */
export async function finishTenantPurgeRun(ctx: SystemTenantCtx, runId: string, finish: TenantPurgeRunFinish): Promise<void> {
  await runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const status: TenantPurgeStatus = finish.status;
    const updated = await tx.tenantPurgeRun.updateMany({
      where: { id: runId, tenantId: ctx.tenantId, status: 'RUNNING' },
      data:
        finish.status === 'COMPLETED'
          ? { status, completedAt: finish.completedAt, counts: finish.counts, failureReason: null }
          : { status, completedAt: finish.completedAt, failureReason: finish.failureReason },
    });
    if (updated.count !== 1) {
      throw new Error(`tenant-purge: TenantPurgeRun(${runId}) を RUNNING から ${status} に確定できませんでした。`);
    }
    if (finish.status === 'COMPLETED') {
      await writeAuditLog(tx, {
        action: TENANT_PURGE_AUDIT_ACTION,
        actorKind: 'SYSTEM',
        actorId: null,
        targetType: 'Tenant',
        targetId: ctx.tenantId,
        summary: {
          cause: TENANT_PURGE_CAUSE,
          runId,
          tables: Object.keys(finish.counts).length,
          ...Object.fromEntries(Object.entries(finish.counts).map(([table, count]) => [`count_${table}`, count])),
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// ① S3 のキー列挙 → ② 列の消去 → ③ 状態遷移
// ---------------------------------------------------------------------------

export type PurgeObjectTarget = {
  readonly table: string;
  readonly column: string;
  readonly key: string;
};

/**
 * 🔴 自テナントのプレフィックス（`t/{tenantId}/…`）でなかった値の**出所だけ**（値を載せない —— 他テナントのキーや
 *    参照 ID を `TenantPurgeRun` / ログ / 監査に運ばない）。
 */
export type PurgeObjectSkipped = {
  readonly table: string;
  readonly column: string;
};

export type PurgeObjectKeyListing = {
  /** `ObjectStore.delete` に渡してよいキー（全件が `t/{ctx.tenantId}/…`）。 */
  readonly targets: readonly PurgeObjectTarget[];
  /** 削除しに行かなかった値の出所。0 件が正常であり、1 件でもあれば `PURGE_SPEC` の `objectKeyColumns` の宣言が誤っている。 */
  readonly skipped: readonly PurgeObjectSkipped[];
};

/**
 * 🔴 fail-closed の振り分け（純粋。`listPurgeObjectKeys` が DB から読んだ値に適用する）。
 *    `tenantIdFromObjectKey(key) === tenantId` のものだけを `targets` に入れ、それ以外（他テナントのプレフィックス / UUID 等の
 *    参照 ID / 形の合わない値）は `skipped` に出所だけを残す。**S3 側の二重防御**である —— RLS と `WHERE tenant_id` で行は
 *    自テナントに絞られているが、列の**値**が他テナントのキーを指していても `DeleteObject` を発行しない。
 */
export function partitionPurgeObjectKeys(
  tenantId: string,
  rows: readonly PurgeObjectTarget[],
): PurgeObjectKeyListing {
  const targets: PurgeObjectTarget[] = [];
  const skipped: PurgeObjectSkipped[] = [];
  for (const row of rows) {
    if (tenantIdFromObjectKey(row.key) === tenantId) targets.push(row);
    else skipped.push({ table: row.table, column: row.column });
  }
  return { targets, skipped };
}

/**
 * ① `PURGE_SPEC.delete` の `objectKeyColumns` からオブジェクトキーを列挙する（削除スコープ = 取引先所有の行も含む）。
 *    呼び出し側（ワーカー）が `targets` を 1 件ずつ `ObjectStore.delete` する。**ここでは消さない**（`packages/db` はコネクタに
 *    依存しない）。自テナントのプレフィックスでない値は `skipped`（`partitionPurgeObjectKeys`）。
 */
export async function listPurgeObjectKeys(ctx: SystemTenantCtx): Promise<PurgeObjectKeyListing> {
  return withPurgeScope(ctx, async (tx) => {
    const rows: PurgeObjectTarget[] = [];
    for (const spec of PURGE_SPEC.delete as readonly PurgeDeleteSpec[]) {
      if (isPurgeRowsSpec(spec) || spec.objectKeyColumns === undefined) continue;
      for (const column of spec.objectKeyColumns) {
        const found = await tx.$queryRaw<{ key: string }[]>(Prisma.sql`
          SELECT ${identifier(column)} AS key FROM ${identifier(spec.table)}
           WHERE "tenant_id" = ${ctx.tenantId}::uuid AND ${identifier(column)} IS NOT NULL
           ORDER BY 1`);
        for (const row of found) rows.push({ table: spec.table, column, key: row.key });
      }
    }
    return partitionPurgeObjectKeys(ctx.tenantId, rows);
  });
}

/**
 * ② 🔴 `PURGE_SPEC.delete` の全要素を **1 トランザクション**で適用する（削除スコープ）。
 *    戻り値は表 → この実行で消した行数。**キー集合は `PURGE_SPEC.delete` の表と一致する**（`F-064 AC-3`。0 件の表も載る）。
 *    再実行は未処理述語により 0 件になる（冪等）。
 */
export async function applyPurgeSpec(ctx: SystemTenantCtx, now: Date): Promise<TenantPurgeCounts> {
  return withPurgeScope(ctx, async (tx) => {
    const counts: Record<string, number> = {};
    for (const spec of PURGE_SPEC.delete) {
      const statements = buildPurgeStatements(spec, ctx.tenantId, now);
      counts[spec.table] = await tx.$executeRaw(statements.apply);
    }
    return counts;
  });
}

/** 未処理の行数（表ごと。`S-042` の削除予定の件数と、結合テストの「消えた」確認）。 */
export async function countPurgePending(ctx: SystemTenantCtx, now: Date): Promise<TenantPurgeCounts> {
  return withPurgeScope(ctx, async (tx) => {
    const counts: Record<string, number> = {};
    for (const spec of PURGE_SPEC.delete) {
      const statements = buildPurgeStatements(spec, ctx.tenantId, now);
      const rows = await tx.$queryRaw<{ count: number }[]>(statements.pendingCount);
      counts[spec.table] = rows[0]?.count ?? 0;
    }
    return counts;
  });
}

/**
 * 🔴 利用者（`OWNER` / `ADMIN`）に見せる削除予定の件数（`S-042` セクション 2）。**通常のテナント文脈**（RLS C3）で数える。
 *    削除スコープでは数えない —— ホストに取引先所有の行数を見せると、それ自体が取引先の台帳の規模の開示になる
 *    （`BR-06` / `CLAUDE.md` §3.1）。したがってここに出るのは「その利用者に見える範囲」の件数である。
 */
export async function countVisiblePurgeTargets(ctx: AuthenticatedTenantCtx, now: Date): Promise<TenantPurgeCounts> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const counts: Record<string, number> = {};
      for (const spec of PURGE_SPEC.delete) {
        const statements = buildPurgeStatements(spec, ctx.tenantId, now);
        const rows = await tx.$queryRaw<{ count: number }[]>(statements.pendingCount);
        counts[spec.table] = rows[0]?.count ?? 0;
      }
      return counts;
    },
  );
}

export type TenantPurgeTransition =
  | { readonly kind: 'PURGED' }
  /** CAS が 0 件（読んだ後に状態が変わった）。呼び出し側は失敗として扱う。 */
  | { readonly kind: 'CAS_FAILED'; readonly lifecycleState: TenantLifecycleState };

/**
 * ③ 🔴 `CLOSING → PURGED`。遷移表（`tenantMachine.transition`）で検査してから `app_complete_tenant_purge()`（SECURITY DEFINER）
 *    を呼ぶ。`PURGED` は終端であり、ここ以外に `tenants.lifecycle_state` をジョブから書く経路は無い。
 *    表に無い遷移（`PURGED → PURGED` 等）は `InvalidStateTransitionError`（API 境界では 422）。
 */
export async function completeTenantPurge(ctx: SystemTenantCtx): Promise<TenantPurgeTransition> {
  return withPurgeScope(ctx, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { lifecycleState: true } });
    if (tenant === null) throw new Error('tenant-purge: テナント行を読めませんでした（ジョブ文脈が不正です）。');
    const from = tenant.lifecycleState;
    if (!tenantMachine.isState(from)) throw new Error(`tenant-purge: 不明な契約状態です（${from}）。`);
    // 🔴 遷移表の検査はここ 1 箇所。`CLOSING` 以外からは例外（`F-064 AC-4`）。
    tenantMachine.transition(from as 'CLOSING', 'PURGED');
    const rows = await tx.$queryRaw<{ ok: boolean }[]>(Prisma.sql`SELECT app_complete_tenant_purge() AS ok`);
    if (rows[0]?.ok === true) return { kind: 'PURGED' };
    return { kind: 'CAS_FAILED', lifecycleState: from };
  });
}
