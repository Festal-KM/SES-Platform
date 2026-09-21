// packages/domain/src/gate/project-publish.test.ts
// 🔴 T-12-10（docs/05 §11.11「T-12-10 の実装の決着」⑨⑫ / `F-014 AC-6`〜`AC-13` / A-26）のユニット。
//
// 固定するのは 4 つ:
//   ① **3 欄の定義が 3 か所で 1 対 1 である**（⑨。ずれると「プレビューに出ないのに FAIL する」
//      「FAIL したのに原因の欄が出ない」が起きる）
//   ② `projectPublicFieldsChanged`（`AC-6` の契機。**ハッシュではなく値の比較**）
//   ③ `projectPublicFieldsFromFindings`（原因の欄。`BLOCK` × `PII|COMMERCE` のみ）
//   ④ `deriveProjectPublishState`（4 値の表。**自動解除と保留を取り違えない**）
import { describe, expect, it } from 'vitest';
import {
  deriveProjectPublishState,
  PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD,
  PROJECT_PUBLIC_FIELDS,
  PROJECT_PUBLISH_LIST_STATUSES,
  PROJECT_PUBLISH_REQUEST_KINDS,
  PROJECT_PUBLISH_RUN_TRIGGERS,
  PROJECT_VISIBILITY_REVOKE_REASONS,
  projectPublicFieldsChanged,
  projectPublicFieldsFromFindings,
  projectPublishListStatus,
  type DeriveProjectPublishStateInput,
  type ProjectPublicFieldValues,
} from './project-publish.js';
import { GATE_FINDING_FIELDS, type GateFinding } from './types.js';
import type { GateHeldView } from './view.js';

/**
 * 🔴 ⑨ の 3 か所目（`apps/web/lib/projects/publish-preview.ts` の `PUBLISHED_FIELDS`）。
 *    `packages/domain` は `apps/web` を import できない（`CLAUDE.md` §2.1）ので**値を写す**が、
 *    写しが古くなったら落ちるように、この配列自体も下のテストが `GATE_FINDING_FIELDS` と突き合わせる。
 *    （`apps/web` 側の 1 対 1 は `apps/web/lib/projects/publish-gate.test.ts` が固定している。）
 */
const PUBLISHED_FIELDS_MIRROR = ['name', 'publicSummary', 'requirement'] as const;

function values(overrides: Partial<ProjectPublicFieldValues> = {}): ProjectPublicFieldValues {
  return {
    name: '基幹システム刷新',
    publicSummary: '公開用の記載です。',
    requirementFreeTexts: ['金融系の経験', 'チームリード経験'],
    ...overrides,
  };
}

function finding(overrides: Partial<GateFinding> = {}): GateFinding {
  return {
    layer: 'COMMERCE',
    kind: 'END_CLIENT',
    field: 'public_summary',
    offsetStart: 0,
    offsetEnd: 3,
    excerpt: '[企業名]',
    severity: 'BLOCK',
    ...overrides,
  };
}

const HELD: GateHeldView = {
  heldReasonKey: 'gate.held.aiCostLimit',
  heldSince: '2026-09-21T01:00:00.000Z',
  resetAt: '2026-09-21T15:00:00.000Z',
  limitRaise: 'PLATFORM_OPERATOR',
  rerun: { auto: true, manual: null },
};

function stateInput(
  overrides: Partial<DeriveProjectPublishStateInput> = {},
): DeriveProjectPublishStateInput {
  return {
    liveVisibilityCount: 0,
    lastRevoked: null,
    recheckPending: false,
    latestGate: null,
    latestGateHeld: null,
    revokingGate: null,
    ...overrides,
  };
}

