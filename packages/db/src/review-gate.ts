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
import type {
  GateExecution,
  GateFinding,
  GateTargetType,
  GateVerdict,
  PersistedGateResult,
  ProjectPublishRunTrigger,
} from '@ses/domain';
import { AI_COST_PERIOD_KIND } from './ai-cost-guard.js';
import type { AuthenticatedTenantCtx, SystemTenantCtx } from './context.js';
import { usagePeriodResetAt } from './usage-period.js';
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

/**
 * 走査（`gate.hold-release`）が受け取る保留行。
 *
 * 🔴 対象を指定せずに引くので、`PendingReviewGate` に**どの対象か**を足した形である ——
 *    再 enqueue の payload（`{ tenantId, targetType, targetId, contentHash }`）を
 *    **この行だけから**組み立てられることが要点である（§11.9 ⑧-7「同じ payload・同じ `jobId`」）。
 */
export type PendingReviewGateRow = PendingReviewGate & {
  readonly targetType: GateTargetType;
  readonly targetId: string;
};

/**
 * 🔴 T-12-10: **この行を作った実行の契機**（`review_gates.run_trigger`。docs/05 §3.6 / §11.11
 *    「T-12-10 の実装の決着」⑪）。`PROJECT_PUBLISH` のときだけ値を持ち、他の対象では `null`。
 *
 * 🔴 **省略可能にしない**（`?:` を付けない）。書き忘れは DB の CHECK
 *    （`(target_type='PROJECT_PUBLISH') = (run_trigger IS NOT NULL)`）が INSERT で落とすが、
 *    型の側でも「渡したかどうか」を呼び出し側に必ず書かせる（`GateInput` から写すだけである）。
 */
type ReviewGateRunTriggerInput = {
  readonly runTrigger: ProjectPublishRunTrigger | null;
};

