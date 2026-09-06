// packages/db/src/storage-usage.ts
// 🔴 `UsageCounter(metric='STORAGE_BYTES')` を読む・動かす**唯一の経路**（docs/05 §8.7 / §14.2 /
//    docs/03 §4.5 / `F-026` / `F-027`）。T-05-04。
//
// ============================================================================
// 🔴 なぜ「カウンタが正」なのか（S3 を都度数えない理由）
// ============================================================================
// S3 はプレフィックス配下の合計サイズを安価に返す API を持たない（docs/03 §4.5）。
// `ListObjectsV2` の全走査はテナント数 × オブジェクト数に比例し、**アップロード前の停止判定**には
// 間に合わない。したがって `PutObject` の確定時に加算、削除の成功時に減算する方式を正とし、
// S3 Inventory / Storage Lens は日次の**検算**（`usage.storage-reconcile`。SP-10 / SP-11）に留める。
//
// ============================================================================
// 🔴 なぜ「月キーなのに累積」なのか
// ============================================================================
// `usage_counters` は `(tenant_id, period_kind, period_key, metric)` の一意キーを持つ。
// ストレージは docs/05 §8.7 が「時間窓 = 累積」と定める**ゲージ**であり、その月に増えた量ではなく
// 「いま何バイト置いてあるか」である。一方 §5.9 は原価を「`UsageCounter(MONTH,'STORAGE_BYTES')` の
// **月末値**」から取ると定める。両方を満たすため、
//   - 行は `period_kind='MONTH'` で持つ（月末値がそのまま `TenantMonthlyCost` に固定できる）
//   - 🔴 **新しい月の最初の書き込みで、直前の月の値を引き継いでから差分を適用する**
// という形にする。引き継がないと、月が変わった瞬間に使用量が 0 に見え、上限が実質的に消える。
//
// 🔴 読み取りも同じ規則で「`period_key <= 当月` の最新行」を見る（その月にまだ増減が無ければ
//    行が無いため、当月キーだけを見ると 0 になってしまう）。
//
// ============================================================================
// 🔴 加算・減算の冪等性（本モジュールの中心）
// ============================================================================
// 再実行は必ず起こる（#19 の二重送信、削除ジョブの再試行）。差分を素直に足し引きするだけでは
// 1 回の再実行で恒久的にずれる。そこで `skill_sheets.storage_counted_at`（migration 20260907000000）を
// 「この版のバイト数がカウンタに含まれているか」の状態として持ち、**条件付き UPDATE（CAS）が
// 成立したときだけ**同じトランザクション内でカウンタを動かす。2 回目は 0 件更新になり、
// 加算も減算も起こらない（`ALREADY_SETTLED`）。
import { Prisma } from '@prisma/client';
import { usagePeriodKey } from '@ses/domain';
import type { AuthenticatedTenantCtx } from './context.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

/** 本モジュールが触る唯一の metric（docs/05 §3.8 の値集合）。 */
const STORAGE_METRIC = 'STORAGE_BYTES';

/** 🔴 ストレージは暦月の行に**累積**で持つ（本ファイル冒頭の理由）。 */
const STORAGE_PERIOD_KIND = 'MONTH';

/**
 * 計上の結果。
 *
 * - `APPLIED`: この呼び出しでカウンタが動いた。
 * - 🔴 `ALREADY_SETTLED`: **冪等な再実行**（加算なら計上済み、減算なら計上されていない）。
 *   エラーではない。呼び出し側は成功として扱ってよい（`docs/05` §10.1 の再実行と同じ扱い）。
 * - 🔴 `NOT_FOUND`: 対象の版が境界の外か存在しない。呼び出し側が 404 に写像する（§4.8）。
 *   **0 バイトの加算として握り潰さない**（握り潰すと、他テナントの ID を指定した呼び出しが
 *   成功に見える）。
 */
export type StorageAccountingOutcome =
  | { readonly kind: 'APPLIED'; readonly deltaBytes: bigint; readonly usedBytes: bigint }
  | { readonly kind: 'ALREADY_SETTLED' }
  | { readonly kind: 'NOT_FOUND' };

export type SkillSheetStorageInput = {
  readonly skillSheetId: string;
  /** 計測時刻。`periodKey`（`Asia/Tokyo` の暦）と `observed_at` の両方に使う。 */
  readonly observedAt: Date;
};

