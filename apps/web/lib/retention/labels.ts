// apps/web/lib/retention/labels.ts
// `PURGE_SPEC.delete` の表名 → 文言キー（`S-042` セクション 2「削除予定のデータ」の対象種別。`retention.schedule.kind.{table}`）。
//
// 🔴 T-12-18 ⑩: `S-041` の `tenant.purge` 行（`count_{table}` = 表名ごとの件数）も**同じ種別ラベル**で描くため、`page.tsx`
//    （Next.js のページは任意の名前を export できない）から `lib/` へ移した。文言そのものは `packages/i18n`（`CLAUDE.md` §3.5）。
// 🔴 `satisfies Record<PurgeTargetTable, MessageKey>` により、`PURGE_SPEC.delete` の表が増減すればコンパイルで落ちる（文言の書き忘れを作らない）。
import type { MessageKey } from '@ses/i18n';
import type { PurgeTargetTable } from './view';

export const PURGE_TARGET_MESSAGE_KEYS = {
  engineers: 'retention.schedule.kind.engineers',
  skill_sheets: 'retention.schedule.kind.skill_sheets',
  skill_sheet_extractions: 'retention.schedule.kind.skill_sheet_extractions',
  engineer_careers: 'retention.schedule.kind.engineer_careers',
  users: 'retention.schedule.kind.users',
  invitations: 'retention.schedule.kind.invitations',
  partner_companies: 'retention.schedule.kind.partner_companies',
  engineer_snapshots: 'retention.schedule.kind.engineer_snapshots',
  proposals: 'retention.schedule.kind.proposals',
  proposal_events: 'retention.schedule.kind.proposal_events',
  proposal_requests: 'retention.schedule.kind.proposal_requests',
  review_gates: 'retention.schedule.kind.review_gates',
  match_candidates: 'retention.schedule.kind.match_candidates',
  messages: 'retention.schedule.kind.messages',
  contract_documents: 'retention.schedule.kind.contract_documents',
  contract_templates: 'retention.schedule.kind.contract_templates',
  contracts: 'retention.schedule.kind.contracts',
  extension_reviews: 'retention.schedule.kind.extension_reviews',
  notifications: 'retention.schedule.kind.notifications',
  email_dispatches: 'retention.schedule.kind.email_dispatches',
  send_attempts: 'retention.schedule.kind.send_attempts',
  data_export_requests: 'retention.schedule.kind.data_export_requests',
} as const satisfies Readonly<Record<PurgeTargetTable, MessageKey>>;