export type ReviewGateResultInput = ReviewGateKey & ReviewGateRunTriggerInput & {
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

export type ReviewGateHoldInput = ReviewGateKey & ReviewGateRunTriggerInput & {
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
 * すでに開いているテナントトランザクションのクライアントのうち、ゲート結果の読み取りに要るもの。
 * 🔴 `TenantDb` そのものを export しない（docs/05 §4.3 実装の規約 3。`AuditLogWriter` と同じ手法）。
 */
export type ReviewGateReader = Pick<
  Parameters<Parameters<typeof runInTenantTransaction<void>>[1]>[0],
  'reviewGate'
>;

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
  ctx: AuthenticatedTenantCtx,
  key: ReviewGateKey,
): Promise<CompletedReviewGate | null> {
  return runInTenantTransaction(
    // 🔴 分離キーは ctx から**そのまま**取る（`readReviewGateResult` と同じ理由。T-07-08 で
    //    #39 が利用者の文脈から呼ぶようになった）。ホスト相当に固定すると、パートナー所属の
    //    利用者の判定が他社の行を見てしまう。
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
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

/**
 * 🔴 その対象について「**外部へ共有してよい**」と言えるゲート結果があるか（`F-020 AC-1`）。T-07-09。
 *
 * 条件は承認 CAS（§11.5 手順 3）と**同じ 3 つ**である: `execution='DONE'` かつ 3 層すべて `PASS`。
 * 🔴 `execution='DONE'` を落とすと、AI 上限で保留中の行（判定は NULL）が「PASS ではない」ではなく
 *    「未判定」として素通りしうる。保留は共有の許可ではない（`F-027 AC-5`）。
 * 🔴 `aiFailed` は条件に入れない —— AI が失敗した実行はそもそも PII / 商流が FAIL であり
 *    （§11.4）、3 層 PASS の条件に到達しない。
 *
 * 🔴 引数の `db` は**すでに開いているトランザクションのクライアント**である（`writeAuditLog` と
 *    同じ受け方）。共有の可否は「共有物を読んだのと同じトランザクション」で判定しなければ、
 *    判定と発行の間に結果が変わりうる。
 */
export async function findPassedReviewGate(
  db: ReviewGateReader,
  target: Pick<ReviewGateKey, 'targetType' | 'targetId'>,
): Promise<{ readonly id: string } | null> {
  return db.reviewGate.findFirst({
    where: {
      targetType: target.targetType,
      targetId: target.targetId,
      execution: 'DONE',
      piiVerdict: 'PASS',
      commerceVerdict: 'PASS',
      consistencyVerdict: 'PASS',
    },
    orderBy: { executedAt: 'desc' },
    select: { id: true },
  });
}

/** 保留中の行を読む（対象ごとに 1 行。部分 UNIQUE）。 */
export async function findPendingReviewGate(
  ctx: AuthenticatedTenantCtx,
  target: Pick<ReviewGateKey, 'targetType' | 'targetId'>,
): Promise<PendingReviewGate | null> {
  return runInTenantTransaction(
    // 🔴 `findCachedReviewGate` と同じ（#39 が利用者の文脈から呼ぶ。T-07-08）。
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
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
 * 🔴 保留中の行を古い順に列挙する（`gate.hold-release` の走査。docs/05 §9.3 / `F-027 AC-5`）。T-07-10。
 *
 * 🔴 **`findPendingReviewGate` と同じ母集団（`execution <> 'DONE'`）を、対象を指定せずに引く。**
 *    保留は対象ごとに 1 行しか作れない（部分 UNIQUE）ので、行数 = 保留中の対象数である。
 * 🔴 **`held_since` の昇順**（`send.hold-release` と同じ配り方）。上限の余地は限られており、
 *    毎回同じ順序でないと**新しい保留に押されて古い保留が永久に再開されない**（飢餓）。
 *    同時刻の並びが実行のたびに変わらないよう `id` を第 2 キーにする（`id` は uuidv7 = 時刻順）。
 * 🔴 **ここで行を書き換えない。** 復帰は `gate.run` の完了 CAS が確定させる（多重化防止の 3 段目。
 *    §11.9 ⑧-7「`gate.hold-release` 側に『先に DONE にする』処理を書かない」）。
 */
export async function listPendingReviewGates(
  ctx: SystemTenantCtx,
  options: { readonly limit: number },
): Promise<readonly PendingReviewGateRow[]> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.reviewGate.findMany({
        where: { execution: { not: 'DONE' } },
        orderBy: [{ heldSince: 'asc' }, { id: 'asc' }],
        take: options.limit,
        select: {
          id: true,
          targetType: true,
          targetId: true,
          contentHash: true,
          heldSince: true,
          consistencyVerdict: true,
        },
      });
      return rows.flatMap((row) =>
        row.heldSince === null
          ? []
          : [
              {
                id: row.id,
                targetType: row.targetType as GateTargetType,
                targetId: row.targetId,
                contentHash: row.contentHash,
                heldSince: row.heldSince,
                consistencyVerdict: row.consistencyVerdict as GateVerdict,
              },
            ],
      );
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
           consistency_verdict, findings, ai_warnings, ai_failed, run_trigger)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, ${input.targetType}, ${input.targetId}::uuid,
           ${input.contentHash}, 'HELD_AI_COST_LIMIT', ${input.heldSince}::timestamptz,
           ${input.consistencyVerdict}, ${findings}::jsonb, '[]'::jsonb, false, ${input.runTrigger})
        ON CONFLICT (tenant_id, target_type, target_id) WHERE execution <> 'DONE'
        DO UPDATE SET
          content_hash = EXCLUDED.content_hash,
          consistency_verdict = EXCLUDED.consistency_verdict,
          findings = EXCLUDED.findings,
          -- 🔴 T-12-10: 保留が差し替わったら契機も差し替える（保留行は対象ごとに 1 行であり、
          --    公開の保留中に再検査が来ることがある。行が表すのは「最後の実行」である）。
          run_trigger = EXCLUDED.run_trigger
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
    executed_at = ${input.executedAt}::timestamptz,
    run_trigger = ${input.runTrigger}
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
           role, prompt_version, model_id, ai_usage_id, ai_failed, executed_at, run_trigger)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, ${input.targetType}, ${input.targetId}::uuid,
           ${input.contentHash}, 'DONE', NULL,
           ${input.piiVerdict}, ${input.commerceVerdict}, ${input.consistencyVerdict},
           ${findings}::jsonb, ${warnings}::jsonb,
           ${input.role}, ${input.promptVersion}, ${input.modelId}, ${input.aiUsageId}::uuid,
           ${input.aiFailed}, ${input.executedAt}::timestamptz, ${input.runTrigger})
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
 * 対象のゲート結果 1 行（#40 の最新 1 件 / #40b の履歴の各行）。`PersistedGateResult` の射影に
 * 行の識別子と 2 つの時刻を足した形。
 *
 * - `executedAt` … `execution='DONE'` のとき非 NULL（確定した時刻）。保留行は `null`
 * - `heldSince` … `execution='HELD_AI_COST_LIMIT'` のとき非 NULL（最初に保留した時刻）。確定行は `null`
 */
export type ReviewGateResultRow = PersistedGateResult & {
  readonly id: string;
  readonly executedAt: Date | null;
  readonly heldSince: Date | null;
  /**
   * 🔴 T-12-10: 実行の契機（`PROJECT_PUBLISH` のみ。提案の行は `null`）。
   *    `S-013` セクション 4 が 1 行ずつに添えるラベル（`公開の実行` / `公開欄の編集による再検査`）の出所。
   */
  readonly runTrigger: ProjectPublishRunTrigger | null;
};

/**
 * 🔴 並びのキー（`COALESCE(executed_at, held_since)` の JS 版）。
 *
 * `execution='DONE'` の行は `executed_at` が、保留行は `held_since` が必ず入る
 * （migration 20260903020000 の CHECK）。**両方 NULL は不変条件違反であり、`0` や
 * `new Date()` へ黙って落とさず例外にする**（T-12-14 レビュー対応）。
 */
function reviewGateSortKey(row: { readonly executedAt: Date | null; readonly heldSince: Date | null }): number {
  if (row.executedAt !== null) return row.executedAt.getTime();
  if (row.heldSince !== null) return row.heldSince.getTime();
  throw new Error(
    'review_gates の行が executedAt と heldSince の両方とも NULL です（docs/05 §3.6 の CHECK が壊れています）。',
  );
}

/**
 * 🔴 対象のゲート結果を**全行**読む（#40b `GET /api/proposals/{id}/gate-results`。docs/05 §6.5
 *    「#40b と `S-023` セクション 4 の設計」/ `F-020 AC-7`）。T-12-14 ②。
 *
 * 🔴 **#40（`readReviewGateResult`）の母集団はこの関数である。** 「最新の 1 件」と「履歴の全行」で
 *    `where` / `select` を別々に書くと、片方だけに条件が増えて「履歴には出るが現在の結果には出ない行」
 *    （またはその逆）が生まれる。母集団のクエリは 1 実装にし、#40 はその結果から 1 行選ぶだけにする。
 *
 * 🔴 並びは **`COALESCE(executed_at, held_since) DESC, id DESC`**（新しい実行が先。保留行は
 *    `executed_at` を持たないので保留開始時刻で並ぶ）。保留行は部分 UNIQUE により対象ごとに高々 1 行で、
 *    確定行は保留行を CAS で確定させた後にしか増えない（`completeReviewGate`）ため、保留行があれば
 *    常に先頭に来る。`id`（uuidv7 = 時刻順）を第 2 キーにして、同時刻でも並びが実行のたびに変わらないようにする。
 *
 * 🔴 **利用者の文脈（`AuthenticatedTenantCtx`）で呼ぶ**（#40 / #40b / `S-023`）。したがって分離キーは
 *    ctx から**そのまま**取る —— 上の書き込み系のように `partnerCompanyId: null`（ホスト相当）に
 *    固定してはならない。固定すると、パートナー所属の利用者の読み取りがホスト文脈で走り、
 *    `review_gates` の C5 ポリシー（`app_is_host() OR owner_partner_company_id = app_partner_id()`）が
 *    **他社のゲート結果まで見せてしまう**（`CLAUDE.md` §3.1 の第二境界をその場で破る）。
 *    `SystemTenantCtx` は `AuthenticatedTenantCtx` の部分型であり、その `partnerCompanyId` は
 *    常に `null` なので、ジョブ側の呼び出しの振る舞いは 1 ビットも変わらない。
 * 🔴 **読み取りは Prisma デリゲートで行う**（クライアント拡張のテナントスコープ注入 = 第 2 防御を通すため。
 *    `COALESCE` の並びは `orderBy` で表せないので JS で作る —— 1 対象あたり数行であり、旧実装も全行読んでいた）。
 */
export async function listReviewGateResults(
  ctx: AuthenticatedTenantCtx,
  target: Pick<ReviewGateKey, 'targetType' | 'targetId'>,
): Promise<readonly ReviewGateResultRow[]> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => listReviewGateResultsIn(tx, target),
  );
}

