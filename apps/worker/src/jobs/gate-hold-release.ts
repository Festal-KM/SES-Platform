// apps/worker/src/jobs/gate-hold-release.ts
// 🔴 `gate.hold-release`（毎 10 分。docs/05 §9.3 / `F-027 AC-5`）。T-07-10。
//
// ============================================================================
// 🔴 このジョブがやることは 2 つだけである
// ============================================================================
//   ① AI の日次コスト上限に**余地が戻ったか**を再判定する（`probeAiCostHeadroom`）
//   ② 余地の件数だけ、保留中のゲートを **`gate.run` へ同じ payload・同じ `jobId` で積み直す**
//
// 🔴 **ここでゲートの結果を書かない。** 保留行を先に `DONE` にする処理を書いてはならない
//    （docs/05 §11.9 ⑧-7）。完了 CAS（`completeReviewGate`。`WHERE execution='HELD_AI_COST_LIMIT'`）は
//    多重化防止の**最後の防波堤**であり、ここで先に確定させると #39 の手動再実行と同時に走ったときに
//    「結果が 2 行・遷移が 2 回」が成立してしまう。
// 🔴 **公開要求（`ProjectPublishRequest`）にも触らない**（docs/05 §11.11 ⑪-1）。復帰後の実行は
//    保留行と公開要求からそのまま公開先を復元できる。
// 🔴 **失敗した `gate.run` の記録（BullMQ の `failed`）も消さない**（§9.10 ①）。同じ `jobId` の
//    失敗記録が残っていると `add` は静かに無視されるので、そのときは**積めなかったこととして
//    数えて返す**（`blockedByFailedJob`）。消してしまうと自動リトライになり、§16.5 の
//    失敗ジョブ数からも消えて「壊れているのに誰も気づかない」状態になる。復帰の入口は #39 である。
// 🔴 **LLM も外部 API も呼ばない。** だから `attempts: 3` を許せる（`packages/connectors/src/queues.ts`）。
//    呼ぶのは再 enqueue された `gate.run` であり、そこで上限判定を**最初から**通る ——
//    保留を経たものだけが判定を免れる経路を作らない（`send.hold-release` と同じ規律。§10.4）。
//
// ============================================================================
// 🔴 なぜ「自動で再実行してよい」のか（§10 の自動リトライ禁止との違い）
// ============================================================================
// 自動リトライを禁じているのは**外部送信ジョブ**である（`BR-21` / `BR-22`。二重送信が事故）。
// ゲートは自テナントの中で完結する検査であり、二度走っても外部には何も起きない。むしろ
// 自動で戻さなければ、上限に当たった提案は**利用者が気づいて手動で再依頼するまで
// `GATE_RUNNING` のまま**になる（`F-027 AC-5` が禁じている状態そのもの）。
import { gateInspectorReservationFloor, gateInspectorSpec, type RoleModelResolver } from '@ses/ai';
import type { GateRunEnqueueOutcome, GateRunJob, InternalJobName } from '@ses/connectors';
import { listPendingReviewGates, probeAiCostHeadroom, systemTenantCtx } from '@ses/db';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const GATE_HOLD_RELEASE_JOB = 'gate.hold-release' satisfies InternalJobName;