describe('🔴 ⑨ 3 欄の定義が 3 か所で 1 対 1（docs/05 §11.11「T-12-10 の実装の決着」⑨）', () => {
  it('要素数が 3 つとも同じで、写像が全単射である', () => {
    const gateFields = Object.keys(PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD);
    expect(gateFields).toHaveLength(PROJECT_PUBLIC_FIELDS.length);
    expect(PUBLISHED_FIELDS_MIRROR).toHaveLength(PROJECT_PUBLIC_FIELDS.length);
    // 写像の値の集合 = `PROJECT_PUBLIC_FIELDS`（重複も欠けも無い）。
    expect([...Object.values(PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD)].sort()).toEqual(
      [...PROJECT_PUBLIC_FIELDS].sort(),
    );
  });

  it('🔴 写像の定義域はゲートが検査する欄の 3 つである（`GATE_FINDING_FIELDS` の部分集合）', () => {
    for (const gateField of Object.keys(PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD)) {
      expect(GATE_FINDING_FIELDS).toContain(gateField);
    }
    expect(Object.keys(PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD).sort()).toEqual([
      'project_name',
      'public_summary',
      'requirement',
    ]);
  });

  it('🔴 語の違い（`requirement` ↔ `requirementFreeText`）を「同じもの」として固定する', () => {
    expect(PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD.project_name).toBe('name');
    expect(PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD.public_summary).toBe('publicSummary');
    expect(PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD.requirement).toBe('requirementFreeText');
    // 🔴 `PUBLISHED_FIELDS`（プレビュー）とも 1 対 1（並びは宣言順で一致する）。
    expect(PUBLISHED_FIELDS_MIRROR.map((field) => (field === 'requirement' ? 'requirementFreeText' : field))).toEqual([
      ...PROJECT_PUBLIC_FIELDS,
    ]);
  });

  it('値集合が閉じている（`kind` / `run_trigger` / `revoked_reason`）', () => {
    expect([...PROJECT_PUBLISH_REQUEST_KINDS]).toEqual(['PUBLISH', 'RECHECK']);
    expect([...PROJECT_PUBLISH_RUN_TRIGGERS]).toEqual(['PUBLISH', 'RECHECK']);
    expect([...PROJECT_VISIBILITY_REVOKE_REASONS]).toEqual(['MANUAL', 'GATE_RECHECK']);
    expect([...PROJECT_PUBLISH_LIST_STATUSES]).toEqual(['UNSET', 'PUBLISHED', 'AUTO_REVOKED']);
  });
});

describe('🔴 projectPublicFieldsChanged（`AC-6` の契機。① の値の比較）', () => {
  it('同じ値なら変わっていない（同一値での再保存では再検査が走らない）', () => {
    expect(projectPublicFieldsChanged(values(), values())).toBe(false);
  });

  it('3 欄それぞれの変更を検出する', () => {
    expect(projectPublicFieldsChanged(values(), values({ name: '別の案件名' }))).toBe(true);
    expect(projectPublicFieldsChanged(values(), values({ publicSummary: '別の記載' }))).toBe(true);
    expect(
      projectPublicFieldsChanged(values(), values({ requirementFreeTexts: ['金融系の経験'] })),
    ).toBe(true);
  });

  it('🔴 要件の並べ替えも変更として扱う（並びは `kind` → `id` で確定しており、順序に意味がある）', () => {
    expect(
      projectPublicFieldsChanged(
        values({ requirementFreeTexts: ['A', 'B'] }),
        values({ requirementFreeTexts: ['B', 'A'] }),
      ),
    ).toBe(true);
  });

  it('🔴 `null`（未入力）と `""`（空文字）を区別する', () => {
    expect(
      projectPublicFieldsChanged(values({ publicSummary: null }), values({ publicSummary: '' })),
    ).toBe(true);
    expect(
      projectPublicFieldsChanged(values({ publicSummary: null }), values({ publicSummary: null })),
    ).toBe(false);
  });

  it('🔴 trim / 正規化をしない（空白の増減も変更である。ハッシュ側と揃える）', () => {
    expect(projectPublicFieldsChanged(values({ name: 'A' }), values({ name: 'A ' }))).toBe(true);
  });

  it('要件の件数が増減したら変更である', () => {
    expect(
      projectPublicFieldsChanged(
        values({ requirementFreeTexts: [] }),
        values({ requirementFreeTexts: ['A'] }),
      ),
    ).toBe(true);
  });
});

describe('🔴 projectPublicFieldsFromFindings（原因の欄。`docs/04` 申し送り 21 ②）', () => {
  it('`BLOCK` × PII / 商流の指摘だけを拾う', () => {
    expect(projectPublicFieldsFromFindings([finding()])).toEqual(['publicSummary']);
    expect(
      projectPublicFieldsFromFindings([finding({ layer: 'PII', kind: 'FULL_NAME', field: 'project_name' })]),
    ).toEqual(['name']);
  });

  it('🔴 `WARN` を拾わない（警告は合否を作らない。`BR-61`）', () => {
    expect(projectPublicFieldsFromFindings([finding({ severity: 'WARN' })])).toEqual([]);
  });

  it('🔴 整合層の指摘を拾わない（原因の欄は PII / 商流だけ）', () => {
    expect(
      projectPublicFieldsFromFindings([
        finding({ layer: 'CONSISTENCY', kind: 'MUST_REQUIREMENT_MISMATCH' }),
      ]),
    ).toEqual([]);
  });

  it('🔴 3 欄に写せない `field` を無視する（提案側の欄が混ざっても落ちない）', () => {
    expect(projectPublicFieldsFromFindings([finding({ field: 'body' })])).toEqual([]);
    expect(projectPublicFieldsFromFindings([finding({ field: 'snapshot' })])).toEqual([]);
  });

  it('🔴 宣言順で重複なく返す（同じ欄に 2 件の指摘があっても 1 回）', () => {
    const fields = projectPublicFieldsFromFindings([
      finding({ field: 'requirement', kind: 'UNIT_PRICE' }),
      finding({ field: 'public_summary' }),
      finding({ field: 'public_summary', kind: 'OTHER_COMPANY' }),
      finding({ field: 'project_name' }),
    ]);
    expect(fields).toEqual(['name', 'publicSummary', 'requirementFreeText']);
  });
});