/**
 * 🔴 `listReviewGateResults` の本体（**すでに開いているトランザクションのクライアント**で読む）。
 *    T-12-10（docs/05 §11.11「T-12-10 の実装の決着」⑤）。
 *
 * 🔴 **母集団・射影・並びの実装はここ 1 つだけである。** 案件の公開の状態（`#27` のホストの枝）は
 *    公開範囲・公開要求と**同じトランザクション**で読む必要があるため、`ctx` からトランザクションを
 *    開く版を呼べない。**書き写すのではなく、トランザクションの開き方だけを外に出す。**
 * 🔴 分離キーは**呼び出し側が開いたトランザクション**が持つ（`withTenant` / `runInTenantTransaction`
 *    が `SET LOCAL` 済み）。ここで ctx を見ない ＝ ホスト相当に固定する余地も無い。
 */
export async function listReviewGateResultsIn(
  db: ReviewGateReader,
  target: Pick<ReviewGateKey, 'targetType' | 'targetId'>,
): Promise<readonly ReviewGateResultRow[]> {
  const rows = await db.reviewGate.findMany({
    where: { targetType: target.targetType, targetId: target.targetId },
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
      executedAt: true,
      heldSince: true,
      // 🔴 T-12-10: 実行の契機（`S-013` セクション 4 のラベル）。
      runTrigger: true,
    },
  });
  return [...rows]
    .sort((a, b) => {
      const diff = reviewGateSortKey(b) - reviewGateSortKey(a);
      if (diff !== 0) return diff;
      if (b.id > a.id) return 1;
      if (b.id < a.id) return -1;
      return 0;
    })
    .map((row) => ({
      id: row.id,
      execution: row.execution as GateExecution,
      contentHash: row.contentHash,
      piiVerdict: row.piiVerdict as GateVerdict | null,
      commerceVerdict: row.commerceVerdict as GateVerdict | null,
      consistencyVerdict: row.consistencyVerdict as GateVerdict,
      findings: fromJson(row.findings),
      aiWarnings: fromJson(row.aiWarnings),
      aiFailed: row.aiFailed,
      executedAt: row.executedAt,
      heldSince: row.heldSince,
      runTrigger: row.runTrigger as ProjectPublishRunTrigger | null,
    }));
}

