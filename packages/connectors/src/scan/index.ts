// packages/connectors/src/scan/index.ts
// ウイルススキャン（GuardDuty Malware Protection for S3）のコネクタ（docs/05 §8.1 / §8.5）。T-05-05。
//
// 🔴 AWS SDK のアダプタ（`createObjectTagApi`）はここから export しない。
//    公開経路は `@ses/connectors/aws` サブパス 1 本である（`storage/**` と同じ規律）。
export {
  buildGuardDutySignatureHeader,
  GUARDDUTY_SCAN_STATUS_TAG,
  GUARDDUTY_SIGNATURE_HEADER,
  GUARDDUTY_SIGNATURE_TOLERANCE_SECONDS,
  GuardDutyEventParseError,
  guardDutyWebhookDedupeKey,
  normalizeScanStatus,
  parseGuardDutyScanEvent,
  parseSerializedScanResult,
  serializeScanResult,
  verifyGuardDutySignature,
  type GuardDutySignatureVerifyInput,
  type NormalizedScanResult,
  type SerializedScanResult,
} from './guardduty.js';
export { GuardDutyMalwareScanner, type GuardDutyMalwareScannerOptions } from './guardduty-scanner.js';
export type { ObjectTagApi, ObjectTagRequest, ObjectTagResponse } from './api.js';
export { SCAN_APPLY_RESULT_JOB, SCAN_POLL_JOB, type ScanApplyResultJob, type ScanApplyResultQueue } from './jobs.js';
