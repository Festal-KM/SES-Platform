// packages/domain/src/anonymize/index.ts
// 🔴 匿名共有（`CLAUDE.md` §3.1 経路 4）の丸め。T-08-01。
// ⚠️ 案件スコープの参照子（`reference.ts`。`HMAC(secret, projectId ‖ engineerId)`）は
//    T-08-04 が同じディレクトリに置く（`docs/05` §4.6）。**丸めと参照子を 1 つの関数にしない**
//    —— 参照子は鍵と案件を要し、丸めは要さない。責務も、テストの書き方も別である。
export {
  anonymizeEngineer,
  ANONYMIZED_AVAILABILITY_BANDS,
  ANONYMIZED_REMOTE_MODES,
  ANONYMIZED_YEARS_BANDS,
  type AnonymizeContext,
  type AnonymizeEngineerInput,
  type AnonymizedAvailabilityBand,
  type AnonymizedPriceBand,
  type AnonymizedRemoteMode,
  type AnonymizedYearsBand,
  type AnonymizeRoundingConfig,
  type AnonymizeSkillInput,
  type RoundedAnonymousAttributes,
} from './rounding.js';
