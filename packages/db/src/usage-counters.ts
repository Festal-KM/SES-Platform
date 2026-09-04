// packages/db/src/usage-counters.ts
// 🔴 `UsageCounter`（docs/05 §3.8 / §7.6 / §9.8 / §14.2 / `F-026` / `CLAUDE.md` §10.6）に
//    値を書く**唯一の経路**。T-03-10（計測フック）。
//
// ============================================================================
// 🔴 なぜ Phase 0 で置くのか
// ============================================================================
// AI / メール / ストレージの**実**計測は SP-07 / SP-10 だが、`CLAUDE.md` §10.6 は
// 「`UsageCounter` のテーブルと計測フックだけは先に置く」と定める。利用量は**後から遡って
// 計測できない**（過去のリクエストは残っていない）ためであり、加算経路が無いまま機能が
// 増えると、その期間の原価・請求根拠が永久に欠落する。
//
// ============================================================================
// 🔴 なぜ raw SQL なのか（`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`）
// ============================================================================
// docs/05 §7.6 / §14.2 が明示する形である。Prisma の `upsert` は「読んでから書く」であり、
// 同一テナントの並行実行（同じジョブが 2 ワーカーで走る / 複数の AI 呼び出しが同時に予約する）で
// **更新を取りこぼす**。`ON CONFLICT DO UPDATE` は 1 文で原子的に決まり、`RETURNING` で
// 確定値をその場で読める（上限判定がこの戻り値に依存する。§7.6 の `reserveAiCost`）。
//
// 🔴 生 SQL を書いてよいのは `packages/db` だけである（`CLAUDE.md` §3.1 / docs/05 §4.3 規約 3。
//    `withTenant` が渡す `TenantDb` の型には `$queryRaw` が無い）。したがって加算のヘルパは
//    ここに置き、`apps/worker` / `packages/ai` は**関数として**呼ぶ。
import { Prisma } from '@prisma/client';
import { usagePeriodKey, type UsagePeriodKind } from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import type { UsageCounterMetric } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

/** `usage_counters` の確定値。🔴 `Decimal(20,6)` を欠損なく運ぶため**文字列**で返す。 */
export type UsageCounterValue = {
  readonly periodKind: UsagePeriodKind;
  readonly periodKey: string;
  readonly metric: UsageCounterMetric;
  /** 確定後の `value`。 */
  readonly value: string;
  /** 確定後の `reserved_value`（AI の呼び出し前予約。§7.6。本タスクでは触らない）。 */
  readonly reservedValue: string;
};

export type UsageCounterWrite = {
  readonly periodKind: UsagePeriodKind;
  readonly metric: UsageCounterMetric;
  /**
   * 加算量（`ADD`）または確定値（`SET`）。
   * 🔴 **文字列で受ける。** 金額（USD）は `Decimal(20,6)` であり、JS の `number` を経由すると
   *    丸め誤差が原価と請求根拠に入る。件数も同じ経路にそろえる（型を 2 つにしない）。
   */
  readonly amount: string;
  /** 計測時刻。`periodKey`（`Asia/Tokyo` の暦）と `observed_at` の両方に使う。 */
  readonly observedAt: Date;
};

type UpsertMode = 'ADD' | 'SET';

type RawRow = { readonly value: string; readonly reserved_value: string };

/** 数値として妥当な文字列か（SQL へ渡す前の門番。`NaN` / 指数表記の混入を止める）。 */
const AMOUNT_PATTERN = /^-?\d{1,20}(\.\d{1,6})?$/;

function assertAmount(amount: string): void {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new RangeError(
      `UsageCounter の値が不正です（${amount}）。整数部 20 桁・小数部 6 桁までの十進数で渡してください。`,
    );
  }
}

/**
 * 🔴 原子的な upsert（docs/05 §7.6 / §14.2）。
 *
 * - `ADD`: `value = value + $amount`（加算。AI コスト・メール通数・ストレージ）
 * - `SET`: `value = $amount`（確定値の上書き。席数の日次スナップショット）
 *
 * 🔴 2 つの SQL を文字列連結で作らない。分岐は式ではなく**文そのもの**で分ける
 *    （どちらが実行されるかを読む側が 1 目で確定できる形にする）。
 * 🔴 `observed_at` は常に新しい方を残す（再実行で過去へ巻き戻さない）。
 */
async function upsertUsageCounter(
  ctx: HostTenantCtx,
  write: UsageCounterWrite,
  mode: UpsertMode,
): Promise<UsageCounterValue> {
  assertAmount(write.amount);
  const periodKey = usagePeriodKey(write.periodKind, write.observedAt);
  const id = uuidV7(write.observedAt);

  const statement =
    mode === 'ADD'
      ? Prisma.sql`
          INSERT INTO usage_counters
            (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
          VALUES
            (${id}::uuid, ${ctx.tenantId}::uuid, ${write.periodKind}, ${periodKey},
             ${write.metric}, ${write.amount}::numeric, 0, ${write.observedAt}::timestamptz)
          ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
            SET value = usage_counters.value + EXCLUDED.value,
                observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
          RETURNING value::text AS value, reserved_value::text AS reserved_value`
      : Prisma.sql`
          INSERT INTO usage_counters
            (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
          VALUES
            (${id}::uuid, ${ctx.tenantId}::uuid, ${write.periodKind}, ${periodKey},
             ${write.metric}, ${write.amount}::numeric, 0, ${write.observedAt}::timestamptz)
          ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
            SET value = EXCLUDED.value,
                observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
          RETURNING value::text AS value, reserved_value::text AS reserved_value`;

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<RawRow[]>(statement);
      const row = rows[0];
      if (row === undefined) {
        // 🔴 RLS（C2 HOST_ONLY）で 0 行になった場合にここへ来る。**0 件を成功として返さない**
        //    （計測が黙って落ちると、後から欠測と区別できない。`F-026 AC-4`）。
        throw new Error(
          `UsageCounter を書き込めませんでした（metric=${write.metric}, periodKey=${periodKey}）。`,
        );
      }
      return {
        periodKind: write.periodKind,
        periodKey,
        metric: write.metric,
        value: row.value,
        reservedValue: row.reserved_value,
      };
    },
  );
}

