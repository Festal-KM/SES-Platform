// apps/web/lib/projects/publish-gate.ts
// 🔴 **案件の公開（越境経路 1）が通る品質ゲートの接続**（`F-014` 処理② / `F-020` /
//    docs/05 §11.1「入口は `gate.run` ジョブ 1 本」/ §11.11）。T-06-06 → **T-07-09 で実装に差し替えた**。
//
// ============================================================================
// 🔴 この経路が守るもの（SP-06 の接続点から 1 ビットも緩めていない）
// ============================================================================
// ① **`PUT` は公開を成立させない。** `ProjectVisibility` の行を作るのは、全層 PASS の
//    ゲート結果を手にした**ワーカー**だけである（`packages/db` の `settleProjectPublish`）。
//    したがって差し替え後も `#28` の応答は「保留（`PENDING_GATE`）」のままであり、
//    **同期的に公開が成立する枝は型として存在しない**（`ProjectPublishGateOutcome` は 1 形）。
// ② **DB 構造がこれを裏打ちしている。** `project_visibilities.review_gate_id` は
//    **NOT NULL + FK**（docs/05 §3.5）であり、ゲート結果の行が無ければ公開範囲の行は
//    物理的に作れない。`review_gates` の CHECK は `execution='DONE'` の行に PII / 商流の判定を
//    要求する（同 §3.6）ので、**「実行中のゲート」という行は存在しえない** —— これが
//    `#28` の応答で `reviewGateId` が常に `null` になる理由である。
//
// ============================================================================
// 🔴 「これから公開する相手」をゲートまで運ぶ（docs/05 §11.9 ⑧-5 の申し送りの解消）
// ============================================================================
// 商流層は「**その公開範囲で**出してはならない語」を見る（`F-014 AC-3`）。公開先が分からなければ
// 「公開先に含まれない取引先の社名」も決まらないので、**新規公開先の社名が公開文に書かれていても
// 他社名として検出されない**。②のとおり `project_visibilities` にはゲート前の行を置けないため、
// 中間テーブル `ProjectPublishRequest` が運ぶ（docs/05 §11.11 ①）。
//
// 🔴 **`gate.run` の payload に載せる案は採らなかった。** `gate.hold-release`（AI 上限からの
//    自動復帰。T-07-10）は `review_gates` の保留行だけを材料に「同じ payload・同じ `jobId`」で
//    再 enqueue する（docs/05 §11.9 ⑧-7）。保留行は `(target_type, target_id, content_hash)` しか
//    持たないので、payload に持たせると**上限で保留された公開要求だけが公開先を復元できない**。
//
// ============================================================================
// 🔴 SP-06 が置いた 4 つの制約と、その守り方
// ============================================================================
//   ① 差し替えは**この port の実装 1 本**で行う → `createProjectPublishGate` 1 つだけ。
//      `updateProjectVisibility` に `if` は 1 つも増えていない。
//   ② ゲートは**非同期**である → 応答は `held: true` のまま（①）。
//   ③ `contentHash` は**唯一の実装**で作る → `computeProjectPublishContentHash`（`@ses/db`。
//      §11.10 ② と同じ 1 実装で、ジョブ側もこの値と突き合わせる）。ここで別実装を書かない。
//   ④ enqueue と DB 更新の順序 → 🔴 **enqueue は commit の後**である（`ProjectPublishGateOutcome`
//      が `enqueue` を**関数として返す**のはこのためで、呼び出し側はトランザクションを
//      抜けてから呼ぶ）。未コミットの公開要求をワーカーが先に読むと、要求が見えず
//      `TARGET_NOT_FOUND` で終わり、**公開が永久に成立しない**（#39 と同じ理由。§11.10 ⑤）。
import type { GateRunJob, GateRunJobQueue } from '@ses/connectors';
import {
  computeProjectPublishContentHash,
  upsertProjectPublishRequest,
  type AuthenticatedTenantCtx,
  type ProjectPublishContentHashReader,
  type ProjectPublishRequestWriter,
} from '@ses/db';
import { InternalError } from '../api/errors';

/**
 * `ReviewGate.targetType`（docs/05 §3.6 の 5 種のうち案件の公開）。
 * 🔴 値の出所は `@ses/domain` の `GATE_TARGET_TYPES` である。ここでは**その 1 要素を
 *    名前で指すだけ**にし、文字列を書き写さない（値集合の突合は
 *    `tests/static/schema-enum-drift.test.ts` が DB の CHECK と行う）。
 */
export const PROJECT_PUBLISH_GATE_TARGET_TYPE = 'PROJECT_PUBLISH' as const;

/** ゲートの準備に要るトランザクションクライアント（🔴 呼び出し側の tx をそのまま使う）。 */
export type ProjectPublishGateDb = ProjectPublishContentHashReader & ProjectPublishRequestWriter;

