// packages/domain/src/ledger/index.ts
// ① 集める（エンジニア台帳・案件）の純粋な値集合（docs/05 §3.4 / §3.5）。T-05-01。
export { isPrefectureCode, PREFECTURE_CODES, type PrefectureCode } from './prefectures.js';
// 🔴 T-09-12: 経験内容と従事期間（`EngineerCareer`。docs/05 §3.4.1）。年月の妥当性判定は
//    API 境界の Zod と DB の CHECK が同じ式を指すための単一出所であり、`diffCareerRows` は
//    行ごとの監査ログの材料を I/O 無しで決める。
export {
  compareYearMonth,
  isYearMonth,
  parseYearMonth,
  YEAR_MONTH_PATTERN,
  YEAR_MONTH_SQL_PATTERN,
  type YearMonth,
} from './year-month.js';
export {
  CAREER_INSPECTION_FIELD_SEPARATOR,
  CAREER_INSPECTION_ROW_SEPARATOR,
  CAREER_VALUE_FIELDS,
  diffCareerRows,
  frozenCareersToInspectionText,
  toFrozenCareer,
  type CareerRowValues,
  type CareerRowsDiff,
  type CareerValueField,
  type FrozenCareer,
  type StoredCareerRow,
  type SubmittedCareerRow,
} from './careers.js';
