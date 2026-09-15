// packages/domain/src/gate/autoApprove.ts
// 🔴 自動モードでの自動承認の分岐条件（docs/05 §11.6 / §10.3 / `F-021 AC-3` `AC-5` / `CLAUDE.md` §3.3）。T-09-03。純粋関数。
//
// 🔴 **全層 PASS のときだけ**である。`autoApproveEnabled`（テナント単位）が有効でも、1 層でも FAIL なら
//    `false` ＝ 提案は `GATE_FAILED` に留まり、人間に差し戻る（`F-021 AC-3`）。
// 🔴 **`TenantRoleApprovalMode`（AI ロール別の承認モード。`F-035`）を参照しない。** 引数の型に入らない
//    （`F-035 AC-3` / `AC-6`「ロール別承認モードは `F-021` の実行ゲートを緩めない」）。全ロールを自動承認にしても
//    ここの結果は 1 ビットも変わらない —— `tests/static/approval-mode-isolation.test.ts` が `proposals/**` から
//    `TenantRoleApprovalMode` / `decideRoleHandoff` が消えていることを機械検証する。
// 🔴 `gate-inspector` に承認モードは存在しない（`CLAUDE.md` §12.4）。ここに「AI の指摘を無視する」入力面は無い ——
//    受け取るのは**機械的照合の結果として確定した 3 層の合否**だけである。

import type { GateVerdict } from './types.js';

export type AutoApproveInput = {
  /** `Tenant.autoApproveEnabled`（テナント単位。`S-035`）。 */
  readonly autoApproveEnabled: boolean;
  readonly pii: GateVerdict;
  readonly commerce: GateVerdict;
  readonly consistency: GateVerdict;
};

/** 自動承認の根拠（`AuditLog.summary.reason`。`F-021 AC-5`「なぜ自動承認されたか」を辿れる）。 */
export const AUTO_APPROVE_REASON = 'ALL_LAYERS_PASS';

/**
 * 🔴 `autoApproveEnabled` かつ 3 層すべて `PASS` のときだけ `true`（docs/05 §11.6 のコードそのもの）。
 */
export function shouldAutoApprove(input: AutoApproveInput): boolean {
  return (
    input.autoApproveEnabled &&
    input.pii === 'PASS' &&
    input.commerce === 'PASS' &&
    input.consistency === 'PASS'
  );
}
