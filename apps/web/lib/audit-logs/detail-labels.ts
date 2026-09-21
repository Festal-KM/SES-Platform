// apps/web/lib/audit-logs/detail-labels.ts
// `S-041` 行の詳細のラベル（`packages/i18n` の `auditLogs.detail.*` を、画面が受け取る形に畳む）。T-11-09。
//
// 🔴 ここは**ラベルの辞書**であり、許可リスト（`@ses/domain` の `AUDIT_DETAIL_ALLOWLIST`）ではない。
//    画面は「選ぶ・伏せる」をせず「描くだけ」（docs/05 §17.2 #32 ③）。ここに無いキー・列挙値はトークンの
//    まま描かれる（形の検査を通った大文字スネークであり自由文ではない）。
import { t } from '@ses/i18n';
import { PURGE_TARGET_MESSAGE_KEYS } from '../retention/labels';
import { TENANT_LIFECYCLE_STATE_MESSAGE_KEYS } from '../tenants/labels';

/** 変更前 / 変更後の対の識別子（`packages/domain` の `AuditDetailPair.id` と同じ語）。 */
const PAIR_IDS = ['visibility', 'role', 'state', 'level', 'mode', 'model', 'weight'] as const;
type PairId = (typeof PAIR_IDS)[number];

/** 単値で描くキー（`summary` のキー名）。 */
const KEY_LABEL_KEYS = [
  'requested',
  'pending',
  'revoked',
  'published',
  'blocked',
  'verdict',
  'operation',
  'outcome',
  'result',
  'rerunReason',
  'attemptSeq',
  'reasonLength',
  'requestedBy',
  'externalCallMade',
  'reason',
  'projectId',
  'via',
  'version',
  'scanStatus',
  'ttlMinutes',
  'expiresAt',
  'metric',
  'periodKind',
  'effect',
  'aiRole',
  'criterion',
  'decision',
  'mode',
  'status',
  'fields',
  'changedFields',
  'skillCount',
  'newSkillLabelCount',
  'headcount',
  'mustCount',
  'niceCount',
  'targetPartnerCompanyId',
  'periodFrom',
  'periodTo',
  // T-12-18 ⑨ / ⑩ / ⑪（`docs/04` §S-041 改訂 13 → docs/05 §6.4 → `AUDIT_DETAIL_ALLOWLIST` の順で足した行）。
  'overall',
  'piiVerdict',
  'commerceVerdict',
  'consistencyVerdict',
  'findingCount',
  'warningCount',
  'entity',
  'cause',
  'tables',
  'kind',
  'rowCount',
  'truncated',
] as const;

/** `tenant.purge` の `count_{table}`（キー接頭辞族）の項目名は `S-042` セクション 2 と同じ種別ラベル。 */
const PURGE_COUNT_KEY_PREFIX = 'count_';

/** キー付きの列挙値ラベル（`auditLogs.detail.enum.<key>.<TOKEN>`）。 */
const ENUM_LABEL_KEYS = [
  'verdict.PENDING_GATE',
  'verdict.NO_PUBLISH_REQUESTED',
  'verdict.PUBLISHED',
  'verdict.BLOCKED',
  'operation.GATE_RESULT',
  'operation.GATE_REQUEST',
  'operation.GATE_RERUN',
  'operation.SUBMIT_REQUEST',
  'operation.SUBMIT_SETTLE',
  'operation.RESEND',
  'operation.APPROVE',
  'operation.REJECT',
  'operation.TRANSITION',
  'operation.DRAFT_UPDATE',
  'operation.ACCEPT',
  'operation.DECLINE',
  'operation.WITHDRAW',
  'operation.EXPIRE',
  'operation.SHARE',
  'operation.REVOKE',
  'operation.SET_LATEST',
  'operation.SUSPEND',
  'operation.RESUME',
  'decision.ACCEPT',
  'decision.REJECT',
  'via.DETAIL',
  'via.EDIT_FORM',
  'via.SKILL_SHEETS',
  'via.VISIBILITY',
  'via.CANDIDATES',
  'via.PROPOSAL_REQUEST',
  'via.SNAPSHOT_DIFF',
  'reason.ALL_LAYERS_PASS',
  'rerunReason.HELD_AI_COST_LIMIT',
  'rerunReason.JOB_FAILED',
  'result.SUBMITTED',
  'result.FAILED',
  'result.UNKNOWN',
  'outcome.ENQUEUED',
  'outcome.HELD',
  'level.BELOW',
  'level.NEARING',
  'level.REACHED',
  // T-12-18 ⑨ / ⑩。
  'entity.Proposal',
  'entity.ProposalRequest',
  'entity.Assignment',
  'entity.Contract',
  'entity.Tenant',
  'cause.TENANT_PURGED',
  'cause.RETENTION',
  'kind.CLOSING_RETURN',
  'kind.OPERATIONAL',
] as const;