export type ProjectPublishGateRequest = {
  /** ゲートの対象（`ReviewGate.targetId`）。 */
  readonly projectId: string;
  /**
   * 🔴 **これから公開しようとしている相手だけ**（すでに公開中の相手は含まない）。
   *    ゲートが見る `audience` は「すでに公開済み ∪ ここで渡した相手」の和である
   *    （`packages/db` の `loadGateInput`）。
   */
  readonly partnerCompanyIds: readonly string[];
};

/**
 * ゲートに預けた結果。
 *
 * 🔴 **形が 1 つしかない**（`held: true`）。「PASS だったので公開した」という枝を
 *    型として持たないことが、本モジュールの安全性そのものである（冒頭の 🔴 ①）。
 * 🔴 `reviewGateId` は常に `null` である（冒頭の 🔴 ②）。
 * 🔴 `enqueue` は**コミット後に呼ぶ**（冒頭の 🔴 ④）。呼ばなければジョブは積まれないが、
 *    そのとき公開要求は「ゲート待ちのまま」であり、**公開は成立しない**（安全側）。
 *    利用者は同じ操作をもう一度行えば復帰できる（同じ内容なら同じ `jobId` に畳まれる）。
 */
export type ProjectPublishGateOutcome = {
  readonly held: true;
  readonly reviewGateId: null;
  readonly enqueue: () => Promise<void>;
};

export type ProjectPublishGate = (
  db: ProjectPublishGateDb,
  ctx: AuthenticatedTenantCtx,
  request: ProjectPublishGateRequest,
) => Promise<ProjectPublishGateOutcome>;

export type ProjectPublishGateDeps = {
  readonly queue: GateRunJobQueue;
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: Date;
};

/**
 * 🔴 **ゲートに預ける（`#28` の唯一の接続点）。**
 *
 * 手順:
 *   1. 内容のハッシュを作る（🔴 材料は公開文だけではない —— 公開先の集合と取引先の社名も
 *      内容である。`ProjectPublishGateHashInput` の 🔴。これを入れないと
 *      「同じ本文・違う公開先」が同じキャッシュを引き、**検査していない相手への公開**が成立する）
 *   2. 公開要求を置く / 差し替える（案件ごとに 1 行）
 *   3. コミット後に `gate.run` を enqueue する（`removeFailedJob` → `enqueue` の順。§9.10 ②）
 *
 * 🔴 **`#39`（提案のレビュー依頼）と違い、確定済み（`DONE`）のゲート結果があっても 422 にしない。**
 *    提案では「同じ内容の確定結果があるのに `GATE_RUNNING` にすると永久に留まる」ため入口で
 *    止めるが、案件の公開に留まる状態は無く、**止めると再公開ができなくなる** ——
 *    「A に公開 → 解除 → もう一度 A に公開」は公開文も公開先も 1 文字も変わらないので
 *    ハッシュが一致し、422 なら**直す元データが無いのに永久に断られる**（`BR-18` の空回り）。
 *    ワーカーは確定済みの結果を見つけたとき、**その結果で公開を確定させる**（ジョブ側の
 *    `ALREADY_DONE` 分岐。docs/05 §11.11 ③）。キャッシュが引けるのは
 *    「公開文・商流情報・公開先・取引先の社名がすべて同じ」ときだけなので、判定は今も妥当である。
 */
export function createProjectPublishGate(deps: ProjectPublishGateDeps): ProjectPublishGate {
  return async (db, ctx, request) => {
    const contentHash = await computeProjectPublishContentHash(
      db,
      request.projectId,
      request.partnerCompanyIds,
    );
    if (contentHash === null) {
      // 呼び出し側が直前に可視性を確認した案件が見えない ＝ 不変条件違反。握り潰さない。
      throw new InternalError(`案件が見つかりません（projectId=${request.projectId}）。`);
    }

    await upsertProjectPublishRequest(db, ctx.tenantId, {
      projectId: request.projectId,
      partnerCompanyIds: request.partnerCompanyIds,
      contentHash,
      requestedAt: deps.now,
      // 🔴 実施者は認証コンテキストから取る（リクエスト入力から受け取らない。`CLAUDE.md` §3.1）。
      //    この値が `ProjectVisibility.published_by` になる。
      requestedBy: ctx.userId,
    });

    const job: GateRunJob = {
      tenantId: ctx.tenantId,
      targetType: PROJECT_PUBLISH_GATE_TARGET_TYPE,
      targetId: request.projectId,
      contentHash,
    };

    return {
      held: true,
      reviewGateId: null,
      enqueue: async () => {
        // 🔴 失敗した同 `jobId` の記録を先に消す（§9.10 ②）。残っていると `add` が静かに
        //    捨てられ、公開要求がゲート待ちのまま止まる。消すのは `failed` だけである
        //    （判定は `shouldRemoveGateRunJob` の 1 箇所にある）。
        await deps.queue.removeFailedJob(job);
        await deps.queue.enqueue(job);
      },
    };
  };
}
