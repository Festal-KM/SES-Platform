// packages/domain/src/audit/pick-detail.test.ts
// `pickAuditDetail` / `AUDIT_DETAIL_ALLOWLIST`（docs/05 §6.4「#10 の改訂」テスト①〜⑤。T-11-09）。
//
// 🔴 ① スナップショットでキー集合を固定する（キーの増減・種類の変更は必ず差分になる。足すときは
//    `docs/04` §S-041 の表 → docs/05 の表 → 許可リスト、の順で上流を先に直す）。
// 🔴 ② 禁止名の検査は `mask-summary.ts` の語彙定数を**読んで**突合する（2 箇所に書かない）。
//    `reason` は `mask-summary.ts` では内容語だが、ここでは **`proposal.approve` にだけ閉集合
//    `[AUTO_APPROVE_REASON]` で許す**（docs/05 の決着 ⑥）ので、その 1 点だけを名指しで別に固定する。
import { describe, expect, it } from 'vitest';
import { AI_MODEL_PRICING } from '../ai/pricing.js';
import { AI_ROLES } from '../ai/roles.js';
import { AUTO_APPROVE_REASON } from '../gate/autoApprove.js';
import { USAGE_LIMIT_LEVELS } from '../quota/limit-level.js';
import { SCAN_STATUSES } from '../scan/status.js';
import { PROPOSAL_STATES } from '../state/proposal.js';
import { GATE_VERDICTS } from '../gate/types.js';
import { STATE_MACHINE_ENTITIES } from '../state/errors.js';
import { COMMERCE_WORDS, CONTENT_WORDS, IDENTITY_WORDS } from './mask-summary.js';
import {
  AUDIT_DETAIL_ALLOWLIST,
  AUDIT_DETAIL_SUFFIX_FAMILIES,
  AUDIT_DETAIL_SUFFIX_FAMILY_EXCLUDED_PREFIXES,
  DATA_EXPORT_KINDS,
  PARTNER_LEDGER_ACTION_PREFIXES,
  PROPOSAL_REQUEST_OPERATIONS,
  TENANT_PURGE_CAUSES,
  pickAuditDetail,
  resolveAuditDetailKeySpecs,
  type AuditActorScope,
  type AuditDetailAllowedKeySpec,
  type PickedAuditDetail,
} from './pick-detail.js';

const HOST = { actorScope: 'HOST' } as const;
const PARTNER = { actorScope: 'PARTNER' } as const;
const UNRESOLVED = { actorScope: 'UNRESOLVED' } as const;
const SCOPES: readonly AuditActorScope[] = ['HOST', 'PARTNER', 'UNRESOLVED'];

const UUID_A = '01930000-0000-7000-8000-00000000000a';
const UUID_B = '01930000-0000-7000-8000-00000000000b';

