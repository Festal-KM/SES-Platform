// packages/domain/src/scan/index.ts
// ウイルススキャン状態の値集合と遷移規則（docs/05 §3.4 / §8.5 / §9.6）。T-05-05。
export {
  decideScanStatusTransition,
  InvalidScanStatusTransitionError,
  isQuarantinedScanStatus,
  isScanStatus,
  isShareableScanStatus,
  QUARANTINED_SCAN_STATUSES,
  scanStatusesReplaceableBy,
  SCAN_STATUSES,
  type QuarantinedScanStatus,
  type ScanStatus,
} from './status.js';