/** 🔴 毎 10 分（docs/05 §9.3）。時刻の出所はここ 1 箇所。 */
export const GATE_HOLD_RELEASE_SCHEDULE = { cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' } as const;

/**
 * 1 回の実行で走査する保留行の上限。
 * 🔴 復帰件数の上限ではない（それは `capacity`）。**1 回のジョブが DB を舐め続けないため**の
 *    ページサイズであり、残りは 10 分後の実行が古い順に拾う（`send.hold-release` と同じ）。
 */
export const GATE_HOLD_SCAN_LIMIT = 200;

export type GateHoldReleasePayload = { readonly tenantId: string };

export function parseGateHoldReleasePayload(raw: unknown): GateHoldReleasePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(GATE_HOLD_RELEASE_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  // 🔴 分離キーは payload から来るが、それはスケジュール側（テナントのファンアウト）が
  //    確定させた値である（docs/05 §9.1「payload に tenantId を必ず含める」）。
  return { tenantId: requireUuid(GATE_HOLD_RELEASE_JOB, 'tenantId', record.tenantId) };
}

export type GateHoldReleaseDeps = {
  readonly now: () => Date;
  /**
   * 🔴 ロール × テナントのモデル解決（`gate.run` に渡すものと**同じ実装**）。
   *    見積りはモデルの単価で決まるため、ここだけ別のモデルを見ると判定がずれる。
   */
  readonly models: RoleModelResolver;
  /**
   * テナントの 1 日の AI コスト上限（USD の十進文字列）。
   * 🔴 既定値をここで決め打ちしない（`packages/config` の `AI_DAILY_COST_LIMIT_USD_DEFAULT`、
   *    将来は `Plan.aiDailyCostLimitUsd`。docs/05 §7.12 ⑧）。**`gate.run` に渡す値と同じ**であること。
   */
  readonly aiDailyCostLimitUsd: string;
  /**
   * 🔴 **積める先は `gate.run` だけである**（docs/05 §17.2 #19。送信系の再 enqueue に転用させない）。
   *    引数の型が `GateRunJob` に固定されているため、他のジョブをここから積む形が存在しない。
   * 🔴 **戻り値を必ず見る**（`GateRunEnqueueOutcome`）。同じ `jobId` の `failed` 記録が残っていると
   *    BullMQ は `add` を静かに無視するため、`void` のままだと「復帰させた」と報告しながら
   *    実際には何も起きない状態を 10 分ごとに繰り返す（`CLAUDE.md` §11.1）。
   */
  readonly enqueueGateRun: (job: GateRunJob) => Promise<GateRunEnqueueOutcome>;
  readonly scanLimit?: number;
};

export type GateHoldReleaseOutcome = {
  /** 走査した保留行の数（0 なら上限に余地が無かったか、保留が 1 件も無い）。 */
  readonly scanned: number;
  /** 🔴 **実際に**キューに乗った数（`add` が無視されたものは含まない）。 */
  readonly requeued: number;
  /**
   * 🔴 同じ `jobId` の `failed` 記録が残っていて積めなかった数（§9.10 ②）。
   *
   * **0 でない状態は自動では解けない** —— 失敗記録を消せるのは利用者の再依頼（#39）だけである。
   * `A-005`（§16.5）の「失敗ジョブ」と対で見るための数であり、**`requeued` に混ぜない**
   * （混ぜた瞬間に「復帰させた」という嘘になる）。
   */
  readonly blockedByFailedJob: number;
  /**
   * この実行で使えた枠（**件数**。`BLOCK` なら 0）。
   * 🔴 金額（USD）は載せない（`F-027 AC-6`。運営平面の指標であり、ジョブの結果に混ぜない）。
   */
  readonly capacity: number;
};

export type GateHoldReleaseHandler = (payload: unknown, jobId: string) => Promise<GateHoldReleaseOutcome>;

export function createGateHoldReleaseHandler(deps: GateHoldReleaseDeps): GateHoldReleaseHandler {
  return async (payload, jobId) => {
    const job = parseGateHoldReleasePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: GATE_HOLD_RELEASE_JOB, jobId });
    const now = deps.now();

    // ① 🔴 上限の再判定（時刻ではなく**カウンタ**を見る。予約と同じ判定式を通る）。
    //    見積りは `gate-inspector` 1 回ぶんの**下限**（`packages/ai`）。多めに見積もると
    //    「上限より大きい見積り」で永久に復帰しない保留を作りうる（reservation.ts の 🔴）。
    const floor = gateInspectorReservationFloor();
    const modelId = await deps.models.resolve({
      tenantId: job.tenantId,
      role: gateInspectorSpec.role,
      tier: gateInspectorSpec.defaultModel,
    });
    const headroom = await probeAiCostHeadroom(ctx, {
      modelId,
      estimatedInputTokens: floor.estimatedInputTokens,
      maxOutputTokens: floor.maxOutputTokens,
      limitUsd: deps.aiDailyCostLimitUsd,
      now,
    });
    // 🔴 余地が無ければ**何もしない**（docs/05 §9.3）。積み直しても `gate.run` がまた保留にするだけで、
    //    10 分ごとに往復するだけになる（`send.hold-release` の「全件を戻して再保留させない」と同じ）。
    if (headroom.kind === 'BLOCK') {
      return { scanned: 0, requeued: 0, blockedByFailedJob: 0, capacity: 0 };
    }

    // ② 保留行を**古い順**に引く（飢餓を作らない。`listPendingReviewGates` の 🔴）。
    const rows = await listPendingReviewGates(ctx, { limit: deps.scanLimit ?? GATE_HOLD_SCAN_LIMIT });

    let requeued = 0;
    let blockedByFailedJob = 0;
    for (const row of rows) {
      // 🔴 枠の分だけ。残りは 10 分後の実行が同じ順序で拾う。
      if (requeued >= headroom.capacity) break;
      // 🔴 **同じ payload・同じ `jobId`**（`jobId` は enqueue 側の 1 実装が組み立てる）。
      //    #39 の手動再実行と同時に走っても、キューに乗るのは 1 本である（重複排除）。
      const outcome = await deps.enqueueGateRun({
        tenantId: job.tenantId,
        targetType: row.targetType,
        targetId: row.targetId,
        contentHash: row.contentHash,
      });
      if (outcome === 'BLOCKED_BY_FAILED_JOB') {
        // 🔴 **失敗記録をここで消さない。** 消せば自動リトライになり、§16.5 の失敗ジョブ数から
        //    消えて「壊れているのに誰も気づかない」状態を作る（§9.10 ①「BullMQ の retry に
        //    相当する運営者操作を作らない」の趣旨）。復帰の入口は利用者の #39 だけである。
        //    🔴 代わりに**数えて返す**（黙って `requeued` に足さない）。枠も消費しない。
        blockedByFailedJob += 1;
        continue;
      }
      requeued += 1;
    }

    return { scanned: rows.length, requeued, blockedByFailedJob, capacity: headroom.capacity };
  };
}
