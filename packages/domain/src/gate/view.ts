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
  /** 再開の経路。🔴 自動（`gate.hold-release`）と手動（#39）の**両方**があることを示す。 */
  readonly rerun: { readonly auto: true; readonly manual: string };
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
