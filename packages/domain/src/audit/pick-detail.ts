// packages/domain/src/audit/pick-detail.ts
// 🔴 監査ログの `summary`（JSON）から、**ホストの管理者（`S-041`）に見せてよいキーだけを選ぶ**純粋関数
//    （docs/05 §6.4「#10 の改訂」/ `docs/04` §S-041「行の詳細」/ `U-17` / §11-15。T-11-09。
//    [Issue #40](https://github.com/Festal-KM/SES-Platform/issues/40) = 選択肢 2）。
//
// 🔴 `mask-summary.ts`（`A-006` の運営者向けマスク）とは**別関数・別の型**である。あちらは「内容キーを語彙で
//    落とし、残りは値の形で伏せる」（既知の形を前提にしない）、こちらは「**許可したキー以外を落とす**」。
//    向きが逆の 2 関数を 1 つにすると、どちらかの用途で「落とし忘れ」が「伏せ忘れ」に化ける。
//    **相互に import しない**（`tests/static/audit-detail-single-path.test.ts` ④ が固定する）。
//
// 🔴 2 段の網:
//   1 段目 = キーの許可（`AUDIT_DETAIL_ALLOWLIST`。action の exact 一致 → 接尾辞族 → 0 キー）。
//   2 段目 = 値の形（`ENUM` は大文字スネーク or 閉集合 / `NUMBER` は有限数 / `DATE` は `YYYY-MM` `YYYY-MM-DD`
//            ISO 8601 / `FIELD_NAMES` は識別子の列挙 / `REF` `REF_LIST` は UUID）。形に合わない値は**キーごと落ちる**。
//   形の検査は 2 段目であり、**1 段目を緩める理由にしない**。
//
// 🔴 第二境界（`CLAUDE.md` §3.1 / `U-17`）: 主体がパートナー所属のメンバーである行のうち、台帳系 4 族
//    （`engineer.` / `engineer_career.` / `skill_sheet.` / `engineer_share.`）は **1 キーも出さない**。
//    この判定は**キー選択より先**に行い、4 族では許可リストの表を読まない。主体の所属の解決は呼び出し側
//    （`apps/web/lib/audit-logs/service.ts`）がサーバで行い、ここは結果（`actorScope`）を受け取るだけ。
//
// 🔴 自由文を表す種類（`TEXT` / `STRING`）を型に作らない。名前は `REF` / `REF_LIST`（ID）として返し、
//    表示名への解決は呼び出し側がホストの自社データ（`partner_companies` / `projects` / `users`）で行う。
//    `AuditDetailRefEntity` に `'ENGINEER'` は無い（パートナー所有のエンジニア ID を名前に解決する種類を持たない）。
import { AI_MODEL_PRICING } from '../ai/pricing.js';
import { AI_ROLES } from '../ai/roles.js';
import { AUTO_APPROVE_REASON } from '../gate/autoApprove.js';
import { USAGE_LIMIT_LEVELS } from '../quota/limit-level.js';
import { SCAN_STATUSES } from '../scan/status.js';
import { PROPOSAL_STATES } from '../state/proposal.js';

/** ID を表示名に解決できるエンティティ。🔴 `'ENGINEER'` は無い（docs/05 §6.4「#10 の改訂」）。 */
export type AuditDetailRefEntity = 'PARTNER_COMPANY' | 'PROJECT' | 'USER';

export type AuditDetailPairSide = 'BEFORE' | 'AFTER';
export type AuditDetailPair = { readonly id: string; readonly side: AuditDetailPairSide };

/** 値は 7 種の判別可能な合併だけ。**自由文を表す種類が無い。** */
export type AuditDetailValue =
  | { readonly kind: 'ENUM'; readonly value: string }
  | { readonly kind: 'BOOLEAN'; readonly value: boolean | null }
  | { readonly kind: 'NUMBER'; readonly value: number }
  | { readonly kind: 'DATE'; readonly value: string | null }
  | { readonly kind: 'FIELD_NAMES'; readonly value: readonly string[] }
  | { readonly kind: 'REF'; readonly entity: AuditDetailRefEntity; readonly id: string }
  | { readonly kind: 'REF_LIST'; readonly entity: 'PARTNER_COMPANY'; readonly ids: readonly string[] };

