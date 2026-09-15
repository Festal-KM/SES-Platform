// tests/e2e/home.mobile.spec.ts
// モバイルビューポートのスモーク（`CLAUDE.md` §13.3 / docs/03 §4.17 /
// docs/sprints/SP-03-auth-audit-admin0.md §5 テスト計画の E2E 行）。
//
// 🔴 本ファイルの起点は**基盤の確立**（Phase 0: `S-003` / `S-004` が T1 として破綻しない）だった。
//    ✅ **T-09-03（SP-09）で承認画面 `S-021` ができ、`CLAUDE.md` §13.3 が要求する「モバイルでの承認フロー」
//    （`F-021 AC-4` / `AC-6` / docs/05 §17.3 #13 / `.claude/agents/e2e-tester.md` シナリオ #14）をホストの test に足した**
//    （test の本数は増やさない。`expectNoBrokenLabels` / `expectNoHiddenCountHints` を同じ画面で呼ぶ）。
//    E2E ハーネスには Redis も worker も無い（docs/05 §11.12 ⑦。足すのは `T-09-11`）ため、「全層 PASS で承認待ち」の
//    前提は `harness/db-admin.ts` のシーム（#39 と `gate.run` が書くのと同じ列）で作る。ゲート本体と承認 CAS の正しさは
//    `tests/isolation/gate-run.test.ts` / `proposal-approval.test.ts` の射程である。
//    ✅ **T-09-04 で E2E #10（承認後に内容を変更できない。docs/05 §17.3 #10）を同じ test の続きに足した**（承認直後の
//    状態をそのまま使う。送信側のアサーションは T-09-06）。
//
// 🔴 「モバイルだから省略する」を作らない（`CLAUDE.md` §13.3）。サインイン（2 要素認証を含む）が
//    モバイルで完結することを、デスクトップと同じ経路で確かめる。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import {
  deleteT0903SyntheticProposals,
  settleProposalGateAsPassedForE2e,
  T0903_SYNTHETIC_PROPOSAL_PREFIX,
} from './harness/db-admin';
import { apiRequest, parseJson } from './support/api';
// 🔴 T-06-09: 横溢れの判定は `support/assertions.ts` に集約した（同じ判定が spec ごとに
//    散ると、1 箇所だけ閾値が緩められたことに気づけない）。
// 🔴 T-08-11: ラベルの折り返し・溢れの判定（`expectNoBrokenLabels`）も同じ置き場所から呼ぶ
//    （SP-21 §8.5。横溢れの式では「1 文字ずつ折り返して箱の中に収まる」壊れ方を捉えられない）。
import { expectNoBrokenLabels, expectNoHiddenCountHints, expectNoHorizontalOverflow } from './support/assertions';
import { partnerIds, tenantIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';

/** 🔴 T-09-03: この spec が作った合成提案（後始末で消す。`isolation.spec.ts` はホストの提案の母集団を seed で表明する）。 */
const syntheticProposalIds: string[] = [];

test.afterAll(() => {
  deleteT0903SyntheticProposals(syntheticProposalIds);
});

test.describe('モバイルビューポートのスモーク（S-003 / S-004 は T1）', () => {
  test('ホストのホームがモバイルで描画され、横に溢れない。承認（S-021）がモバイルで完結し、承認後は内容を変更できない（E2E #13 / #10）', async ({
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

      // ✅ T-09-03: 🔴 **モバイルビューポートでの承認**（docs/05 §17.3 #13 / `F-021 AC-4` / `AC-6` / `CLAUDE.md` §13.3）。
      //    前提: ホストが自社エンジニアで提案を作り（#36）、#40 が返す**現在の内容のハッシュ**で「全層 PASS → 承認待ち」を
      //    シームで作る（ハーネスに Redis / worker が無いため。ファイル冒頭）。
      const ids = tenantIds(1);
      const subject = `${T0903_SYNTHETIC_PROPOSAL_PREFIX}${String(Date.now())}`;
      const body = 'T0903 ご提案します。設計から運用まで一貫して担当できます。';
      const created = await apiRequest(session.page, '/api/proposals', {
        method: 'POST',
        body: {
          projectId: ids.publishedProjectId,
          engineerId: ids.hostEngineerId,
          recipientCompanyName: 'T0903 架空エンド株式会社',
          recipientEmail: 't0903-recipient@example.test',
          offeredUnitPrice: 700000,
          offeredStartDate: '2026-11-01',
          subject,
          body,
        },
      });
      expect(created.status, created.text).toBe(201);
      const proposalId = (parseJson(created) as { id: string }).id;
      syntheticProposalIds.push(proposalId);
      const gate = await apiRequest(session.page, `/api/proposals/${proposalId}/gate`);
      expect(gate.status, gate.text).toBe(200);
      const { contentHash } = parseJson(gate) as { contentHash: string };
      settleProposalGateAsPassedForE2e(proposalId, contentHash);

      await session.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      const screen = session.page.getByTestId('proposal-approval');
      await expect(screen).toHaveAttribute('data-proposal-state', 'APPROVAL_PENDING');
      await expect(screen).toHaveAttribute('data-can-approve', 'true');

      // 🔴 `F-021 AC-4`: 判断材料（提案先・エンジニア・案件・単価・開始日・作成者・経過時間 / ゲートの指摘と警告 / プレビュー）が
      //    **同一画面に、省略されずに**描かれる。折りたたみ・タブに入っていない。
      for (const field of ['recipient', 'engineer', 'project', 'unit-price', 'start-date', 'created-by', 'elapsed']) {
        await expect(session.page.getByTestId(`proposal-approval-header-row-${field}`)).toBeVisible();
      }
      await expect(session.page.getByTestId('proposal-approval-header-row-unit-price')).toContainText('700,000');
      await expect(session.page.getByTestId('proposal-approval-header-row-recipient')).toContainText('T0903 架空エンド株式会社');
      for (const layer of ['pii', 'commerce', 'consistency']) {
        await expect(session.page.getByTestId(`proposal-approval-gate-layer-${layer}`)).toHaveAttribute('data-layer-state', 'PASS');
      }
      await expect(session.page.getByTestId('proposal-approval-gate-findings')).toBeVisible();
      await expect(session.page.getByTestId('proposal-approval-gate-warnings')).toBeVisible();
      await expect(session.page.getByTestId('proposal-approval-preview-body')).toContainText(body);
      await expect(session.page.locator('details')).toHaveCount(0);
      await expect(session.page.locator('[role="tab"]')).toHaveCount(0);
      // 🔴 `F-021 AC-6` / `BR-50`: 一括承認・force / override に相当する操作が存在しない。
      await expect(session.page.locator('[data-testid*="bulk"]')).toHaveCount(0);
      await expect(session.page.locator('[data-testid*="force"], [data-testid*="override"], [data-testid*="skip"]')).toHaveCount(0);
      expect(await session.page.content()).not.toMatch(/一括承認|一括送信|無視して/);
      expectNoHiddenCountHints('S-021 提案の承認（モバイル）', await session.page.locator('body').innerText());
      await expectNoHorizontalOverflow('S-021 提案の承認', session.page);
      await expectNoBrokenLabels('S-021 提案の承認', session.page);

      // 🔴 `docs/04` §S-021 デバイス別: プレビューの末尾までスクロールするまで承認・却下は有効にならない。
      const approve = session.page.getByTestId('proposal-approval-approve');
      await expect(approve).toBeDisabled();
      await expect(session.page.getByTestId('proposal-approval-scroll-required')).toBeVisible();
      await session.page.getByTestId('proposal-approval-preview-end').scrollIntoViewIfNeeded();
      await expect(screen).toHaveAttribute('data-reached-end', 'true');
      await expect(approve).toBeEnabled();
      await expect(session.page.getByTestId('proposal-approval-reject')).toBeEnabled();

      // 🔴 承認はモバイルで完結する（Tier 1）。body は送られない（#41 はゲート結果を引数に取らない）。
      await approve.click();
      await expect(session.page.getByTestId('proposal-approval-result')).toHaveAttribute('data-result', 'APPROVED');
      await expect(screen).toHaveAttribute('data-proposal-state', 'APPROVED');
      await expect(session.page.getByTestId('proposal-approval-approver')).toBeVisible();
      await expect(session.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      await expectNoBrokenLabels('S-021 提案の承認（承認後）', session.page);
      // 🔴 承認は送信を伴わない（送信ジョブは T-09-06）。外部への発信は 0 件。
      session.outbound.assertNone();

      // ✅ T-09-04: 🔴 **E2E #10（承認後に内容を変更できない）**（docs/05 §11.5 手順 2〔改訂〕/ §17.3 #10 / `F-021`。
      //    ⚠️ 暫定。Issue #54 で確認中 = `APPROVED → DRAFT` は追加しない）。
      //    ①`S-020` を開くと読み取り専用で理由が表示され、入力欄と保存・レビュー依頼が使えない
      //    ②#37 `PATCH` は 422 `PROPOSAL_NOT_EDITABLE` で、#40 が返す内容のハッシュが 1 バイトも変わらない
      //    ③`S-021` は承認済みを示したまま（承認アクションは描画されない）
      //    ⚠️ **「再検証なしで送信できない」の送信側アサーションは送信 API（#43）が T-09-06 のため、そこで足す。**
      //       API を通らない経路（`proposals.content_hash` / 凍結の careers のずれ）で `APPROVED → SUBMITTING` の CAS が
      //       0 件更新になることは `tests/isolation/proposal-approval-invalidation.test.ts` が実 DB で固定している。
      const gateBefore = await apiRequest(session.page, `/api/proposals/${proposalId}/gate`);
      expect(gateBefore.status, gateBefore.text).toBe(200);
      const hashBefore = (parseJson(gateBefore) as { contentHash: string }).contentHash;
      expect(hashBefore).toBe(contentHash);

      await session.page.goto(`/proposals/${proposalId}/edit`, { waitUntil: 'domcontentloaded' });
      const editor = session.page.getByTestId('proposal-editor');
      await expect(editor).toHaveAttribute('data-proposal-state', 'APPROVED');
      const readOnly = session.page.getByTestId('proposal-editor-read-only');
      await expect(readOnly).toBeVisible();
      await expect(readOnly).toContainText(t('proposals.editor.readOnly.prefix'));
      await expect(readOnly).toContainText(t('proposals.editor.readOnly.suffix'));
      await expect(session.page.getByTestId('proposal-editor-body')).toBeDisabled();
      await expect(session.page.getByTestId('proposal-editor-save')).toBeDisabled();
      await expect(session.page.getByTestId('proposal-editor-request-gate')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-editor-open-approval')).toBeVisible();
      await expectNoHorizontalOverflow('S-020 提案の編集（承認後・読み取り専用）', session.page);
      await expectNoBrokenLabels('S-020 提案の編集（承認後・読み取り専用）', session.page);

      const patched = await apiRequest(session.page, `/api/proposals/${proposalId}`, {
        method: 'PATCH',
        body: { body: `${body} 承認後の追記。`, offeredUnitPrice: 750000 },
      });
      expect(patched.status, patched.text).toBe(422);
      expect((parseJson(patched) as { error: { code: string } }).error.code).toBe('PROPOSAL_NOT_EDITABLE');
      const gateAfter = await apiRequest(session.page, `/api/proposals/${proposalId}/gate`);
      expect(gateAfter.status, gateAfter.text).toBe(200);
      expect((parseJson(gateAfter) as { contentHash: string }).contentHash).toBe(hashBefore);

      await session.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'APPROVED');
      await expect(session.page.getByTestId('proposal-approval-approver')).toBeVisible();
      await expect(session.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-approval-header-row-unit-price')).toContainText('700,000');
      await expect(session.page.getByTestId('proposal-approval-preview-body')).toContainText(body);
      await expect(session.page.getByTestId('proposal-approval-preview-body')).not.toContainText('承認後の追記');
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
