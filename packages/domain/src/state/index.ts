// packages/domain/src/state/index.ts
// 5 状態機械（CLAUDE.md §4.2）の型と遷移表の唯一の集約点。
export * from './errors.js';
export * from './machine.js';
export * from './proposal.js';
export * from './proposalRequest.js';
export * from './assignment.js';
export * from './contract.js';
export * from './tenant.js';
// 🔴 T-08-08: 状態 → 指標区分（docs/02 §5.1 / F-051 / F-018 AC-4 AC-5）。成約率の分母の唯一の定義。
export * from './indicators.js';
