// apps/web/lib/home/service.test.ts
// `getHomeView`（`GET /api/home`。docs/05 §6.3 #9 / `F-006 AC-1`〜`AC-3`）。T-03-06。
//
// 🔴 `getHomeView` は純粋関数（DB を読まない。`apps/web/lib/home/service.ts` 冒頭コメント）
//    なので、DB を経由しない `resolveTenantCtx`（`@ses/db`）で ctx を組み立てられる
//    （`tests/static/auth-db-callers.test.ts` はテストファイルを走査対象から除外している）。
import { describe, expect, it } from 'vitest';
import { resolveTenantCtx, type AuthenticatedTenantCtx, type TenantRole } from '@ses/db';
import { getHomeView } from './service';

async function ctxOf(role: TenantRole, partnerCompanyId: string | null): Promise<AuthenticatedTenantCtx> {
  return resolveTenantCtx(
    {
      tenantId: '00000000-0000-7000-8000-000000000001',
      partnerCompanyId,
      userId: '00000000-0000-7000-8000-000000000002',
      role,
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'desktop' },
  );
}

describe('getHomeView', () => {
  it('ホスト文脈は HostHomeView（audience=HOST）を返し、境界外フィールドを持たない', async () => {
    const view = getHomeView(await ctxOf('SALES', null));

    expect(view.audience).toBe('HOST');
    expect(view.blocks).toEqual([]);
    expect(Object.keys(view).sort()).toEqual(['audience', 'blocks', 'changedSince']);
  });

  it('🔴 F-006 AC-1 / AC-2: パートナー文脈は PartnerHomeView を返し、visibilityNotice を常時持つ', async () => {
    const view = getHomeView(await ctxOf('PARTNER_SALES', '00000000-0000-7000-8000-0000000000aa'));

    expect(view.audience).toBe('PARTNER');
    expect(view.blocks).toEqual([]);
    if (view.audience !== 'PARTNER') throw new Error('unreachable');
    expect(view.visibilityNotice.messageKey).toBe('home.partner.visibilityNotice');
    // 🔴 境界外フィールド（他社の件数・存在を示唆するもの）が無いことを実行時に固定する。
    expect(Object.keys(view).sort()).toEqual(['audience', 'blocks', 'changedSince', 'visibilityNotice']);
  });

  it('🔴 パートナーの判定はリクエスト入力ではなく ctx.partnerCompanyId のみで決まる', async () => {
    const partnerA = getHomeView(await ctxOf('PARTNER_ADMIN', '00000000-0000-7000-8000-0000000000aa'));
    const partnerB = getHomeView(await ctxOf('PARTNER_ADMIN', '00000000-0000-7000-8000-0000000000bb'));

    expect(partnerA.audience).toBe('PARTNER');
    expect(partnerB.audience).toBe('PARTNER');
    // 🔴 F-006 AC-1: 表示される内容（Phase 0 は空配列 + 固定文言）は所属先を問わず同一であり、
    //    他パートナーの件数・存在を一切含まない。
    expect(partnerA).toEqual({ ...partnerB, changedSince: partnerA.changedSince });
  });

  it('VIEWER でもホスト / パートナーの型分岐は同じ（実行系導線がそもそも Phase 0 に無い）', async () => {
    const hostViewer = getHomeView(await ctxOf('VIEWER', null));
    const partnerViewer = getHomeView(
      await ctxOf('VIEWER', '00000000-0000-7000-8000-0000000000aa'),
    );

    expect(hostViewer.audience).toBe('HOST');
    expect(partnerViewer.audience).toBe('PARTNER');
  });

  it('changedSince は ISO 8601 の現在時刻に近い（60 秒ポーリングの基準時刻）', async () => {
    const before = Date.now();
    const view = getHomeView(await ctxOf('OWNER', null));
    const after = Date.now();

    const parsed = Date.parse(view.changedSince);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});
