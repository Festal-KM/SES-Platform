// packages/db/src/platform/queries/quota-overrides.ts
// 🔴 `PUT /api/admin/tenants/{id}/quota`（docs/05 §6.9 API-A6 の書き込み / docs/02 `F-057` 処理③〜⑤ / `AC-2`〜`AC-4` /
//    `BR-44` / `CLAUDE.md` §10.1 / §10.5「クォータ」）。T-11-02。
//
// ============================================================================
// 🔴 この経路が `CLAUDE.md` §10.5 の read-only 原則に反しない理由
// ============================================================================
// 触れるのは `tenant_quota_overrides` の **INSERT だけ**である（`withPlatformWrite(domain='QUOTA')`。docs/05 §5.2 の 4 表目）。
// §10.5 は「契約・クォータ・機能フラグ・お知らせ」への書き込みを最初から運営者に認めており、本表はその「クォータ」そのものである。
// 越境 5 経路の対象表（エンジニア・案件・提案・チャット・契約）には 1 行も触れず、DB 側も `app_platform_write` に
// この表以外の業務テーブルの権限を GRANT していない（fail-closed）。UPDATE / DELETE は誰にも無い（行は積むだけ）。
//
// ============================================================================
// 🔴 引き下げの規律（`F-057 AC-3`）は 3 枚で守る
// ============================================================================
//   ① `decideQuotaChange`（`@ses/domain`。純粋関数）—— 引き下げは翌日以降 + 通知の確認が無ければ `QuotaChangeRejectedError`
//   ② RLS の `WITH CHECK`（migration 20260924000000）—— 当日適用の引き下げ行は DB に入らない
//   ③ 通知の実行 —— `usage.limit-check`（ワーカー）が `limit < previous_limit` の行を掃いて `email.dispatch` を積む
//      （管理平面は `EmailDispatch` を書かない = `app_platform_write` の INSERT を `email_dispatches` に広げない）
//
// ============================================================================
// 🔴 「変更前の値」は書き込みの前に読む（監査行は `fn` の前に書かれる）
// ============================================================================
// `withPlatformWrite` は `before` / `after` を**先に**監査ログへ書く（docs/05 §5.3）。したがって `from`（その適用日に効いて
// いたはずの上限）は `withPlatformRead`（`admin.usage.view`。対象テナントに閉じる）で先に読む。2 人の `PLATFORM_OWNER` が
// 同じテナント・同じ計測を同時に変えた場合、後の行が効き（適用日 → 作成時刻 → ID の順）、両方の監査行が残る。
// 先に読んだ `from` が古くなっている可能性は残るが、行の `previous_limit` と監査の `from` は同じ値であり、
// 一覧（`A-004`）が最終的に効いている値を示す。
import {
  decideQuotaChange,
  resolveQuotaLimit,
  selectPendingQuotaOverride,
  usagePeriodKey,
  type QuotaChangeDecision,
  type QuotaOverrideMetric,
  type QuotaOverrideRow,
} from '@ses/domain';
import { withPlatformRead, withPlatformWrite } from '../../platform.js';
import type { PlatformOwnerCtx } from '../../platform-context.js';
import { requirePlatformOwner } from '../../platform-context.js';
import type { TenantQuotaDefaults } from '../../quota-overrides.js';
import { uuidV7 } from '../../uuid.js';

/** `reason` の上限（`tenant_quota_overrides_reason_check` と同じ）。 */
export const QUOTA_OVERRIDE_REASON_MAX_LENGTH = 500;

export type SetTenantQuotaOverrideInput = {
  readonly tenantId: string;
  readonly metric: QuotaOverrideMetric;
  /** 新しい上限（AI の月次件数 / メール日次通数 / ストレージのバイト数）。1 以上。 */
  readonly limit: bigint;
  /** 適用日（`YYYY-MM-DD`。`Asia/Tokyo`）。引き下げは翌日以降。 */
  readonly effectiveFrom: string;
  /** 🔴 引き下げでは `true` が必須（対象テナントの管理者へ通知が行くことの確認）。 */
  readonly notifyTenantAdmins: boolean;
  /** 変更理由（1〜500 文字。監査ログには長さだけを載せる）。 */
  readonly reason: string;
};

export type SetTenantQuotaOverrideMeta = {
  readonly ipAddress?: string | null;
  /** 🔴 現在時刻は引数で受ける（結合テストが決定的な値を使えるようにする）。 */
  readonly now: Date;
  /** 上書きが無いときの上限（`packages/config`）。`from` の解決に使う。 */
  readonly defaults: TenantQuotaDefaults;
};

export type SetTenantQuotaOverrideResult = {
  readonly overrideId: string;
  readonly decision: QuotaChangeDecision;
};

/** 🔴 対象テナントが実在しない（RLS で 0 行 = 「見えない ＝ 存在しない」。API は 404）。 */
export class QuotaOverrideTenantNotFoundError extends Error {
  constructor(readonly tenantId: string) {
    super('対象のテナントが見つかりません。');
    this.name = 'QuotaOverrideTenantNotFoundError';
  }
}

