// tests/e2e/home.mobile.spec.ts
// モバイルビューポートのスモーク（`CLAUDE.md` §13.3 / docs/03 §4.17 /
// docs/sprints/SP-03-auth-audit-admin0.md §5 テスト計画の E2E 行）。
//
// 🔴 本ファイルの目的は**基盤の確立**である。`CLAUDE.md` §13.3 が本番で要求している
//    「モバイルでの承認フロー」（`F-021` / docs/05 §17.3 #13）は Phase 1 の実装が要るため、
//    Phase 0 では `S-003` / `S-004` が T1（モバイル完結）として破綻しないことだけを見る。
//    **Phase 1 で承認画面ができたら、このプロジェクト（`mobile-chromium`）にシナリオを足す。**
//
// 🔴 「モバイルだから省略する」を作らない（`CLAUDE.md` §13.3）。サインイン（2 要素認証を含む）が
//    モバイルで完結することを、デスクトップと同じ経路で確かめる。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
// 🔴 T-06-09: 横溢れの判定は `support/assertions.ts` に集約した（同じ判定が spec ごとに
//    散ると、1 箇所だけ閾値が緩められたことに気づけない）。
import { expectNoHorizontalOverflow } from './support/assertions';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';

test.describe('モバイルビューポートのスモーク（S-003 / S-004 は T1）', () => {
  test('ホストのホームがモバイルで描画され、横に溢れない', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 2 要素認証もモバイルで完結する（`OWNER` は 2FA 必須。`BR-30`）。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByRole('heading', { name: t('home.title') })).toBeVisible();
      await expect(session.page.getByText(t('home.host.empty.title')).first()).toBeVisible();
      await expectNoHorizontalOverflow('S-003 ホストのホーム', session.page);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('取引先のホームがモバイルで描画され、説明文が省略されない（F-006 AC-2）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      await session.page.goto('/', { waitUntil: 'domcontentloaded' });
      // 🔴 「自社に見えない情報が存在すること」の説明文は**モバイルでも常時表示**。
      await expect(session.page.getByText(t('home.partner.visibilityNotice')).first()).toBeVisible();
      await expectNoHorizontalOverflow('S-004 取引先のホーム', session.page);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
