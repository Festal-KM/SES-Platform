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
// 🔴 T-08-11: ラベルの折り返し・溢れの判定（`expectNoBrokenLabels`）も同じ 1 実装を通す。
import {
  expectNoBrokenLabels,
  expectNoHiddenCountHints,
  expectNoHorizontalOverflow,
} from './support/assertions';
import { apiRequest, parseJson } from './support/api';
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
      await expectNoBrokenLabels('S-010 案件一覧', session.page);
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
      await expectNoBrokenLabels('S-011 案件詳細', session.page);
      session.outbound.assertNone();

      // ------------------------------------------------------------------------------------------
      // 🔴 T-08-06: `S-016`（候補検索。T2）→ 提案依頼の発行 → `S-017`（提案依頼の一覧。**T1**）→ 取り下げ。
      //    `docs/04` §3.3 の遷移（`S-011` →「② 候補を探す」→ `S-016` →「匿名候補」→ `S-017`）をそのまま辿る。
      //    **test を増やさず**（T-08-11 受け入れ基準 1 / 5）、新設 2 画面を `expectNoBrokenLabels` の射程に入れる。
      //    🔴 `S-017` は Tier 1 であり、**モバイルで取り下げまで完結する**ことを実際に押して確かめる
      //    （`CLAUDE.md` §13.3 / `docs/04` §S-017 デバイス別）。判断材料（案件名・状態・残り時間）は隠さない。
      //    ⚠️ DB は毎回の実行で `seed:isolation` から作り直される（`global-setup.ts`）ので、ここで作った依頼が
      //    次回の実行に残ることは無い。同じ実行内の他 spec は `proposal_requests` を見ない。
      //    🔴 T-08-07: ここでは**未公開案件**（`privateProjectId`）で依頼 → 取り下げを行う。`@@unique([tenantId, projectId,
      //    engineerId])` により同じ候補への再依頼はできないため、**公開案件の枠は下の取引先テスト（`S-018` の応諾）に残す**。
      //    `S-016` は共有候補を案件の公開範囲に関係なく出す（共有は案件スコープではない）ので、この流れは変わらない。
      //    ⚠️ 素の URL は**案件の要件を検索条件の初期値**にする（`docs/04` §S-016 実装の補足）。未公開案件の要件
      //    （`seed:isolation` は Go）は共有候補のスキルに当たらないため、検索条件を 1 つ置いて（`?limit=`）
      //    「要件に戻す」前の全件表示にする（利用者が条件を外した状態と同じ経路）。
      // ------------------------------------------------------------------------------------------
      await session.page.goto(`/projects/${tenantIds(1).privateProjectId}/candidates?limit=20`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(session.page.getByTestId('candidate-screen')).toBeVisible();
      // 🔴 共有候補の行が実際に描かれる（`seed:isolation` の 2 パートナーは共有可にしている）。
      //    「空だから壊れていない」を緑にしない。
      const anonymousRow = session.page
        .locator('[data-testid^="candidate-list-row-"][data-candidate-kind="ANONYMOUS"]')
        .first();
      await expect(anonymousRow).toBeVisible();
      await expectNoHorizontalOverflow('S-016 候補検索', session.page);
      await expectNoBrokenLabels('S-016 候補検索', session.page);
      expectNoHiddenCountHints('S-016 候補検索（モバイル）', await session.page.content());

      // 行を選ぶ → 右パネル（モバイルでは一覧の下）に 5 項目と「提案依頼を送る」。
      await anonymousRow.click();
      await expect(session.page.getByTestId('candidate-detail-anonymous')).toBeVisible();
      await session.page.getByTestId('candidate-request-open').click();
      const requestForm = session.page.getByTestId('candidate-request-form');
      await expect(requestForm).toBeVisible();
      // 🔴 フォームに単価に関する入力欄が無い（`F-017 AC-4` / `BR-58`）。入力はメッセージと期限の 2 つだけ。
      await expect(requestForm.locator('input[type="number"]')).toHaveCount(0);
      await expect(requestForm.locator('textarea, input')).toHaveCount(2);
      await expectNoBrokenLabels('S-016 提案依頼フォーム', session.page);
      await session.page
        .getByTestId('candidate-request-message')
        .fill('11 月上旬の開始を希望しています。面談は来週中に設定可能です。');
      await session.page.getByTestId('candidate-request-submit').click();
      await expect(session.page.getByTestId('candidate-request-sent')).toBeVisible();

      // `S-017`: 送った依頼が「返答待ち」で並び、モバイルでも取り下げまで押せる。
      await session.page.getByTestId('candidate-request-open-list').click();
      await expect(session.page.getByTestId('proposal-request-screen')).toBeVisible();
      const requestedRow = session.page
        .locator('[data-testid^="proposal-request-row-"][data-request-state="REQUESTED"]')
        .first();
      await expect(requestedRow).toBeVisible();
      await expectNoHorizontalOverflow('S-017 提案依頼の一覧', session.page);
      await expectNoBrokenLabels('S-017 提案依頼の一覧', session.page);
      expectNoHiddenCountHints('S-017 提案依頼の一覧（モバイル）', await session.page.content());

      await requestedRow.click();
      await expect(session.page.getByTestId('proposal-request-detail')).toBeVisible();
      await session.page.getByTestId('proposal-request-withdraw').click();
      await expect(session.page.getByTestId('proposal-request-withdraw-confirm')).toBeVisible();
      await expectNoBrokenLabels('S-017 取り下げの確認', session.page);
      await session.page.getByTestId('proposal-request-withdraw-submit').click();
      // 🔴 再読込後、同じ依頼が「取り下げ」の状態で並ぶ（サーバの状態だけが正。`WITHDRAWN_BY_HOST` は
      //    `DECLINED` / `EXPIRED` と別のバッジである。`F-018 AC-5`）。
      await expect(
        session.page
          .locator('[data-testid^="proposal-request-row-"][data-request-state="WITHDRAWN_BY_HOST"]')
          .first(),
      ).toBeVisible();
      // ④ 外向き発信が 0 件（依頼の通知は Phase 1 ではアプリ内表示。メールは飛ばない）。
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
      await expectNoBrokenLabels('S-011 案件詳細（取引先）', session.page);
      expectNoHiddenCountHints('S-011 案件詳細（取引先・モバイル）', await session.page.content());
      session.outbound.assertNone();

      // 🔴 T-08-06: `S-017`（取引先視点。T1）。届いた依頼に気づく唯一の入口であり（Phase 1 の通知はアプリ内表示）、
      //    モバイルで破綻しないこと・**取り下げの導線がホスト専用で取引先には無い**ことを見る（`F-018` 関連ロール）。
      // 🔴 T-08-07: 続けて `S-018`（応諾・辞退。**T1**）を**モバイルで応諾まで完結**させる（`CLAUDE.md` §13.3 /
      //    `docs/04` §S-018 デバイス別）。**test を増やさず**（T-08-11 受け入れ基準 1 / 5）、新設画面を
      //    `expectNoBrokenLabels` の射程に入れる。依頼はホストのセッションが API（#30 → #31）で公開案件の全共有候補に
      //    発行する —— どの参照子が取引先 1 の人材かはホストには分からない（設計どおり）ので、全員に出して
      //    取引先 1 の一覧に「返答待ち」が 1 件だけ現れることを使う。
      await issueRequestsToAllSharedCandidates(browser, tenantIds(1).publishedProjectId);

      await session.page.goto('/proposal-requests', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-request-screen')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-withdraw')).toHaveCount(0);
      await expectNoHorizontalOverflow('S-017 提案依頼の一覧（取引先）', session.page);
      await expectNoBrokenLabels('S-017 提案依頼の一覧（取引先）', session.page);
      expectNoHiddenCountHints('S-017 提案依頼の一覧（取引先・モバイル）', await session.page.content());
      session.outbound.assertNone();

      // `S-017` → 行を選ぶ → 「この依頼に返答する」→ `S-018`。
      const requestedRow = session.page
        .locator('[data-testid^="proposal-request-row-"][data-request-state="REQUESTED"]')
        .first();
      await expect(requestedRow).toBeVisible();
      await requestedRow.click();
      await expect(session.page.getByTestId('proposal-request-detail')).toBeVisible();
      await session.page.getByTestId('proposal-request-detail-respond').click();
      await expect(session.page.getByTestId('proposal-request-respond-screen')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-screen')).toHaveAttribute(
        'data-request-state',
        'REQUESTED',
      );
      // ③ 判断材料が可視（`CLAUDE.md` §13.3 / `docs/04` §S-018「モバイルでも省略しない」）:
      //    案件名・必須要件・条件（単価レンジ / 開始日 / 勤務地）・依頼メッセージ・返答期限・開示される項目・対象エンジニア。
      await expect(session.page.getByTestId('proposal-request-respond-project-name')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-project-headline')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-requirements-MUST')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-remaining')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-disclosure-items')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-engineer-name')).toBeVisible();
      // 🔴 応諾と辞退の両方が同じ行にある（辞退を目立たなくしない。`BR-57`）。
      await expect(session.page.getByTestId('proposal-request-respond-accept')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-decline')).toBeVisible();
      await expectNoHorizontalOverflow('S-018 提案依頼の詳細（取引先）', session.page);
      await expectNoBrokenLabels('S-018 提案依頼の詳細（取引先）', session.page);
      expectNoHiddenCountHints('S-018 提案依頼の詳細（取引先・モバイル）', await session.page.content());

      // 応諾: 確認 1 段（開示される 3 項目を列挙）→ 確定 → 下書き ID が示される。
      await session.page.getByTestId('proposal-request-respond-accept').click();
      const confirm = session.page.getByTestId('proposal-request-respond-accept-confirm');
      await expect(confirm).toBeVisible();
      await expect(confirm.getByTestId('proposal-request-respond-accept-confirm-items').locator('li')).toHaveCount(3);
      await expectNoBrokenLabels('S-018 応諾の確認', session.page);
      await session.page.getByTestId('proposal-request-respond-accept-submit').click();
      await expect(session.page.getByTestId('proposal-request-respond-accepted')).toBeVisible();
      await expect(session.page.getByTestId('proposal-request-respond-accepted-proposal-id')).toHaveText(
        /^[0-9a-f-]{36}$/,
      );
      await expectNoBrokenLabels('S-018 応諾の完了', session.page);
      // ④ 外向き発信が 0 件（応諾の通知は Phase 1 ではアプリ内表示。メールは飛ばない）。
      session.outbound.assertNone();

      // 🔴 再訪すると `ACCEPTED` の状態で描かれ、応諾・辞退の操作が無い（サーバの状態だけが正。`F-018 AC-5`）。
      await session.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-request-respond-screen')).toHaveAttribute(
        'data-request-state',
        'ACCEPTED',
      );
      await expect(session.page.getByTestId('proposal-request-respond-accept')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-request-respond-decline')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-request-respond-closed')).toBeVisible();
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
      await expectNoBrokenLabels('S-012 案件の登録', session.page);
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
      await expectNoBrokenLabels('S-013 公開範囲', session.page);
      // 🔴 送信はしない（公開範囲の変更は監査対象の実行系操作であり、スモークで動かさない）。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});