/** 既定値（`packages/config`）から計測の上限を引く。🔴 6 計測（T-12-12 で `EMAIL_COUNT` / `STORAGE_BYTES` を戻した）。 */
function defaultLimitOf(defaults: TenantQuotaDefaults, metric: QuotaOverrideMetric): bigint {
  if (metric === 'EMAIL_COUNT') return BigInt(defaults.emailDailyLimit);
  if (metric === 'STORAGE_BYTES') return defaults.storageLimitBytes;
  return BigInt(defaults.aiUnitQuotas[metric]);
}

function assertReason(reason: string): void {
  const length = reason.trim().length;
  if (length < 1 || reason.length > QUOTA_OVERRIDE_REASON_MAX_LENGTH) {
    throw new RangeError(`reason は 1〜${QUOTA_OVERRIDE_REASON_MAX_LENGTH} 文字である必要があります。`);
  }
}

/**
 * API-A6 の書き込み（`PUT /api/admin/tenants/{id}/quota`）。
 *
 * 🔴 **`PLATFORM_OWNER` のみ**（`PlatformOwnerCtx` を要求する = 型でも縛る。`F-057 AC-2` / `BR-44`）。
 * 🔴 監査（`F-057 AC-4`。実施者・対象・変更前後の値・適用日）は `withPlatformWrite` が**ハンドラの前に**書く（§5.3）。
 *    `summary` は `{ metric, from, to, effectiveFrom, kind, notifyTenantAdmins, reasonLength }`（`reason` の本文は載せない。
 *    T-09-08 の規律）。`before` / `after` にも同じ数値を載せる。
 */
export async function setTenantQuotaOverride(
  ctx: PlatformOwnerCtx,
  input: SetTenantQuotaOverrideInput,
  meta: SetTenantQuotaOverrideMeta,
): Promise<SetTenantQuotaOverrideResult> {
  // 🔴 型に加えて実行時にも確かめる（`as` で型を破っても通さない）。
  requirePlatformOwner(ctx);
  assertReason(input.reason);
  const today = usagePeriodKey('DAY', meta.now);
  const defaultLimit = defaultLimitOf(meta.defaults, input.metric);

  // 1. 変更前の値（その適用日に効いているはずの上限）を対象テナントに閉じて読む。
  const rows = await withPlatformRead(
    {
      ctx,
      action: 'admin.usage.view',
      targetTenantId: input.tenantId,
      targetType: 'Tenant',
      targetId: input.tenantId,
      ipAddress: meta.ipAddress ?? null,
      summary: { metric: input.metric, purpose: 'quota.change.before' },
    },
    async (db): Promise<readonly QuotaOverrideRow[]> => {
      const tenant = await db.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });
      if (tenant === null) throw new QuotaOverrideTenantNotFoundError(input.tenantId);
      const found = await db.tenantQuotaOverride.findMany({
        where: { tenantId: input.tenantId, metric: input.metric },
        select: { id: true, metric: true, limit: true, effectiveFrom: true, createdAt: true },
      });
      return found.map((row) => ({
        id: row.id,
        metric: input.metric,
        limit: row.limit,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
        createdAt: row.createdAt,
      }));
    },
  );
  const current = resolveQuotaLimit({ rows, metric: input.metric, onDate: input.effectiveFrom, defaultLimit });

  // 2. 🔴 引き下げ / 引き上げの判定（純粋関数。拒否は `QuotaChangeRejectedError` のまま伝播 = 400）。
  const decision = decideQuotaChange({
    metric: input.metric,
    currentLimit: current.limit,
    nextLimit: input.limit,
    effectiveFrom: input.effectiveFrom,
    today,
    notifyTenantAdmins: input.notifyTenantAdmins,
  });

  // 3. INSERT（監査行が先。`createMany` = RETURNING 無し。`app_platform_write` はこの表を SELECT できない）。
  const overrideId = uuidV7(meta.now);
  const snapshot = {
    metric: input.metric,
    effectiveFrom: input.effectiveFrom,
  };
  await withPlatformWrite(
    {
      ctx,
      action: 'admin.quota.change',
      domain: 'QUOTA',
      targetTenantId: input.tenantId,
      targetType: 'TenantQuotaOverride',
      targetId: overrideId,
      ipAddress: meta.ipAddress ?? null,
      summary: {
        metric: input.metric,
        from: decision.from.toString(),
        to: decision.to.toString(),
        effectiveFrom: input.effectiveFrom,
        kind: decision.kind,
        notifyTenantAdmins: decision.notifyTenantAdmins,
        // 🔴 理由の本文は載せない（自由記述を監査ログに流さない。T-09-08 レビューの規律）。長さだけ。
        reasonLength: input.reason.length,
        pendingSuperseded: selectPendingQuotaOverride(rows, input.metric, today) !== null,
      },
      before: { ...snapshot, limit: decision.from.toString(), source: current.source },
      after: { ...snapshot, limit: decision.to.toString(), source: 'OVERRIDE' },
    },
    async (db) => {
      await db.tenantQuotaOverride.createMany({
        data: [
          {
            id: overrideId,
            tenantId: input.tenantId,
            metric: input.metric,
            limit: input.limit,
            previousLimit: decision.from,
            // 🔴 `@db.Date`: `YYYY-MM-DD` を UTC 0 時の `Date` として渡すと、その暦日が保存される。
            effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
            setByPlatformUserId: ctx.platformUserId,
            reason: input.reason,
            createdAt: meta.now,
          },
        ],
      });
    },
  );

  return { overrideId, decision };
}