/**
 * 対象の最新のゲート結果を読む（#40 / 承認画面が使う。docs/05 §11.7）。
 *
 * 🔴 T-12-14 ②: 母集団は `listReviewGateResults`（#40b と同じ 1 実装）であり、本関数は
 *    その結果から **保留行（`execution <> 'DONE'`）を優先して 1 行選ぶ**だけである。
 *    保留中に古い `DONE` の行を返すと、画面は「確定済み」と表示し、利用者は上限で止まっていることに
 *    気づけない（`F-027 AC-5`）。並びは上の関数が保証しているので、保留行が無ければ先頭 = 最新の確定行。
 *
 * 🔴 分離キーの扱い（ctx からそのまま取る理由）は `listReviewGateResults` の注記のとおり（T-07-08）。
 */
export async function readReviewGateResult(
  ctx: AuthenticatedTenantCtx,
  target: Pick<ReviewGateKey, 'targetType' | 'targetId'>,
): Promise<ReviewGateResultRow | null> {
  const rows = await listReviewGateResults(ctx, target);
  return rows.find((candidate) => candidate.execution !== 'DONE') ?? rows[0] ?? null;
}

/** `GateHeldView`（docs/05 §11.7）の時刻 2 つ。ISO 8601。 */
export type GateHoldTimestamps = {
  readonly heldSince: string;
  readonly resetAt: string;
};

/**
 * 🔴 保留の「いつから」と「いつ再開するか」（#40 が `GateHeldView` を組み立てるために使う。
 *    docs/05 §11.7 / §11.9 ⑧-4）。T-07-08。
 *
 * 🔴 **`packages/domain` では作れない。** `resetAt` は暦（`Asia/Tokyo` の翌 0 時）の計算であり、
 *    domain は `new Date(...)` を持てない（`tests/static/domain-purity.test.ts`。§17.2 #14）。
 * 🔴 期間の種別は AI の日次コスト上限と**同じ 1 つの定数**（`AI_COST_PERIOD_KIND`）から取る。
 *    ここに `'DAY'` を書き写すと、上限の集計期間を変えたときに「表示だけ古い暦」になる。
 * 🔴 金額（USD）を返さない（`F-027 AC-6`。利用者に見せてよいのは理由と再開時刻だけ）。
 */
export function gateHoldTimestamps(input: {
  readonly heldSince: Date;
  readonly now: Date;
}): GateHoldTimestamps {
  return {
    heldSince: input.heldSince.toISOString(),
    resetAt: usagePeriodResetAt(AI_COST_PERIOD_KIND, input.now).toISOString(),
  };
}
