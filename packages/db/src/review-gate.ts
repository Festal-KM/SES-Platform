// packages/db/src/review-gate.ts
// 🔴 `ReviewGate` の読み書き（docs/05 §3.6 / §9.3 / §11.1〜§11.7 / `F-020 AC-7`）。T-07-06。
//
// ============================================================================
// 🔴 同一対象へのゲート実行が多重化しないための 3 段（docs/05 §9.3 / `F-027 AC-5`）
// ============================================================================
//   ① **HELD 部分 UNIQUE** … `review_gates(tenant_id, target_type, target_id) WHERE execution <> 'DONE'`
//      保留の行は対象ごとに 1 行しか作れない（SP-02 の migration）
//   ② **`jobId` 重複排除** … `gate.run:{targetType}:{targetId}:{contentHash}`（`packages/connectors`）
//      待機中・実行中の同 ID は BullMQ が弾く
//   ③ **完了 CAS** … 保留行を `execution='HELD_AI_COST_LIMIT'` の条件付きで `DONE` にする。
//      0 件なら**結果を破棄する**（`P-A-09`。他の実行が先に確定させている）
//
// ①②が同時にすり抜けても③が最後に効く。逆に③だけに頼らないのは、①が無ければ
// 保留行が対象ごとに増え、「どの保留を再実行するのか」が決まらなくなるからである。
//
// ============================================================================
// 🔴 なぜ生 SQL なのか
// ============================================================================
// ①の部分 UNIQUE は述語付きの索引であり、Prisma の `upsert` は述語付き索引を
// 競合ターゲットにできない（`ON CONFLICT (...) WHERE ...` を発行できない）。
// `findFirst` → `create` に分けると **判定と書き込みの間に窓が開く**（`gate.hold-release` と
// #39 が同時に走る場面がまさにそれである）。したがってここだけ 1 文の SQL にする
// （`ai-cost-guard.ts` / `storage-usage.ts` と同じ規律。テナントキーの述語は RLS が課す）。

import { Prisma } from '@prisma/client';
import type { GateExecution, GateFinding, GateTargetType, GateVerdict, PersistedGateResult } from '@ses/domain';
import type { SystemTenantCtx } from './context.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

/** ゲート結果の所在（対象 1 件 × 内容 1 版）。 */
export type ReviewGateKey = {
  readonly targetType: GateTargetType;
  readonly targetId: string;
  readonly contentHash: string;
};

/** 確定済みの行（`execution='DONE'`）。 */
export type CompletedReviewGate = {
  readonly id: string;
  /** 🔴 `true` の行は**キャッシュとして使わない**（再実行で PASS になりうるため。§11.7）。 */
  readonly aiFailed: boolean;
  readonly piiVerdict: GateVerdict;
  readonly commerceVerdict: GateVerdict;
  readonly consistencyVerdict: GateVerdict;
};

/** 保留中の行（`execution='HELD_AI_COST_LIMIT'`）。対象ごとに 1 行しか存在しない。 */
export type PendingReviewGate = {
  readonly id: string;
  readonly contentHash: string;
  readonly heldSince: Date;
  readonly consistencyVerdict: GateVerdict;
};

export type ReviewGateResultInput = ReviewGateKey & {
  readonly piiVerdict: GateVerdict;
  readonly commerceVerdict: GateVerdict;
  readonly consistencyVerdict: GateVerdict;
  readonly findings: readonly GateFinding[];
  readonly aiWarnings: readonly GateFinding[];
  /** 🔴 AI が失敗したら `role` / `promptVersion` / `modelId` / `aiUsageId` は `null` である。 */
  readonly aiFailed: boolean;
  readonly role: string | null;
  readonly promptVersion: string | null;
  readonly modelId: string | null;
  readonly aiUsageId: string | null;
  readonly executedAt: Date;
};

export type ReviewGateHoldInput = ReviewGateKey & {
  /** 🔴 保留中でも整合層は確定している（機械的照合のみで決まる。`F-027 AC-5`）。 */
  readonly consistencyVerdict: GateVerdict;
  readonly findings: readonly GateFinding[];
  readonly heldSince: Date;
};