/**
 * 🔴 利用量を**原子的に加算**する（docs/05 §7.6 / §14.2）。
 *
 * 使う側（いずれも後続スプリント）:
 *   - AI コスト / 件数（`packages/ai` の `runRole`。SP-07）
 *   - メール通数（`send.*` / `email.dispatch`。SP-10）
 *   - ストレージ（`POST /api/engineers/{id}/skill-sheets` の確定時。SP-05）
 *
 * 🔴 この関数を迂回して `usage_counters` を書く経路を作らない。
 */
export async function incrementUsageCounter(
  ctx: HostTenantCtx,
  write: UsageCounterWrite,
): Promise<UsageCounterValue> {
  return upsertUsageCounter(ctx, write, 'ADD');
}

/**
 * 🔴 利用量を**確定値で上書き**する（スナップショット系。docs/05 §9.8）。
 *
 * 加算と分ける理由: 席数は「その日の実測値」であり、同じ日に 2 回実行しても
 * 2 倍になってはならない（`usage.seat-snapshot` の冪等性）。加算のヘルパで
 * 「先に消してから足す」を書かせると、消した直後に落ちた実行が欠測を作る。
 */
export async function recordUsageCounterSnapshot(
  ctx: HostTenantCtx,
  write: UsageCounterWrite,
): Promise<UsageCounterValue> {
  return upsertUsageCounter(ctx, write, 'SET');
}

export type SeatSnapshotOptions = {
  /**
   * 🔴 取引先所属の席（`PARTNER_ADMIN` / `PARTNER_SALES`）を数に含めるか
   *    （docs/05 TBD-19 / [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)）。
   *
   * 🔴 **引数で受け取る。関数の中で決め打ちしない。** 席単価と課金対象は事業判断であり未決である。
   *    既定値は `packages/config` の `SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS` が持ち、
   *    呼び出し側（ジョブ）がそれを渡す。
   */
  readonly countPartnerSeats: boolean;
  readonly observedAt: Date;
};

export type SeatSnapshotResult = UsageCounterValue & {
  /** 実測した有効な `Membership` の行数。 */
  readonly seatCount: number;
};

/**
 * 🔴 席数の日次スナップショット（`usage.seat-snapshot`。docs/05 §9.8 / §5.9 / `F-026`）。
 *
 * 「有効な `Membership` の行数」= `revoked_at IS NULL`。招待中（`Invitation`）は数えない
 * （docs/05 §3.2「受諾前のレコードが `Membership` として存在すると席数を汚す」）。
 *
 * 🔴 数え上げと書き込みを**同一トランザクション**で行う。別々にすると、数えた後・書く前に
 *    メンバーが増減したときに「どの時点の実測値か」が説明できない値が残る。
 * 🔴 冪等: 同じ日に 2 回実行しても `usage_counters` は 1 行のまま（`SET` の upsert）。
 */
export async function snapshotSeatCount(
  ctx: HostTenantCtx,
  options: SeatSnapshotOptions,
): Promise<SeatSnapshotResult> {
  const periodKey = usagePeriodKey('DAY', options.observedAt);
  const id = uuidV7(options.observedAt);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      // 🔴 Prisma 拡張（第 2 防御）が `tenantId` を注入し、RLS（C5 / 第 1 防御）が
      //    ホスト文脈で自テナントの全所属に絞る。件数の母集団はこの 2 重で決まる。
      const seatCount = await tx.membership.count({
        where: {
          revokedAt: null,
          // 🔴 ホストの席だけを数えるときは `partner_company_id IS NULL`。
          //    DB の CHECK（パートナーロール ⇔ 所属あり）により、この条件は
          //    「ホストロールの行」と厳密に一致する（ロール名の列挙に頼らない）。
          ...(options.countPartnerSeats ? {} : { partnerCompanyId: null }),
        },
      });

      const rows = await tx.$queryRaw<RawRow[]>(Prisma.sql`
        INSERT INTO usage_counters
          (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, 'DAY', ${periodKey},
           'SEAT_COUNT', ${String(seatCount)}::numeric, 0, ${options.observedAt}::timestamptz)
        ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
          SET value = EXCLUDED.value,
              observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
        RETURNING value::text AS value, reserved_value::text AS reserved_value`);

      const row = rows[0];
      if (row === undefined) {
        throw new Error(`席数スナップショットを書き込めませんでした（periodKey=${periodKey}）。`);
      }
      return {
        periodKind: 'DAY' as const,
        periodKey,
        metric: 'SEAT_COUNT' as const,
        value: row.value,
        reservedValue: row.reserved_value,
        seatCount,
      };
    },
  );
}
