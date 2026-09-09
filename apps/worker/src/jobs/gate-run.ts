// apps/worker/src/jobs/gate-run.ts
// 🔴 品質ゲートのパイプライン（`gate.run`。docs/05 §9.3 / §11.1〜§11.7 / `F-020`）。T-07-06。
//
// ============================================================================
// 🔴 入口はこのジョブ 1 本である（docs/05 §11.1）
// ============================================================================
// テナント外へ共有される対象は、**すべてこのジョブの結果を参照して**共有状態へ進む。
// ゲートを経ずに共有状態へ進む API は存在しない（§6.8 / `F-020 AC-1`）。
//
// ============================================================================
// 🔴 3 層の実行順（docs/05 §11.2）
// ============================================================================
//   対象の読み出し → ┬→ 整合層（機械的照合。**AI を待たない / AI の成否と独立**）
//                    └→ マスキング → gate-inspector（PII 層 + 商流層 + 整合層の警告）
//                                  → 合否の合成（`decideGate`）→ `ReviewGate` 保存 → 状態遷移
//
// 🔴 **AI 呼び出しは 1 回**（PII 層と商流層をまとめて返す。コストと 30 秒目標の両方から）。
//
// ============================================================================
// 🔴 「呼んで失敗した」と「上限で呼べなかった」を分ける（docs/05 §7.4 / §7.6 / §11.4）
// ============================================================================
//   - `RoleResult.ok === false`（タイムアウト / スキーマ違反 / API エラー）
//       → **PII 層・商流層は判定不能 = FAIL**。`aiFailed = true`。**PASS へ倒さない**
//   - `AiCostLimitExceededError`（テナントの 1 日コスト上限で**呼ばなかった**）
//       → **合否を確定させない**。`ReviewGate(execution='HELD_AI_COST_LIMIT')` を upsert し、
//         対象は `GATE_RUNNING` のまま。ジョブは**正常終了**する（失敗ジョブ数に混ぜない）
// 🔴 この 2 つを同じ枝で扱うと、ゲート FAIL 率（`F-059`）が汚れ、直すべき元データが無いのに
//    「修正して再実行」を促す誤った導線になる（`CLAUDE.md` §4.2「失敗と保留を混同しない」）。
//
// ============================================================================
// 🔴 再試行しない（`attempts: 1`。docs/05 §9.3）
// ============================================================================
// LLM の再試行は `runRole` の内部で最大 2 回まで行う。ジョブ単位で再試行すると
// マスキングとプロンプト構築からやり直しになり `AiUsage` が二重に積まれる（原価が実態と合わない）。

import {
  AiCostLimitExceededError,
  createRoleRunner,
  gateInspectorSpec,
  interpretGateInspection,
  prepareGateExamination,
  type RoleModelResolver,
  type createAiClient,
} from '@ses/ai';
import { GATE_RUN_JOB } from '@ses/connectors';
import {
  completeReviewGate,
  findCachedReviewGate,
  holdReviewGate,
  loadGateInput,
  settleProjectPublish,
  systemTenantCtx,
  withTenant,
  writeAuditLog,
  type ProjectPublishSettlement,
  type SystemTenantCtx,
} from '@ses/db';
import {
  decideConsistency,
  decideGate,
  isGateTargetType,
  proposalMachine,
  type GateAiOutcome,
  type GateDecision,
  type GateInput,
  type GateTargetType,
  type GateVerdict,
} from '@ses/domain';
import { createAiCostGuard } from '../ai/cost-guard.js';
import { createAiUsageRecorder } from '../ai/usage-recorder.js';
import { InvalidJobPayloadError, requireNonEmptyString, requireUuid } from './payload.js';

export { GATE_RUN_JOB } from '@ses/connectors';

/** 🔴 `createAiClient` の戻り値の型（ポートはバレルから出ていない。docs/05 §7.9 ⑦）。 */
type AiClient = ReturnType<typeof createAiClient>;

export type GateRunPayload = {
  readonly tenantId: string;
  readonly targetType: GateTargetType;
  readonly targetId: string;
  readonly contentHash: string;
};

/**
 * ジョブの帰結。
 *
 * - `COMPLETED` … 3 層が確定し `ReviewGate` に保存した
 * - `ALREADY_DONE` … 🔴 同じ内容の確定結果が既にある（`P-A-09`。再実行しない）
 * - 🔴 `HELD_AI_COST_LIMIT` … AI の日次上限で**呼べなかった**。合否は未確定のまま保持した
 * - 🔴 `RACED` … 保留行を別の実行が先に確定させた。**結果を破棄した**（多重化防止の 3 段目）
 * - `TARGET_NOT_FOUND` … 対象が消えている（削除済み）。**PASS にはしない**
 */