/**
 * 結果の保存の帰結。
 *
 * - `SAVED` … 新しい行を作った
 * - `COMPLETED_HELD` … 保留していた行を CAS で確定させた（`gate.hold-release` / #39 の復帰）
 * - `REPLACED` … 🔴 前回 AI が失敗した同じ内容の行を上書きした（`aiFailed` はキャッシュしない）
 * - 🔴 `RACED` … 保留行が別の実行に先に確定させられていた。**結果を破棄する**（`P-A-09`）
 */
export type ReviewGateSaveOutcome =
  | { readonly kind: 'SAVED' | 'COMPLETED_HELD' | 'REPLACED'; readonly id: string }
  | { readonly kind: 'RACED' };

type IdRow = { readonly id: string };

/**
 * `GateFinding[]` を JSONB へ渡せる形にする。
 *
 * 🔴 型を経由するだけで、値の加工はしない（`excerpt` を切り詰める等は作る側の責務であり、
 *    保存側で黙って変えると「保存された値と画面の値が違う」状態になる）。
 * 🔴 **文字列にしてから `::jsonb` へ渡す。** `Prisma.sql` はテンプレートの配列を
 *    PostgreSQL の**配列**として送るため、素の配列を渡すと `jsonb[]` になって落ちる。
 */
function toJson(findings: readonly GateFinding[]): string {
  return JSON.stringify(
    findings.map((finding) => ({
      layer: finding.layer,
      kind: finding.kind,
      field: finding.field,
      offsetStart: finding.offsetStart,
      offsetEnd: finding.offsetEnd,
      excerpt: finding.excerpt,
      severity: finding.severity,
    })),
  );
}

function fromJson(value: unknown): readonly GateFinding[] {
  return Array.isArray(value) ? (value as GateFinding[]) : [];
}

/**
 * 🔴 同じ内容のゲート結果が既に確定していれば再実行しない（`P-A-09` / `F-020 AC-3`）。
 *
 * 🔴 **`aiFailed = true` の行はキャッシュにしない**（docs/sprints/SP-07 T-07-06）。
 *    AI の失敗は元データの欠陥ではないので、同じ内容でも再実行すれば PASS になりうる。
 *    ここで返してしまうと「一度 LLM がタイムアウトした提案は、内容を変えるまで永久に送れない」
 *    という直しようのない状態になる（`BR-18` の解消手段が存在しなくなる）。
 */
export async function findCachedReviewGate(
  ctx: SystemTenantCtx,
  key: ReviewGateKey,
): Promise<CompletedReviewGate | null> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const row = await tx.reviewGate.findFirst({
        where: {
          targetType: key.targetType,
          targetId: key.targetId,
          contentHash: key.contentHash,
          execution: 'DONE',
          aiFailed: false,
        },
        orderBy: { executedAt: 'desc' },
        select: {
          id: true,
          aiFailed: true,
          piiVerdict: true,
          commerceVerdict: true,
          consistencyVerdict: true,
        },
      });
      if (row === null) return null;
      // 🔴 CHECK（docs/05 §3.6）により `execution='DONE'` の行は両判定が非 NULL である。
      //    それでも `null` なら DB の不変条件が壊れているので、握り潰さず落とす。
      if (row.piiVerdict === null || row.commerceVerdict === null) {
        throw new Error(
          `review_gates(${row.id}) が execution='DONE' なのに判定が NULL です（docs/05 §3.6 の CHECK が壊れています）。`,
        );
      }
      return {
        id: row.id,
        aiFailed: row.aiFailed,
        piiVerdict: row.piiVerdict as GateVerdict,
        commerceVerdict: row.commerceVerdict as GateVerdict,
        consistencyVerdict: row.consistencyVerdict as GateVerdict,
      };
    },
  );
}

/** 保留中の行を読む（対象ごとに 1 行。部分 UNIQUE）。 */
export async function findPendingReviewGate(
  ctx: SystemTenantCtx,
  target: Pick<ReviewGateKey, 'targetType' | 'targetId'>,
): Promise<PendingReviewGate | null> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const row = await tx.reviewGate.findFirst({
        where: {
          targetType: target.targetType,
          targetId: target.targetId,
          execution: { not: 'DONE' },
        },
        select: { id: true, contentHash: true, heldSince: true, consistencyVerdict: true },
      });
      if (row === null || row.heldSince === null) return null;
      return {
        id: row.id,
        contentHash: row.contentHash,
        heldSince: row.heldSince,
        consistencyVerdict: row.consistencyVerdict as GateVerdict,
      };
    },
  );
}

