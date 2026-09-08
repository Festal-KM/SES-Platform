// packages/domain/src/gate/index.ts
// 品質ゲート（CLAUDE.md §3.3 / docs/05 §11）の共有物。
//
// ✅ 合否の合成（`decideGate`。docs/05 §11.4）は T-07-06 で `decide.ts` に入った。
//    整合層の機械的照合（`decideConsistency`。🔴 引数型に AI 由来の型が現れないこと）は
//    T-07-07 で `consistency.ts` に入った（docs/05 §11.8）。
export { decideGate } from './decide.js';
export type {
  GateAiOutcome,
  GateDecision,
  GateDecisionInput,
  GateLayerResult,
} from './decide.js';
// 🔴 T-07-08: 内容のハッシュの材料（docs/05 §11.5）。SHA-256 を取るのは `packages/db` 側である
//    （domain は `node:crypto` を import できない。§17.2 #14）。
export { GATE_HASH_ALGORITHM_VERSION, gateHashSource, GateHashInputError } from './hash.js';
export type {
  GateHashAttachment,
  GateHashInput,
  GateHashSkill,
  GateHashSnapshot,
  ProposalGateHashInput,
} from './hash.js';
export { hasInspectableText } from './input.js';
export type {
  GateAudience,
  GateForbiddenTerms,
  GateInput,
  GateInputTargetType,
  GateKnownPii,
  GateSection,
  ProjectPublishGateInput,
  ProposalGateInput,
  SkillSheetShareGateInput,
} from './input.js';
export { runningGateResultView, toGateResultView } from './view.js';
export type {
  GateHeldView,
  GateLayerState,
  GateLayerView,
  GateResultView,
  PersistedGateResult,
} from './view.js';
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
  GATE_EXECUTIONS,
  GATE_FINDING_EXCERPT_MAX_LENGTH,
  GATE_FINDING_FIELDS,
  GATE_FINDING_KINDS,
  GATE_FINDING_SEVERITIES,
  GATE_LAYERS,
  GATE_TARGET_TYPES,
  GATE_VERDICTS,
  isGateTargetType,
  PHASE1_GATE_TARGET_TYPES,
  type GateAudienceKind,
  type GateExecution,
  type GateFinding,
  type GateFindingField,
  type GateFindingKind,
  type GateFindingSeverity,
  type GateLayer,
  type GateTargetType,
  type GateVerdict,
  type Phase1GateTargetType,
} from './types.js';
