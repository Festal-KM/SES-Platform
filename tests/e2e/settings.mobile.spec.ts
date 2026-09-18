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
//
// ⚠️ **例外: 案件系の 4 画面（`S-010`〜`S-013`）は `tests/e2e/projects.mobile.spec.ts` に分けた**
//    （T-06-09）。上の「乱立させない」に対する判断の理由は 2 つ:
//      ①**4 画面がひと続きの導線**（一覧 → 詳細 → 登録 / 公開範囲）であり、`S-013` では
//        「公開先の選択状態が狭い画面でも確認できる」（`CLAUDE.md` §13.3「判断材料を隠さない」）
//        という**案件固有の観点**を見る。本ファイルの「描画される / 溢れない」だけの型に収まらない。
//      ②1 ファイルに 7 画面（設定 2 + 台帳 1 + 案件 4）が同居すると、失敗時に
//        どのスプリントの回帰かが読み取れなくなる。
//    🔴 判定そのものは共有する（`expectNoHorizontalOverflow`。実装は `support/assertions.ts` の 1 本）。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
// 🔴 T-06-09: 横溢れの判定は `support/assertions.ts` に集約した（`home.mobile.spec.ts` /
//    `projects.mobile.spec.ts` と同じ 1 実装を通す）。
// 🔴 T-08-11: ラベルの折り返し・溢れの判定（`expectNoBrokenLabels`）も同じ 1 実装を通す。
import { apiRequest } from './support/api';
import { expectNoBrokenLabels, expectNoHorizontalOverflow } from './support/assertions';
import { isolationSeedCompanyNames } from '@ses/db/seed';
import { partnerIds, tenantIds } from './support/population';
import { hostOwner, openTenantSession } from './support/sessions';

