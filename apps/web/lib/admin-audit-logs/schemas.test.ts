// apps/web/lib/admin-audit-logs/schemas.test.ts
// `parseAdminAuditLogQuery` / `validateAuditLogPeriod`（API-A7 の境界検証。`F-058`）。T-11-03。
//
// 🔴 `apps/web/app/api/admin/audit-logs/route.ts` が呼ぶのと同じ関数を直接検証する:
//   ① `from` / `to` は必須。片方でも欠ければ 400（期間なしの全件検索を API に作らない）
//   ② 期間の上限（引数 `maxDays`）を超えれば `TOO_LONG`、逆転は `INVERTED`
//   ③ 任意フィルタの形（`targetTenantId` は UUID / `action` は `entity.operation` / 列挙値）
//   ④ 分離キー（`tenantId` / `partnerCompanyId`）をスキーマが持たない
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS } from '@ses/config';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  adminAuditLogQuerySchema,
  parseAdminAuditLogQuery,
  validateAuditLogPeriod,
} from './schemas';

const FROM = '2026-09-01T00:00:00.000Z';
const TO = '2026-09-07T23:59:59.999Z';
const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';

describe('① 期間は必須（docs/03 申し送り 9）', () => {
  it('from / to が揃っていれば通り、limit は既定 100', () => {
    const result = parseAdminAuditLogQuery({ from: FROM, to: TO });
    expect(result).toEqual({ ok: true, value: { from: FROM, to: TO, limit: 100 } });
  });

  it.each([
    [{ to: TO }, 'from'],
    [{ from: FROM }, 'to'],
    [{}, 'from'],
  ])('🔴 %o は 400（欠けたフィールド %s が issues に出る）', (raw, missing) => {
    const result = parseAdminAuditLogQuery(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain(missing);
  });

  it('🔴 日付だけ（時刻・オフセット無し）や自由文は 400', () => {
    expect(parseAdminAuditLogQuery({ from: '2026-09-01', to: TO }).ok).toBe(false);
    expect(parseAdminAuditLogQuery({ from: 'yesterday', to: TO }).ok).toBe(false);
  });
});

describe('② 期間の上限と逆転（validateAuditLogPeriod）', () => {
  it('上限ちょうど（31 日）は OK', () => {
    expect(
      validateAuditLogPeriod(
        { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
        AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS,
      ),
    ).toBe('OK');
  });

  it('🔴 上限を 1 ミリ秒でも超えれば TOO_LONG', () => {
    expect(
      validateAuditLogPeriod(
        { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.001Z' },
        AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS,
      ),
    ).toBe('TOO_LONG');
  });

  it('🔴 1 年分は TOO_LONG（全期間相当の検索を通さない）', () => {
    expect(
      validateAuditLogPeriod(
        { from: '2025-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
        AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS,
      ),
    ).toBe('TOO_LONG');
  });

  it('from > to は INVERTED', () => {
    expect(validateAuditLogPeriod({ from: TO, to: FROM }, AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS)).toBe(
      'INVERTED',
    );
  });

  it('from == to は OK（1 時点の検索）', () => {
    expect(validateAuditLogPeriod({ from: FROM, to: FROM }, AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS)).toBe(
      'OK',
    );
  });

  it('上限は引数で決まる（config の値をここで固定しない）', () => {
    expect(
      validateAuditLogPeriod({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' }, 1),
    ).toBe('TOO_LONG');
  });
});

describe('③ 任意フィルタの形', () => {
  it('targetTenantId / action / actorType / deviceKind / cursor が通る', () => {
    const result = parseAdminAuditLogQuery({
      from: FROM,
      to: TO,
      targetTenantId: TENANT_ID,
      action: 'skill_sheet.download',
      actorType: 'USER',
      deviceKind: 'mobile',
      cursor: TENANT_ID,
      limit: '25',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        from: FROM,
        to: TO,
        targetTenantId: TENANT_ID,
        action: 'skill_sheet.download',
        actorType: 'USER',
        deviceKind: 'mobile',
        cursor: TENANT_ID,
        limit: 25,
      },
    });
  });

  it.each([
    [{ targetTenantId: 'not-a-uuid' }, 'targetTenantId'],
    [{ cursor: "1' OR '1'='1" }, 'cursor'],
    [{ action: 'skill sheet download' }, 'action'],
    [{ action: 'noDot' }, 'action'],
    [{ action: '%' }, 'action'],
    [{ actorType: 'ADMIN' }, 'actorType'],
    [{ deviceKind: 'watch' }, 'deviceKind'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '201' }, 'limit'],
  ])('🔴 %o は 400（%s）', (extra, field) => {
    const result = parseAdminAuditLogQuery({ from: FROM, to: TO, ...extra });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain(field);
  });
});

describe('④ 分離キーを持たない（CLAUDE.md §3.1 / BR-03）', () => {
  it('🔴 スキーマの shape に ISOLATION_KEYS のどれも現れない（`tenantId` ではなく `targetTenantId`）', () => {
    const keys = Object.keys(adminAuditLogQuerySchema.shape);
    for (const forbidden of ISOLATION_KEYS) expect(keys).not.toContain(forbidden);
    expect(keys).toContain('targetTenantId');
  });

  it('🔴 `tenantId` を渡しても無視される（RLS の対象を選ぶ入力にならない）', () => {
    const result = parseAdminAuditLogQuery({ from: FROM, to: TO, tenantId: TENANT_ID });
    expect(result.ok).toBe(true);
    if (result.ok) expect('tenantId' in result.value).toBe(false);
  });
});
