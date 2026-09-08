// packages/domain/src/gate/index.ts
// 品質ゲート（CLAUDE.md §3.3 / docs/05 §11）の共有物。
//
// ⚠️ 合否の合成（`decideGate`。docs/05 §11.4）は T-07-06 がここに足す。
//    整合層の機械的照合（`decideConsistency`。🔴 引数型に AI 由来の型が現れないこと）は
//    T-07-07 で `consistency.ts` に入った（docs/05 §11.8）。
export {
  decideConsistency,
  type ConsistencyDecision,
  type ConsistencyInput,
  type ConsistencySubject,
  type EngineerSkillFacts,
  type EngineerSnapshotFacts,
  type ProjectRequirementFacts,
  type SnapshotSkillFacts,
} from './consistency.js';
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
