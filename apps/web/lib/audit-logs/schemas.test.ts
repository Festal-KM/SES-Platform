// apps/web/lib/audit-logs/schemas.test.ts
// docs/05 §6.3 #10「期間必須」/ docs/04 §S-041「期間未指定 → 検索を実行させず…」の境界検証を固定する。
import { describe, expect, it } from 'vitest';
import { auditLogQuerySchema, isValidAuditLogPeriod } from './schemas';

const VALID = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-09-03T23:59:59.999Z',
};

describe('auditLogQuerySchema（🔴 期間必須。docs/05 §6.3 #10）', () => {
  it('from / to が揃っていれば通る', () => {
    const result = auditLogQuerySchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it('from が無いと 400 に写像される失敗になる', () => {
    expect(auditLogQuerySchema.safeParse({ to: VALID.to }).success).toBe(false);
  });

  it('to が無いと失敗する', () => {
    expect(auditLogQuerySchema.safeParse({ from: VALID.from }).success).toBe(false);
  });

  it('action は AUDIT_LOG_CATEGORY_KEYS の値だけを受け付ける', () => {
    expect(auditLogQuerySchema.safeParse({ ...VALID, action: 'LOGIN_LOGOUT' }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ ...VALID, action: 'auth.login' }).success).toBe(false);
  });

  it('actorId は UUID 形式のみ受け付ける', () => {
    expect(
      auditLogQuerySchema.safeParse({
        ...VALID,
        actorId: '01930000-0000-7000-8000-0000000000a1',
      }).success,
    ).toBe(true);
    expect(auditLogQuerySchema.safeParse({ ...VALID, actorId: 'not-a-uuid' }).success).toBe(false);
  });

  it('🔴 分離キー（tenantId / partnerCompanyId）を持たない（CLAUDE.md §3.1）', () => {
    expect(Object.keys(auditLogQuerySchema.shape)).not.toContain('tenantId');
    expect(Object.keys(auditLogQuerySchema.shape)).not.toContain('partnerCompanyId');
  });
});

describe('isValidAuditLogPeriod', () => {
  it('from <= to なら true', () => {
    expect(isValidAuditLogPeriod(VALID)).toBe(true);
    expect(isValidAuditLogPeriod({ from: VALID.from, to: VALID.from })).toBe(true);
  });

  it('from > to なら false', () => {
    expect(isValidAuditLogPeriod({ from: VALID.to, to: VALID.from })).toBe(false);
  });
});