export type GateRunOutcome =
  | {
      readonly kind: 'COMPLETED';
      readonly reviewGateId: string;
      readonly overall: 'PASS' | 'FAIL';
      readonly aiFailed: boolean;
      /** 対象の状態を実際に動かしたか（`GATE_RUNNING` からの CAS が 1 件だったか）。 */
      readonly transitioned: boolean;
      /** 🔴 案件の公開の確定（T-07-09）。対象が `PROJECT_PUBLISH` 以外なら `null`。 */
      readonly publish: ProjectPublishSettlement | null;
    }
  | {
      readonly kind: 'ALREADY_DONE';
      readonly reviewGateId: string;
      /** 🔴 確定済みの結果でも**公開の確定は行う**（下記 `settlePublish` の 🔴）。 */
      readonly publish: ProjectPublishSettlement | null;
    }
  | { readonly kind: 'HELD_AI_COST_LIMIT'; readonly reviewGateId: string }
  | { readonly kind: 'RACED' }
  | { readonly kind: 'TARGET_NOT_FOUND' };

export type GateRunDeps = {
  readonly now: () => Date;
  /** 🔴 起動時に 1 回組み立てる（docs/05 §7.12 ⑤。外部資源を持つ 2 ポート）。 */
  readonly aiClient: AiClient;
  readonly models: RoleModelResolver;
  /**
   * テナントの 1 日の AI コスト上限（USD の十進文字列）。
   * 🔴 既定値をここで決め打ちしない（`packages/config` の `AI_DAILY_COST_LIMIT_USD_DEFAULT`、
   *    将来は `Plan.aiDailyCostLimitUsd`。docs/05 §7.12 ⑧）。
   */
  readonly aiDailyCostLimitUsd: string;
};

export type GateRunHandler = (payload: unknown, jobId: string) => Promise<GateRunOutcome>;

export function parseGateRunPayload(raw: unknown): GateRunPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(GATE_RUN_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  const targetType = requireNonEmptyString(GATE_RUN_JOB, 'targetType', record.targetType);
  if (!isGateTargetType(targetType)) {
    throw new InvalidJobPayloadError(GATE_RUN_JOB, `targetType が不正です: ${targetType}`);
  }
  return {
    // 🔴 分離キーは payload から来るが、それはジョブの enqueue 側（認証済み経路）が
    //    確定させた値である（`CLAUDE.md` §3.1 / docs/05 §9.1「payload に tenantId を必ず含める」）。
    tenantId: requireUuid(GATE_RUN_JOB, 'tenantId', record.tenantId),
    targetType,
    targetId: requireUuid(GATE_RUN_JOB, 'targetId', record.targetId),
    contentHash: requireNonEmptyString(GATE_RUN_JOB, 'contentHash', record.contentHash),
  };
}

/**
 * 🔴 提案の状態を確定させる（`GATE_RUNNING` → `APPROVAL_PENDING` / `GATE_FAILED`）。
 *
 * 🔴 **CAS である**（`WHERE state='GATE_RUNNING'`）。0 件なら**何もしない** ——
 *    利用者が内容を編集して `DRAFT` に戻していたり、別の実行が先に確定させている。
 *    そこへ上書きすると「編集したのに古い検査結果で承認待ちになる」（§11.5 が防いでいる事故）。
 * 🔴 自動承認（`shouldAutoApprove`。§11.6）はここで行わない —— 承認は `F-021`（SP-09）の
 *    範囲であり、`Proposal.approvedBy` / `approvedAt` / `ProposalEvent` の記録と一体である。
 */
async function settleProposalState(
  ctx: SystemTenantCtx,
  input: { readonly proposalId: string; readonly decision: GateDecision; readonly now: Date },
): Promise<boolean> {
  // 🔴 遷移の妥当性は `packages/domain` の遷移表が決める（不正な組はここで例外になる）。
  //    `GATE_RUNNING` から行ける先は `GATE_FAILED` / `APPROVAL_PENDING` の 2 つだけであり、
  //    それ以外を書くとコンパイルエラーになる（docs/05 §10.3）。
  const to = proposalMachine.transition(
    'GATE_RUNNING',
    input.decision.overall === 'PASS' ? 'APPROVAL_PENDING' : 'GATE_FAILED',
  );

  return withTenant(ctx, async (db) => {
    const updated = await db.proposal.updateMany({
      where: { id: input.proposalId, state: 'GATE_RUNNING' },
      data: { state: to },
    });
    if (updated.count !== 1) return false;

    await db.proposalEvent.create({
      data: {
        // 🔴 分離キーは ctx（認証コンテキスト）から取る。値が ctx と違えば Prisma 拡張が例外にする。
        tenantId: ctx.tenantId,
        proposalId: input.proposalId,
        kind: 'STATE',
        fromState: 'GATE_RUNNING',
        toState: to,
        // 🔴 `actorUserId` は null = system（docs/05 §3.6）。
        actorUserId: null,
        occurredAt: input.now,
      },
    });
    // 🔴 状態を変えるジョブは `AuditLog`（`actorKind='SYSTEM'`）を書く（docs/05 §9.1）。
    //    独自の action を作らず `*.update` に畳む（`S-041` の操作種別フィルタから漏らさない。§16.1）。
    await writeAuditLog(db, {
      action: 'proposal.update',
      actorKind: 'SYSTEM',
      targetType: 'PROPOSAL',
      targetId: input.proposalId,
      summary: {
        operation: 'GATE_RESULT',
        // 🔴 件数・状態・判定だけを載せる（指摘の本文を載せない。§16.2）。
        overall: input.decision.overall,
        piiVerdict: input.decision.piiVerdict,
        commerceVerdict: input.decision.commerceVerdict,
        consistencyVerdict: input.decision.consistencyVerdict,
        aiFailed: input.decision.aiFailed,
        findingCount: input.decision.findings.length,
        warningCount: input.decision.aiWarnings.length,
      },
    });
    return true;
  });
}

