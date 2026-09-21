// packages/domain/src/gate/view.ts
// 🔴 ゲート結果を画面へ渡す形（docs/05 §11.7 の `GateResultView`）。T-07-06。純粋関数。
//
// 🔴 なぜ domain に置くか: `#40 GET /api/proposals/{id}/gate`（T-07-08）と `S-013` の公開状況
//    （T-07-09）と承認画面（SP-09）が**同じ 1 つの形**を読む。組み立てを各 API に書くと、
//    「HELD を 2 値に潰す」実装が片方だけに入り込む（docs/04 申し送り 11 / `F-027 AC-5`）。
//
// 🔴 **`execution` は 3 値である。**「実行中か完了か」の 2 値に潰してはならない ——
//    `HELD_AI_COST_LIMIT`（上限で呼べていない）を `RUNNING` に潰すと利用者は永遠に待ち、
//    `DONE` に潰すと未判定が確定として扱われる。

import type { ProjectPublishRunTrigger } from './project-publish.js';
import type { GateExecution, GateFinding, GateVerdict } from './types.js';

/**
 * 層の表示状態。
 *
 * - `RUNNING` … まだ確定していない（`ReviewGate` の行が無い）
 * - `PASS` / `FAIL` … 確定
 * - 🔴 `HELD` … AI の日次コスト上限で**未実行**（`pii` / `commerce` のみ取り得る。
 *   整合層は AI に依存しないので常に確定する。`F-027 AC-5`）
 */
export type GateLayerState = 'RUNNING' | 'PASS' | 'FAIL' | 'HELD';

export type GateLayerView = {
  readonly state: GateLayerState;
  readonly findings: readonly GateFinding[];
};

/**
 * 保留の説明（`execution='HELD_AI_COST_LIMIT'` のときだけ存在する）。
 *
 * 🔴 **金額（USD）を載せない**（`F-027 AC-6`）。利用者に見せるのは理由キーとリセット時刻、
 *    そして「誰が上限を上げられるか」だけである（金額は `A-004` = 運営平面にのみ）。
 */
export type GateHeldView = {
  readonly heldReasonKey: 'gate.held.aiCostLimit';
  /** ISO 8601。最初に保留した時刻。 */
  readonly heldSince: string;
  /** ISO 8601。日次枠がリセットされる時刻（JST の翌 0 時）。 */
  readonly resetAt: string;
  /** 🔴 上限の引き上げは運営者だけができる（`F-057`）。テナント側の導線を作らない。 */
  readonly limitRaise: 'PLATFORM_OPERATOR';
  /**
   * 再開の経路。🔴 自動（`gate.hold-release`）は**常にある**。
   *
   * 🔴 **T-12-10: `manual` は `null` を取る。** 手動の再実行の入口があるのは提案（#39）だけであり、
   *    **案件の公開には無い**（docs/05 §6.8。「再検査だけをもう一度実行する」エンドポイントを
   *    置かない —— 元データが変わっていない再実行は結果が変わらず `F-026` の件数だけを消費する）。
   *    ここに提案の入口を書き写すと、案件の画面・応答に**存在しない操作**を広告することになる。
   */
  readonly rerun: { readonly auto: true; readonly manual: string | null };
};

export type GateResultView = {
  readonly execution: 'RUNNING' | GateExecution;
  readonly layers: {
    readonly pii: GateLayerView;
    readonly commerce: GateLayerView;
    readonly consistency: GateLayerView;
  };
  /** 🔴 `findings` とは別（画面は視覚的に別物として描く。docs/04 申し送り 5）。 */
  readonly aiWarnings: readonly GateFinding[];
  readonly aiFailed: boolean;
  /** 🔴 画面が「承認後に内容が変わった」を検知するために使う（§11.5）。 */
  readonly contentHash: string;
  readonly held?: GateHeldView;
};

/**
 * 🔴 ゲート結果の履歴の 1 行（#40b `GET /api/proposals/{id}/gate-results` / `S-023` セクション 4。
 *    docs/05 §6.5「#40b と `S-023` セクション 4 の設計」/ `F-020 AC-7`）。T-12-14 ②。
 *
 * `GateResultView` の**拡張**であり、`layers` / `aiWarnings` / `aiFailed` / `contentHash` / `held` は
 * #40 と同じ射影（`toGateResultView` の出力をそのまま写す）。画面は `approvalGateRows(gate)` に
 * そのまま渡せる（履歴用の別の描画実装を書かない）。
 *
 * 🔴 履歴に `'RUNNING'` は無い（`RUNNING` = 「確定した行がまだ無い」であり、行として存在しない。§11.7）。
 */
