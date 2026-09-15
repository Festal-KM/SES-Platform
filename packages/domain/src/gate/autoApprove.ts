// packages/domain/src/gate/autoApprove.ts
// 🔴 自動モードでの自動承認の分岐条件（docs/05 §11.6 / §10.3 / `F-021 AC-3` `AC-5` / `CLAUDE.md` §3.3）。T-09-03。純粋関数。
//
// 🔴 **全層 PASS のときだけ**である。`autoApproveEnabled`（テナント単位）が有効でも、1 層でも FAIL なら
//    `false` ＝ 提案は `GATE_FAILED` に留まり、人間に差し戻る（`F-021 AC-3`）。
// 🔴 **テナントの状態が実行可（`SANDBOX` / `ACTIVE`）のときだけ**である（T-09-04。docs/05 §11.6）。人間の承認は
//    `requireExecutable`（docs/05 §6.2）が `SUSPENDED` / `CLOSING` / `PURGED` で 409 にするのに、ジョブの自動承認だけが
//    停止中のテナントで通るのは `CLAUDE.md` §4.2「`SUSPENDED` では実行系は一切できない」に反する。停止中は
//    `APPROVAL_PENDING` に留める（安全側 = 人間承認に倒す）。判定は本関数の 1 実装に置き、`apps/worker` に `if` を散らさない。
// 🔴 **`TenantRoleApprovalMode`（AI ロール別の承認モード。`F-035`）を参照しない。** 引数の型に入らない
//    （`F-035 AC-3` / `AC-6`「ロール別承認モードは `F-021` の実行ゲートを緩めない」）。全ロールを自動承認にしても
//    ここの結果は 1 ビットも変わらない —— `tests/static/approval-mode-isolation.test.ts` が `proposals/**` から
//    `TenantRoleApprovalMode` / `decideRoleHandoff` が消えていることを機械検証する。
// 🔴 `gate-inspector` に承認モードは存在しない（`CLAUDE.md` §12.4）。ここに「AI の指摘を無視する」入力面は無い ——
//    受け取るのは**機械的照合の結果として確定した 3 層の合否**だけである。

import { isExecutableTenantLifecycleState, type TenantLifecycleState } from '../state/tenant.js';
import type { GateVerdict } from './types.js';

export type AutoApproveInput = {
  /** `Tenant.autoApproveEnabled`（テナント単位。`S-035`）。 */
  readonly autoApproveEnabled: boolean;
  /** `Tenant.lifecycleState`（`autoApproveEnabled` と同じ `select` で読む。T-09-04）。 */
  readonly lifecycleState: TenantLifecycleState;
  readonly pii: GateVerdict;
  readonly commerce: GateVerdict;
  readonly consistency: GateVerdict;
};

/** 自動承認の根拠（`AuditLog.summary.reason`。`F-021 AC-5`「なぜ自動承認されたか」を辿れる）。 */
export const AUTO_APPROVE_REASON = 'ALL_LAYERS_PASS';

/**
 * 🔴 `autoApproveEnabled` かつ実行可のテナント状態かつ 3 層すべて `PASS` のときだけ `true`（docs/05 §11.6 のコードそのもの）。
 */
export function shouldAutoApprove(input: AutoApproveInput): boolean {
  return (
    input.autoApproveEnabled &&
    isExecutableTenantLifecycleState(input.lifecycleState) &&
    input.pii === 'PASS' &&
    input.commerce === 'PASS' &&
    input.consistency === 'PASS'
  );
}
