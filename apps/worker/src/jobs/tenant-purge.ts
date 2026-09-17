// apps/worker/src/jobs/tenant-purge.ts
// 🔴 `tenant.purge`（イベント。`attempts: 3`。docs/05 §9.7 / `docs/02` `F-064 AC-1`〜`AC-4` / `AC-8` / `AC-10` / `CLAUDE.md` §4.2 `Tenant`）。T-10-09。
//
// ============================================================================
// 🔴 手順（この順序が設計の要。docs/05 §9.7 / `docs/03` §4.12）
// ============================================================================
//   ⓪ 🔴 **配送確認の再評価** … `readClosingNoticeDelivery`（`tenant.purge-scan` と**同じ 1 関数**）。偽なら**何もせず正常終了**
//      （二重の確認。直接 enqueue しても配送未確認なら no-op。`F-064 AC-10`）。別の判定式を書かない。
//   ① `TenantPurgeRun(cause='TENANT_PURGED', status='RUNNING')` を CAS で作る（同一テナントに `RUNNING` / `COMPLETED` があれば no-op）。
//   ② 🔴 **S3 の `DeleteObject`** … `PURGE_SPEC.delete` の `objectKeyColumns`（スキルシート原本・添付・契約書・返却 ZIP）を 1 件ずつ。
//      失敗したら③に進まない（実体が残っているのに DB だけ消えると、実体を二度と辿れない）。`listPurgeObjectKeys` は自テナントの
//      プレフィックス（`t/{tenantId}/…`）でない値を `skipped` に分けて返し、ここはそれを**削除しに行かない**（S3 側の二重防御。
//      件数だけを `objectsSkipped` に出す。0 でなければ `PURGE_SPEC` の `objectKeyColumns` の宣言が誤っている）。
//   ③ **DB の列の消去 / 行の削除** … `applyPurgeSpec`（`PURGE_SPEC` が唯一の出所。1 トランザクション）。
//   ④ `CLOSING → PURGED` … `completeTenantPurge`（遷移表 + `app_complete_tenant_purge()` の CAS）。
//   ⑤ `TenantPurgeRun` を `COMPLETED` + `counts`（表ごとの件数。キー集合 = `PURGE_SPEC.delete` の表）+ `AuditLog(tenant.purge)`。
//   失敗は `FAILED` + `failureReason`（段 + 例外クラス名だけ。自由文を書かない）にしてから**例外を投げ直す**（BullMQ の `attempts: 3`
//   が次の試行を積む。再実行は各段が冪等 —— `DeleteObject` は無いキーに対しても成功、③は未処理述語で 0 件、④は CAS）。
//   `FAILED` の確定自体が失敗したら、元の段の例外を失わずに両方を `AggregateError` で投げる（原因の段が BullMQ の失敗記録から消えない）。
//
// 🔴 このジョブは外部へ**送信**しない（S3 の削除だけ）。`PURGED` は終端であり、ここから `ACTIVE` / `CLOSING` へ戻す経路は無い。
import type { AppEnvKind } from '@ses/config';
import type { InternalJobName, ObjectStore } from '@ses/connectors';
import {
  applyPurgeSpec,
  completeTenantPurge,
  finishTenantPurgeRun,
  listPurgeObjectKeys,
  readClosingNoticeDelivery,
  readTenantClosingSchedule,
  startTenantPurgeRun,
  systemTenantCtx,
  tenantPurgeFailureReason,
  type ClosingNoticeDeliveryInput,
  type SystemTenantCtx,
  type TenantPurgeCounts,
  type TenantPurgeFailureStage,
} from '@ses/db';
import type { ClosingNoticeDelivery } from '@ses/domain';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const TENANT_PURGE_JOB = 'tenant.purge' satisfies InternalJobName;

export type TenantPurgePayload = { readonly tenantId: string };

export function parseTenantPurgePayload(raw: unknown): TenantPurgePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(TENANT_PURGE_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(TENANT_PURGE_JOB, 'tenantId', record.tenantId) };
}

export type TenantPurgeDeps = {
  readonly now: () => Date;
  /** 🔴 起動時に解決した `APP_ENV`（`tenant.purge-scan` と同じ値を渡す）。 */
  readonly appEnv: AppEnvKind;
  /** 🔴 `delete` だけ（署名も put も要らない。型で表明する）。 */
  readonly objectStore: Pick<ObjectStore, 'delete'>;
};

