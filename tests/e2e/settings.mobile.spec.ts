// tests/e2e/settings.mobile.spec.ts
// モバイルビューポートでの設定系画面のスモーク（`CLAUDE.md` §13.3 / SP-04 完了確認 NG の是正）。
//
// 🔴 本ファイルの目的は **T-04-06（`S-036` 送信ドメイン）/ T-04-07（`S-014` 取引先企業）の
//    完了判定「モバイルで破綻しない」を固定する恒久テスト**である。両画面は
//    `docs/04` の 3 階層で **Tier 3（デスクトップ主体）**に分類されるが、`CLAUDE.md` §13.3 は
//    「Tier 3 の画面をモバイルで『非表示』にしない。劣化はさせても遮断はしない」を要求する。
//    `playwright.config.ts` の `mobile-chromium` プロジェクトは元々
//    `tests/e2e/home.mobile.spec.ts`（`S-003` / `S-004`）しか実行しておらず、
//    Tier 3 側の非破綻を固定するテストが 1 本も無かった（pm の SP-04 完了確認 NG）。
//
// 🔴 「モバイルだから省略する」を作らない。デスクトップと同じ画面・同じ API 経路をモバイル
//    ビューポートで通し、①画面が描画される ②横スクロールが出ない ③状態表示が可視 ④外向き
//    発信が 0 件であることを確かめる（`home.mobile.spec.ts` と同じ観点・同じ構成）。
//
// 🔴 Phase 1 で設定系画面（`S-021` / `S-024` / `S-026` など）が増えたら、本ファイルに
//    ケースを足す（新規ファイルを乱立させず、設定系のモバイル非破綻はここに集約する）。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { hostOwner, openTenantSession } from './support/sessions';

/** 横スクロールが出ていないこと（狭い画面での破綻の代表的な症状）。 */
async function assertNoHorizontalOverflow(session: {
  page: import('@playwright/test').Page;
}): Promise<void> {
  const overflow = await session.page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, '横スクロールが発生しています（モバイルで破綻している）').toBeLessThanOrEqual(1);
}

test.describe('モバイルビューポートのスモーク（S-036 / S-014 は Tier 3・遮断禁止）', () => {
  test('S-036 送信ドメインの設定と検証がモバイルで描画され、横に溢れない（T-04-06）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 到達は `OWNER` / `ADMIN`（docs/04 §S-036「権限差分」）。`hostOwner` は登録も可能な立場。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto('/settings/sending-domains', { waitUntil: 'domcontentloaded' });

      // ① 画面が描画される。
      await expect(session.page.getByTestId('sending-domain-screen')).toBeVisible();
      await expect(
        session.page.getByRole('heading', { name: t('settings.sendingDomain.title') }),
      ).toBeVisible();

      // ③ 主要素（状態表示。`送信元ドメイン: ...` の「事実」表示）が可視。
      //    E2E は `APP_ENV=development` で起動するため独自ドメインの検証は不要
      //    （`fact.kind === 'NOT_REQUIRED'`。`resolveSendingDomainFact` 冒頭コメント）であり、
      //    表示される文言はどの状態でも変わらず `sending-domain-fact` に現れる。
      await expect(session.page.getByTestId('sending-domain-fact')).toBeVisible();

      // ② 横スクロールが出ない（Tier 3 だが遮断しない。CLAUDE.md §13.3）。
      await assertNoHorizontalOverflow(session);
      // ④ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('S-014 取引先企業がモバイルで描画され、横に溢れない（T-04-07）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 この画面はロールで到達を止めない（`page.tsx` 冒頭コメント）。`hostOwner` で確認する。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto('/settings/partner-companies', { waitUntil: 'domcontentloaded' });

      // ① 画面が描画される。
      await expect(session.page.getByTestId('partner-companies-screen')).toBeVisible();
      await expect(
        session.page.getByRole('heading', { name: t('partnerCompanies.title') }),
      ).toBeVisible();

      // ③ 主要素（状態表示。一覧セクション。空 / 非空のいずれでも常に描画される）。
      //    🔴 一覧テーブルは `overflow-x-auto` の内側でスクロールさせる設計であり
      //    （`partner-companies-screen.tsx`「Tier 3 の一覧は横スクロールで劣化させる」）、
      //    ドキュメント全体を横に溢れさせない。
      await expect(session.page.getByTestId('partner-companies-list-section')).toBeVisible();

      // ② 横スクロールが出ない（Tier 3 だが遮断しない。CLAUDE.md §13.3）。
      await assertNoHorizontalOverflow(session);
      // ④ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