export type AuditDetailEntry = {
  /** `summary` のキー名そのまま（i18n のラベルキーになる）。 */
  readonly key: string;
  readonly pair: AuditDetailPair | null;
  readonly value: AuditDetailValue;
};

export type AuditDetailSuppressedReason = 'PARTNER_LEDGER';

export type PickedAuditDetail =
  | { readonly kind: 'DETAIL'; readonly entries: readonly AuditDetailEntry[] }
  | { readonly kind: 'SUPPRESSED'; readonly reason: AuditDetailSuppressedReason };

/** 主体の所属。`UNRESOLVED` = `SYSTEM` / `PLATFORM_USER` / 所属行が無い利用者。 */
export type AuditActorScope = 'HOST' | 'PARTNER' | 'UNRESOLVED';

export type AuditDetailAllowedKeySpec =
  | { readonly kind: 'ENUM'; readonly values?: readonly string[]; readonly pair?: AuditDetailPair }
  | { readonly kind: 'BOOLEAN' }
  | { readonly kind: 'NUMBER'; readonly pair?: AuditDetailPair }
  | { readonly kind: 'DATE'; readonly pair?: AuditDetailPair }
  | { readonly kind: 'FIELD_NAMES'; readonly separator: ',' }
  | { readonly kind: 'REF'; readonly entity: AuditDetailRefEntity }
  | {
      readonly kind: 'REF_LIST';
      readonly entity: 'PARTNER_COMPANY';
      readonly separator: ',';
      readonly pair?: AuditDetailPair;
    };

export type AuditDetailKeySpecs = Readonly<Record<string, AuditDetailAllowedKeySpec>>;

/** 🔴 主体がパートナー所属なら 1 キーも出さない action の接頭辞（`U-17`）。 */
export const PARTNER_LEDGER_ACTION_PREFIXES = [
  'engineer.',
  'engineer_career.',
  'skill_sheet.',
  'engineer_share.',
] as const;

/**
 * `proposal_request.update` の `operation` の閉集合（docs/05 §6.4「#10 の改訂」で確定）。
 * `ACCEPT` / `DECLINE` / `WITHDRAW` は `apps/web/lib/proposal-requests/service.ts`、`EXPIRE` は
 * `packages/db/src/proposal-request-expiry.ts` の書き込み側と同じ値。
 */
export const PROPOSAL_REQUEST_OPERATIONS = ['ACCEPT', 'DECLINE', 'WITHDRAW', 'EXPIRE'] as const;

export type ProposalRequestOperation = (typeof PROPOSAL_REQUEST_OPERATIONS)[number];

/**
 * 🔴 T-12-17 ⑮: 書き込み側（`apps/web/lib/proposal-requests/service.ts` / `packages/db/src/proposal-request-expiry.ts`）が
 *    `summary.operation` に載せる値の**名前付き参照**。値は上の閉集合から取る（リテラルを 2 度書かない。監査ログの値は不変）。
 *    `satisfies` が「キー名 = 値」を型で固定するので、閉集合と食い違う定義はコンパイルできない。
 */
export const PROPOSAL_REQUEST_OPERATION = {
  ACCEPT: PROPOSAL_REQUEST_OPERATIONS[0],
  DECLINE: PROPOSAL_REQUEST_OPERATIONS[1],
  WITHDRAW: PROPOSAL_REQUEST_OPERATIONS[2],
  EXPIRE: PROPOSAL_REQUEST_OPERATIONS[3],
} as const satisfies { readonly [K in ProposalRequestOperation]: K };

const PAIR_VISIBILITY_BEFORE: AuditDetailPair = { id: 'visibility', side: 'BEFORE' };
const PAIR_VISIBILITY_AFTER: AuditDetailPair = { id: 'visibility', side: 'AFTER' };
const PAIR_ROLE_BEFORE: AuditDetailPair = { id: 'role', side: 'BEFORE' };
const PAIR_ROLE_AFTER: AuditDetailPair = { id: 'role', side: 'AFTER' };
const PAIR_STATE_BEFORE: AuditDetailPair = { id: 'state', side: 'BEFORE' };
const PAIR_STATE_AFTER: AuditDetailPair = { id: 'state', side: 'AFTER' };
const PAIR_LEVEL_BEFORE: AuditDetailPair = { id: 'level', side: 'BEFORE' };
const PAIR_LEVEL_AFTER: AuditDetailPair = { id: 'level', side: 'AFTER' };
const PAIR_MODE_BEFORE: AuditDetailPair = { id: 'mode', side: 'BEFORE' };
const PAIR_MODE_AFTER: AuditDetailPair = { id: 'mode', side: 'AFTER' };
const PAIR_MODEL_BEFORE: AuditDetailPair = { id: 'model', side: 'BEFORE' };
const PAIR_MODEL_AFTER: AuditDetailPair = { id: 'model', side: 'AFTER' };
const PAIR_WEIGHT_BEFORE: AuditDetailPair = { id: 'weight', side: 'BEFORE' };
const PAIR_WEIGHT_AFTER: AuditDetailPair = { id: 'weight', side: 'AFTER' };

