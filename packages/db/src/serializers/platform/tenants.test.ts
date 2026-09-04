// packages/db/src/serializers/platform/tenants.test.ts
// `toPlatformTenantListItem` / `toPlatformTenantDetail`（docs/05 §5.5 第 2 層 / `F-056 AC-1`）。
// T-03-09。
//
// 🔴 `Object.keys` 照合で境界外フィールドが無いことを実行時に固定する
//    （`apps/web/lib/home/service.test.ts` の先例に倣う。CLAUDE.md §8「テストの同梱」）。
import { describe, expect, it } from 'vitest';
import {
  toPlatformTenantDetail,
  toPlatformTenantListItem,
  type PlatformTenantDetailRow,
  type PlatformTenantListRow,
} from './tenants.js';

const LIST_ROW: PlatformTenantListRow = {
  id: '01930000-0000-7000-8000-000000000a01',
  name: 'Tenant A',
  environment: 'production',
  lifecycleState: 'ACTIVE',
  lifecycleChangedAt: new Date('2026-09-01T00:00:00.000Z'),
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  lastActivityAt: new Date('2026-09-03T00:00:00.000Z'),
  seatCount: 3,
  partnerCompanyCount: 2,
  engineerCount: 4,
  projectCount: 2,
};

const DETAIL_ROW: PlatformTenantDetailRow = {
  ...LIST_ROW,
  sandboxExpiresAt: null,
  closingEnteredAt: null,
  proposalCount: 4,
  recentActivityCount30d: 12,
};

describe('toPlatformTenantListItem（A-002 / F-056 AC-1）', () => {
  it('🔴 件数・状態・日時のみを返す（境界外フィールドを持たない）', () => {
    const view = toPlatformTenantListItem(LIST_ROW);

    expect(Object.keys(view).sort()).toEqual(
      [
        'createdAt',
        'engineerCount',
        'environment',
        'id',
        'lastActivityAt',
        'lifecycleChangedAt',
        'lifecycleState',
        'name',
        'partnerCompanyCount',
        'projectCount',
        'seatCount',
      ].sort(),
    );
    expect(view.lifecycleChangedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(view.lastActivityAt).toBe('2026-09-03T00:00:00.000Z');
  });

  it('lastActivityAt が無ければ null を返す（ログイン記録が無いテナント）', () => {
    const view = toPlatformTenantListItem({ ...LIST_ROW, lastActivityAt: null });
    expect(view.lastActivityAt).toBeNull();
  });
});

describe('toPlatformTenantDetail（A-003 / F-056 AC-1）', () => {
  it('🔴 通常状態は件数・状態・日時のみを返す（境界外フィールドを持たない）', () => {
    const view = toPlatformTenantDetail(DETAIL_ROW);

    expect(Object.keys(view).sort()).toEqual(
      [
        'closingEnteredAt',
        'createdAt',
        'engineerCount',
        'environment',
        'id',
        'lastActivityAt',
        'lifecycleChangedAt',
        'lifecycleState',
        'name',
        'partnerCompanyCount',
        'projectCount',
        'proposalCount',
        'recentActivityCount30d',
        'sandboxExpiresAt',
        'seatCount',
      ].sort(),
    );
  });

  it('🔴 PURGED はライフサイクル状態のみを返し、削除件数を含めない（F-062 AC-7 / 申し送り 15）', () => {
    const purgedRow: PlatformTenantDetailRow = {
      ...DETAIL_ROW,
      lifecycleState: 'PURGED',
      seatCount: 999, // 🔴 呼び出し側が誤って件数を積んでも、シリアライザは出力しない。
      proposalCount: 999,
    };
    const view = toPlatformTenantDetail(purgedRow);

    expect(Object.keys(view).sort()).toEqual(
      ['id', 'name', 'lifecycleChangedAt', 'lifecycleState'].sort(),
    );
    expect(view).toEqual({
      id: purgedRow.id,
      name: purgedRow.name,
      lifecycleState: 'PURGED',
      lifecycleChangedAt: purgedRow.lifecycleChangedAt.toISOString(),
    });
    // 🔴 件数フィールドが応答の JSON 文字列にも一切現れない（走査による二重確認）。
    expect(JSON.stringify(view)).not.toMatch(/seatCount|proposalCount|engineerCount|projectCount/);
  });

  it('sandboxExpiresAt / closingEnteredAt は null 許容で ISO 文字列に変換される', () => {
    const view = toPlatformTenantDetail({
      ...DETAIL_ROW,
      lifecycleState: 'SANDBOX',
      sandboxExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
      closingEnteredAt: null,
    });
    if (view.lifecycleState === 'PURGED') throw new Error('unreachable');
    expect(view.sandboxExpiresAt).toBe('2026-10-01T00:00:00.000Z');
    expect(view.closingEnteredAt).toBeNull();
  });
});