test.describe('モバイルビューポートのスモーク（S-036 / S-014 / S-042 は Tier 3、S-005 / S-041 は Tier 2・遮断禁止）', () => {
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
      await expectNoHorizontalOverflow('S-036 送信ドメイン', session.page);
      await expectNoBrokenLabels('S-036 送信ドメイン', session.page);
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
      await expectNoHorizontalOverflow('S-014 取引先企業', session.page);
      await expectNoBrokenLabels('S-014 取引先企業', session.page);
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
      await expectNoHorizontalOverflow('S-005 エンジニア台帳一覧', session.page);
      await expectNoBrokenLabels('S-005 エンジニア台帳一覧', session.page);
      // ④ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  // 🔴 T-10-09: `S-042` データの返却と保持期間（docs/04 §S-042。Tier 3）の到達 1 ケース。E2E ハーネスのテナントは `ACTIVE`
  //    なので、描画されるのは空状態（「削除予定のデータはありません」）と「返却データの生成は解約手続き中のテナントで実行できます」
  //    であり、`CLOSING` の固定バナーと返却・削除の本体は結合テスト（`tests/isolation/tenant-purge.test.ts`）で固定する
  //    （docs/05 §17.3 #17 / #24 の注記）。
  test('S-042 データの返却と保持期間がモバイルで描画され、横に溢れない（T-10-09。Tier 3・遮断禁止）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 到達は `OWNER` / `ADMIN`（docs/04 §S-042「権限差分」）。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto('/settings/retention', { waitUntil: 'domcontentloaded' });

      // ① 画面が描画される。
      await expect(session.page.getByTestId('retention-page')).toBeVisible();
      await expect(session.page.getByRole('heading', { name: t('retention.title') })).toBeVisible();

      // ③ 主要素: `ACTIVE` では空状態と「解約手続き中でのみ生成できる」の注記。削除を実行する導線は無い。
      await expect(session.page.getByTestId('retention-schedule-empty')).toBeVisible();
      await expect(session.page.getByTestId('retention-export-not-closing')).toBeVisible();
      await expect(session.page.getByTestId('retention-history-empty')).toBeVisible();
      await expect(session.page.getByTestId('retention-banner-closing')).toHaveCount(0);
      await expect(session.page.getByTestId('retention-export-generate')).toHaveCount(0);

      // ② 横スクロールが出ない（Tier 3 だが遮断しない。CLAUDE.md §13.3）。
      await expectNoHorizontalOverflow('S-042 データの返却と保持期間', session.page);
      await expectNoBrokenLabels('S-042 データの返却と保持期間', session.page);
      // ④ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('🔴 S-041 監査ログの行の展開がモバイルで縦積みで読め、project.visibility_change の変更前 / 変更後が読める（T-12-17 ⑫）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(120_000);
    const session = await openTenantSession(browser, hostOwner(1));
    const publishedPartnerId = partnerIds(1, 1).partnerCompanyId;
    try {
      // 前提: `project.visibility_change` の行を 1 つ作る。公開済みの案件に**同じ集合**を送る（`#28` は冪等で、
      //       新しい公開先が無いのでゲートは積まれず外へ何も出ない。記録だけが残る = `F-014 AC-5` の説明責任の一部）。
      const put = await apiRequest(session.page, `/api/projects/${tenantIds(1).publishedProjectId}/visibility`, {
        method: 'PUT',
        body: { partnerCompanyIds: [publishedPartnerId] },
      });
      expect(put.status, put.text).toBe(200);

      await session.page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByRole('heading', { name: t('auditLogs.title') })).toBeVisible();

      // 検索: 期間（過去 1 年〜明日）+ 操作種別 = 公開範囲の変更。フォームは `Field`（`<label>` が入力を包む）なのでラベルで掴む。
      const dayKey = (offsetDays: number): string => new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await session.page.getByLabel(t('auditLogs.filter.from.label')).fill(dayKey(-365));
      await session.page.getByLabel(t('auditLogs.filter.to.label')).fill(dayKey(1));
      await session.page.getByLabel(t('auditLogs.filter.category.label')).selectOption('VISIBILITY_CHANGE');
      await session.page.getByRole('button', { name: t('auditLogs.search') }).click();
      await expect(session.page.getByTestId('audit-logs-table')).toBeVisible({ timeout: 30_000 });

      // 行を展開する（一覧の先頭 = 最新 = いま作った行）。
      const toggle = session.page.locator('[data-testid^="audit-logs-row-toggle-"]').first();
      await expect(toggle).toBeVisible();
      await toggle.click();
      const detail = session.page.locator('[data-testid^="audit-logs-row-detail-"]').first();
      await expect(detail).toBeVisible();

      // 🔴 `detail` の固定形 DTO のうち `project.visibility_change` の before / after が読める（公開先 = 取引先 1 の社名）。
      const pair = detail.getByTestId('audit-logs-detail-row-before');
      await expect(pair).toBeVisible();
      const pairText = (await pair.innerText()).replace(/\s+/g, ' ');
      // 縦積み: `sm` 未満では列ヘッダ行が隠れ、各値の前に「変更前:」「変更後:」のラベルが並ぶ（`sm:hidden`）。
      expect(pairText).toContain(`${t('auditLogs.detail.column.before')}:`);
      expect(pairText).toContain(`${t('auditLogs.detail.column.after')}:`);
      const columnHeaderRow = detail.locator('[role="row"]').first();
      const headerDisplay = await columnHeaderRow.evaluate((element) => getComputedStyle(element).display);
      expect(headerDisplay, 'sm 未満では列ヘッダ行は隠れ、値の前のラベルで読む').toBe('none');
      // 変更前・変更後の両方が同じ 1 社（同じ集合を送ったので変わっていない）。社名が読める = 本文・件名・宛先ではない。
      //    モバイルでは各セルの先頭に「変更前:」「変更後:」のラベルが乗る（`sm:hidden`）ので、ラベルを除いた値で比べる。
      const partnerName = isolationSeedCompanyNames(1).partners[0];
      const beforeCells = pair.locator('[role="cell"]');
      await expect(beforeCells).toHaveCount(2);
      const stripLabel = (text: string): string =>
        text
          .replace(`${t('auditLogs.detail.column.before')}:`, '')
          .replace(`${t('auditLogs.detail.column.after')}:`, '')
          .trim();
      const values: string[] = [];
      for (const index of [0, 1]) {
        const value = stripLabel(await beforeCells.nth(index).innerText());
        expect(value).toContain(partnerName);
        expect(value).not.toContain(publishedPartnerId);
        values.push(value);
      }
      expect(values[0]).toBe(values[1]);

      // ② 横スクロールが出ない。
      await expectNoHorizontalOverflow('S-041 監査ログ（行の展開）', session.page);
      await expectNoBrokenLabels('S-041 監査ログ（行の展開）', session.page);
      // ④ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