/**
 * 🔴 案件の公開を確定させる（T-07-09。`F-014` 処理② / `F-020 AC-1`）。
 *
 * 🔴 **公開範囲の行を作るのはここだけ**である（`apps/web` の `#28` は解除しかしない）。
 *    実体は `packages/db` の `settleProjectPublish`（`apps/web` と `apps/worker` は相互に
 *    import できないため、共有点は `packages/db` しか無い）。
 * 🔴 **確定済み（キャッシュ）の結果でも呼ぶ。** `#28` は「同じ内容の確定結果がある」ことを
 *    理由に依頼を断らない（提案の `#39` と違う。理由は `publish-gate.ts` の 🔴）。
 *    したがって「A に公開 → 解除 → もう一度 A に公開」はキャッシュを引き当てるが、
 *    ここで確定させなければ**公開要求だけが残って永久に公開されない**。
 *    確定は `(project_id, content_hash)` の CAS なので、二重に実行しても行は 1 度しか動かない。
 */
async function settlePublish(
  ctx: SystemTenantCtx,
  input: {
    readonly targetType: GateTargetType;
    readonly targetId: string;
    readonly contentHash: string;
    readonly reviewGateId: string;
    readonly piiVerdict: GateVerdict;
    readonly commerceVerdict: GateVerdict;
    readonly consistencyVerdict: GateVerdict;
    readonly now: Date;
  },
): Promise<ProjectPublishSettlement | null> {
  if (input.targetType !== 'PROJECT_PUBLISH') return null;
  return settleProjectPublish(ctx, {
    projectId: input.targetId,
    contentHash: input.contentHash,
    reviewGateId: input.reviewGateId,
    piiVerdict: input.piiVerdict,
    commerceVerdict: input.commerceVerdict,
    consistencyVerdict: input.consistencyVerdict,
    now: input.now,
  });
}

/**
 * 🔴 ゲートを 1 回実行する。
 *
 * @throws GateFactsUnavailableError / UnsupportedGateTargetError / EmptyGateContentError
 *         いずれも `ReviewGate` を 1 行も書かずに落ちる（＝ 対象は共有状態へ進めない）。
 */
