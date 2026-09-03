// apps/web/lib/audit-logs/categories.test.ts
// docs/04 §S-041 の「操作種別」カテゴリと docs/05 §16.1 の action 一致条件を固定する。
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_CATEGORY_KEYS, auditLogCategoryWhere } from './categories';

describe('AUDIT_LOG_CATEGORY_KEYS（docs/04 §S-041「BR-27 の記録対象を過不足なく網羅する」）', () => {
  it('9 カテゴリが重複なく定義されている', () => {
    expect(AUDIT_LOG_CATEGORY_KEYS.length).toBe(9);
    expect(new Set(AUDIT_LOG_CATEGORY_KEYS).size).toBe(AUDIT_LOG_CATEGORY_KEYS.length);
  });
});

describe('auditLogCategoryWhere', () => {
  it('LOGIN_LOGOUT は auth.login / auth.logout / auth.login_failed の完全一致', () => {
    expect(auditLogCategoryWhere('LOGIN_LOGOUT')).toEqual({
      action: { in: ['auth.login', 'auth.logout', 'auth.login_failed'] },
    });
  });

  it('🔴 CREATE_UPDATE_DELETE はサフィックス一致（エンティティ名を列挙しない）', () => {
    expect(auditLogCategoryWhere('CREATE_UPDATE_DELETE')).toEqual({
      OR: [
        { action: { endsWith: '.create' } },
        { action: { endsWith: '.update' } },
        { action: { endsWith: '.delete' } },
      ],
    });
  });

  it.each(AUDIT_LOG_CATEGORY_KEYS)('%s は空でない一致条件を返す（空振り防止）', (key) => {
    const where = auditLogCategoryWhere(key);
    if ('OR' in where) {
      expect(where.OR.length).toBeGreaterThan(0);
    } else {
      expect(where.action.in.length).toBeGreaterThan(0);
    }
  });
});
