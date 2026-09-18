// tests/e2e/admin.mobile.spec.ts
// 🔴 管理平面（`/admin`）の Tier 3 画面のモバイル非破綻（`CLAUDE.md` §13.3「Tier 3 の画面をモバイルで『非表示』にしない。
//    劣化はさせても遮断はしない」）。T-12-17 ⑪（SP-11 T-11-07 申し送り ② = T-11-02 申し送り ⑥）。
//
// 🔴 本ファイルの目的は **`A-004` 利用量・クォータ管理の表が、モバイルビューポート（Pixel 5）でも `hidden` にならず、
//    横スクロールで全列に到達できる**ことを固定することである。`admin-usage-table.tsx` 冒頭「T3 だがモバイルで列を
//    `hidden` にしない」の実装を、デスクトップ側の E2E（`admin-non-disclosure.spec.ts`）とは別の観点で見る。
// 🔴 **禁止値の走査（E2E #15）はここでは繰り返さない**（`docs/05` §17.4 の規律。`admin-non-disclosure.spec.ts` (a) が唯一の
//    実装であり、同じ検査を 2 か所に持たない）。本 spec が見るのは「描画される / 溢れない / 列に到達できる / 外向き 0 件」だけ。
//
// 🔴 「モバイルだから省略する」を作らない: デスクトップと同じ画面・同じ API 経路（API-A6）を Pixel 5 で通す。
//    管理平面の画面が増えたら本ファイルにケースを足す（`settings.mobile.spec.ts` と同じ「乱立させない」方針）。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { expectNoBrokenLabels, expectNoHorizontalOverflow } from './support/assertions';
import { openPlatformSession } from './support/sessions';

test.describe('管理平面のモバイルビューポート（Tier 3。遮断禁止）', () => {
  test('🔴 A-004 利用量・クォータ管理の表がモバイルで hidden にならず、横スクロールで全列に到達できる（T-12-17 ⑪）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(120_000);
    const session = await openPlatformSession(browser);
    try {
      await session.page.goto('/admin/usage', { waitUntil: 'domcontentloaded' });

      // ① 画面が描画される（API-A6 の読み取りを待つ）。
      const table = session.page.getByTestId('admin-usage-table');
      await expect(table).toBeVisible({ timeout: 30_000 });
      await expect(session.page.getByRole('heading', { name: t('admin.usage.title') })).toBeVisible();

      // ② 🔴 表の列を 1 つも隠していない（`hidden` / `sm:table-cell` 系のブレークポイント間引きを `A-004` に使わない）。
      //    列ヘッダの数 = 実装の 10 列。すべてが「表示中」（`display: none` でない）である。
      const headers = table.locator('thead th');
      const headerCount = await headers.count();
      expect(headerCount, 'A-004 の列ヘッダが集まっていない').toBeGreaterThanOrEqual(10);
      for (let index = 0; index < headerCount; index += 1) {
        const header = headers.nth(index);
        const hiddenByClass = await header.evaluate((element) => element.className.split(/\s+/).includes('hidden'));
        expect(hiddenByClass, `A-004 の列 ${index + 1} が hidden クラスで隠されている`).toBe(false);
        const display = await header.evaluate((element) => getComputedStyle(element).display);
        expect(display, `A-004 の列 ${index + 1} が display:none になっている`).not.toBe('none');
      }

      // ③ 🔴 溢れは**表の器の内側**（`overflow-x-auto`）に閉じ込められ、ドキュメントは横に溢れない。
      await expectNoHorizontalOverflow('A-004 利用量・クォータ管理', session.page);

      // ④ 🔴 横スクロールで最後の列に到達できる（器の scrollWidth が clientWidth を超え、末尾までスクロールすると
      //    最後の列ヘッダがビューポート内に入る）。「隠していないが読めない」を作らない。
      const scroller = table.locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]');
      await expect(scroller).toHaveCount(1);
      const widths = await scroller.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
      expect(widths.scroll, 'A-004 の表がモバイル幅に収まっている（劣化の前提が変わった）').toBeGreaterThan(widths.client);
      await scroller.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      const last = headers.nth(headerCount - 1);
      const reachable = await last.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right <= window.innerWidth + 1 && rect.width > 0;
      });
      expect(reachable, 'A-004 の最後の列に横スクロールで到達できない').toBe(true);

      // ⑤ ラベルの折り返し・溢れの検出器（`support/assertions.ts` の 1 実装。無改変）。
      await expectNoBrokenLabels('A-004 利用量・クォータ管理', session.page);

      // ⑥ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