const PARTNER_LIST: AuditDetailAllowedKeySpec = {
  kind: 'REF_LIST',
  entity: 'PARTNER_COMPANY',
  separator: ',',
};

/**
 * `proposal.*`（exact 5 action）の共通キー。🔴 `reason` は含めない —— `proposal.approve` の spec にだけ
 * 閉集合 `[AUTO_APPROVE_REASON]` で置く（`proposal.reject` が将来 `reason` を書いても出ない）。
 */
const PROPOSAL_KEYS: AuditDetailKeySpecs = {
  operation: { kind: 'ENUM' },
  fromState: { kind: 'ENUM', values: PROPOSAL_STATES, pair: PAIR_STATE_BEFORE },
  toState: { kind: 'ENUM', values: PROPOSAL_STATES, pair: PAIR_STATE_AFTER },
  outcome: { kind: 'ENUM' },
  result: { kind: 'ENUM' },
  rerunReason: { kind: 'ENUM' },
  attemptSeq: { kind: 'NUMBER' },
  reasonLength: { kind: 'NUMBER' },
  requestedBy: { kind: 'REF', entity: 'USER' },
  externalCallMade: { kind: 'BOOLEAN' },
};

/** `engineer.view` / `skill_sheet.view` / `skill_sheet.download`（🔴 主体がパートナーならこの表に到達しない）。 */
const LEDGER_VIEW_KEYS: AuditDetailKeySpecs = {
  via: { kind: 'ENUM' },
  version: { kind: 'NUMBER' },
  scanStatus: { kind: 'ENUM', values: SCAN_STATUSES },
};

/** `usage.limit_*`（`SYSTEM`）。 */
const USAGE_LIMIT_KEYS: AuditDetailKeySpecs = {
  metric: { kind: 'ENUM' },
  from: { kind: 'ENUM', values: USAGE_LIMIT_LEVELS, pair: PAIR_LEVEL_BEFORE },
  to: { kind: 'ENUM', values: USAGE_LIMIT_LEVELS, pair: PAIR_LEVEL_AFTER },
  periodKind: { kind: 'ENUM' },
  effect: { kind: 'ENUM' },
};

/** `impersonation.start` / `.end`（§5.6 は Phase 2 未実装。実装時にこのキー名で書く）。 */
const IMPERSONATION_KEYS: AuditDetailKeySpecs = {
  ttlMinutes: { kind: 'NUMBER' },
  expiresAt: { kind: 'DATE' },
};

/** 接尾辞族 `*.create` / `*.update` / `*.delete`（exact 行に無い action だけがここに来る）。 */
const CRUD_KEYS: AuditDetailKeySpecs = {
  operation: { kind: 'ENUM' },
  decision: { kind: 'ENUM' },
  mode: { kind: 'ENUM' },
  status: { kind: 'ENUM' },
  fields: { kind: 'FIELD_NAMES', separator: ',' },
  changedFields: { kind: 'FIELD_NAMES', separator: ',' },
  skillCount: { kind: 'NUMBER' },
  newSkillLabelCount: { kind: 'NUMBER' },
  headcount: { kind: 'NUMBER' },
  mustCount: { kind: 'NUMBER' },
  niceCount: { kind: 'NUMBER' },
  targetPartnerCompanyId: { kind: 'REF', entity: 'PARTNER_COMPANY' },
  periodFrom: { kind: 'DATE' },
  periodTo: { kind: 'DATE' },
};

/** 接尾辞族のキー（`AUDIT_DETAIL_ALLOWLIST` のキーとして使う。`'*.create'` の形）。 */
export const AUDIT_DETAIL_SUFFIX_FAMILIES = ['*.create', '*.update', '*.delete'] as const;