export type GateResultHistoryItem = {
  /** 🔴 `review_gates.id`。`S-023` の承認の履歴行「検査 #<id>」（`reviewGateId`）と突合するため。 */
  readonly reviewGateId: string;
  readonly execution: GateExecution;
  /** `DONE` のとき ISO 8601、HELD は `null`。 */
  readonly executedAt: string | null;
  /** HELD のとき ISO 8601、`DONE` は `null`。 */
  readonly heldSince: string | null;
  /** 🔴 `contentHash` === 現在の内容のハッシュ。画面が「現在の内容に対する結果」を印で示す。 */
  readonly matchesCurrentContent: boolean;
  readonly layers: GateResultView['layers'];
  readonly aiWarnings: GateResultView['aiWarnings'];
  readonly aiFailed: boolean;
  readonly contentHash: string;
  /**
   * 🔴 T-12-10: **この実行の契機**（`review_gates.run_trigger`）。`S-013` セクション 4 が
   *    1 行ずつに添えるラベル（`公開の実行` / `公開欄の編集による再検査`）の出所であり、
   *    **提案（`S-023`）の行は常に `null`** である（提案に「公開欄の編集」は無い）。
   *    契機が読めないと、`S-011` の帯から辿った利用者が「これは公開しようとしたときの
   *    古い結果では」と迷う（docs/04 §S-013）。
   */
  readonly runTrigger: ProjectPublishRunTrigger | null;
  /** `execution='HELD_AI_COST_LIMIT'` のときだけ（#40 と同じ `GateHeldView`）。 */
  readonly held?: GateHeldView;
};

/** #40b の応答。降順（新しい実行が先）。0 件 = まだ一度も依頼していない。 */
export type GateResultHistoryView = { readonly items: readonly GateResultHistoryItem[] };

/** `ReviewGate` の行のうち、画面が読む値だけ（`packages/db` が読み出して渡す）。 */
export type PersistedGateResult = {
  readonly execution: GateExecution;
  readonly contentHash: string;
  /** 🔴 `HELD_AI_COST_LIMIT` のときだけ `null`（PASS でも FAIL でもない = 未判定）。 */
  readonly piiVerdict: GateVerdict | null;
  readonly commerceVerdict: GateVerdict | null;
  /** 🔴 保留中でも確定している（機械的照合のみで決まるため。`F-027 AC-5`）。 */
  readonly consistencyVerdict: GateVerdict;
  readonly findings: readonly GateFinding[];
  readonly aiWarnings: readonly GateFinding[];
  readonly aiFailed: boolean;
};

function layerView(
  verdict: GateVerdict | null,
  findings: readonly GateFinding[],
  layer: GateFinding['layer'],
): GateLayerView {
  return {
    state: verdict ?? 'HELD',
    findings: findings.filter((finding) => finding.layer === layer),
  };
}

/**
 * 🔴 まだ `ReviewGate` の行が無い（ゲート実行中）。
 *
 * `review_gates` は `execution='DONE'` の行に PII / 商流の判定を要求する CHECK を持つため
 * （docs/05 §3.6）、**「実行中」を表す行は存在しえない**。行の非存在がそのまま `RUNNING` である。
 */
export function runningGateResultView(contentHash: string): GateResultView {
  const running: GateLayerView = { state: 'RUNNING', findings: [] };
  return {
    execution: 'RUNNING',
    layers: { pii: running, commerce: running, consistency: running },
    aiWarnings: [],
    aiFailed: false,
    contentHash,
  };
}

/**
 * 保存済みの結果を画面の形に写す。
 *
 * @param held `execution='HELD_AI_COST_LIMIT'` のときだけ渡す（リセット時刻は暦の計算であり
 *        domain では作れない。docs/05 §7.12 ⑥ と同じ理由で `packages/db` が組み立てる）。
 * @throws RangeError `execution` と `held` の有無が食い違うとき。🔴 判別可能な合併として結ぶ。
 */
export function toGateResultView(row: PersistedGateResult, held?: GateHeldView): GateResultView {
  const isHeld = row.execution === 'HELD_AI_COST_LIMIT';
  if (isHeld !== (held !== undefined)) {
    throw new RangeError(
      `execution='${row.execution}' と held の有無が一致しません（HELD のときだけ held を渡してください。docs/05 §11.7）。`,
    );
  }
  return {
    execution: row.execution,
    layers: {
      pii: layerView(row.piiVerdict, row.findings, 'PII'),
      commerce: layerView(row.commerceVerdict, row.findings, 'COMMERCE'),
      // 🔴 整合層は保留中でも確定値である（`null` を取らない）。
      consistency: layerView(row.consistencyVerdict, row.findings, 'CONSISTENCY'),
    },
    aiWarnings: row.aiWarnings,
    aiFailed: row.aiFailed,
    contentHash: row.contentHash,
    ...(held === undefined ? {} : { held }),
  };
}
