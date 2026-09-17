// packages/domain/src/retention/index.ts
// 保持期間・削除（docs/05 §9.7）の判定の公開面。T-10-12 は削除予告（`tenant.closing-notify`）の 4 点を置いた。
export {
  classifyClosingNoticeDelivery,
  CLOSING_NOTICE_D7_DAYS_BEFORE_PURGE,
  CLOSING_NOTICE_FILED_STATUSES,
  closingNoticeSchedule,
  closingNoticeTargetId,
  closingNoticeTargetIdPrefix,
  dueClosingNoticePhases,
  isClosingNoticePhaseFiled,
  isTenantClosingNoticePhase,
  parseClosingNoticeDedupeKey,
  TENANT_CLOSING_NOTICE_PHASES,
  TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
} from './closing-notice.js';
export type {
  ClosingNoticeDelivery,
  ClosingNoticeDeliveryOptions,
  ClosingNoticeSchedule,
  ClosingNoticeScheduleInput,
  ClosingNoticeTargetIdInput,
  DueClosingNoticePhasesInput,
  TenantClosingNoticePhase,
} from './closing-notice.js';
