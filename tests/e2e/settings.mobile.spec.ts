// tests/e2e/settings.mobile.spec.ts
// モバイルビューポートでの設定 + 台帳画面のスモーク（`CLAUDE.md` §13.3 / SP-04 完了確認 NG の是正）。
//
// 🔴 本ファイルの目的は **T-04-06（`S-036` 送信ドメイン）/ T-04-07（`S-014` 取引先企業）の
//    完了判定「モバイルで破綻しない」を固定する恒久テスト**である。両画面は
//    `docs/04` の 3 階層で **Tier 3（デスクトップ主体）**に分類されるが、`CLAUDE.md` §13.3 は
//    「Tier 3 の画面をモバイルで『非表示』にしない。劣化はさせても遮断はしない」を要求する。
//    `playwright.config.ts` の `mobile-chromium` プロジェクトは元々
//    `tests/e2e/home.mobile.spec.ts`（`S-003` / `S-004`）しか実行しておらず、
//    Tier 3 側の非破綻を固定するテストが 1 本も無かった（pm の SP-04 完了確認 NG）。
//
// 🔴 T-05-09: `S-005`（エンジニア台帳一覧）のモバイルスモークを本ファイルに足した。
//    `S-005` は `docs/04` の 3 階層で **Tier 2（モバイル閲覧可）**であり、厳密には
//    「設定系」ではない。それでも新規ファイルを立てず、ここへ追加することにした理由:
//      ①1 画面だけのために新しい `*.mobile.spec.ts` を立てると、`mobile-chromium`
//        プロジェクトの起動コスト（globalSetup 一式の直列 seed）が画面数に対して割高になる。
//      ②本ファイルは実質「`home.mobile.spec.ts`（Tier 1 の承認・通知系）に入らない画面の、
//        モバイル非破綻の一括置き場」として機能しており、Tier 2 / Tier 3 のどちらでも
//        受け皿になれる（下段の 🔴 も参照）。
//    ファイル名（`settings.*`）を画面種別に追従させて改名するほどの画面数（1 画面）ではない
//    ため、ファイル名は据え置き、**対象範囲の記述だけをここで「設定 + 台帳」に改訂する**。
//    台帳・一覧系の画面が増えて「設定」という呼び名が実態とずれてきたら、そのときに
//    ファイル名の改訂（例: `ledger-and-settings.mobile.spec.ts`）を検討する。
//
// 🔴 「モバイルだから省略する」を作らない。デスクトップと同じ画面・同じ API 経路をモバイル
//    ビューポートで通し、①画面が描画される ②横スクロールが出ない ③状態表示が可視 ④外向き
//    発信が 0 件であることを確かめる（`home.mobile.spec.ts` と同じ観点・同じ構成）。
//
// 🔴 Phase 1 で設定系画面（`S-021` / `S-024` / `S-026` など）や、台帳・一覧系の画面が
//    増えたら、本ファイルにケースを足す（新規ファイルを乱立させず、Tier 2 / Tier 3 の
//    モバイル非破綻はここに集約する）。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { tenantIds } from './support/population';
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

test.describe('モバイルビューポートのスモーク（S-036 / S-014 は Tier 3、S-005 は Tier 2・遮断禁止）', () => {
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

  test('S-005 エンジニア台帳一覧がモバイルで描画され、横に溢れない（T-05-09。Tier 2 だが列を間引くだけで遮断しない）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 この画面はロールで到達を止めない（`app/(main)/engineers/page.tsx` 冒頭コメント）。
    //    `hostOwner` で確認する。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto('/engineers', { waitUntil: 'domcontentloaded' });

      // ① 画面が描画される。
      await expect(session.page.getByTestId('engineer-ledger-screen')).toBeVisible();
      await expect(
        session.page.getByRole('heading', { name: t('engineers.list.title') }),
      ).toBeVisible();

      // ③ 主要素（母集団の明示 + 一覧テーブル）が可視。`seed:isolation` のホスト所有 1 件
      //    （`tenantIds(1).hostEngineerId`）が実際に行として描画されることまで見る
      //    （モバイルでも氏名・主要スキル・稼働可能時期の 3 列は落とさない。
      //    `engineer-ledger-screen.tsx` 冒頭「移動中の判断に要る値をモバイルで落とさない」）。
      await expect(session.page.getByTestId('engineer-list-population')).toBeVisible();
      await expect(
        session.page.getByTestId(`engineer-list-row-${tenantIds(1).hostEngineerId}`),
      ).toBeVisible();

      // ② 横スクロールが出ない（Tier 2。列を間引くが遮断しない。CLAUDE.md §13.3）。
      await assertNoHorizontalOverflow(session);
      // ④ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