type ValueRow = { readonly value: string };
type ByteSizeRow = { readonly byte_size: string };

/** `usage_counters.value` は `Decimal(20,6)`。バイト数は整数なので切り捨てて `bigint` にする。 */
function toBytes(value: string): bigint {
  return BigInt(value);
}

/**
 * 🔴 テナントの現在使用量（バイト）。
 *
 * 「当月に行が無ければ直前の月の値」を見る（本ファイル冒頭の「月キーなのに累積」）。
 * 🔴 行が 1 つも無ければ 0（まだ 1 バイトも置いていないテナント）。**例外にしない** ——
 *    計測が始まる前のテナントは実際に 0 であり、それは欠測ではない。
 */
export async function readStorageBytesUsed(
  ctx: AuthenticatedTenantCtx,
  observedAt: Date,
): Promise<bigint> {
  const periodKey = usagePeriodKey(STORAGE_PERIOD_KIND, observedAt);
  return runInTenantTransaction(
    {
      tenantId: ctx.tenantId,
      partnerCompanyId: ctx.partnerCompanyId,
      actorUserId: ctx.userId,
    },
    async (tx) => {
      const rows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
        SELECT trunc(value)::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = ${STORAGE_PERIOD_KIND}
           AND metric = ${STORAGE_METRIC}
           AND period_key <= ${periodKey}
         ORDER BY period_key DESC
         LIMIT 1`);
      const row = rows[0];
      return row === undefined ? 0n : toBytes(row.value);
    },
  );
}

/**
 * 🔴 カウンタへの差分適用（本モジュールの内部だけが呼ぶ）。
 *
 * - 当月の行が無ければ**直前の月の値を引き継いで**作る（累積ゲージ）。
 * - `GREATEST(…, 0)` で下限を 0 に留める。負のバイト数は意味を持たず、そのまま残すと
 *   以後のアップロードに実体の無い枠を与えてしまう（乖離は `usage.storage-reconcile` が
 *   `A-005` に出す。ここでは**自動補正しない**）。
 */
async function applyStorageDelta(
  tx: Parameters<Parameters<typeof runInTenantTransaction<bigint>>[1]>[0],
  tenantId: string,
  deltaBytes: bigint,
  observedAt: Date,
): Promise<bigint> {
  const periodKey = usagePeriodKey(STORAGE_PERIOD_KIND, observedAt);
  const id = uuidV7(observedAt);
  const delta = deltaBytes.toString();

  const rows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
    INSERT INTO usage_counters
      (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
    VALUES
      (${id}::uuid, ${tenantId}::uuid, ${STORAGE_PERIOD_KIND}, ${periodKey}, ${STORAGE_METRIC},
       GREATEST(
         COALESCE((SELECT carried.value
                     FROM usage_counters carried
                    WHERE carried.tenant_id = ${tenantId}::uuid
                      AND carried.period_kind = ${STORAGE_PERIOD_KIND}
                      AND carried.metric = ${STORAGE_METRIC}
                      AND carried.period_key < ${periodKey}
                    ORDER BY carried.period_key DESC
                    LIMIT 1), 0) + ${delta}::numeric,
         0),
       0, ${observedAt}::timestamptz)
    ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
      SET value = GREATEST(usage_counters.value + ${delta}::numeric, 0),
          observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
    RETURNING trunc(value)::text AS value`);

  const row = rows[0];
  if (row === undefined) {
    // 🔴 RLS で 0 行になった場合にここへ来る。**0 件を成功として返さない**
    //    （計測が黙って落ちると、後から欠測と区別できない。`F-026 AC-4`）。
    throw new Error(
      `UsageCounter(${STORAGE_METRIC}) を書き込めませんでした（periodKey=${periodKey}）。`,
    );
  }
  return toBytes(row.value);
}

/**
 * 🔴 アップロード確定時の**加算**（docs/05 §14.2 / docs/03 §4.5）。呼ぶのは
 *    `POST /api/engineers/{id}/skill-sheets`（#19。T-05-06）である。
 *
 * 🔴 **署名付き URL の発行時には呼ばない**（docs/05 §14.2）。発行しても最後までアップロード
 *    されないことがあり、その分を加算すると使用量が実体より大きくなり続ける。
 *
 * 🔴 CAS（`storage_counted_at IS NULL`）が成立したときだけ加算する。二重呼び出しの 2 回目は
 *    `ALREADY_SETTLED` であり、カウンタは 1 度しか動かない。
 * 🔴 母集団は `skill_sheets` の RLS（C3 OWNER_SCOPED）が決める。パートナー文脈では自社の版しか
 *    更新できず、他社・他テナントの ID を渡しても `NOT_FOUND` になる（§4.8）。
 */
export async function accountSkillSheetStorage(
  ctx: AuthenticatedTenantCtx,
  input: SkillSheetStorageInput,
): Promise<StorageAccountingOutcome> {
  return settleSkillSheetStorage(ctx, input, 'ADD');
}

/**
 * 🔴 削除ジョブが **S3 の削除に成功した後**に呼ぶ**減算**（docs/03 §4.5）。
 *
 * 🔴 削除に失敗したまま減算しない（実体が残っているのに枠だけ空くと、S3 の請求は増え続ける）。
 * 🔴 CAS（`storage_counted_at IS NOT NULL`）が成立したときだけ減算する。再試行の 2 回目は
 *    `ALREADY_SETTLED` であり、二重に引かれない。
 */
export async function releaseSkillSheetStorage(
  ctx: AuthenticatedTenantCtx,
  input: SkillSheetStorageInput,
): Promise<StorageAccountingOutcome> {
  return settleSkillSheetStorage(ctx, input, 'RELEASE');
}

/**
 * 加算・減算の共通実装。
 * 🔴 分岐は「CAS の述語」と「差分の符号」の 2 点だけであり、手順（CAS → 差分適用）は 1 本である。
 *    2 つの関数に書き分けると、片方だけ CAS を落とした実装がいつか混ざる。
 */
async function settleSkillSheetStorage(
  ctx: AuthenticatedTenantCtx,
  input: SkillSheetStorageInput,
  mode: 'ADD' | 'RELEASE',
): Promise<StorageAccountingOutcome> {
  return runInTenantTransaction(
    {
      tenantId: ctx.tenantId,
      partnerCompanyId: ctx.partnerCompanyId,
      actorUserId: ctx.userId,
    },
    async (tx) => {
      // 🔴 CAS。`RETURNING` はこの UPDATE が実際に状態を変えた行だけを返す。
      // 🔴 生 SQL は Prisma 拡張（第 2 防御）のフックを通らないため、テナントキーの述語を
      //    **明示的に書く**（`incrementUsageCounter` と同じ規律）。オーナー（パートナー）の
      //    絞り込みは RLS の C3 が行う。
      const claimed = await tx.$queryRaw<ByteSizeRow[]>(
        mode === 'ADD'
          ? Prisma.sql`
              UPDATE skill_sheets
                 SET storage_counted_at = ${input.observedAt}::timestamptz
               WHERE id = ${input.skillSheetId}::uuid
                 AND tenant_id = ${ctx.tenantId}::uuid
                 AND storage_counted_at IS NULL
              RETURNING byte_size::text AS byte_size`
          : Prisma.sql`
              UPDATE skill_sheets
                 SET storage_counted_at = NULL
               WHERE id = ${input.skillSheetId}::uuid
                 AND tenant_id = ${ctx.tenantId}::uuid
                 AND storage_counted_at IS NOT NULL
              RETURNING byte_size::text AS byte_size`,
      );

      const row = claimed[0];
      if (row === undefined) {
        // 0 件更新には 2 つの意味がある。**混ぜない**（片方は正常な再実行、片方は境界違反）。
        const exists = await tx.skillSheet.findFirst({
          where: { id: input.skillSheetId },
          select: { id: true },
        });
        return exists === null
          ? ({ kind: 'NOT_FOUND' } as const)
          : ({ kind: 'ALREADY_SETTLED' } as const);
      }

      const byteSize = BigInt(row.byte_size);
      const deltaBytes = mode === 'ADD' ? byteSize : -byteSize;
      const usedBytes = await applyStorageDelta(tx, ctx.tenantId, deltaBytes, input.observedAt);
      return { kind: 'APPLIED', deltaBytes, usedBytes } as const;
    },
  );
}
