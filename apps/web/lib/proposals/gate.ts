// apps/web/lib/proposals/gate.ts
// 🔴 **品質ゲートの入口（#39）と結果の読み出し（#40）**（docs/05 §6.5 #39 / #40 / §9.10 / §11.5 / §11.7）。
//    T-07-08。`F-020` / `F-027 AC-5`。
//
// ============================================================================
// 🔴 #39 が守るもの
// ============================================================================
// ① **入口はここだけ**である（docs/05 §9.10 ①）。失敗した `gate.run` の再実行も、AI 上限で
//    保留された（HELD）ゲートの手動再実行も、**テナント利用者のレビュー依頼と同じ 1 本**を通る。
//    🔴 運営者の retry 操作を作らない（`CLAUDE.md` §10.5 の既定 read-only。管理平面の DB ロールには
//    `proposals` / `review_gates` の書き込み権限が無いため、作ろうとしても権限で弾かれる）。
// ② **合否を上書きする経路を作らない**（`F-020 AC-2` / `BR-18`）。本モジュールは
//    「ゲートを実行させる」だけで、`ReviewGate` の判定にも `Proposal` の合否にも触れない。
//    入力（body / query）を 1 つも取らないのは、そこがゲートを緩める入口になるからである。
// ③ **状態を足さない・勝手に動かさない**（docs/05 §9.10 ⑤ / `P-A-16`）。動かすのは
//    `DRAFT → GATE_RUNNING` の 1 回だけであり、再実行では対象の状態を触らない
//    （`APPROVAL_PENDING` / `GATE_FAILED` への確定は `gate.run` の結果が決める）。
//
// ============================================================================
// 🔴 多重化しない理由（docs/05 §9.3 の 3 段のうち、この経路が関わる 2 段）
// ============================================================================
//   - **`jobId` 重複排除** … `gateRunJobId()` が組み立てる同じ ID で enqueue するため、
//     待機中・実行中の同じ実行は 1 本に畳まれる（`gate.hold-release` と同時に走っても同じ）。
//   - **`DONE` 行チェック** … 確定済みの内容は再実行しない（`P-A-09`）。
//     🔴 これは「不要な再実行を避ける」最適化ではなく、**行き止まりを作らない**ための判定である ——
//     確定済みの内容で `GATE_RUNNING` にすると、ジョブはキャッシュを見て何もせず（`ALREADY_DONE`）、
//     対象は永久に `GATE_RUNNING` のまま残る。直せるのは元データだけである（`BR-18`）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/connectors` のみ）。
//    結合テストがサーバを立てずに同じ経路を実行できるようにするため（`projects/visibility.ts` と同方針）。
import { gateRunJobId, type GateRunJob, type GateRunJobQueue } from '@ses/connectors';
import {
  computeProposalContentHash,
  findCachedReviewGate,
  findPendingReviewGate,
  gateHoldTimestamps,
  readReviewGateResult,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  InvalidStateTransitionError,
  proposalMachine,
  runningGateResultView,
  toGateResultView,
  type GateHeldView,
  type GateResultView,
} from '@ses/domain';
import { GateAlreadyCompletedError, InternalError, ProposalGateForbiddenError, requireFound } from '../api/errors';
import { canRequestProposalGate } from './policy';

/** ゲートの対象種別（`ReviewGate.targetType`）。値の出所は `@ses/domain` の `GATE_TARGET_TYPES`。 */
const PROPOSAL_GATE_TARGET_TYPE = 'PROPOSAL' as const;

/**
 * docs/05 §16.1 の `*.update`。
 *
 * 🔴 **`proposal.gate_request` のような独自 action を作らない**（`partner_company.suspend` /
 *    `skill_alias.decide` を作らなかったのと同じ理由）。`S-041` の操作種別フィルタは
 *    `CREATE_UPDATE_DELETE` を**接尾辞一致**で拾うため、独自 action は
 *    「記録されているのに検索で出てこない」状態になる。区別は `summary.operation` に置く
 *    （`gate.run` が結果を書くときの `operation='GATE_RESULT'` と同じ形。docs/05 §11.9 ⑥）。
 */
export const PROPOSAL_GATE_AUDIT_ACTION = 'proposal.update';