/**
 * 🔴 AI の日次コスト上限で**呼べなかった**ことを保持する（docs/05 §7.6 / `F-027 AC-5`）。
 *
 * 🔴 **合否を確定させない。** `pii_verdict` / `commerce_verdict` は NULL のままであり、
 *    承認 CAS と送信の事前判定（`g.execution='DONE' AND 3 層 PASS`。§11.5）を満たさない ——
 *    つまり**保留行が PASS として読まれる経路が無い**。
 * 🔴 整合層の結果は**保持する**（機械的照合は動いている）。上限解除後の再実行はこの行を
 *    CAS で確定させ、同じ整合層の結果を使う。
 * 🔴 `held_since` は最初に保留した時刻を保つ（再保留のたびに更新すると、滞留の検知（`A-005`）が
 *    「ずっと今さっき保留になったばかり」に見えて永久に気づけない）。
 */
export async function holdReviewGate(
  ctx: SystemTenantCtx,
  input: ReviewGateHoldInput,
): Promise<PendingReviewGate> {
  const id = uuidV7(input.heldSince);
  const findings = toJson(input.findings);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; content_hash: string; held_since: Date; consistency_verdict: string }[]
      >(Prisma.sql`
        INSERT INTO review_gates
          (id, tenant_id, target_type, target_id, content_hash, execution, held_since,
           consistency_verdict, findings, ai_warnings, ai_failed)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, ${input.targetType}, ${input.targetId}::uuid,
           ${input.contentHash}, 'HELD_AI_COST_LIMIT', ${input.heldSince}::timestamptz,
           ${input.consistencyVerdict}, ${findings}::jsonb, '[]'::jsonb, false)
        ON CONFLICT (tenant_id, target_type, target_id) WHERE execution <> 'DONE'
        DO UPDATE SET
          content_hash = EXCLUDED.content_hash,
          consistency_verdict = EXCLUDED.consistency_verdict,
          findings = EXCLUDED.findings
        RETURNING id, content_hash, held_since, consistency_verdict
      `);
      const row = rows[0];
      if (row === undefined || row.held_since === null) {
        throw new Error('review_gates の保留行を作成できませんでした（docs/05 §7.6）。');
      }
      return {
        id: row.id,
        contentHash: row.content_hash,
        heldSince: row.held_since,
        consistencyVerdict: row.consistency_verdict as GateVerdict,
      };
    },
  );
}

/**
 * 🔴 ゲートの結果を確定させる（`F-020 AC-7`）。
 *
 * 順序（この順序が上の 3 段の③にあたる）:
 *   1. 保留行があれば **CAS で `DONE` にする**（`WHERE execution='HELD_AI_COST_LIMIT'`）。
 *      0 件なら他の実行が先に確定させているので `RACED` を返し、**結果を捨てる**。
 *   2. 前回 AI が失敗した同じ内容の行があれば**上書きする**（`aiFailed` はキャッシュしないため、
 *      再実行のたびに行が増えないようにする）。
 *   3. どちらでもなければ新しい行を作る。
 */
