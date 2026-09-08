// packages/domain/src/gate/index.ts
// 品質ゲート（CLAUDE.md §3.3 / docs/05 §11）の共有物。
//
// ⚠️ 現時点（T-07-05）は値集合と指摘の構造だけである。整合層の機械的照合
//    （`decideConsistency`。🔴 引数型に AI 由来の型が現れないこと）は T-07-07、
//    合否の合成（`decideGate`）は T-07-06 がここに足す。
export {
  GATE_AUDIENCE_KINDS,
  GATE_FINDING_EXCERPT_MAX_LENGTH,
  GATE_FINDING_FIELDS,
  GATE_FINDING_KINDS,
  GATE_FINDING_SEVERITIES,
  GATE_LAYERS,
  GATE_VERDICTS,
  type GateAudienceKind,
  type GateFinding,
  type GateFindingField,
  type GateFindingKind,
  type GateFindingSeverity,
  type GateLayer,
  type GateVerdict,
} from './types.js';