export function createGateRunHandler(deps: GateRunDeps): GateRunHandler {
  return async (payload, jobId) => {
    const parsed = parseGateRunPayload(payload);
    const job = { queue: GATE_RUN_JOB, jobId } as const;
    const ctx = systemTenantCtx(parsed.tenantId, job);
    const key = {
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      contentHash: parsed.contentHash,
    };

    // ① 🔴 同じ内容の確定結果があれば再実行しない（`P-A-09` / `F-020 AC-3`）。
    //    🔴 `aiFailed = true` の行はキャッシュにならない（`findCachedReviewGate` の 🔴）。
    const cached = await findCachedReviewGate(ctx, key);
    if (cached !== null) {
      // 🔴 検査はしないが、**その結果での確定はする**（`settlePublish` の 🔴）。
      const publish = await settlePublish(ctx, {
        ...key,
        reviewGateId: cached.id,
        piiVerdict: cached.piiVerdict,
        commerceVerdict: cached.commerceVerdict,
        consistencyVerdict: cached.consistencyVerdict,
        now: deps.now(),
      });
      return { kind: 'ALREADY_DONE', reviewGateId: cached.id, publish };
    }

    // ② 対象を読み、検査する内容を組み立てる（docs/05 §11.2 の BUILD）。
    const lookup = await loadGateInput(ctx, key);
    if (lookup.kind === 'NOT_FOUND') return { kind: 'TARGET_NOT_FOUND' };
    const input: GateInput = lookup.input;

    // ③ 🔴 整合層（機械的照合）。**AI を待たない / AI の成否と独立**（`BR-61` / `F-027 AC-5`）。
    const consistency = decideConsistency(input.consistency);

    // ④ マスキングと機械的検出（AI の見落としに対する保険）。
    const prepared = prepareGateExamination(input);

    // ⑤ AI の実行（1 回）。
    const runner = createRoleRunner({
      client: deps.aiClient,
      // 🔴 記録器とコストガードは**ジョブ単位**で組み立てる（docs/05 §7.11 ④ / §7.12 ⑤）。
      usage: createAiUsageRecorder(job),
      costGuard: createAiCostGuard({ job, dailyLimitUsd: deps.aiDailyCostLimitUsd }),
      models: deps.models,
    });

    let ai: GateAiOutcome;
    let role: string | null = null;
    let promptVersion: string | null = null;
    let modelId: string | null = null;
    let aiUsageId: string | null = null;

    try {
      const result = await runner.runRole(gateInspectorSpec, prepared.inspectorInput, {
        tenantId: ctx.tenantId,
        // 🔴 `AiUsage.targetType` にはゲートの対象種別をそのまま入れる（`F-026` の記録項目。
        //    ロール別原価（`F-063`）を対象種別で割れるようにするため）。
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        // 🔴 マスキングの要約を `AiUsage` へ運ぶ（docs/05 §7.11 ③）。
        maskHits: prepared.maskHits,
        now: deps.now,
      });
      if (result.ok) {
        ai = { ok: true, ...interpretGateInspection(prepared, result.output) };
        role = result.provenance.role;
        promptVersion = result.provenance.promptVersion;
        modelId = result.provenance.modelId;
        // 🔴 `ReviewGate.aiUsageId` は 1 本しか持てないので、成功した試行（＝ 最後の行）を指す。
        aiUsageId = result.provenance.aiUsageIds[result.provenance.aiUsageIds.length - 1] ?? null;
      } else {
        // 🔴 判定不能 = FAIL（`F-020` の AI 利用欄）。**PASS へフォールバックしない。**
        //    出所（`role` / `promptVersion` / `modelId` / `aiUsageId`）は `null` のままにする ——
        //    「その版で検査した」という記録にならないため（`BR-13`）。
        ai = { ok: false };
      }
    } catch (error) {
      if (error instanceof AiCostLimitExceededError) {
        // 🔴 上限で**呼べなかった**。合否を確定させず、整合層の結果だけを保持する。
        //    対象は `GATE_RUNNING` のまま（`GATE_FAILED` にしない。`F-027 AC-5`）。
        //    ジョブは**正常終了**する（BullMQ の failed に入れない = 失敗ジョブ数に混ぜない）。
        const held = await holdReviewGate(ctx, {
          ...key,
          consistencyVerdict: consistency.verdict,
          findings: consistency.findings,
          heldSince: deps.now(),
        });
        return { kind: 'HELD_AI_COST_LIMIT', reviewGateId: held.id };
      }
      throw error;
    }

    // ⑥ 合否の合成（docs/05 §11.4）。
    const decision = decideGate({
      ai,
      consistency,
      mechanicalPii: prepared.mechanicalPii,
      mechanicalCommerce: prepared.mechanicalCommerce,
    });

    // ⑦ 保存（`F-020 AC-7`）。🔴 保留行があれば CAS で確定させ、0 件なら結果を破棄する。
    const executedAt = deps.now();
    const saved = await completeReviewGate(ctx, {
      ...key,
      piiVerdict: decision.piiVerdict,
      commerceVerdict: decision.commerceVerdict,
      consistencyVerdict: decision.consistencyVerdict,
      findings: decision.findings,
      aiWarnings: decision.aiWarnings,
      aiFailed: decision.aiFailed,
      role,
      promptVersion,
      modelId,
      aiUsageId,
      executedAt,
    });
    if (saved.kind === 'RACED') return { kind: 'RACED' };

    // ⑧ 対象の状態を確定させる。
    //    🔴 状態機械を動かすのは提案だけである（`CLAUDE.md` §4.2 の 5 つに案件の公開は無い）。
    const transitioned =
      parsed.targetType === 'PROPOSAL'
        ? await settleProposalState(ctx, {
            proposalId: parsed.targetId,
            decision,
            now: executedAt,
          })
        : false;

    // ⑨ 🔴 T-07-09: 案件の公開を確定させる（PASS なら公開範囲の行、FAIL なら 1 行も作らない）。
    const publish = await settlePublish(ctx, {
      ...key,
      reviewGateId: saved.id,
      piiVerdict: decision.piiVerdict,
      commerceVerdict: decision.commerceVerdict,
      consistencyVerdict: decision.consistencyVerdict,
      now: executedAt,
    });

    return {
      kind: 'COMPLETED',
      reviewGateId: saved.id,
      overall: decision.overall,
      aiFailed: decision.aiFailed,
      transitioned,
      publish,
    };
  };
}