/** ゲートの各層 verdict（`overall` / `piiVerdict` / `commerceVerdict` / `consistencyVerdict`）は同じ 2 値のラベル。 */
const GATE_VERDICT_KEYS = ['overall', 'piiVerdict', 'commerceVerdict', 'consistencyVerdict'] as const;
const GATE_VERDICT_TOKENS = ['PASS', 'FAIL'] as const;

/**
 * `state.invalid_transition` の `from` / `to`（`pair.id = 'state'`）は §4.2 の状態名。Phase 1 で起こりうるのは `Proposal` /
 * `ProposalRequest` / `Tenant` の 3 機械であり、状態名は互いに衝突しない。
 * ⚠️ `Assignment`（Phase 2。`ACTIVE` が `Tenant` と衝突）/ `Contract`（Phase 3。`DRAFT` / `WITHDRAWN` / `EXPIRED` が衝突）を実装するときは
 *    `entity` で引き分ける形に改める（ラベルの辞書はキー + トークンだけで引いている）。
 */
const PROPOSAL_REQUEST_STATE_TOKENS = ['REQUESTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED'] as const;
const TENANT_STATE_TOKENS = ['SANDBOX', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'PURGED'] as const;

/** 状態名（`fromState` / `toState`）は `proposals.state.*` を、ロール名は `role.*` を流用する。 */
const PROPOSAL_STATE_TOKENS = [
  'DRAFT',
  'GATE_RUNNING',
  'GATE_FAILED',
  'APPROVAL_PENDING',
  'APPROVED',
  'SUBMITTING',
  'SUBMITTED',
  'SUBMIT_FAILED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'RESULT_PENDING',
  'WON',
  'LOST',
  'WITHDRAWN',
] as const;
const ROLE_TOKENS = ['OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES', 'VIEWER'] as const;
const SCAN_STATUS_TOKENS = ['SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED'] as const;

export type AuditLogDetailMessages = {
  readonly toggleOpen: string;
  readonly toggleClose: string;
  readonly columnItem: string;
  readonly columnValue: string;
  readonly columnBefore: string;
  readonly columnAfter: string;
  readonly empty: string;
  readonly suppressed: Readonly<Record<'PARTNER_LEDGER', string>>;
  readonly deletedPartnerCompany: string;
  readonly emptyList: string;
  readonly booleanTrue: string;
  readonly booleanFalse: string;
  readonly booleanUnknown: string;
  readonly dateNone: string;
  /** 対の項目名（`pair.id` → 名前）。 */
  readonly pairLabels: Readonly<Record<string, string>>;
  /** 対の片側だけの行の項目名（`${pair.id}.${side}` → 名前）。 */
  readonly pairSideLabels: Readonly<Record<string, string>>;
  /** 単値の項目名（キー → 名前）。 */
  readonly keyLabels: Readonly<Record<string, string>>;
  /** 列挙値のラベル（`${key}.${TOKEN}` → 名前。無ければ `${TOKEN}` で引き、それも無ければトークンのまま）。 */
  readonly enumLabels: Readonly<Record<string, string>>;
  /** `null` の描き方（キー → 名前。`NAME` / `DATE` の `null`。無ければ `deletedPartnerCompany` / `dateNone`）。 */
  readonly nullLabels: Readonly<Record<string, string>>;
};