/** `AuditLog.summary.operation`。#39 の 2 経路を区別する（状態が動いたか否か）。 */
export const PROPOSAL_GATE_AUDIT_OPERATIONS = {
  /** `DRAFT → GATE_RUNNING`（レビュー依頼）。 */
  request: 'GATE_REQUEST',
  /** 🔴 `GATE_RUNNING` のままの再実行（HELD の手動再開 / 失敗ジョブの再依頼。§9.10）。 */
  rerun: 'GATE_RERUN',
} as const;

/** 🔴 `GateHeldView.rerun.manual`（#40 が返す「手動の再開経路」）。 */
export const PROPOSAL_GATE_MANUAL_RERUN = 'POST /api/proposals/{id}/gate';

/** 再実行の理由（監査に残す。`A-005` の滞留検知と突き合わせるため）。 */
export type ProposalGateRerunReason = 'HELD_AI_COST_LIMIT' | 'JOB_FAILED';

/** `#39` の応答（docs/05 §6.5 #39 の `{ jobId }`）。 */
export type ProposalGateRequestView = {
  readonly jobId: string;
};

export type ProposalGateRequestMeta = {
  readonly ipAddress: string | null;
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: Date;
};

export type ProposalGateRequestDeps = {
  readonly queue: GateRunJobQueue;
  readonly meta: ProposalGateRequestMeta;
};

type ProposalGateTarget = {
  readonly id: string;
  readonly state: string;
  readonly createdBy: string;
  readonly contentHash: string;
};

/** 対象と、その**現在の内容**のハッシュ（§11.5）。見えなければ `null`（＝ 404）。 */
async function loadTarget(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
): Promise<ProposalGateTarget | null> {
  return withTenant(ctx, async (db) => {
    const proposal = await db.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, state: true, createdBy: true },
    });
    if (proposal === null) return null;
    // 🔴 ハッシュは同じトランザクションの中で、同じ内容から作る（読み直しの間に
    //    内容が変わると、検査した内容と `Proposal.contentHash` がずれる）。
    const contentHash = await computeProposalContentHash(db, proposalId);
    if (contentHash === null) return null;
    return { id: proposal.id, state: proposal.state, createdBy: proposal.createdBy, contentHash };
  });
}

/**
 * 🔴 レビュー依頼（#39）。`DRAFT` からの実行と、`GATE_RUNNING` の再実行を**同じ入口**で扱う。
 *
 * 手順は docs/05 §9.10 の 5 つをそのまま並べたものである:
 *   ① 入口はここ（作成者 / ホストの `OWNER` / `ADMIN` / `SALES`）
 *   ② DB トランザクションの**外**で、`failed` の同 `jobId` だけを削除する
 *   ③ `withTenant(ctx)` で `DONE` 行が無いことを確認し、あれば **422**
 *   ④ 同じ payload・同じ `jobId` で enqueue
 *   ⑤ `Proposal` は `GATE_RUNNING` のまま（再実行では状態を動かさない）
 */