/**
 * 🔴 action → キー → 値の種類（docs/05 §6.4「#10 の改訂」の許可リスト表。**この表が 1 箇所**）。
 *
 * - キーは action の完全名、または接尾辞族 `'*.create'` / `'*.update'` / `'*.delete'`。
 * - 表に無い action は 0 キー（`auth.*` / `state.invalid_transition` / `esign.*` / `admin.*` …）。
 * - 足すときは `docs/04` §S-041 の表 → docs/05 の表 → ここ、の順（`pick-detail.test.ts` のスナップショットが差分を出す）。
 */
export const AUDIT_DETAIL_ALLOWLIST: Readonly<Record<string, AuditDetailKeySpecs>> = {
  'project.visibility_change': {
    before: { ...PARTNER_LIST, pair: PAIR_VISIBILITY_BEFORE },
    after: { ...PARTNER_LIST, pair: PAIR_VISIBILITY_AFTER },
    requested: PARTNER_LIST,
    pending: PARTNER_LIST,
    revoked: PARTNER_LIST,
    published: PARTNER_LIST,
    blocked: PARTNER_LIST,
    verdict: { kind: 'ENUM' },
    operation: { kind: 'ENUM' },
  },
  'membership.role_change': {
    beforeRole: { kind: 'ENUM', pair: PAIR_ROLE_BEFORE },
    afterRole: { kind: 'ENUM', pair: PAIR_ROLE_AFTER },
  },
  'membership.revoke': {
    beforeRole: { kind: 'ENUM', pair: PAIR_ROLE_BEFORE },
  },
  'proposal.submit': PROPOSAL_KEYS,
  'proposal.resend': PROPOSAL_KEYS,
  'proposal.approve': {
    ...PROPOSAL_KEYS,
    reason: { kind: 'ENUM', values: [AUTO_APPROVE_REASON] },
  },
  'proposal.reject': PROPOSAL_KEYS,
  'proposal.update': PROPOSAL_KEYS,
  'proposal_request.create': {
    projectId: { kind: 'REF', entity: 'PROJECT' },
  },
  'proposal_request.update': {
    operation: { kind: 'ENUM', values: PROPOSAL_REQUEST_OPERATIONS },
  },
  'engineer.view': LEDGER_VIEW_KEYS,
  'skill_sheet.view': LEDGER_VIEW_KEYS,
  'skill_sheet.download': LEDGER_VIEW_KEYS,
  'project.view': {
    via: { kind: 'ENUM' },
  },
  'impersonation.start': IMPERSONATION_KEYS,
  'impersonation.end': IMPERSONATION_KEYS,
  'usage.limit_nearing': USAGE_LIMIT_KEYS,
  'usage.limit_reached': USAGE_LIMIT_KEYS,
  'usage.limit_released': USAGE_LIMIT_KEYS,
  'ai.approval_mode_change': {
    aiRole: { kind: 'ENUM', values: AI_ROLES },
    beforeMode: { kind: 'ENUM', pair: PAIR_MODE_BEFORE },
    afterMode: { kind: 'ENUM', pair: PAIR_MODE_AFTER },
  },
  'ai.model_change': {
    aiRole: { kind: 'ENUM', values: AI_ROLES },
    beforeModel: { kind: 'ENUM', values: Object.keys(AI_MODEL_PRICING), pair: PAIR_MODEL_BEFORE },
    afterModel: { kind: 'ENUM', values: Object.keys(AI_MODEL_PRICING), pair: PAIR_MODEL_AFTER },
  },
  match_weight_change: {
    criterion: { kind: 'ENUM' },
    before: { kind: 'NUMBER', pair: PAIR_WEIGHT_BEFORE },
    after: { kind: 'NUMBER', pair: PAIR_WEIGHT_AFTER },
  },
  '*.create': CRUD_KEYS,
  '*.update': CRUD_KEYS,
  '*.delete': CRUD_KEYS,
};

const ENUM_TOKEN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

export function isPartnerLedgerAction(action: string): boolean {
  return PARTNER_LEDGER_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}