export async function completeReviewGate(
  ctx: SystemTenantCtx,
  input: ReviewGateResultInput,
): Promise<ReviewGateSaveOutcome> {
  const id = uuidV7(input.executedAt);
  const findings = toJson(input.findings);
  const warnings = toJson(input.aiWarnings);
  const assignments = Prisma.sql`
    execution = 'DONE',
    held_since = NULL,
    content_hash = ${input.contentHash},
    pii_verdict = ${input.piiVerdict},
    commerce_verdict = ${input.commerceVerdict},
    consistency_verdict = ${input.consistencyVerdict},
    findings = ${findings}::jsonb,
    ai_warnings = ${warnings}::jsonb,
    role = ${input.role},
    prompt_version = ${input.promptVersion},
    model_id = ${input.modelId},
    ai_usage_id = ${input.aiUsageId}::uuid,
    ai_failed = ${input.aiFailed},
    executed_at = ${input.executedAt}::timestamptz
  `;

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<ReviewGateSaveOutcome> => {
      const pending = await tx.reviewGate.findFirst({
        where: {
          targetType: input.targetType,
          targetId: input.targetId,
          execution: { not: 'DONE' },
        },
        select: { id: true },
      });

      if (pending !== null) {
        const completed = await tx.$queryRaw<IdRow[]>(Prisma.sql`
          UPDATE review_gates SET ${assignments}
           WHERE id = ${pending.id}::uuid
             AND execution = 'HELD_AI_COST_LIMIT'
          RETURNING id
        `);
        const row = completed[0];
        // 🔴 0 件 = 他の実行（自動再試行 / 手動再実行）が先に確定させた。結果を破棄する。
        return row === undefined ? { kind: 'RACED' } : { kind: 'COMPLETED_HELD', id: row.id };
      }

      const replaced = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        UPDATE review_gates SET ${assignments}
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND target_type = ${input.targetType}
           AND target_id = ${input.targetId}::uuid
           AND content_hash = ${input.contentHash}
           AND execution = 'DONE'
           AND ai_failed = true
        RETURNING id
      `);
      const replacedRow = replaced[0];
      if (replacedRow !== undefined) return { kind: 'REPLACED', id: replacedRow.id };

      const inserted = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        INSERT INTO review_gates
          (id, tenant_id, target_type, target_id, content_hash, execution, held_since,
           pii_verdict, commerce_verdict, consistency_verdict, findings, ai_warnings,
           role, prompt_version, model_id, ai_usage_id, ai_failed, executed_at)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, ${input.targetType}, ${input.targetId}::uuid,
           ${input.contentHash}, 'DONE', NULL,
           ${input.piiVerdict}, ${input.commerceVerdict}, ${input.consistencyVerdict},
           ${findings}::jsonb, ${warnings}::jsonb,
           ${input.role}, ${input.promptVersion}, ${input.modelId}, ${input.aiUsageId}::uuid,
           ${input.aiFailed}, ${input.executedAt}::timestamptz)
        RETURNING id
      `);
      const insertedRow = inserted[0];
      if (insertedRow === undefined) {
        throw new Error('review_gates の結果を保存できませんでした（docs/05 §11.1 / F-020 AC-7）。');
      }
      return { kind: 'SAVED', id: insertedRow.id };
    },
  );
}

/**
 * 対象の最新のゲート結果を読む（#40 / 承認画面が使う。docs/05 §11.7）。
 *
 * 🔴 保留行（`execution <> 'DONE'`）を優先して返す。保留中に古い `DONE` の行を返すと、
 *    画面は「確定済み」と表示し、利用者は上限で止まっていることに気づけない（`F-027 AC-5`）。
 */
export async function readReviewGateResult(
  ctx: SystemTenantCtx,
  target: Pick<ReviewGateKey, 'targetType' | 'targetId'>,
): Promise<(PersistedGateResult & { readonly id: string; readonly heldSince: Date | null }) | null> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.reviewGate.findMany({
        where: { targetType: target.targetType, targetId: target.targetId },
        orderBy: [{ execution: 'asc' }, { executedAt: 'desc' }],
        select: {
          id: true,
          execution: true,
          contentHash: true,
          piiVerdict: true,
          commerceVerdict: true,
          consistencyVerdict: true,
          findings: true,
          aiWarnings: true,
          aiFailed: true,
          heldSince: true,
        },
      });
      // 'DONE' < 'HELD_AI_COST_LIMIT' なので、保留行は昇順の末尾に来る。保留を優先する。
      const row = rows.find((candidate) => candidate.execution !== 'DONE') ?? rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        execution: row.execution as GateExecution,
        contentHash: row.contentHash,
        piiVerdict: row.piiVerdict as GateVerdict | null,
        commerceVerdict: row.commerceVerdict as GateVerdict | null,
        consistencyVerdict: row.consistencyVerdict as GateVerdict,
        findings: fromJson(row.findings),
        aiWarnings: fromJson(row.aiWarnings),
        aiFailed: row.aiFailed,
        heldSince: row.heldSince,
      };
    },
  );
}