export async function requestProposalGate(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  deps: ProposalGateRequestDeps,
): Promise<ProposalGateRequestView> {
  const target = requireFound(await loadTarget(ctx, proposalId));

  // ① 🔴 行を読んでから認可する（ロールだけでは「他人の提案のゲートを回す」を止められない）。
  if (!canRequestProposalGate(ctx, { createdBy: target.createdBy })) {
    throw new ProposalGateForbiddenError();
  }

  if (!proposalMachine.isState(target.state)) {
    // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
    throw new InternalError(`proposals.state が未知の値です（${target.state}）。`);
  }
  const state = target.state;
  const isRerun = state === 'GATE_RUNNING';
  if (!isRerun && !proposalMachine.canTransition(state, 'GATE_RUNNING')) {
    // 🔴 `GATE_FAILED` / `APPROVAL_PENDING` / `APPROVED` … からは依頼できない（422）。
    //    判定は `CLAUDE.md` §4.2 の遷移表 1 つに委ねる（ここに状態を列挙しない）。
    throw new InvalidStateTransitionError(proposalMachine.entity, state, 'GATE_RUNNING');
  }

  // 🔴 保留（HELD）が残っているなら、その行の内容で再開する（`gate.hold-release` が
  //    自動で積むのと**同じ payload・同じ `jobId`**。両者が同時に走っても 1 本に畳まれる）。
  const pending = isRerun
    ? await findPendingReviewGate(ctx, {
        targetType: PROPOSAL_GATE_TARGET_TYPE,
        targetId: target.id,
      })
    : null;
  const contentHash = pending?.contentHash ?? target.contentHash;
  const key = {
    targetType: PROPOSAL_GATE_TARGET_TYPE,
    targetId: target.id,
    contentHash,
  } as const;

  // ② 🔴 **トランザクションの外**で、失敗した同 `jobId` を消す（§9.10 ②）。
  //    `waiting` / `active` は消さない（走っているものを止めない。判定は
  //    `shouldRemoveGateRunJob`（`@ses/connectors`）の 1 箇所にある）。
  //
  //    🔴 **経路によらず必ず消す**（T-07-10 で是正した）。当初は「HELD の再開では消す対象が
  //    そもそも無い」として飛ばしていたが、それは **`gate.hold-release` が保留行を自動で
  //    積み直すようになった時点で成立しない** —— 自動で積み直された実行が失敗すれば
  //    （`loadGateInput` 系の例外 / 単価未登録 / DB・Redis の一時障害）、保留行が残ったまま
  //    同じ `jobId` の `failed` 記録が残る。その状態では `add` が**静かに捨てられる**ため
  //    （§9.1）、自動でも手動でも復帰できない行き止まりになる（`F-027 AC-5` が禁じている
  //    「`GATE_RUNNING` のまま戻らない」状態そのもの）。
  //    🔴 **失敗記録を消してよいのはこの利用者操作だけである**（§9.10 ①。`gate.hold-release` は
  //    消さない —— 自動で消すと §16.5 の失敗ジョブ数から見えなくなり、壊れていることに
  //    誰も気づけなくなる）。
  const removal = await deps.queue.removeFailedJob(key);

  // ③ 🔴 同じ内容の確定結果があれば **enqueue せず 422**（`P-A-09` / docs/05 §6.5 #39）。
  //    ワーカーの開始時チェックと同じ判定を、先に API で行う。
  //    🔴 `aiFailed = true` の行はキャッシュではない（`findCachedReviewGate`）ので、
  //    LLM が落ちた提案は同じ内容のまま再実行できる。
  const completed = await findCachedReviewGate(ctx, key);
  if (completed !== null) throw new GateAlreadyCompletedError();

  const rerunReason: ProposalGateRerunReason | null = !isRerun
    ? null
    : pending !== null
      ? 'HELD_AI_COST_LIMIT'
      : 'JOB_FAILED';

  // 状態の確定（`DRAFT` のときだけ）と監査を、1 つの業務トランザクションで書く。
  // 🔴 監査は `withApiRoute` の `audit` オプションではなくここで書く（`membership.role_change` と
  //    同じ形）: ①`audit` はハンドラの前に別トランザクションで書くため、**起きなかった依頼**
  //    （403 / 404 / 422）まで残る ②`operation` と `reason` は行を読むまで決まらない。
  await withTenant(ctx, async (db) => {
    if (!isRerun) {
      const to = proposalMachine.transition('DRAFT', 'GATE_RUNNING');
      // 🔴 CAS（`WHERE state='DRAFT'`）。0 件なら、読んでから今までの間に他の実行が
      //    先に進めている（二重にジョブを積まない）。
      //    🔴 `content_hash` も同じ 1 文で書く —— 承認 CAS（§11.5 手順 3）は
      //    `proposals.content_hash` と `review_gates.content_hash` の一致を条件にするため、
      //    「検査を依頼した内容」を列に残しておかなければ承認が永久に通らない。
      const updated = await db.proposal.updateMany({
        where: { id: target.id, state: 'DRAFT' },
        data: { state: to, contentHash: target.contentHash },
      });
      if (updated.count !== 1) {
        throw new InvalidStateTransitionError(proposalMachine.entity, 'DRAFT', 'GATE_RUNNING');
      }
      await db.proposalEvent.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: target.id,
          kind: 'STATE',
          fromState: 'DRAFT',
          toState: to,
          actorUserId: ctx.userId,
          occurredAt: deps.meta.now,
        },
      });
    }

    await writeAuditLog(db, {
      action: PROPOSAL_GATE_AUDIT_ACTION,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: PROPOSAL_GATE_TARGET_TYPE,
      targetId: target.id,
      // 🔴 件名・本文・単価を載せない（docs/05 §16.2）。載せるのは操作と状態だけである。
      summary: {
        operation: isRerun
          ? PROPOSAL_GATE_AUDIT_OPERATIONS.rerun
          : PROPOSAL_GATE_AUDIT_OPERATIONS.request,
        contentHash,
        ...(rerunReason === null ? {} : { rerunReason }),
        ...(removal === 'REMOVED' ? { removedFailedJob: true } : {}),
      },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
  });

  // ④ 🔴 **commit の後に** enqueue する（未コミットの `GATE_RUNNING` をワーカーが先に読むと、
  //    結果の確定 CAS〔`WHERE state='GATE_RUNNING'`〕が 0 件になり、対象が取り残される）。
  //    🔴 payload と `jobId` の組み立ては `@ses/connectors` の 1 実装だけを使う。
  const job: GateRunJob = { tenantId: ctx.tenantId, ...key };
  // 🔴 **積めたことを確かめる。** ②で `failed` を消した直後なので、ここで弾かれるのは
  //    その隙間に別の実行が失敗記録を作った場合だけである。**握り潰さない** ——
  //    202 と `jobId` を返しながら誰も実行しない応答は、`CLAUDE.md` §11.1 の
  //    「成功したように見えて実際には起きていない」そのものである。もう一度 #39 を呼べば
  //    ②が失敗記録を消して復帰する（利用者に見えるところで壊す）。
  if ((await deps.queue.enqueue(job)) === 'BLOCKED_BY_FAILED_JOB') {
    throw new InternalError(
      `gate.run を積めませんでした（同じ jobId の失敗記録が残っています。proposalId=${target.id}）。`,
    );
  }

  // ⑤ 🔴 再実行では `Proposal` は `GATE_RUNNING` のまま（状態を足さない・遷移も起こさない）。
  return { jobId: gateRunJobId(job) };
}