export function auditLogDetailMessages(): AuditLogDetailMessages {
  const pairLabels: Record<string, string> = {};
  const pairSideLabels: Record<string, string> = {};
  for (const id of PAIR_IDS) {
    pairLabels[id] = t(`auditLogs.detail.pair.${id as PairId}`);
    pairSideLabels[`${id}.BEFORE`] = t(`auditLogs.detail.pair.${id as PairId}.BEFORE`);
    pairSideLabels[`${id}.AFTER`] = t(`auditLogs.detail.pair.${id as PairId}.AFTER`);
  }
  const keyLabels: Record<string, string> = {};
  for (const key of KEY_LABEL_KEYS) keyLabels[key] = t(`auditLogs.detail.key.${key}`);
  // `tenant.purge` の `count_{table}` は表名ごとの件数行（`S-042` セクション 2 と同じ種別ラベル。表名は `PURGE_SPEC.delete` の閉集合）。
  for (const [table, messageKey] of Object.entries(PURGE_TARGET_MESSAGE_KEYS)) {
    keyLabels[`${PURGE_COUNT_KEY_PREFIX}${table}`] = t(messageKey);
  }

  const enumLabels: Record<string, string> = {};
  for (const key of ENUM_LABEL_KEYS) enumLabels[key] = t(`auditLogs.detail.enum.${key}`);
  for (const token of PROPOSAL_STATE_TOKENS) enumLabels[`fromState.${token}`] = enumLabels[`toState.${token}`] = t(`proposals.state.${token}`);
  for (const token of ROLE_TOKENS) enumLabels[`beforeRole.${token}`] = enumLabels[`afterRole.${token}`] = t(`role.${token}`);
  for (const token of SCAN_STATUS_TOKENS) enumLabels[`scanStatus.${token}`] = t(`skillSheets.scanStatus.${token}`);
  // `usage.limit_*` の `from` / `to` は水準（`level.*`）。
  for (const token of ['BELOW', 'NEARING', 'REACHED'] as const) {
    enumLabels[`from.${token}`] = enumLabels[`to.${token}`] = t(`auditLogs.detail.enum.level.${token}`);
  }
  // T-12-18 ⑨: ゲートの各層 verdict / `state.invalid_transition` の `from` / `to`（状態名。Phase 1 の 3 機械）。
  for (const key of GATE_VERDICT_KEYS) {
    for (const token of GATE_VERDICT_TOKENS) enumLabels[`${key}.${token}`] = t(`auditLogs.detail.enum.gateVerdict.${token}`);
  }
  for (const token of PROPOSAL_STATE_TOKENS) enumLabels[`from.${token}`] = enumLabels[`to.${token}`] = t(`proposals.state.${token}`);
  for (const token of PROPOSAL_REQUEST_STATE_TOKENS) {
    enumLabels[`from.${token}`] = enumLabels[`to.${token}`] = t(`proposalRequests.state.${token}`);
  }
  for (const token of TENANT_STATE_TOKENS) {
    enumLabels[`from.${token}`] = enumLabels[`to.${token}`] = t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[token]);
  }

  return {
    toggleOpen: t('auditLogs.detail.toggle.open'),
    toggleClose: t('auditLogs.detail.toggle.close'),
    columnItem: t('auditLogs.detail.column.item'),
    columnValue: t('auditLogs.detail.column.value'),
    columnBefore: t('auditLogs.detail.column.before'),
    columnAfter: t('auditLogs.detail.column.after'),
    empty: t('auditLogs.detail.empty'),
    suppressed: { PARTNER_LEDGER: t('auditLogs.detail.suppressed.PARTNER_LEDGER') },
    deletedPartnerCompany: t('auditLogs.detail.deleted.partnerCompany'),
    emptyList: t('auditLogs.detail.emptyList'),
    booleanTrue: t('auditLogs.detail.boolean.true'),
    booleanFalse: t('auditLogs.detail.boolean.false'),
    booleanUnknown: t('auditLogs.detail.boolean.unknown'),
    dateNone: t('auditLogs.detail.date.none'),
    pairLabels,
    pairSideLabels,
    keyLabels,
    enumLabels,
    nullLabels: {
      projectId: t('auditLogs.detail.deleted.project'),
      requestedBy: t('auditLogs.detail.deleted.user'),
      targetPartnerCompanyId: t('auditLogs.detail.deleted.partnerCompany'),
      periodTo: t('auditLogs.detail.date.ongoing'),
    },
  };
}
