// packages/domain/src/export/index.ts
// 返却データ（`F-064 AC-5` / docs/05 §9.6 `export.generate`）の公開面。T-10-09。
export { encodeCsv } from './csv.js';
export type { CsvCell } from './csv.js';
export { buildZipArchive, crc32, listZipEntries } from './zip.js';
export { decodeUtf8, encodeUtf8 } from './utf8.js';
export type { ZipEntry } from './zip.js';
export { buildClosingReturnArchive, CLOSING_RETURN_FILES } from './closing-return.js';
export type {
  ClosingReturnArchive,
  ClosingReturnDataset,
  ClosingReturnFileName,
  ReturnAssignmentRow,
  ReturnEngineerCareerRow,
  ReturnEngineerRow,
  ReturnEngineerSkillRow,
  ReturnEngineerSnapshotCareerRow,
  ReturnEngineerSnapshotRow,
  ReturnEngineerSnapshotSkillRow,
  ReturnPartnerCompanyRow,
  ReturnProjectRequirementRow,
  ReturnProjectRow,
  ReturnProposalEventRow,
  ReturnProposalRow,
} from './closing-return.js';
