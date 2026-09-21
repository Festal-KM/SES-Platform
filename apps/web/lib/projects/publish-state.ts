// apps/web/lib/projects/publish-state.ts
// 🔴 案件の「公開の状態」（T-12-10。docs/05 §11.11「T-12-10 の実装の決着」⑤ /
//    `docs/04` §S-011 の 4 値 / §S-013 のセクション 1・4 / `F-014 AC-9` / `AC-12`）。
//
// ============================================================================
// 🔴 このファイルが読むもの（3 本の問い合わせ。**同じトランザクション**で読む）
// ============================================================================
//   ① `project_visibilities` の全行（生存 / `revoked_*`）
//   ② `project_publish_requests` の `kind='RECHECK'` の行（未消費の再検査があるか）
//   ③ `review_gates` の全行（`listReviewGateResultsIn`。**#40b と同じ 1 実装**）
//
// 🔴 **判定の規則は `packages/domain` の `deriveProjectPublishState` にある。** ここがやるのは
//    「行を読んで materialize すること」だけである —— 一覧（`#25`）と詳細（`#27`）が同じ 0 社を
//    別の言葉で説明しないよう、規則は 1 つに閉じる（`docs/04` §S-010 の 3 値目の理由そのもの）。
//
// 🔴 **ホストの枝でしか呼ばない。** 取引先向けの応答は 1 バイトも変わらない（`F-014 AC-10`。
//    `PartnerProjectDetailView` は `publishState?: never` を持ち、値を入れた実装はコンパイルで落ちる）。
//
// 🔴 **指摘の本文（`excerpt`）を公開の状態に載せない**（`docs/04` 申し送り 21 ②）。商流層の指摘は
//    エンド企業名そのものであり、案件詳細に常時表示される経路を作らない。本文を読む場所は
//    `S-013` セクション 4（`readProjectPublishGateResults`）だけである。
import {
  computeProjectPublishContentHash,
  hasPendingProjectRecheck,
  listReviewGateResultsIn,
  withTenant,
  type AuthenticatedTenantCtx,
  type ProjectPublishContentHashReader,
  type ProjectVisibilityRevokeReason,
  type ReviewGateReader,
  type ReviewGateResultRow,
} from '@ses/db';
import {
  deriveProjectPublishState,
  toGateResultView,
  type GateResultHistoryItem,
  type GateResultHistoryView,
  type ProjectPublishGateRef,
  type ProjectPublishLastRevoked,
  type ProjectPublishStateView,
} from '@ses/domain';
import { InternalError, NotFoundError } from '../api/errors';
import { heldViewFor, PROJECT_PUBLISH_GATE_RERUN } from '../gate/held-view';

/** ゲートの対象種別（`ReviewGate.targetType`）。値の出所は `@ses/domain` の `GATE_TARGET_TYPES`。 */
const PROJECT_PUBLISH_GATE_TARGET_TYPE = 'PROJECT_PUBLISH' as const;

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使うデリゲートだけ。 */
type PublishStateDb = ReviewGateReader &
  ProjectPublishContentHashReader &
  Pick<Parameters<Parameters<typeof withTenant<void>>[1]>[0], 'projectPublishRequest'>;

type VisibilityRow = {
  readonly id: string;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
  readonly revokedReviewGateId: string | null;
};

/**
 * 🔴 「最後に解除された行」＝ `revoked_at DESC → id DESC` の 1 行（docs/05 §4.8 の決定的順序）。
 *
 * 🔴 `revokedPartnerCount` は **`revoked_review_gate_id` が一致する行の数**である
 *    （同じ確定で落ちた相手の数。`revoked_at` の同値比較に頼らない —— 1 回の UPDATE でも
 *    タイムスタンプの等値は実装依存の比較になり、帯の「N 社」が揺れる）。
 * 🔴 人の解除（`MANUAL`）は `revoked_review_gate_id` を持たないので件数は 0 である。
 *    `AUTO_REVOKED` の枝でしか読まれない値であり、`UNPUBLISHED` の帯には件数が出ない。
 */
function lastRevokedOf(rows: readonly VisibilityRow[]): ProjectPublishLastRevoked | null {
  const revoked = rows.filter((row) => row.revokedAt !== null);
  if (revoked.length === 0) return null;
  const sorted = [...revoked].sort((a, b) => {
    const diff = (b.revokedAt?.getTime() ?? 0) - (a.revokedAt?.getTime() ?? 0);
    if (diff !== 0) return diff;
    return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
  });
  const latest = sorted[0];
  if (latest === undefined || latest.revokedAt === null) return null;
  if (latest.revokedReason === null) {
    // 🔴 CHECK（`(revoked_at IS NULL) = (revoked_reason IS NULL)`）が守っている不変条件。
    //    壊れていたら握り潰さない（「人の解除」に倒すと自動解除が静かに消える）。
    throw new InternalError(
      'project_visibilities の解除済みの行に revoked_reason がありません（docs/05 §3.5 の CHECK が壊れています）。',
    );
  }
  const gateId = latest.revokedReviewGateId;
  return {
    reason: latest.revokedReason as ProjectVisibilityRevokeReason,
    revokedAt: latest.revokedAt.toISOString(),
    reviewGateId: gateId,
    partnerCount:
      gateId === null ? 0 : rows.filter((row) => row.revokedReviewGateId === gateId).length,
  };
}

