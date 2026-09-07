// apps/web/lib/projects/publish-gate.ts
// 🔴 **案件の公開（越境経路 1）が通る品質ゲートの接続点**（`F-014` 処理② / `F-020` /
//    docs/05 §11.1「入口は `gate.run` ジョブ 1 本」）。T-06-06。
//
// ============================================================================
// 🔴 本タスク（SP-06）で実装するのは「接続点」までである
// ============================================================================
// `docs/sprints/SP-06` T-06-06:「公開時に品質ゲート（`F-020`）を実行し、PII 層・商流層で
// FAIL したら公開しない（`F-014 AC-3`）。**本スプリントでは呼び出しの接続点まで。
// ゲート本体と `AC-3` の検証は SP-07（T-07-09）**」。
//
// したがって本モジュールの既定実装は **「公開を保留する」だけ**を行う。
//
// 🔴 **PASS を返す枝を型として持たない。** `ProjectPublishGateOutcome` は `held: true` の
//    1 形だけであり、「ゲートが未実装だから素通しする」実装は**書こうとしてもコンパイルできない**。
//    `CLAUDE.md` §11.1 の 🔴（「未設定ならモックにフォールバック」は、成功したように見えて
//    実際には起きていないという最悪の壊れ方を生む）と同じ規律である —— ここで PASS に倒すと、
//    **ゲートを 1 度も通していない案件が取引先に見える**（`F-014 AC-3` を破る）うえ、
//    画面上は「公開しました」と表示されるため、破れたことに誰も気づけない。
//
// 🔴 **DB 構造もこれを裏打ちしている。** `project_visibilities.review_gate_id` は
//    **NOT NULL + `review_gates` への FK**（docs/05 §3.5）であり、ゲート結果の行が無ければ
//    公開範囲の行は物理的に作れない。加えて `review_gates` の CHECK は
//    `execution='DONE'` の行に PII / 商流の判定を要求する（同 §3.6）ため、
//    **「実行中のゲート」という行は存在しえない** —— これが `#28` の応答で
//    `reviewGateId` が常に `null` になる理由である（下記 `ProjectPublishGateOutcome`）。
//
// ============================================================================
// 🔴 SP-07（T-07-09）が差し替えるときに守ること
// ============================================================================
//   ① 実装の差し替えは**この port の実装 1 本**で行う（呼び出し側の `if` を増やさない）。
//   ② ゲートは**非同期**である（docs/05 §12.1 のシーケンス / `docs/04` §S-013
//      「ゲート実行は数十秒。離脱可能」）。`PUT` はジョブを積むだけで、
//      **`ProjectVisibility` の行を作るのは全層 PASS を確認したワーカーである**。
//      したがって差し替え後も `PUT` の応答は「保留」のままであり、
//      **同期的に公開が成立する枝を作らない**。
//   ③ `gate.run` の `jobId` は `'gate.run:{targetType}:{targetId}:{contentHash}'`（docs/05 §9.3）。
//      `contentHash` は `packages/domain` の `gateContentHash`（§11.5。**SP-07 で新設**）で作る。
//      🔴 本タスクではハッシュを**作らない** —— 先に別実装を置くと、SP-07 の正本と
//      2 本になり、片方だけが更新される（`F-020 AC-3` の再現性が壊れる）。
//   ④ enqueue と DB 更新の順序（コミット前に積むか後に積むか）は SP-07 の判断である。
//      本モジュールの既定実装は I/O を持たないため、現時点ではどちらでも壊れない。
import type { AuthenticatedTenantCtx } from '@ses/db';

/**
 * `ReviewGate.targetType`（docs/05 §3.6 の 5 種のうち案件の公開）。
 * 🔴 値の出所は `@ses/db` の `REVIEW_GATE_TARGET_TYPES` である。ここでは**その 1 要素を
 *    名前で指すだけ**にし、文字列を書き写さない（値集合の突合は
 *    `tests/static/schema-enum-drift.test.ts` が DB の CHECK と行う）。
 */
export const PROJECT_PUBLISH_GATE_TARGET_TYPE = 'PROJECT_PUBLISH' as const;

export type ProjectPublishGateRequest = {
  /** ゲートの対象（`ReviewGate.targetId`）。 */
  readonly projectId: string;
  /**
   * 🔴 **これから公開しようとしている相手だけ**（すでに公開中の相手は含まない）。
   *    docs/05 §11.3 の `GateInput.audience.partnerCompanyIds` に対応する。
   */
  readonly partnerCompanyIds: readonly string[];
};

/**
 * ゲートに預けた結果。
 *
 * 🔴 **形が 1 つしかない**（`held: true`）。「PASS だったので公開した」という枝を
 *    型として持たないことが、本タスクの安全性そのものである（本ファイル冒頭の 🔴）。
 * 🔴 `reviewGateId` は常に `null` である。`review_gates` には `execution='DONE'` の
 *    確定した行しか存在できず（docs/05 §3.6 の CHECK）、**実行中のゲートを指す ID は
 *    そもそも採番されない**。docs/05 §6.4 #28 の応答 `{ reviewGateId, verdict }` の
 *    `reviewGateId` が `null` を取りうるのはこのためである（§11.7 の
 *    `GateResultView.execution='RUNNING'` ＝「まだ行が無い」と同じ表現）。
 */
export type ProjectPublishGateOutcome = {
  readonly held: true;
  readonly reviewGateId: null;
};

export type ProjectPublishGate = (
  ctx: AuthenticatedTenantCtx,
  request: ProjectPublishGateRequest,
) => Promise<ProjectPublishGateOutcome>;

/**
 * 🔴 **既定の接続点（SP-06 のスタブ）: 公開を保留する。**
 *
 * ゲート本体（`gate.run` / `gate-inspector`）は SP-07 で入る。それまで、案件の公開要求は
 * **1 件も成立しない**（`ProjectVisibility` の行が増えない）。
 * ⚠️ これは「機能が壊れている」のではなく、`F-014 AC-3`（ゲート FAIL なら公開しない）を
 *    満たせない実装を**先に稼働させない**という選択である。画面（`S-013`）は
 *    「まだ公開されていない」ことを利用者に明示する（`packages/i18n` の
 *    `projects.visibilitySettings.gate.pending`）。
 */
export const heldProjectPublishGate: ProjectPublishGate = () =>
  Promise.resolve({ held: true, reviewGateId: null });
