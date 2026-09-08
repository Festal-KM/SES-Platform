// packages/domain/src/ai/roles.test.ts
// 値集合そのものの整合（migration.sql との突合は tests/static/schema-enum-drift.test.ts が行う）。
import { describe, expect, it } from 'vitest';
import {
  AI_ROLES,
  AI_USAGE_FAILURE_KINDS,
  AI_USAGE_PURPOSES,
  APPROVAL_MODE_CONFIGURABLE_ROLES,
  isAiRole,
  ROLE_PURPOSE,
} from './roles.js';

describe('AI ロールの値集合（docs/05 §7.1 / §3.8）', () => {
  it('6 ロールが揃っている（CLAUDE.md §12.2）', () => {
    expect([...AI_ROLES]).toEqual([
      'sheet-parser',
      'skill-normalizer',
      'match-explainer',
      'gate-inspector',
      'proposal-drafter',
      'renewal-advisor',
    ]);
  });

  it('🔴 承認モードを設定できるロールに gate-inspector が含まれない（CLAUDE.md §12.4）', () => {
    expect(APPROVAL_MODE_CONFIGURABLE_ROLES).not.toContain('gate-inspector');
    expect(APPROVAL_MODE_CONFIGURABLE_ROLES).toHaveLength(AI_ROLES.length - 1);
  });

  it('🔴 ROLE_PURPOSE が 6 ロールを漏れなく覆い、値が AI_USAGE_PURPOSES に含まれる', () => {
    // 欠けると AiUsage.purpose が CHECK に落ちる = 記録できない呼び出しが生まれる（F-026 AC-2）。
    expect(Object.keys(ROLE_PURPOSE).sort()).toEqual([...AI_ROLES].sort());
    for (const role of AI_ROLES) {
      expect(AI_USAGE_PURPOSES).toContain(ROLE_PURPOSE[role]);
    }
  });

  it('🔴 ROLE_PURPOSE がロールと 1:1（用途の重複が無い）', () => {
    const purposes = AI_ROLES.map((role) => ROLE_PURPOSE[role]);
    expect(new Set(purposes).size).toBe(AI_ROLES.length);
  });

  it('失敗種別が 5 値（SCHEMA / TIMEOUT / RATE / SPEND_CAP / API）', () => {
    expect([...AI_USAGE_FAILURE_KINDS]).toEqual(['SCHEMA', 'TIMEOUT', 'RATE', 'SPEND_CAP', 'API']);
  });

  it('isAiRole が未知の値を弾く', () => {
    expect(isAiRole('gate-inspector')).toBe(true);
    expect(isAiRole('gate_inspector')).toBe(false);
    expect(isAiRole('')).toBe(false);
  });
});