/**
 * 🔴 T-08-07: ホストのセッションから、公開案件の**全共有候補**に提案依頼を発行する（API 直叩き。#30 → #31）。
 *
 * どの参照子がどの取引先の人材かはホストには分からない（`candidateRef` は案件スコープの HMAC。docs/05 §4.6）
 * ので、全員に出す。既に依頼がある候補は 409（`@@unique`）で、それは「出せなかった」ではなく「もうある」なので
 * 通す。**`S-018` の取引先テストが「返答待ちが 1 件ある」状態を作るためだけの前処理**であり、画面の検証ではない。
 */
async function issueRequestsToAllSharedCandidates(browser: Browser, projectId: string): Promise<void> {
  const host = await openTenantSession(browser, hostOwner(1));
  try {
    const list = parseJson(await apiRequest(host.page, `/api/projects/${projectId}/candidates`)) as {
      readonly items: readonly { readonly candidateRef?: string }[];
    };
    const refs = list.items.flatMap((item) => (typeof item.candidateRef === 'string' ? [item.candidateRef] : []));
    expect(refs.length).toBeGreaterThan(0);
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    for (const candidateRef of refs) {
      const response = await apiRequest(host.page, '/api/proposal-requests', {
        method: 'POST',
        body: { projectId, candidateRef, message: '11 月上旬の開始を希望しています。', expiresAt },
      });
      expect([201, 409]).toContain(response.status);
    }
    host.outbound.assertNone();
  } finally {
    await host.close();
  }
}