/** ①exact → ②接尾辞族 → ③無し。 */
export function resolveAuditDetailKeySpecs(action: string): AuditDetailKeySpecs | null {
  const exact = AUDIT_DETAIL_ALLOWLIST[action];
  if (exact !== undefined) return exact;
  for (const family of AUDIT_DETAIL_SUFFIX_FAMILIES) {
    if (action.endsWith(family.slice(1))) return AUDIT_DETAIL_ALLOWLIST[family] ?? null;
  }
  return null;
}

function splitList(value: string, separator: ','): readonly string[] {
  return value === '' ? [] : value.split(separator);
}

/** 形に合えば値、合わなければ `undefined`（キーごと落ちる）。 */
function shapeValue(spec: AuditDetailAllowedKeySpec, raw: unknown): AuditDetailValue | undefined {
  switch (spec.kind) {
    case 'ENUM': {
      if (typeof raw !== 'string') return undefined;
      const accepted =
        spec.values !== undefined ? spec.values.includes(raw) : ENUM_TOKEN_PATTERN.test(raw);
      return accepted ? { kind: 'ENUM', value: raw } : undefined;
    }
    case 'BOOLEAN':
      return raw === null || typeof raw === 'boolean' ? { kind: 'BOOLEAN', value: raw } : undefined;
    case 'NUMBER':
      return typeof raw === 'number' && Number.isFinite(raw) ? { kind: 'NUMBER', value: raw } : undefined;
    case 'DATE': {
      if (raw === null) return { kind: 'DATE', value: null };
      if (typeof raw !== 'string') return undefined;
      const accepted =
        YEAR_MONTH_PATTERN.test(raw) || DATE_PATTERN.test(raw) || ISO_DATE_TIME_PATTERN.test(raw);
      return accepted ? { kind: 'DATE', value: raw } : undefined;
    }
    case 'FIELD_NAMES': {
      if (typeof raw !== 'string') return undefined;
      const names = splitList(raw, spec.separator);
      return names.every((name) => FIELD_NAME_PATTERN.test(name))
        ? { kind: 'FIELD_NAMES', value: names }
        : undefined;
    }
    case 'REF':
      return typeof raw === 'string' && UUID_PATTERN.test(raw)
        ? { kind: 'REF', entity: spec.entity, id: raw }
        : undefined;
    case 'REF_LIST': {
      if (typeof raw !== 'string') return undefined;
      const ids = splitList(raw, spec.separator);
      return ids.every((id) => UUID_PATTERN.test(id))
        ? { kind: 'REF_LIST', entity: spec.entity, ids }
        : undefined;
    }
  }
}

function pairOf(spec: AuditDetailAllowedKeySpec): AuditDetailPair | null {
  return 'pair' in spec && spec.pair !== undefined ? spec.pair : null;
}

const EMPTY_DETAIL: PickedAuditDetail = { kind: 'DETAIL', entries: [] };

/**
 * 🔴 `summary: unknown` を受け取るのはこの関数だけである（`tests/static/audit-detail-single-path.test.ts` ①
 *    が呼び出し元を `apps/web/lib/audit-logs/service.ts` の 1 本に固定する）。
 *
 * - 台帳系 4 族は `actorScope` を**先に**見る: `PARTNER` → `SUPPRESSED` / `UNRESOLVED` → 0 キー / `HOST` → 表へ。
 * - 4 族以外は `actorScope` に依らず同じ結果。
 * - 出力の順序は許可リストの定義順（決定的。同じ入力に同じ出力）。
 * - `summary` がオブジェクトでなければ 0 キー。
 */
export function pickAuditDetail(
  action: string,
  summary: unknown,
  context: { readonly actorScope: AuditActorScope },
): PickedAuditDetail {
  if (isPartnerLedgerAction(action)) {
    if (context.actorScope === 'PARTNER') return { kind: 'SUPPRESSED', reason: 'PARTNER_LEDGER' };
    if (context.actorScope === 'UNRESOLVED') return EMPTY_DETAIL;
  }
  const specs = resolveAuditDetailKeySpecs(action);
  if (specs === null) return EMPTY_DETAIL;
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) return EMPTY_DETAIL;
  const raw = summary as Readonly<Record<string, unknown>>;

  const entries: AuditDetailEntry[] = [];
  for (const [key, spec] of Object.entries(specs)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = shapeValue(spec, raw[key]);
    if (value === undefined) continue;
    entries.push({ key, pair: pairOf(spec), value });
  }
  return { kind: 'DETAIL', entries };
}