/** `mask-summary.ts` と同じ規則でキーを語に分解する（末尾語の突合のため）。 */
function wordsOf(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function tailCandidates(key: string): readonly string[] {
  const words = wordsOf(key);
  const last = words[words.length - 1];
  if (last === undefined) return [];
  const secondLast = words[words.length - 2];
  return secondLast === undefined ? [last] : [last, `${secondLast}${last}`];
}

/** 全 action × 全キーの平坦な列挙（列挙式にしない: 許可リストを走査して生成する）。 */
function allSpecs(): readonly { action: string; key: string; spec: AuditDetailAllowedKeySpec }[] {
  return Object.entries(AUDIT_DETAIL_ALLOWLIST).flatMap(([action, specs]) =>
    Object.entries(specs).map(([key, spec]) => ({ action, key, spec })),
  );
}

function entriesOf(picked: PickedAuditDetail) {
  return picked.kind === 'DETAIL' ? picked.entries : [];
}

describe('① 許可リストのスナップショット（action → キー → kind / pair / values）', () => {
  it('キー集合と種類を固定する', () => {
    const shape = Object.fromEntries(
      Object.entries(AUDIT_DETAIL_ALLOWLIST).map(([action, specs]) => [
        action,
        Object.fromEntries(
          Object.entries(specs).map(([key, spec]) => [
            key,
            [
              spec.kind,
              'pair' in spec && spec.pair ? `${spec.pair.id}:${spec.pair.side}` : '-',
              'values' in spec && spec.values ? `closed(${spec.values.length})` : '-',
              'entity' in spec ? spec.entity : '-',
            ].join(' '),
          ]),
        ),
      ]),
    );
    expect(shape).toMatchInlineSnapshot(`
      {
        "*.create": {
          "changedFields": "FIELD_NAMES - - -",
          "decision": "ENUM - - -",
          "fields": "FIELD_NAMES - - -",
          "headcount": "NUMBER - - -",
          "mode": "ENUM - - -",
          "mustCount": "NUMBER - - -",
          "newSkillLabelCount": "NUMBER - - -",
          "niceCount": "NUMBER - - -",
          "operation": "ENUM - - -",
          "periodFrom": "DATE - - -",
          "periodTo": "DATE - - -",
          "skillCount": "NUMBER - - -",
          "status": "ENUM - - -",
          "targetPartnerCompanyId": "REF - - PARTNER_COMPANY",
        },
        "*.delete": {
          "changedFields": "FIELD_NAMES - - -",
          "decision": "ENUM - - -",
          "fields": "FIELD_NAMES - - -",
          "headcount": "NUMBER - - -",
          "mode": "ENUM - - -",
          "mustCount": "NUMBER - - -",
          "newSkillLabelCount": "NUMBER - - -",
          "niceCount": "NUMBER - - -",
          "operation": "ENUM - - -",
          "periodFrom": "DATE - - -",
          "periodTo": "DATE - - -",
          "skillCount": "NUMBER - - -",
          "status": "ENUM - - -",
          "targetPartnerCompanyId": "REF - - PARTNER_COMPANY",
        },
        "*.update": {
          "changedFields": "FIELD_NAMES - - -",
          "decision": "ENUM - - -",
          "fields": "FIELD_NAMES - - -",
          "headcount": "NUMBER - - -",
          "mode": "ENUM - - -",
          "mustCount": "NUMBER - - -",
          "newSkillLabelCount": "NUMBER - - -",
          "niceCount": "NUMBER - - -",
          "operation": "ENUM - - -",
          "periodFrom": "DATE - - -",
          "periodTo": "DATE - - -",
          "skillCount": "NUMBER - - -",
          "status": "ENUM - - -",
          "targetPartnerCompanyId": "REF - - PARTNER_COMPANY",
        },
        "ai.approval_mode_change": {
          "afterMode": "ENUM mode:AFTER - -",
          "aiRole": "ENUM - closed(6) -",
          "beforeMode": "ENUM mode:BEFORE - -",
        },
        "ai.model_change": {
          "afterModel": "ENUM model:AFTER closed(3) -",
          "aiRole": "ENUM - closed(6) -",
          "beforeModel": "ENUM model:BEFORE closed(3) -",
        },
        "audit_log.export": {
          "rowCount": "NUMBER - - -",
          "truncated": "BOOLEAN - - -",
        },
        "data_export.download": {
          "kind": "ENUM - closed(2) -",
        },
        "engineer.view": {
          "scanStatus": "ENUM - closed(5) -",
          "version": "NUMBER - - -",
          "via": "ENUM - - -",
        },
        "impersonation.end": {
          "expiresAt": "DATE - - -",
          "ttlMinutes": "NUMBER - - -",
        },
        "impersonation.start": {
          "expiresAt": "DATE - - -",
          "ttlMinutes": "NUMBER - - -",
        },
        "match_weight_change": {
          "after": "NUMBER weight:AFTER - -",
          "before": "NUMBER weight:BEFORE - -",
          "criterion": "ENUM - - -",
        },
        "membership.revoke": {
          "beforeRole": "ENUM role:BEFORE - -",
        },
        "membership.role_change": {
          "afterRole": "ENUM role:AFTER - -",
          "beforeRole": "ENUM role:BEFORE - -",
        },
        "project.view": {
          "via": "ENUM - - -",
        },
        "project.visibility_change": {
          "after": "REF_LIST visibility:AFTER - PARTNER_COMPANY",
          "before": "REF_LIST visibility:BEFORE - PARTNER_COMPANY",
          "blocked": "REF_LIST - - PARTNER_COMPANY",
          "operation": "ENUM - - -",
          "pending": "REF_LIST - - PARTNER_COMPANY",
          "published": "REF_LIST - - PARTNER_COMPANY",
          "requested": "REF_LIST - - PARTNER_COMPANY",
          "revoked": "REF_LIST - - PARTNER_COMPANY",
          "verdict": "ENUM - - -",
        },
        "proposal.approve": {
          "attemptSeq": "NUMBER - - -",
          "externalCallMade": "BOOLEAN - - -",
          "fromState": "ENUM state:BEFORE closed(14) -",
          "operation": "ENUM - - -",
          "outcome": "ENUM - - -",
          "reason": "ENUM - closed(1) -",
          "reasonLength": "NUMBER - - -",
          "requestedBy": "REF - - USER",
          "rerunReason": "ENUM - - -",
          "result": "ENUM - - -",
          "toState": "ENUM state:AFTER closed(14) -",
        },
        "proposal.reject": {
          "attemptSeq": "NUMBER - - -",
          "externalCallMade": "BOOLEAN - - -",
          "fromState": "ENUM state:BEFORE closed(14) -",
          "operation": "ENUM - - -",
          "outcome": "ENUM - - -",
          "reasonLength": "NUMBER - - -",
          "requestedBy": "REF - - USER",
          "rerunReason": "ENUM - - -",
          "result": "ENUM - - -",
          "toState": "ENUM state:AFTER closed(14) -",
        },
        "proposal.resend": {
          "attemptSeq": "NUMBER - - -",
          "externalCallMade": "BOOLEAN - - -",
          "fromState": "ENUM state:BEFORE closed(14) -",
          "operation": "ENUM - - -",
          "outcome": "ENUM - - -",
          "reasonLength": "NUMBER - - -",
          "requestedBy": "REF - - USER",
          "rerunReason": "ENUM - - -",
          "result": "ENUM - - -",
          "toState": "ENUM state:AFTER closed(14) -",
        },
        "proposal.submit": {
          "attemptSeq": "NUMBER - - -",
          "externalCallMade": "BOOLEAN - - -",
          "fromState": "ENUM state:BEFORE closed(14) -",
          "operation": "ENUM - - -",
          "outcome": "ENUM - - -",
          "reasonLength": "NUMBER - - -",
          "requestedBy": "REF - - USER",
          "rerunReason": "ENUM - - -",
          "result": "ENUM - - -",
          "toState": "ENUM state:AFTER closed(14) -",
        },
        "proposal.update": {
          "attemptSeq": "NUMBER - - -",
          "commerceVerdict": "ENUM - closed(2) -",
          "consistencyVerdict": "ENUM - closed(2) -",
          "externalCallMade": "BOOLEAN - - -",
          "findingCount": "NUMBER - - -",
          "fromState": "ENUM state:BEFORE closed(14) -",
          "operation": "ENUM - - -",
          "outcome": "ENUM - - -",
          "overall": "ENUM - closed(2) -",
          "piiVerdict": "ENUM - closed(2) -",
          "reasonLength": "NUMBER - - -",
          "requestedBy": "REF - - USER",
          "rerunReason": "ENUM - - -",
          "result": "ENUM - - -",
          "toState": "ENUM state:AFTER closed(14) -",
          "warningCount": "NUMBER - - -",
        },
        "proposal_request.create": {
          "projectId": "REF - - PROJECT",
        },
        "proposal_request.update": {
          "operation": "ENUM - closed(4) -",
        },
        "skill_sheet.download": {
          "scanStatus": "ENUM - closed(5) -",
          "version": "NUMBER - - -",
          "via": "ENUM - - -",
        },
        "skill_sheet.view": {
          "scanStatus": "ENUM - closed(5) -",
          "version": "NUMBER - - -",
          "via": "ENUM - - -",
        },
        "state.invalid_transition": {
          "entity": "ENUM - closed(5) -",
          "from": "ENUM state:BEFORE - -",
          "to": "ENUM state:AFTER - -",
        },
        "tenant.purge": {
          "cause": "ENUM - closed(2) -",
          "count_*": "NUMBER - - -",
          "tables": "NUMBER - - -",
        },
        "usage.limit_nearing": {
          "effect": "ENUM - - -",
          "from": "ENUM level:BEFORE closed(3) -",
          "metric": "ENUM - - -",
          "periodKind": "ENUM - - -",
          "to": "ENUM level:AFTER closed(3) -",
        },
        "usage.limit_reached": {
          "effect": "ENUM - - -",
          "from": "ENUM level:BEFORE closed(3) -",
          "metric": "ENUM - - -",
          "periodKind": "ENUM - - -",
          "to": "ENUM level:AFTER closed(3) -",
        },
        "usage.limit_released": {
          "effect": "ENUM - - -",
          "from": "ENUM level:BEFORE closed(3) -",
          "metric": "ENUM - - -",
          "periodKind": "ENUM - - -",
          "to": "ENUM level:AFTER closed(3) -",
        },
      }
    `);
  });

  it('閉集合は domain の定数そのものを指す（列挙し直していない）', () => {
    expect(AUDIT_DETAIL_ALLOWLIST['proposal.submit']?.['fromState']).toMatchObject({ values: PROPOSAL_STATES });
    expect(AUDIT_DETAIL_ALLOWLIST['engineer.view']?.['scanStatus']).toMatchObject({ values: SCAN_STATUSES });
    expect(AUDIT_DETAIL_ALLOWLIST['usage.limit_reached']?.['to']).toMatchObject({ values: USAGE_LIMIT_LEVELS });
    expect(AUDIT_DETAIL_ALLOWLIST['ai.model_change']?.['aiRole']).toMatchObject({ values: AI_ROLES });
    expect(AUDIT_DETAIL_ALLOWLIST['ai.model_change']?.['afterModel']).toMatchObject({
      values: Object.keys(AI_MODEL_PRICING),
    });
    expect(AUDIT_DETAIL_ALLOWLIST['proposal_request.update']?.['operation']).toMatchObject({
      values: PROPOSAL_REQUEST_OPERATIONS,
    });
    expect([...PROPOSAL_REQUEST_OPERATIONS].sort()).toEqual(['ACCEPT', 'DECLINE', 'EXPIRE', 'WITHDRAW']);
    // T-12-18 ⑨ / ⑩: 各層 verdict は `GATE_VERDICTS`、`entity` は `STATE_MACHINE_ENTITIES`、`cause` / `kind` は domain 側の閉集合。
    for (const key of ['overall', 'piiVerdict', 'commerceVerdict', 'consistencyVerdict']) {
      expect(AUDIT_DETAIL_ALLOWLIST['proposal.update']?.[key]).toMatchObject({ values: GATE_VERDICTS });
    }
    expect(AUDIT_DETAIL_ALLOWLIST['state.invalid_transition']?.['entity']).toMatchObject({ values: STATE_MACHINE_ENTITIES });
    expect(AUDIT_DETAIL_ALLOWLIST['tenant.purge']?.['cause']).toMatchObject({ values: TENANT_PURGE_CAUSES });
    expect(AUDIT_DETAIL_ALLOWLIST['data_export.download']?.['kind']).toMatchObject({ values: DATA_EXPORT_KINDS });
  });

  it('🔴 T-12-18 ⑩: 閉集合の値は DB の CHECK（packages/db/src/schema-value-sets.ts が再 export する）と同じ', () => {
    // `packages/db` 側は本定数を再 export しており（1 実装）、migration の CHECK との一致は `tests/static/schema-enum-drift.test.ts` が見る。
    expect([...TENANT_PURGE_CAUSES]).toEqual(['TENANT_PURGED', 'RETENTION']);
    expect([...DATA_EXPORT_KINDS]).toEqual(['CLOSING_RETURN', 'OPERATIONAL']);
    expect([...GATE_VERDICTS]).toEqual(['PASS', 'FAIL']);
    expect([...STATE_MACHINE_ENTITIES]).toEqual(['Proposal', 'ProposalRequest', 'Assignment', 'Contract', 'Tenant']);
  });

  it('自由文を表す種類（TEXT / STRING）が 1 つも無い', () => {
    const kinds = new Set(allSpecs().map(({ spec }) => spec.kind));
    expect([...kinds].sort()).toEqual(['BOOLEAN', 'DATE', 'ENUM', 'FIELD_NAMES', 'NUMBER', 'REF', 'REF_LIST']);
  });

  it("🔴 REF / REF_LIST のエンティティに 'ENGINEER' が無い", () => {
    const entities = new Set(
      allSpecs().flatMap(({ spec }) => ('entity' in spec ? [spec.entity as string] : [])),
    );
    expect([...entities].sort()).toEqual(['PARTNER_COMPANY', 'PROJECT', 'USER']);
  });
});

describe('② 禁止名の検査（mask-summary.ts の語彙定数と突合）', () => {
  /** 🔴 `reason` だけは docs/05 の決着 ⑥ により別扱い（下の it で名指しで固定する）。 */
  const CONTENT_WORDS_EXCEPT_REASON = new Set([...CONTENT_WORDS].filter((word) => word !== 'reason'));

  it('全キーの末尾語が内容・身元・商流の語彙に 1 つも一致しない', () => {
    const offenders = allSpecs().filter(({ key }) => {
      const tails = tailCandidates(key);
      const words = wordsOf(key);
      return (
        tails.some((tail) => CONTENT_WORDS_EXCEPT_REASON.has(tail)) ||
        tails.some((tail) => IDENTITY_WORDS.has(tail)) ||
        tails.some((tail) => COMMERCE_WORDS.has(tail)) ||
        words.some((word) => COMMERCE_WORDS.has(word))
      );
    });
    expect(offenders.map(({ action, key }) => `${action}.${key}`)).toEqual([]);
    // 対照: 語彙が空でない（検査が空振りしていない）。
    expect(CONTENT_WORDS.has('body')).toBe(true);
    expect(IDENTITY_WORDS.has('name')).toBe(true);
    expect(COMMERCE_WORDS.has('unitprice')).toBe(true);
  });

  it('🔴 declineReason / objectKey / token / displayName / email / unitPrice が無い', () => {
    const keys = new Set(allSpecs().map(({ key }) => key));
    for (const forbidden of ['declineReason', 'objectKey', 'token', 'displayName', 'email', 'unitPrice', 'note', 'body', 'subject']) {
      expect(keys.has(forbidden), `${forbidden} が許可リストに在る`).toBe(false);
    }
  });

  it('🔴 `reason` を持つ spec は proposal.approve の 1 つだけで、閉集合 [AUTO_APPROVE_REASON]', () => {
    const withReason = allSpecs().filter(({ key }) => key === 'reason');
    expect(withReason.map(({ action }) => action)).toEqual(['proposal.approve']);
    expect(withReason[0]?.spec).toEqual({ kind: 'ENUM', values: [AUTO_APPROVE_REASON] });
    // 末尾語が `reason` の他のキーは `rerunReason`（大文字スネークの列挙値）だけ。
    const reasonTailed = new Set(
      allSpecs()
        .filter(({ key }) => key !== 'reason' && tailCandidates(key).includes('reason'))
        .map(({ key }) => key),
    );
    expect([...reasonTailed]).toEqual(['rerunReason']);
  });

  it('🔴 proposal_request.update は operation だけ（辞退理由に相当するキーが無い。経路 4）', () => {
    expect(Object.keys(AUDIT_DETAIL_ALLOWLIST['proposal_request.update'] ?? {})).toEqual(['operation']);
    const picked = pickAuditDetail(
      'proposal_request.update',
      {
        operation: 'DECLINE',
        fromState: 'REQUESTED',
        toState: 'DECLINED',
        proposalId: UUID_A,
        declineReason: '単価が合わない',
        reason: 'OTHER',
        note: 'メモ',
        message: 'ALL_CAPS_BUT_NOT_ALLOWED',
      },
      PARTNER,
    );
    expect(picked).toEqual({
      kind: 'DETAIL',
      entries: [{ key: 'operation', pair: null, value: { kind: 'ENUM', value: 'DECLINE' } }],
    });
  });
});

describe('③ 形の検査（形に合わない値はキーごと落ちる）', () => {
  it('ENUM: 大文字スネーク以外（自由文・空白・非 ASCII・小文字）は落ちる', () => {
    const pick = (value: unknown) =>
      entriesOf(pickAuditDetail('project.view', { via: value }, HOST)).map((entry) => entry.value);
    expect(pick('DETAIL')).toEqual([{ kind: 'ENUM', value: 'DETAIL' }]);
    expect(pick('EDIT_FORM2')).toEqual([{ kind: 'ENUM', value: 'EDIT_FORM2' }]);
    expect(pick('detail')).toEqual([]);
    expect(pick('請求金額の不一致（Zendesk #1234）')).toEqual([]);
    expect(pick('ALL LAYERS PASS')).toEqual([]);
    expect(pick('')).toEqual([]);
    expect(pick(`${'A'.repeat(65)}`)).toEqual([]);
    expect(pick(1)).toEqual([]);
    expect(pick(null)).toEqual([]);
  });

  it('ENUM（閉集合）: 集合外は大文字スネークでも落ちる（reason は ALL_LAYERS_PASS だけ）', () => {
    const pick = (value: unknown) =>
      entriesOf(pickAuditDetail('proposal.approve', { reason: value }, HOST)).map((entry) => entry.value);
    expect(pick(AUTO_APPROVE_REASON)).toEqual([{ kind: 'ENUM', value: 'ALL_LAYERS_PASS' }]);
    expect(pick('MANUAL')).toEqual([]);
    expect(pick('請求金額の不一致（Zendesk #1234）')).toEqual([]);
    // 閉集合が小文字（AI ロール / モデル ID）でも集合の要素なら通る。
    expect(
      entriesOf(pickAuditDetail('ai.model_change', { aiRole: 'sheet-parser', beforeModel: 'claude-sonnet-5' }, HOST)),
    ).toEqual([
      { key: 'aiRole', pair: null, value: { kind: 'ENUM', value: 'sheet-parser' } },
      { key: 'beforeModel', pair: { id: 'model', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'claude-sonnet-5' } },
    ]);
    expect(entriesOf(pickAuditDetail('ai.model_change', { aiRole: 'unknown-role', beforeModel: 'gpt-4' }, HOST))).toEqual([]);
  });

  it('NUMBER: 有限数のみ（NaN / Infinity / 数字文字列は落ちる）', () => {
    const pick = (value: unknown) =>
      entriesOf(pickAuditDetail('proposal.submit', { attemptSeq: value }, HOST)).map((entry) => entry.value);
    expect(pick(3)).toEqual([{ kind: 'NUMBER', value: 3 }]);
    expect(pick(0)).toEqual([{ kind: 'NUMBER', value: 0 }]);
    expect(pick(Number.NaN)).toEqual([]);
    expect(pick(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(pick('3')).toEqual([]);
    expect(pick(null)).toEqual([]);
  });

  it('BOOLEAN: true / false / null のみ', () => {
    const pick = (value: unknown) =>
      entriesOf(pickAuditDetail('proposal.submit', { externalCallMade: value }, HOST)).map((entry) => entry.value);
    expect(pick(true)).toEqual([{ kind: 'BOOLEAN', value: true }]);
    expect(pick(false)).toEqual([{ kind: 'BOOLEAN', value: false }]);
    expect(pick(null)).toEqual([{ kind: 'BOOLEAN', value: null }]);
    expect(pick('true')).toEqual([]);
    expect(pick(1)).toEqual([]);
  });

  it('DATE: YYYY-MM / YYYY-MM-DD / ISO 8601 / null のみ', () => {
    const pick = (value: unknown) =>
      entriesOf(pickAuditDetail('engineer_career.update', { periodTo: value }, HOST)).map((entry) => entry.value);
    expect(pick('2026-09')).toEqual([{ kind: 'DATE', value: '2026-09' }]);
    expect(pick('2026-09-17')).toEqual([{ kind: 'DATE', value: '2026-09-17' }]);
    expect(pick('2026-09-17T01:02:03.000Z')).toEqual([{ kind: 'DATE', value: '2026-09-17T01:02:03.000Z' }]);
    expect(pick('2026-09-17T01:02+09:00')).toEqual([{ kind: 'DATE', value: '2026-09-17T01:02+09:00' }]);
    expect(pick(null)).toEqual([{ kind: 'DATE', value: null }]);
    expect(pick('2026-13')).toEqual([]);
    expect(pick('2026/09/17')).toEqual([]);
    expect(pick('1990年1月1日生')).toEqual([]);
    expect(pick('yesterday')).toEqual([]);
    expect(pick(20260917)).toEqual([]);
  });

  it('FIELD_NAMES: `,` 区切りの各語が識別子形（空文字は空配列。本文は落ちる）', () => {
    const pick = (value: unknown) =>
      entriesOf(pickAuditDetail('engineer_career.update', { changedFields: value }, HOST)).map((entry) => entry.value);
    expect(pick('periodFrom,roleTitle')).toEqual([{ kind: 'FIELD_NAMES', value: ['periodFrom', 'roleTitle'] }]);
    expect(pick('')).toEqual([{ kind: 'FIELD_NAMES', value: [] }]);
    expect(pick('period From')).toEqual([]);
    expect(pick('業務内容')).toEqual([]);
    expect(pick('a,,b')).toEqual([]);
    expect(pick(['a', 'b'])).toEqual([]);
    expect(pick(null)).toEqual([]);
  });

  it('REF / REF_LIST: UUID 以外は落ちる（空文字の REF_LIST は空配列）', () => {
    const ref = (value: unknown) =>
      entriesOf(pickAuditDetail('proposal_request.create', { projectId: value }, HOST)).map((entry) => entry.value);
    expect(ref(UUID_A)).toEqual([{ kind: 'REF', entity: 'PROJECT', id: UUID_A }]);
    expect(ref('公開案件 T1')).toEqual([]);
    expect(ref('not-a-uuid')).toEqual([]);
    expect(ref('')).toEqual([]);

    const list = (value: unknown) =>
      entriesOf(pickAuditDetail('project.visibility_change', { before: value }, HOST)).map((entry) => entry.value);
    expect(list(`${UUID_A},${UUID_B}`)).toEqual([{ kind: 'REF_LIST', entity: 'PARTNER_COMPANY', ids: [UUID_A, UUID_B] }]);
    expect(list('')).toEqual([{ kind: 'REF_LIST', entity: 'PARTNER_COMPANY', ids: [] }]);
    expect(list(`${UUID_A},株式会社ダミーチャーリー`)).toEqual([]);
    expect(list(`${UUID_A}, ${UUID_B}`)).toEqual([]);
  });

  it('summary がオブジェクトでなければ 0 キー（文字列 / 配列 / null / undefined）', () => {
    for (const summary of ['{"before":"x"}', [UUID_A], null, undefined, 1]) {
      expect(pickAuditDetail('project.visibility_change', summary, HOST)).toEqual({ kind: 'DETAIL', entries: [] });
    }
  });

  it('許可リストに無いキーは黙って落ちる（注記も残さない）', () => {
    const picked = pickAuditDetail(
      'project.visibility_change',
      {
        before: UUID_A,
        after: '',
        verdict: 'PENDING_GATE',
        reviewGateId: UUID_B,
        piiVerdict: 'PASS',
        endClientName: 'エンド企業',
        unitPrice: 800000,
      },
      HOST,
    );
    expect(entriesOf(picked).map((entry) => entry.key)).toEqual(['before', 'after', 'verdict']);
    expect(JSON.stringify(picked)).not.toContain('reviewGateId');
    expect(JSON.stringify(picked)).not.toContain('エンド企業');
    expect(JSON.stringify(picked)).not.toContain('800000');
  });
});

describe('④ actorScope と台帳系 4 族', () => {
  const LEDGER_SUMMARY = {
    via: 'DETAIL',
    version: 3,
    scanStatus: 'CLEAN',
    operation: 'SET_LATEST',
    periodFrom: '2020-04',
    periodTo: null,
    changedFields: 'periodFrom',
  };
  const LEDGER_ACTIONS = [
    'engineer.view',
    'engineer.create',
    'engineer.update',
    'engineer_career.update',
    'skill_sheet.view',
    'skill_sheet.download',
    'skill_sheet.update',
    'engineer_share.create',
    'engineer_share.update',
  ];

  it('接頭辞は 4 つ', () => {
    expect([...PARTNER_LEDGER_ACTION_PREFIXES]).toEqual(['engineer.', 'engineer_career.', 'skill_sheet.', 'engineer_share.']);
  });

  it.each(LEDGER_ACTIONS)('🔴 %s: PARTNER → SUPPRESSED（1 キーも出ない）', (action) => {
    const picked = pickAuditDetail(action, LEDGER_SUMMARY, PARTNER);
    expect(picked).toEqual({ kind: 'SUPPRESSED', reason: 'PARTNER_LEDGER' });
    expect(JSON.stringify(picked)).not.toMatch(/DETAIL|CLEAN|SET_LATEST|2020-04|periodFrom/);
  });

  it.each(LEDGER_ACTIONS)('%s: UNRESOLVED → entries: []（理由は出さない）', (action) => {
    expect(pickAuditDetail(action, LEDGER_SUMMARY, UNRESOLVED)).toEqual({ kind: 'DETAIL', entries: [] });
  });

  it('HOST のときだけ許可リストが評価される（対照）', () => {
    expect(entriesOf(pickAuditDetail('engineer.view', LEDGER_SUMMARY, HOST)).map((entry) => entry.key)).toEqual([
      'via',
      'version',
      'scanStatus',
    ]);
    expect(entriesOf(pickAuditDetail('engineer_career.update', LEDGER_SUMMARY, HOST)).map((entry) => entry.key)).toEqual([
      'operation',
      'changedFields',
      'periodFrom',
      'periodTo',
    ]);
  });

  it('4 族以外は actorScope に依らず同じ結果', () => {
    const summaries: readonly [string, Record<string, unknown>][] = [
      ['project.visibility_change', { before: UUID_A, after: `${UUID_A},${UUID_B}`, verdict: 'PUBLISHED' }],
      ['membership.role_change', { beforeRole: 'SALES', afterRole: 'ADMIN', targetUserId: UUID_A }],
      ['proposal.submit', { operation: 'SUBMIT', fromState: 'APPROVED', toState: 'SUBMITTING', attemptSeq: 1 }],
      ['proposal_request.update', { operation: 'ACCEPT' }],
      ['project.view', { via: 'CANDIDATES' }],
      ['auth.login', { method: 'credentials' }],
      ['partner_company.update', { operation: 'SUSPEND' }],
    ];
    for (const [action, summary] of summaries) {
      const results = SCOPES.map((actorScope) => pickAuditDetail(action, summary, { actorScope }));
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    }
  });

  it('auth.* / 表に無い action は 0 キー', () => {
    for (const action of ['auth.login', 'auth.login_failed', 'auth.logout', 'esign.sent', 'admin.tenant.view', 'tenant.update', 'sending_domain.state_change']) {
      expect(pickAuditDetail(action, { reason: 'PASSWORD_MISMATCH', method: 'credentials', entity: 'Proposal', from: 'DRAFT', to: 'WON' }, HOST)).toEqual({ kind: 'DETAIL', entries: [] });
    }
  });
});

describe('⑥ T-12-18 ⑨ / ⑩ / ⑫ の追加行', () => {
  it('🔴 ⑨ proposal.update の GATE_RESULT は各層 verdict（閉集合）と件数が出て、aiFailed / contentHash は落ちる', () => {
    const gate = pickAuditDetail(
      'proposal.update',
      {
        operation: 'GATE_RESULT',
        overall: 'FAIL',
        piiVerdict: 'FAIL',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        aiFailed: false,
        findingCount: 2,
        warningCount: 0,
        contentHash: 'abc',
      },
      HOST,
    );
    expect(entriesOf(gate).map((entry) => `${entry.key}=${JSON.stringify(entry.value)}`)).toEqual([
      'operation={"kind":"ENUM","value":"GATE_RESULT"}',
      'overall={"kind":"ENUM","value":"FAIL"}',
      'piiVerdict={"kind":"ENUM","value":"FAIL"}',
      'commerceVerdict={"kind":"ENUM","value":"PASS"}',
      'consistencyVerdict={"kind":"ENUM","value":"PASS"}',
      'findingCount={"kind":"NUMBER","value":2}',
      'warningCount={"kind":"NUMBER","value":0}',
    ]);
    expect(JSON.stringify(gate)).not.toContain('aiFailed');
    expect(JSON.stringify(gate)).not.toContain('contentHash');
    // 閉集合の外（`HELD` / 自由文 / null）は落ちる。
    expect(entriesOf(pickAuditDetail('proposal.update', { overall: 'HELD', piiVerdict: null, commerceVerdict: '合格' }, HOST))).toEqual([]);
  });

  it('⑨ state.invalid_transition は entity（閉集合）と from → to の対。理由・本文に相当するキーは無い', () => {
    const picked = pickAuditDetail(
      'state.invalid_transition',
      { entity: 'Proposal', from: 'DRAFT', to: 'WON', reason: '承認を経ていません', proposalId: UUID_A },
      PARTNER,
    );
    expect(entriesOf(picked)).toEqual([
      { key: 'entity', pair: null, value: { kind: 'ENUM', value: 'Proposal' } },
      { key: 'from', pair: { id: 'state', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'DRAFT' } },
      { key: 'to', pair: { id: 'state', side: 'AFTER' }, value: { kind: 'ENUM', value: 'WON' } },
    ]);
    expect(JSON.stringify(picked)).not.toContain('承認を経て');
    expect(JSON.stringify(picked)).not.toContain(UUID_A);
    // `entity` は閉集合（PascalCase）。集合外・大文字スネークは落ちる。
    expect(entriesOf(pickAuditDetail('state.invalid_transition', { entity: 'PROPOSAL' }, HOST))).toEqual([]);
    expect(entriesOf(pickAuditDetail('state.invalid_transition', { entity: 'Invoice' }, HOST))).toEqual([]);
    for (const entity of STATE_MACHINE_ENTITIES) {
      expect(entriesOf(pickAuditDetail('state.invalid_transition', { entity }, HOST))).toHaveLength(1);
    }
  });

  it('🔴 ⑩ tenant.purge は cause / tables / count_{table}（接頭辞族。昇順）が出て、runId は落ちる', () => {
    const picked = pickAuditDetail(
      'tenant.purge',
      { cause: 'TENANT_PURGED', runId: UUID_A, tables: 3, count_skill_sheets: 4, count_engineers: 12, count_users: 0 },
      UNRESOLVED,
    );
    expect(entriesOf(picked)).toEqual([
      { key: 'cause', pair: null, value: { kind: 'ENUM', value: 'TENANT_PURGED' } },
      { key: 'tables', pair: null, value: { kind: 'NUMBER', value: 3 } },
      { key: 'count_engineers', pair: null, value: { kind: 'NUMBER', value: 12 } },
      { key: 'count_skill_sheets', pair: null, value: { kind: 'NUMBER', value: 4 } },
      { key: 'count_users', pair: null, value: { kind: 'NUMBER', value: 0 } },
    ]);
    expect(JSON.stringify(picked)).not.toContain('runId');
    expect(JSON.stringify(picked)).not.toContain(UUID_A);
  });

  it('⑩ count_ の後ろが表名の形でない・値が非負整数でないキーは落ちる。count_* は tenant.purge 以外に無い', () => {
    const picked = pickAuditDetail(
      'tenant.purge',
      {
        cause: 'RETENTION',
        'count_Engineers!': 1,
        count_: 1,
        'count_engineers.display_name': 1,
        count_engineers: -1,
        count_users: 1.5,
        count_messages: '3',
        count_skill_sheets: Number.NaN,
        count_proposals: 7,
      },
      HOST,
    );
    expect(entriesOf(picked).map((entry) => entry.key)).toEqual(['cause', 'count_proposals']);
    // 接頭辞族の spec を持つ行は `tenant.purge` の 1 行だけ。
    const prefixFamilies = allSpecs().filter(({ key }) => key.endsWith('*'));
    expect(prefixFamilies.map(({ action, key }) => `${action}.${key}`)).toEqual(['tenant.purge.count_*']);
    // 対照: 他の action で `count_*` 風のキーは出ない。
    expect(entriesOf(pickAuditDetail('proposal.submit', { count_engineers: 1, attemptSeq: 1 }, HOST)).map((entry) => entry.key)).toEqual(['attemptSeq']);
  });

  it('⑩ data_export.download は kind（閉集合）だけ。exportRequestId は落ちる', () => {
    const picked = pickAuditDetail('data_export.download', { kind: 'CLOSING_RETURN', exportRequestId: UUID_A }, HOST);
    expect(entriesOf(picked)).toEqual([{ key: 'kind', pair: null, value: { kind: 'ENUM', value: 'CLOSING_RETURN' } }]);
    expect(JSON.stringify(picked)).not.toContain(UUID_A);
    expect(entriesOf(pickAuditDetail('data_export.download', { kind: 'FULL_DUMP' }, HOST))).toEqual([]);
  });

  it('⑪ audit_log.export は rowCount / truncated だけ（検索条件を書いても落ちる）', () => {
    const picked = pickAuditDetail(
      'audit_log.export',
      { rowCount: 120, truncated: false, from: '2026-09-01T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z', action: 'ENGINEER_SKILL_SHEET_ACCESS', actorId: UUID_A },
      HOST,
    );
    expect(entriesOf(picked)).toEqual([
      { key: 'rowCount', pair: null, value: { kind: 'NUMBER', value: 120 } },
      { key: 'truncated', pair: null, value: { kind: 'BOOLEAN', value: false } },
    ]);
    expect(JSON.stringify(picked)).not.toContain('2026-09-01');
    expect(JSON.stringify(picked)).not.toContain(UUID_A);
  });

  it('🔴 ⑫ admin.* は接尾辞族（CRUD_KEYS）の評価対象にならない（対照: partner_company.update は出る）', () => {
    expect([...AUDIT_DETAIL_SUFFIX_FAMILY_EXCLUDED_PREFIXES]).toEqual(['admin.']);
    const crudSummary: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(AUDIT_DETAIL_ALLOWLIST['*.update'] ?? {})) {
      crudSummary[key] =
        spec.kind === 'NUMBER' ? 1 : spec.kind === 'DATE' ? '2026-09-18' : spec.kind === 'FIELD_NAMES' ? 'status' : spec.kind === 'REF' ? UUID_A : 'SUSPEND';
    }
    for (const action of ['admin.tenant.create', 'admin.tenant.update', 'admin.quota.change', 'admin.tenant.delete']) {
      expect(resolveAuditDetailKeySpecs(action), action).toBeNull();
      expect(pickAuditDetail(action, crudSummary, HOST), action).toEqual({ kind: 'DETAIL', entries: [] });
    }
    expect(resolveAuditDetailKeySpecs('partner_company.update')).toBe(AUDIT_DETAIL_ALLOWLIST['*.update']);
    expect(entriesOf(pickAuditDetail('partner_company.update', crudSummary, HOST)).length).toBeGreaterThan(0);
    // exact 一致は除外の前に評価される（将来 `admin.*` の行を表に足せば出る）。現時点で `admin.` の exact 行は無い。
    expect(Object.keys(AUDIT_DETAIL_ALLOWLIST).filter((action) => action.startsWith('admin.'))).toEqual([]);
  });
});

describe('⑤ キーの選び方と決定性', () => {
  it('exact 一致が接尾辞族より優先される（proposal.update は proposal.* の行）', () => {
    expect(resolveAuditDetailKeySpecs('proposal.update')).toBe(AUDIT_DETAIL_ALLOWLIST['proposal.update']);
    expect(resolveAuditDetailKeySpecs('engineer_share.update')).toBe(AUDIT_DETAIL_ALLOWLIST['*.update']);
    expect(resolveAuditDetailKeySpecs('invitation.create')).toBe(AUDIT_DETAIL_ALLOWLIST['*.create']);
    expect(resolveAuditDetailKeySpecs('auth.login')).toBeNull();
    expect(resolveAuditDetailKeySpecs('proposal_event.create')).toBe(AUDIT_DETAIL_ALLOWLIST['*.create']);
    expect([...AUDIT_DETAIL_SUFFIX_FAMILIES]).toEqual(['*.create', '*.update', '*.delete']);
  });

  it('proposal.update の DRAFT_UPDATE の fields は落ちる（GATE_RESULT の verdict は ⑥。T-12-18 ⑨）。proposal.* の他 4 行に verdict は無い', () => {
    const draft = pickAuditDetail('proposal.update', { operation: 'DRAFT_UPDATE', fields: 'body,subject' }, HOST);
    expect(entriesOf(draft).map((entry) => entry.key)).toEqual(['operation']);
    for (const action of ['proposal.submit', 'proposal.resend', 'proposal.approve', 'proposal.reject']) {
      expect(Object.keys(AUDIT_DETAIL_ALLOWLIST[action] ?? {})).not.toContain('overall');
    }
  });

  it('membership.role_change の対（beforeRole / afterRole）と revoke の片側', () => {
    expect(entriesOf(pickAuditDetail('membership.role_change', { beforeRole: 'SALES', afterRole: 'ADMIN', targetUserId: UUID_A, partnerScoped: false }, HOST))).toEqual([
      { key: 'beforeRole', pair: { id: 'role', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'SALES' } },
      { key: 'afterRole', pair: { id: 'role', side: 'AFTER' }, value: { kind: 'ENUM', value: 'ADMIN' } },
    ]);
    expect(entriesOf(pickAuditDetail('membership.revoke', { beforeRole: 'PARTNER_SALES', targetUserId: UUID_A, partnerScoped: true }, HOST))).toEqual([
      { key: 'beforeRole', pair: { id: 'role', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'PARTNER_SALES' } },
    ]);
  });

  it('同じ入力に同じ出力（決定性。順序は許可リストの定義順）', () => {
    const summary = { verdict: 'PENDING_GATE', after: UUID_B, before: UUID_A, requested: `${UUID_A},${UUID_B}`, pending: UUID_B, revoked: '' };
    const first = pickAuditDetail('project.visibility_change', summary, HOST);
    const second = pickAuditDetail('project.visibility_change', { ...summary }, HOST);
    expect(second).toEqual(first);
    expect(entriesOf(first).map((entry) => entry.key)).toEqual(['before', 'after', 'requested', 'pending', 'revoked', 'verdict']);
  });

  it('入力を変異させない', () => {
    const summary = { before: UUID_A, note: 'x' };
    pickAuditDetail('project.visibility_change', summary, HOST);
    expect(summary).toEqual({ before: UUID_A, note: 'x' });
  });
});
