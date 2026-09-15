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
// 🔴 T-08-11: ラベルの折り返し・溢れの判定（`expectNoBrokenLabels`）も同じ置き場所から呼ぶ
//    （SP-21 §8.5。横溢れの式では「1 文字ずつ折り返して箱の中に収まる」壊れ方を捉えられない）。
import { expectNoBrokenLabels, expectNoHorizontalOverflow } from './support/assertions';
import { partnerIds } from './support/population';
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
      await expectNoBrokenLabels('S-003 ホストのホーム', session.page);
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
      await expectNoBrokenLabels('S-004 取引先のホーム', session.page);
      session.outbound.assertNone();

      // 🔴 T-08-11: `S-015` 匿名共有の設定（T-08-02 で新設。取引先専用・Tier 2）もここで走査する。
      //    **test を増やさず**（受け入れ基準 1）取引先専用画面を検出器の射程に入れるには、
      //    取引先セッションを持つ既存 test に続ける形しかない。候補は本 test と `projects.mobile`
      //    の S-011（取引先）の 2 つだが、`S-015` は案件系ではなく共有の設定であり、
      //    `S-004` → `S-015` が `docs/04` §2.2 の取引先の遷移図（`UC-14`）どおりの導線なので本 test に置く。
      //    共有中の 1 名（`seed:isolation` のパートナー 1 のエンジニア）が行として描かれ、
      //    解除ボタンが**押せる形**で存在することまで見る（「空だから壊れていない」を緑にしない）。
      // ⚠️ `S-016`〜`S-018`（`T-08-05` / `T-08-06` / `T-08-07` で新設予定）は、画面が出来た
      //    時点で該当 spec から `expectNoBrokenLabels` を呼ぶ。本ファイルには足さない。
      await session.page.goto('/engineer-shares', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('engineer-share-screen')).toBeVisible();
      await expect(session.page.getByTestId('engineer-share-shared-table')).toBeVisible();
      await expect(
        session.page.getByTestId(`engineer-share-revoke-${partnerIds(1, 1).engineerId}`),
      ).toBeVisible();
      await expectNoHorizontalOverflow('S-015 匿名共有の設定', session.page);
      await expectNoBrokenLabels('S-015 匿名共有の設定', session.page);
      // 🔴 共有の開始・停止は監査対象の実行系操作（`F-016 AC-4`）。スモークで動かさない。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