/**
 * 🔴 `listReviewGateResultsIn` の先頭 1 行 → `ProjectPublishGateRef`。
 *
 * 🔴 **公開の時点の結果を再検査の結果で黙って上書きしない** —— 行は `F-020 AC-7` のとおり積み上がり、
 *    `S-013` セクション 4 は**実行ごとの履歴**として全行を描く。ここが返すのは「直近の 1 行」だけである。
 */
function gateRefOf(row: ReviewGateResultRow | undefined): ProjectPublishGateRef | null {
  if (row === undefined) return null;
  if (row.runTrigger === null) {
    // 🔴 CHECK（`(target_type='PROJECT_PUBLISH') = (run_trigger IS NOT NULL)`）が守っている。
    throw new InternalError(
      'PROJECT_PUBLISH の review_gates に run_trigger がありません（docs/05 §3.6 の CHECK が壊れています）。',
    );
  }
  return {
    reviewGateId: row.id,
    runTrigger: row.runTrigger,
    execution: row.execution,
    executedAt: row.executedAt === null ? null : row.executedAt.toISOString(),
    heldSince: row.heldSince === null ? null : row.heldSince.toISOString(),
  };
}

/**
 * 🔴 公開の状態（4 値）を読む（`#27` のホストの枝が**同じトランザクション**で呼ぶ）。
 *
 * 🔴 **アプリが母集団を絞らない。** `project_visibilities` / `project_publish_requests` /
 *    `review_gates` はいずれも RLS（C2 / C4 / C5）が決め、ここに `tenant_id` を書かない。
 */
export async function readProjectPublishState(
  db: PublishStateDb,
  projectId: string,
  now: Date,
): Promise<ProjectPublishStateView> {
  const rows: readonly VisibilityRow[] = await db.projectVisibility.findMany({
    where: { projectId },
    select: { id: true, revokedAt: true, revokedReason: true, revokedReviewGateId: true },
  });
  const lastRevoked = lastRevokedOf(rows);
  const recheckPending = await hasPendingProjectRecheck(db, projectId);
  const gateRows = await listReviewGateResultsIn(db, {
    targetType: PROJECT_PUBLISH_GATE_TARGET_TYPE,
    targetId: projectId,
  });
  const latestRow = gateRows[0];
  const latestGate = gateRefOf(latestRow);
  const latestGateHeld =
    latestRow === undefined
      ? null
      : (heldViewFor(latestRow, now, PROJECT_PUBLISH_GATE_RERUN) ?? null);
  // 🔴 原因の欄は「**落とした実行**」の指摘から導く（直近の実行ではない。⑤ の 🔴）。
  const revokingRow =
    lastRevoked?.reviewGateId === undefined || lastRevoked.reviewGateId === null
      ? undefined
      : gateRows.find((row) => row.id === lastRevoked.reviewGateId);

  return deriveProjectPublishState({
    liveVisibilityCount: rows.filter((row) => row.revokedAt === null).length,
    lastRevoked,
    recheckPending,
    latestGate,
    latestGateHeld,
    revokingGate:
      revokingRow === undefined
        ? null
        : { findings: revokingRow.findings, aiFailed: revokingRow.aiFailed },
  });
}

/**
 * 🔴 `S-013` セクション 4 のゲート結果の履歴（T-12-10。`docs/04` §S-013 /
 *    docs/05 §11.11「T-12-10 の実装の決着」⑤）。
 *
 * 🔴 **サーバコンポーネントから直接呼ぶ。Route Handler を新設しない**（`#46b` / `S-006` と同じ作法。
 *    読み取り専用の API の面を増やさない。docs/05 §6.8）。
 * 🔴 **提案側の #40b と同じ 1 実装（`listReviewGateResultsIn` + `toGateResultView` + `heldViewFor`）を
 *    流用する。** 射影を書き写すと、層の並び・保留の説明・警告の扱いが画面ごとにずれる。
 * 🔴 **ホスト専用である**（`S-013` はホストの画面。取引先はゲート結果に到達しない）。
 *    到達不能な案件は `NotFoundError`（境界外と不存在を区別しない。docs/05 §4.8）。
 */
export async function readProjectPublishGateResults(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  meta: { readonly now: Date },
): Promise<GateResultHistoryView> {
  return withTenant(ctx, async (db) => {
    const project = await db.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (project === null) throw new NotFoundError();

    const rows = await listReviewGateResultsIn(db, {
      targetType: PROJECT_PUBLISH_GATE_TARGET_TYPE,
      targetId: projectId,
    });
    // 🔴 「現在の内容」は**再検査と同じ材料**（追加する公開先 0 件）で取る ——
    //    こうしないと `matchesCurrentContent` が「公開先を 1 社足した場合の内容」を指し、
    //    `S-013` の印が実際に検査された内容とずれる。
    const currentHash = await computeProjectPublishContentHash(db, projectId, []);

    const items: GateResultHistoryItem[] = rows.map((row) => {
      const held = heldViewFor(row, meta.now, PROJECT_PUBLISH_GATE_RERUN);
      const view = toGateResultView(row, held);
      return {
        reviewGateId: row.id,
        execution: row.execution,
        executedAt: row.executedAt === null ? null : row.executedAt.toISOString(),
        heldSince: row.heldSince === null ? null : row.heldSince.toISOString(),
        matchesCurrentContent: currentHash !== null && row.contentHash === currentHash,
        runTrigger: row.runTrigger,
        layers: view.layers,
        aiWarnings: view.aiWarnings,
        aiFailed: view.aiFailed,
        contentHash: view.contentHash,
        ...(view.held === undefined ? {} : { held: view.held }),
      };
    });
    return { items };
  });
}