describe('🔴 projectPublishListStatus / deriveProjectPublishState（4 値の表。⑤⑥）', () => {
  it('一覧の 3 値: 生存 ≥ 1 → PUBLISHED / 0 かつ GATE_RECHECK → AUTO_REVOKED / それ以外 → UNSET', () => {
    expect(projectPublishListStatus({ liveVisibilityCount: 2, lastRevokedReason: 'GATE_RECHECK' })).toBe('PUBLISHED');
    expect(projectPublishListStatus({ liveVisibilityCount: 0, lastRevokedReason: 'GATE_RECHECK' })).toBe('AUTO_REVOKED');
    expect(projectPublishListStatus({ liveVisibilityCount: 0, lastRevokedReason: 'MANUAL' })).toBe('UNSET');
    expect(projectPublishListStatus({ liveVisibilityCount: 0, lastRevokedReason: null })).toBe('UNSET');
  });

  it('一度も公開していない → `UNPUBLISHED`', () => {
    const view = deriveProjectPublishState(stateInput());
    expect(view.state).toBe('UNPUBLISHED');
    expect(view.visibleToCount).toBe(0);
    expect(view.revocation).toBeUndefined();
    expect(view.held).toBeUndefined();
  });

  it('🔴 人が解除した 0 社は `UNPUBLISHED`（自動解除と混ぜない）', () => {
    const view = deriveProjectPublishState(
      stateInput({
        lastRevoked: { reason: 'MANUAL', revokedAt: '2026-09-20T00:00:00.000Z', reviewGateId: null, partnerCount: 0 },
      }),
    );
    expect(view.state).toBe('UNPUBLISHED');
  });

  it('公開中（再検査なし）→ `PUBLISHED` / `recheckRunning=false`', () => {
    const view = deriveProjectPublishState(stateInput({ liveVisibilityCount: 3 }));
    expect(view).toMatchObject({ state: 'PUBLISHED', visibleToCount: 3, recheckRunning: false });
  });

  it('🔴 公開中 + 未消費の再検査要求（保留行なし）→ `PUBLISHED` / `recheckRunning=true`（公開は維持）', () => {
    const view = deriveProjectPublishState(
      stateInput({
        liveVisibilityCount: 1,
        recheckPending: true,
        latestGate: {
          reviewGateId: 'g1',
          runTrigger: 'PUBLISH',
          execution: 'DONE',
          executedAt: '2026-09-20T00:00:00.000Z',
          heldSince: null,
        },
      }),
    );
    expect(view).toMatchObject({ state: 'PUBLISHED', recheckRunning: true });
    expect(view.held).toBeUndefined();
  });

  it('🔴 上限到達（保留）→ `PUBLISHED_RECHECK_HELD`（公開は落ちない。`AC-12`）', () => {
    const view = deriveProjectPublishState(
      stateInput({
        liveVisibilityCount: 2,
        recheckPending: true,
        latestGate: {
          reviewGateId: 'g2',
          runTrigger: 'RECHECK',
          execution: 'HELD_AI_COST_LIMIT',
          executedAt: null,
          heldSince: '2026-09-21T01:00:00.000Z',
        },
        latestGateHeld: HELD,
      }),
    );
    expect(view).toMatchObject({ state: 'PUBLISHED_RECHECK_HELD', visibleToCount: 2, held: HELD });
    expect(view.revocation).toBeUndefined();
    // 🔴 `usageHref` を足していない（`docs/04` `U-19`）。
    expect(Object.keys(HELD)).not.toContain('usageHref');
  });

  it('🔴 保留の判定に契機（`runTrigger`）を使わない（`PUBLISH` の保留でも同じ表示）', () => {
    const view = deriveProjectPublishState(
      stateInput({
        liveVisibilityCount: 1,
        recheckPending: true,
        latestGate: {
          reviewGateId: 'g3',
          runTrigger: 'PUBLISH',
          execution: 'HELD_AI_COST_LIMIT',
          executedAt: null,
          heldSince: '2026-09-21T01:00:00.000Z',
        },
        latestGateHeld: HELD,
      }),
    );
    expect(view.state).toBe('PUBLISHED_RECHECK_HELD');
  });

  it('🔴 保留の枝で `GateHeldView` が無ければ落ちる（保留なのに理由が描けない状態を通さない）', () => {
    expect(() =>
      deriveProjectPublishState(
        stateInput({
          liveVisibilityCount: 1,
          recheckPending: true,
          latestGate: {
            reviewGateId: 'g4',
            runTrigger: 'RECHECK',
            execution: 'HELD_AI_COST_LIMIT',
            executedAt: null,
            heldSince: '2026-09-21T01:00:00.000Z',
          },
          latestGateHeld: null,
        }),
      ),
    ).toThrow(RangeError);
  });

  it('🔴 再検査 FAIL で 0 社 → `AUTO_REVOKED` + 原因の欄（`GATE_FINDINGS`）', () => {
    const view = deriveProjectPublishState(
      stateInput({
        lastRevoked: {
          reason: 'GATE_RECHECK',
          revokedAt: '2026-09-21T02:00:00.000Z',
          reviewGateId: 'g5',
          partnerCount: 2,
        },
        revokingGate: { findings: [finding()], aiFailed: false },
      }),
    );
    expect(view).toMatchObject({
      state: 'AUTO_REVOKED',
      visibleToCount: 0,
      revocation: {
        revokedAt: '2026-09-21T02:00:00.000Z',
        revokedPartnerCount: 2,
        reviewGateId: 'g5',
        cause: { kind: 'GATE_FINDINGS', fields: ['publicSummary'] },
      },
    });
    expect(view.held).toBeUndefined();
    // 🔴 指摘の本文（`excerpt`）を載せない。
    expect(JSON.stringify(view)).not.toContain('[企業名]');
  });

  it('🔴 A-26 ①: 判定不能（`aiFailed`）は保留ではなく FAIL であり、原因の欄を出さない', () => {
    const view = deriveProjectPublishState(
      stateInput({
        lastRevoked: {
          reason: 'GATE_RECHECK',
          revokedAt: '2026-09-21T02:00:00.000Z',
          reviewGateId: 'g6',
          partnerCount: 1,
        },
        // 🔴 機械的検出が欄を特定できていても `GATE_INCONCLUSIVE` に倒す（`aiFailed` 優先）。
        revokingGate: { findings: [finding()], aiFailed: true },
      }),
    );
    expect(view.state).toBe('AUTO_REVOKED');
    expect(view.revocation?.cause).toEqual({ kind: 'GATE_INCONCLUSIVE' });
    expect(view.revocation?.cause.fields).toBeUndefined();
  });

  it('欄に帰せない FAIL（指摘 0 件）も `GATE_INCONCLUSIVE`', () => {
    const view = deriveProjectPublishState(
      stateInput({
        lastRevoked: {
          reason: 'GATE_RECHECK',
          revokedAt: '2026-09-21T02:00:00.000Z',
          reviewGateId: 'g7',
          partnerCount: 1,
        },
        revokingGate: { findings: [], aiFailed: false },
      }),
    );
    expect(view.revocation?.cause).toEqual({ kind: 'GATE_INCONCLUSIVE' });
  });

  it('🔴 `AUTO_REVOKED` の判定に `latestGate` を使わない（自動解除の後に公開し直して FAIL しても解除のまま）', () => {
    const view = deriveProjectPublishState(
      stateInput({
        lastRevoked: {
          reason: 'GATE_RECHECK',
          revokedAt: '2026-09-21T02:00:00.000Z',
          reviewGateId: 'g8',
          partnerCount: 1,
        },
        revokingGate: { findings: [finding({ field: 'project_name' })], aiFailed: false },
        latestGate: {
          reviewGateId: 'g9',
          runTrigger: 'PUBLISH',
          execution: 'DONE',
          executedAt: '2026-09-21T03:00:00.000Z',
          heldSince: null,
        },
      }),
    );
    expect(view.state).toBe('AUTO_REVOKED');
    expect(view.revocation?.reviewGateId).toBe('g8');
    expect(view.latestGate?.reviewGateId).toBe('g9');
  });

  it('🔴 `GATE_RECHECK` なのに `revoked_review_gate_id` が無ければ落ちる（導線の無い帯を描かない）', () => {
    expect(() =>
      deriveProjectPublishState(
        stateInput({
          lastRevoked: {
            reason: 'GATE_RECHECK',
            revokedAt: '2026-09-21T02:00:00.000Z',
            reviewGateId: null,
            partnerCount: 1,
          },
        }),
      ),
    ).toThrow(RangeError);
  });
});
