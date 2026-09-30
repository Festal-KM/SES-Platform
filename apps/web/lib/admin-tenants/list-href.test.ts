// apps/web/lib/admin-tenants/list-href.test.ts
// `A-002` の URL の組み立て（並び替え / 絞り込み / カーソル / 列表示切替）を固定する。SP-22 `T-22-08`。
//
// 🔴 固定するのは 3 つである:
//   ① **既定値は URL に出ない**（同じ見え方に複数の URL が対応しない）
//   ② 🔴 **`?hide=` は許可リストの値だけを通し、その並びに正規化する**（URL 直打ちで壊れない）
//   ③ 🔴 **列を外しても並び・絞り込み・カーソルが落ちない**（読んでいた行を見失わない）
import { describe, expect, it } from 'vitest';
import {
  TENANT_HIDEABLE_COLUMN_IDS,
  parseHiddenTenantColumns,
  tenantColumnToggleHref,
  tenantListHref,
} from './list-href';

const CURSOR = '01930000-0000-7000-8000-0000000000a1';

describe('tenantListHref（A-002 / docs/04 §A-002）', () => {
  it('① 既定値（health / 絞り込み無し / 先頭ページ / 何も隠していない）はクエリを持たない', () => {
    expect(tenantListHref('health', null)).toBe('/admin/tenants');
    expect(tenantListHref('health', null, null, [])).toBe('/admin/tenants');
  });

  it('① 既定以外は決まった並びで載る（sort → signal → cursor → hide）', () => {
    expect(tenantListHref('name', null)).toBe('/admin/tenants?sort=name');
    expect(tenantListHref('health', CURSOR)).toBe(`/admin/tenants?cursor=${CURSOR}`);
    expect(tenantListHref('createdAt', CURSOR, 'NO_PARTNERS', ['projects'])).toBe(
      `/admin/tenants?sort=createdAt&signal=NO_PARTNERS&cursor=${CURSOR}&hide=projects`,
    );
  });

  it('🔴 ② `?hide=` は許可リストの値だけを通す（未知の列・重複・空値は捨てる）', () => {
    expect(parseHiddenTenantColumns('projects')).toEqual(['projects']);
    expect(parseHiddenTenantColumns('projects,projects')).toEqual(['projects']);
    expect(parseHiddenTenantColumns('name')).toEqual([]);
    expect(parseHiddenTenantColumns('health,engineers')).toEqual([]);
    expect(parseHiddenTenantColumns('')).toEqual([]);
    expect(parseHiddenTenantColumns(undefined)).toEqual([]);
    // 🔴 `?hide=a&hide=b` の配列でも受ける（片方を黙って捨てない）。
    expect(parseHiddenTenantColumns(['projects', 'name'])).toEqual(['projects']);
  });

  it('🔴 ③ 切替の URL は並び・絞り込み・カーソルを保つ（列だけが反転する）', () => {
    const base = { sort: 'name', cursor: CURSOR, signal: 'INACTIVE', columnId: 'projects' } as const;
    // 表示中 → 隠す
    expect(tenantColumnToggleHref({ ...base, hidden: [] })).toBe(
      `/admin/tenants?sort=name&signal=INACTIVE&cursor=${CURSOR}&hide=projects`,
    );
    // 隠している → 表示する（`hide` のキーそのものが消える）
    expect(tenantColumnToggleHref({ ...base, hidden: ['projects'] })).toBe(
      `/admin/tenants?sort=name&signal=INACTIVE&cursor=${CURSOR}`,
    );
  });

  it('🔴 `hideable` にする列は 1 列だけである（9 列目 = 案件数。docs/04 §10.3 改訂 21）', () => {
    // 🔴 増やすことは `docs/04` §10.3 / §A-002 の改訂であり、実装側で決めない
    //    （8 列の壁〔`DATA_TABLE_MAX_VISIBLE_COLUMNS`〕を通り抜ける入口になる）。
    expect([...TENANT_HIDEABLE_COLUMN_IDS]).toEqual(['projects']);
  });
});
