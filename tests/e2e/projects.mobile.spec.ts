// tests/e2e/projects.mobile.spec.ts
// モバイルビューポートでの案件 4 画面（`S-010`〜`S-013`）のスモーク。
// `CLAUDE.md` §13.3（3 階層と「劣化はさせても遮断はしない」）/ `docs/04` §S-010〜§S-013 /
// `docs/sprints/SP-06` T-06-09。
//
// ============================================================================
// 🔴 本ファイルが守るもの
// ============================================================================
//   - `S-010`（案件一覧）/ `S-011`（案件詳細）は **Tier 2（モバイル閲覧可）**。狭い画面では
//     列を間引いてよいが、**遮断しない**。一覧のテーブルは `overflow-x-auto` の内側で
//     スクロールさせ、**ドキュメント全体を横に溢れさせない**。
//   - `S-012`（案件の登録・編集）/ `S-013`（公開範囲の設定）は **Tier 3（デスクトップ主体）**。
//     劣化は許容するが**破綻させない**（`CLAUDE.md` §13.3「Tier 3 の画面をモバイルで
//     『非表示』にしない」）。
//   - 🔴 **`S-013` は「公開先の選択状態」がモバイルでも確認できる**（`CLAUDE.md` §13.3
//     「狭い画面を理由に判断材料を隠さない」）。公開範囲は**取引先に何が見えるかを決める操作**
//     であり、いま誰に公開しているのかを見ずに変更できる導線は、承認ゲートの形骸化と同じ質の
//     事故になる（`F-014 AC-2` / `AC-5`）。
//
// 🔴 「モバイルだから省略する」を作らない。デスクトップと同じ画面・同じ API 経路を
//    モバイルビューポート（`mobile-chromium` = Pixel 5）で通し、
//    ①描画される ②横スクロールが出ない ③判断材料が可視 ④外向き発信が 0 件 を見る
//    （`home.mobile.spec.ts` / `settings.mobile.spec.ts` と同じ 4 観点）。
//
// 🔴 **行を増やさない。** 本ファイルは登録フォームを描画するだけで**保存しない**
//    （`S-012` の保存導線そのものは `tests/e2e/projects.spec.ts` がデスクトップで検証済み。
//    同じ検証を 2 か所に置かない ——「モバイルで保存できること」を見たくなったら、
//    `docs/05` §17.3 #13（モバイルでの承認）と同じ格の観点として改めて設計する）。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { expectNoHiddenCountHints, expectNoHorizontalOverflow } from './support/assertions';
import { partnerIds, tenantIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';

test.describe('モバイルビューポートのスモーク（S-010 / S-011 は Tier 2、S-012 / S-013 は Tier 3）', () => {
  test('S-010 案件一覧がモバイルで描画され、横に溢れない（Tier 2。列を間引くが遮断しない）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 この画面はロールで到達を止めない（`app/(main)/projects/(list)/page.tsx` 冒頭）。
    //    母集団を決めるのは `projects` の RLS（C4 VISIBILITY）である。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto('/projects', { waitUntil: 'domcontentloaded' });

      // ① 画面が描画される。
      await expect(session.page.getByTestId('project-list-screen')).toBeVisible();
      await expect(
        session.page.getByRole('heading', { name: t('projects.list.title') }),
      ).toBeVisible();

      // ③ 判断材料が可視: 母集団の明示 + 並び順の説明 + `seed:isolation` の公開案件の行。
      //    🔴 行が実際に描画されることまで見る（「空だから溢れなかった」を green にしない）。
      await expect(session.page.getByTestId('project-list-population')).toBeVisible();
      await expect(session.page.getByTestId('project-list-order-note')).toBeVisible();
      await expect(
        session.page.getByTestId(`project-list-row-${tenantIds(1).publishedProjectId}`),
      ).toBeVisible();

      // ② 横スクロールが出ない（テーブルは `overflow-x-auto` の内側でスクロールする）。
      await expectNoHorizontalOverflow('S-010 案件一覧', session.page);
      // 🔴 モバイルでも「見えない件数」の示唆を出さない（§4.8。列を間引いた分を
      //    「他 N 件」で補うような実装に倒れていないこと）。
      expectNoHiddenCountHints('S-010 案件一覧（モバイル）', await session.page.content());
      // ④ 外向き発信が 0 件。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('S-011 案件詳細がモバイルで描画され、判断材料（見出し・要件）が省略されない（Tier 2）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto(`/projects/${tenantIds(1).publishedProjectId}`, {
        waitUntil: 'domcontentloaded',
      });

      // ① 画面が描画される（ホスト文脈 = 商流情報の枝）。
      await expect(session.page.getByTestId('project-detail-screen')).toBeVisible();
      await expect(session.page.getByTestId('project-detail-screen')).toHaveAttribute(
        'data-audience',
        'HOST',
      );
      await expect(session.page.getByTestId('project-detail-name')).toBeVisible();

      // ③ 判断材料が可視: 見出し（状態・単価・開始日など）と必須要件のブロック。
      //    🔴 Tier 2 でも**要件は落とさない**（提案の可否を判断する材料そのもの）。
      await expect(session.page.getByTestId('project-detail-headline')).toBeVisible();
      await expect(session.page.getByTestId('project-detail-requirements-MUST')).toBeVisible();

      await expectNoHorizontalOverflow('S-011 案件詳細', session.page);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('🔴 S-011 を取引先が開いてもモバイルで破綻せず、商流情報の枝が出ない', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 取引先は 1 日 4〜5 時間の主利用者である（`CLAUDE.md` §1.2）。**取引先視点の
    //    モバイル検証を「ついで」にしない。**
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      await session.page.goto(`/projects/${tenantIds(1).publishedProjectId}`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(session.page.getByTestId('project-detail-screen')).toBeVisible();
      await expect(session.page.getByTestId('project-detail-screen')).toHaveAttribute(
        'data-audience',
        'PARTNER',
      );
      // 🔴 商流情報・公開範囲のセクションは**要素ごと存在しない**（`F-013 AC-2` / `F-014 AC-4`）。
      //    モバイルで「隠れている」のではないことを、要素数 0 で確かめる。
      await expect(session.page.getByTestId('project-detail-commerce-notice')).toHaveCount(0);
      await expect(session.page.getByTestId('project-detail-visibility-table')).toHaveCount(0);
      // 対照: 取引先にも判断材料（要件）は届く。
      await expect(session.page.getByTestId('project-detail-requirements-MUST')).toBeVisible();

      await expectNoHorizontalOverflow('S-011 案件詳細（取引先）', session.page);
      expectNoHiddenCountHints('S-011 案件詳細（取引先・モバイル）', await session.page.content());
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('S-012 案件の登録がモバイルで描画され、横に溢れない（Tier 3 だが遮断しない）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 到達できるのは `PROJECT_EDITOR_ROLES`（`OWNER` / `ADMIN` / `SALES`）だけである。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      await session.page.goto('/projects/new', { waitUntil: 'domcontentloaded' });

      // ① 画面が描画される（新規モード）。
      await expect(session.page.getByTestId('project-form')).toBeVisible();
      await expect(session.page.getByTestId('project-form')).toHaveAttribute('data-mode', 'CREATE');
      await expect(
        session.page.getByRole('heading', { name: t('projects.new.title') }),
      ).toBeVisible();

      // ③ 主要素（必須入力と要件の 2 ブロック）が可視。**入力できる**ことまで見る
      //    —— Tier 3 の劣化は「使いにくい」であって「触れない」ではない。
      await expect(session.page.getByTestId('project-name')).toBeVisible();
      await expect(session.page.getByTestId('project-section-requirements-MUST')).toBeVisible();
      await expect(session.page.getByTestId('project-section-requirements-NICE')).toBeVisible();

      await expectNoHorizontalOverflow('S-012 案件の登録', session.page);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('🔴 S-013 公開範囲がモバイルで描画され、公開先の選択状態が確認できる（CLAUDE.md §13.3）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const publishedPartnerId = partnerIds(1, 1).partnerCompanyId;
    try {
      await session.page.goto(`/projects/${tenantIds(1).publishedProjectId}/visibility`, {
        waitUntil: 'domcontentloaded',
      });

      // ① 画面が描画される。
      await expect(session.page.getByTestId('project-visibility-screen')).toBeVisible();
      await expect(session.page.getByTestId('project-visibility-name')).toBeVisible();

      // ③ 🔴 **判断材料を隠さない**（`CLAUDE.md` §13.3）:
      //    (a) 現在の公開先（`seed:isolation` はパートナー 1 に公開済み）
      await expect(session.page.getByTestId('project-visibility-current-table')).toBeVisible();
      //    (b) 選択チェックボックスが**可視かつ選択済み**として見える
      //        （見えるだけでなく「いまオンである」ことが分かる ＝ 状態の確認ができる）
      const publishedChoice = session.page.getByTestId(
        `project-visibility-choice-${publishedPartnerId}`,
      );
      await expect(publishedChoice).toBeVisible();
      await expect(publishedChoice).toBeChecked();
      //    (c) 未公開のパートナー 2 は選択肢に出るが**オフ**である（既定は誰にも公開されない
      //        ＝ `F-014 AC-2` が画面の初期状態としても守られている）
      const unpublishedChoice = session.page.getByTestId(
        `project-visibility-choice-${partnerIds(1, 2).partnerCompanyId}`,
      );
      await expect(unpublishedChoice).toBeVisible();
      await expect(unpublishedChoice).not.toBeChecked();
      //    (d) 公開されたときの見え方（プレビュー）とゲートの説明も畳まない ——
      //        「何が外へ出るか」を見ずに公開できる導線を、狭い画面にも作らない。
      await expect(session.page.getByTestId('project-visibility-preview')).toBeVisible();
      await expect(session.page.getByTestId('project-visibility-gate')).toBeVisible();

      await expectNoHorizontalOverflow('S-013 公開範囲', session.page);
      // 🔴 送信はしない（公開範囲の変更は監査対象の実行系操作であり、スモークで動かさない）。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