/**
 * 🔴 ゲート結果の読み出し（#40。docs/05 §6.5 #40 / §11.7）。
 *
 * 🔴 **ゲート状態は 3 値である**（`RUNNING` / `DONE` / `HELD_AI_COST_LIMIT`）。2 値に潰さない
 *    （`docs/04` 申し送り 11 / `F-027 AC-5`）—— HELD を `RUNNING` に潰すと利用者は永遠に待ち、
 *    `DONE` に潰すと未判定が確定として扱われる。
 * 🔴 **`RUNNING` は「確定した行がまだ無い」を意味する。** `review_gates` は `execution='DONE'` の
 *    行に判定を要求する CHECK を持つため（§3.6）、実行中を表す行は存在しえない。
 *    したがって一度も依頼していない `DRAFT` の提案も `RUNNING` になる（画面は提案の状態と
 *    合わせて描く。#46）。
 * 🔴 **保持済みの整合層の結果を返す**（HELD でも `consistency` は確定している。`F-027 AC-5`）。
 */
export async function readProposalGateResult(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  meta: { readonly now: Date },
): Promise<GateResultView> {
  const target = requireFound(await loadTarget(ctx, proposalId));

  const row = await readReviewGateResult(ctx, {
    targetType: PROPOSAL_GATE_TARGET_TYPE,
    targetId: target.id,
  });
  // 🔴 行が無い＝まだ確定していない。**現在の内容のハッシュ**を返す（画面が
  //    「承認後に内容が変わった」を検知するのに使う。§11.7）。
  if (row === null) return runningGateResultView(target.contentHash);

  if (row.execution !== 'HELD_AI_COST_LIMIT') return toGateResultView(row);

  if (row.heldSince === null) {
    // 保留行は `held_since` を必ず持つ（`holdReviewGate`）。壊れていたら握り潰さない。
    throw new InternalError('review_gates の保留行に held_since がありません。');
  }
  // 🔴 リセット時刻は暦の計算（`Asia/Tokyo` の翌 0 時）であり `packages/db` が出す（§11.9 ⑧-4）。
  const timestamps = gateHoldTimestamps({ heldSince: row.heldSince, now: meta.now });
  const held: GateHeldView = {
    heldReasonKey: 'gate.held.aiCostLimit',
    heldSince: timestamps.heldSince,
    resetAt: timestamps.resetAt,
    // 🔴 上限の引き上げは運営者だけができる（`F-057`）。テナント側の導線を作らない。
    limitRaise: 'PLATFORM_OPERATOR',
    // 🔴 自動（`gate.hold-release`）と手動（#39）の**両方**があることを示す。
    rerun: { auto: true, manual: PROPOSAL_GATE_MANUAL_RERUN },
  };
  return toGateResultView(row, held);
}