export type TenantPurgeOutcome =
  /** 列挙と実行の間に `CLOSING` を離れた。 */
  | { readonly kind: 'NOOP'; readonly reason: 'NOT_CLOSING' }
  /** 🔴 予告が配送済みでない。何もしない（正常終了）。 */
  | { readonly kind: 'NOOP'; readonly reason: 'NOTICE_PENDING'; readonly delivery: ClosingNoticeDelivery }
  | { readonly kind: 'NOOP'; readonly reason: 'ALREADY_RUNNING' | 'ALREADY_COMPLETED' }
  | {
      readonly kind: 'PURGED';
      readonly runId: string;
      readonly counts: TenantPurgeCounts;
      /** S3 から消したオブジェクト数（`counts` には含めない。`counts` のキーは表だけ）。 */
      readonly objectsDeleted: number;
      /**
       * 🔴 自テナントのプレフィックスでないため**削除しに行かなかった**値の数（`listPurgeObjectKeys` の `skipped`）。
       *    0 が正常。値そのものは持たない。
       */
      readonly objectsSkipped: number;
    };

/** 段を持った失敗（`TenantPurgeRun.failure_reason` の材料。原因の例外は `cause`）。 */
export class TenantPurgeStageError extends Error {
  constructor(
    readonly stage: TenantPurgeFailureStage,
    override readonly cause: unknown,
  ) {
    super(`tenant.purge: ${stage} で失敗しました。`);
    this.name = 'TenantPurgeStageError';
  }
}

async function stage<T>(name: TenantPurgeFailureStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new TenantPurgeStageError(name, error);
  }
}

/** 🔴 1 テナント分の削除。 */
export async function purgeTenant(deps: TenantPurgeDeps, ctx: SystemTenantCtx): Promise<TenantPurgeOutcome> {
  const tenant = await readTenantClosingSchedule(ctx);
  if (tenant.lifecycleState !== 'CLOSING') return { kind: 'NOOP', reason: 'NOT_CLOSING' };

  // ⓪ 🔴 二重の配送確認（`tenant.purge-scan` と同じ関数・同じ引数）。
  const deliveryInput: ClosingNoticeDeliveryInput = { appEnv: deps.appEnv };
  const delivery = await readClosingNoticeDelivery(ctx, deliveryInput);
  if (!delivery.delivered) return { kind: 'NOOP', reason: 'NOTICE_PENDING', delivery };

  // ① 実行の予約（CAS）。
  const started = await startTenantPurgeRun(ctx, deps.now());
  if (started.kind !== 'STARTED') return { kind: 'NOOP', reason: started.kind };
  const { runId } = started;

  try {
    // ② S3 → ③ DB → ④ 状態遷移（順序を入れ替えない）。
    const listing = await stage('OBJECT_DELETE', () => listPurgeObjectKeys(ctx));
    await stage('OBJECT_DELETE', async () => {
      // 🔴 `listing.skipped` は消しに行かない（自テナントのプレフィックスでない値に `DeleteObject` を発行しない）。
      for (const target of listing.targets) await deps.objectStore.delete(target.key);
    });
    const counts = await stage('COLUMN_ERASE', () => applyPurgeSpec(ctx, deps.now()));
    await stage('STATE_TRANSITION', async () => {
      const transition = await completeTenantPurge(ctx);
      if (transition.kind !== 'PURGED') {
        throw new Error(`CLOSING → PURGED の CAS が 0 件でした（現在: ${transition.lifecycleState}）。`);
      }
    });
    // ⑤ 確定 + 監査（件数と種別のみ）。
    await finishTenantPurgeRun(ctx, runId, { status: 'COMPLETED', counts, completedAt: deps.now() });
    return { kind: 'PURGED', runId, counts, objectsDeleted: listing.targets.length, objectsSkipped: listing.skipped.length };
  } catch (error) {
    const failure = error instanceof TenantPurgeStageError ? error : new TenantPurgeStageError('UNKNOWN', error);
    try {
      await finishTenantPurgeRun(ctx, runId, {
        status: 'FAILED',
        failureReason: tenantPurgeFailureReason(failure.stage, failure.cause),
        completedAt: deps.now(),
      });
    } catch (finishError) {
      // 🔴 元の段の例外を失わない（`FAILED` の確定失敗だけが残ると、原因の段が分からなくなる）。
      throw new AggregateError([failure, finishError], `tenant.purge: ${failure.stage} で失敗し、FAILED の確定にも失敗しました。`);
    }
    throw failure;
  }
}

export type TenantPurgeHandler = (payload: unknown, jobId: string) => Promise<TenantPurgeOutcome>;

export function createTenantPurgeHandler(deps: TenantPurgeDeps): TenantPurgeHandler {
  return async (payload, jobId) => {
    const job = parseTenantPurgePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: TENANT_PURGE_JOB, jobId });
    return purgeTenant(deps, ctx);
  };
}
