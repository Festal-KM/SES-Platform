// apps/web/lib/admin-usage/schemas.test.ts
// API-A6（`GET /api/admin/usage` / `PUT /api/admin/tenants/{id}/quota`）の境界検証。T-11-02。
import { describe, expect, it } from 'vitest';
import {
  ADMIN_USAGE_FILTERS,
  parseAdminUsageFilter,
  parseAdminUsageQuery,
  parseQuotaChangeBody,
  parseTargetTenantId,
} from './schemas';
import { applyUsageFilter } from './view';

const TENANT = '01930000-0000-7000-8000-0000000000a1';

describe('parseAdminUsageQuery（GET）', () => {
  it('既定は filter=all。targetTenantId は UUID 形状のみ', () => {
    expect(parseAdminUsageQuery({})).toEqual({ ok: true, value: { filter: 'all' } });
    expect(parseAdminUsageQuery({ filter: 'high', targetTenantId: TENANT })).toEqual({
      ok: true,
      value: { filter: 'high', targetTenantId: TENANT },
    });
  });

  it('未知の filter / 不正な targetTenantId は 400（黙って既定に丸めない）', () => {
    expect(parseAdminUsageQuery({ filter: 'HIGH' })).toEqual({ ok: false, issues: ['filter'] });
    expect(parseAdminUsageQuery({ targetTenantId: 'not-a-uuid' })).toEqual({ ok: false, issues: ['targetTenantId'] });
  });

  it('画面用の門番は不正な値を既定に倒す（画面は 400 を返せない）', () => {
    expect(parseAdminUsageFilter(undefined)).toBe('all');
    expect(parseAdminUsageFilter('low')).toBe('low');
    expect(parseAdminUsageFilter('x')).toBe('all');
    expect(parseTargetTenantId('x')).toBeUndefined();
    expect(parseTargetTenantId(TENANT)).toBe(TENANT);
    expect(ADMIN_USAGE_FILTERS).toEqual(['all', 'low', 'high']);
  });

  it('applyUsageFilter: low = LOW の帯だけ / high = HIGH の帯だけ / all = 素通し', () => {
    const items = [{ band: 'LOW' as const, id: 1 }, { band: 'MID' as const, id: 2 }, { band: 'HIGH' as const, id: 3 }];
    expect(applyUsageFilter(items, 'all')).toHaveLength(3);
    expect(applyUsageFilter(items, 'low').map((item) => item.id)).toEqual([1]);
    expect(applyUsageFilter(items, 'high').map((item) => item.id)).toEqual([3]);
  });
});

describe('parseQuotaChangeBody（PUT）', () => {
  const valid = {
    metric: 'AI_UNIT_SHEET_PARSE',
    limit: '300',
    effectiveFrom: '2026-09-17',
    notifyTenantAdmins: true,
    reason: 'プラン変更に伴う暫定の引き上げ',
  };

  it('limit は十進の整数文字列で受け、bigint に上げる（Number の安全整数を超える値も扱える）', () => {
    const parsed = parseQuotaChangeBody({ ...valid, limit: '107374182400000' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.limit).toBe(107374182400000n);
    }
  });

  it('数値（JSON number）も受ける。安全整数を超える数値・負数・小数は 400', () => {
    const ok = parseQuotaChangeBody({ ...valid, limit: 12 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.limit).toBe(12n);
    expect(parseQuotaChangeBody({ ...valid, limit: 1.5 }).ok).toBe(false);
    expect(parseQuotaChangeBody({ ...valid, limit: -1 }).ok).toBe(false);
    expect(parseQuotaChangeBody({ ...valid, limit: Number.MAX_SAFE_INTEGER + 2 }).ok).toBe(false);
    expect(parseQuotaChangeBody({ ...valid, limit: '12a' }).ok).toBe(false);
  });

  it('🔴 金額（AI_COST_USD）と席数は上書きできる計測に無い。メール / ストレージは受ける（値集合は QUOTA_OVERRIDE_METRICS = 6 計測。T-12-12）', () => {
    expect(parseQuotaChangeBody({ ...valid, metric: 'AI_COST_USD' })).toEqual({ ok: false, issues: ['metric'] });
    expect(parseQuotaChangeBody({ ...valid, metric: 'SEAT_COUNT' }).ok).toBe(false);
    expect(parseQuotaChangeBody({ ...valid, metric: 'EMAIL_COUNT' }).ok).toBe(true);
    // ストレージは安全整数を超えるバイト数を十進整数文字列で受けて `bigint` にする。
    const storage = parseQuotaChangeBody({ ...valid, metric: 'STORAGE_BYTES', limit: '10995116277760' });
    expect(storage.ok).toBe(true);
    if (storage.ok) expect(storage.value.limit).toBe(10_995_116_277_760n);
  });

  it('effectiveFrom は YYYY-MM-DD の形。notifyTenantAdmins は boolean 必須。reason は 1〜500 文字', () => {
    expect(parseQuotaChangeBody({ ...valid, effectiveFrom: '2026/09/17' }).ok).toBe(false);
    expect(parseQuotaChangeBody({ ...valid, notifyTenantAdmins: 'yes' }).ok).toBe(false);
    expect(parseQuotaChangeBody({ ...valid, reason: '   ' }).ok).toBe(false);
    expect(parseQuotaChangeBody({ ...valid, reason: 'x'.repeat(501) }).ok).toBe(false);
    const { reason: _reason, ...withoutReason } = valid;
    void _reason;
    expect(parseQuotaChangeBody(withoutReason).ok).toBe(false);
  });

  it('🔴 body に tenantId を持たせても無視される（対象は URL のパス。分離キーを入力から受けない）', () => {
    const parsed = parseQuotaChangeBody({ ...valid, tenantId: TENANT });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.value)).toEqual(['metric', 'limit', 'effectiveFrom', 'notifyTenantAdmins', 'reason']);
  });

  it('body が null / 配列 なら 400', () => {
    expect(parseQuotaChangeBody(null).ok).toBe(false);
    expect(parseQuotaChangeBody([]).ok).toBe(false);
  });
});
