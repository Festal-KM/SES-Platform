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
//    ✅ **T-09-06 で承認後の primary「送信する」（#43）を同じ test の続きに足した**（docs/05 §6.5 #43 / §10.2）。ハーネスに
//    Redis は足した（`harness/redis.ts`。#43 が `send.proposal` を積む先）が **worker はまだ無い**（Issue #47 の既定値 =
//    `T-09-11` で設計）。したがってここで確かめるのは「202 = 受け付け」「押した瞬間に送信済みと見せない」「状態は
//    `APPROVED` のまま（`SUBMITTING` に入れるのはジョブ）」までであり、確定（`SUBMITTED` / 保留）と E2E #7 / #10 の
//    送信側（`GATE_STALE`）は `tests/isolation/send-proposal.test.ts`（実 Redis + 実 Worker）が証明する。ブラウザ経路の
//    E2E #7 / #9 / #10 送信側は `T-09-11` が worker を立てて足す。
//    ✅ **T-09-08 で送信失敗 → `S-022` → 確認ステップを経た人手再送（#44）を同じ test の続きに足した**（docs/05 §6.5 #44 / §10.6 /
//    `F-023`）。`SUBMIT_FAILED` の前提は `harness/db-admin.ts` の `settleProposalSendAsFailedForE2e`（送信ジョブの ⑥ と同じ列）で
//    作る。E2E #8 の通し（応答不明 → `SUBMIT_FAILED` → 自動再送されない → 人手再送で 1 回）は `T-09-07` / `T-09-11`。
//
// 🔴 「モバイルだから省略する」を作らない（`CLAUDE.md` §13.3）。サインイン（2 要素認証を含む）が
//    モバイルで完結することを、デスクトップと同じ経路で確かめる。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import {
  deleteT0903SyntheticProposals,
  settleProposalGateAsPassedForE2e,
  settleProposalSendAsFailedForE2e,
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

      // ✅ T-09-06: 🔴 **承認後の primary は「送信する」（#43）**（docs/05 §6.5 #43 / §10.2 / T-09-03 の決着「押した瞬間に送信済みと
      //    見せない」）。モバイルで完結する（Tier 1）。
      //    ①「承認する」は無く「送信する」が描かれ、プレビューの末尾まで確認するまで押せない
      //    ②押すと 202（受け付け）。画面は「送信を受け付けました。送信中です」を出し、**「送信済み」の語を出さない**
      //    ③状態は `APPROVED` のまま（`SUBMITTING` に入れるのは送信ジョブ。ハーネスに worker は無いので確定しない）
      //    ④外部への発信は 0 件（#43 は enqueue するだけ。送信そのものはジョブであり、E2E の環境ではモック）
      const approvalScreen = session.page.getByTestId('proposal-approval');
      await expect(approvalScreen).toHaveAttribute('data-can-submit', 'true');
      await expect(approvalScreen).toHaveAttribute('data-send-hold', '');
      const submitButton = session.page.getByTestId('proposal-approval-submit');
      await expect(submitButton).toBeVisible();
      await expect(submitButton).toHaveText(t('proposals.approval.action.submit'));
      await expect(submitButton).toBeDisabled();
      await expect(session.page.getByTestId('proposal-approval-submit-scroll-required')).toBeVisible();
      await expect(session.page.getByTestId('proposal-approval-submit-lead')).toContainText(t('proposals.approval.action.submitLead'));
      expect(await session.page.content()).not.toMatch(/一括送信|無視して送信|再送/);
      await session.page.getByTestId('proposal-approval-preview-end').scrollIntoViewIfNeeded();
      await expect(approvalScreen).toHaveAttribute('data-reached-end', 'true');
      await expect(submitButton).toBeEnabled();
      await expectNoBrokenLabels('S-021 提案の承認（送信可）', session.page);

      const submitResponse = session.page.waitForResponse(
        (response) => response.url().endsWith(`/api/proposals/${proposalId}/submit`) && response.request().method() === 'POST',
      );
      await submitButton.click();
      const submitted = await submitResponse;
      // 🔴 202 = 受け付け（200 にすると「送った」と読める）。本文の契約は下の API 直叩きで確かめる。
      expect(submitted.status()).toBe(202);
      const result = session.page.getByTestId('proposal-approval-result');
      await expect(result).toHaveAttribute('data-result', 'SUBMIT_REQUESTED');
      await expect(result).toContainText(t('proposals.approval.action.submitRequested'));
      // 🔴 「送信済み」と見せない。「送信する」も二重に押せない。
      expect(await session.page.content()).not.toContain(t('proposals.approval.state.submitted.prefix'));
      await expect(session.page.getByTestId('proposal-approval-submit')).toHaveCount(0);
      await expect(approvalScreen).toHaveAttribute('data-proposal-state', 'APPROVED');
      await expectNoHorizontalOverflow('S-021 提案の承認（送信受け付け後）', session.page);
      await expectNoBrokenLabels('S-021 提案の承認（送信受け付け後）', session.page);

      // 🔴 2 回目の #43（二重押下 / 別タブ）は同じ attemptSeq・同じ jobId で 202 になり、BullMQ が 1 本に畳む（F-022 AC-1 の入口側。
      //    ジョブ側の「外部 1 回」は結合テスト）。
      const again = await apiRequest(session.page, `/api/proposals/${proposalId}/submit`, { method: 'POST' });
      expect(again.status, again.text).toBe(202);
      const submitBody = parseJson(again) as { outcome: string; attemptSeq: number; state: string; jobId: string | null; sendHoldReasonKey: string | null };
      expect(submitBody).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1, state: 'APPROVED', sendHoldReasonKey: null });
      expect(submitBody.jobId).toBe(`send.proposal.${proposalId}.1`);
      // 🔴 取引先（作成者ではないが、取引先ロールは #43 を呼べない）は 403。#44 も同じ（T-09-08）。
      const partnerSession = await openTenantSession(browser, partnerSales(1, 1));
      try {
        const forbidden = await apiRequest(partnerSession.page, `/api/proposals/${proposalId}/submit`, { method: 'POST' });
        expect(forbidden.status, forbidden.text).toBe(403);
        const forbiddenResend = await apiRequest(partnerSession.page, `/api/proposals/${proposalId}/resend`, {
          method: 'POST',
          body: { acknowledged: true, reason: 'T0903 取引先からの再送は通らない' },
        });
        expect(forbiddenResend.status, forbiddenResend.text).toBe(403);
        // 🔴 `S-022` にも到達しない（ホームへ戻される。`docs/04` §S-022 権限差分）。
        await partnerSession.page.goto('/proposals/send-failures', { waitUntil: 'domcontentloaded' });
        await expect(partnerSession.page.getByTestId('send-failure-screen')).toHaveCount(0);
        await expect(partnerSession.page.getByRole('heading', { name: t('home.title') })).toBeVisible();
      } finally {
        await partnerSession.close();
      }
      // 🔴 外部への発信は 0 件（#43 は積むだけ。ブラウザ経路の送信の確定は T-09-11 が worker を立てて確かめる）。
      session.outbound.assertNone();

      // ✅ T-09-08: 🔴 **送信失敗（`SUBMIT_FAILED`）→ `S-022` → 確認ステップを経た人手再送（#44）**（docs/05 §6.5 #44 / §10.6 /
      //    `F-023 AC-1`〜`AC-3` / `docs/04` §S-022）。モバイルでも 1 件ずつの再送は可能（Tier 2。確認ステップは省略しない）。
      //    前提: ハーネスに worker が無いため、「応答不明で `SUBMIT_FAILED` に確定した」状態はシーム（`settleProposalSendAsFailedForE2e`。
      //    送信ジョブの ⑥ と同じ列）で作る。ジョブ本体は `tests/isolation/send-proposal.test.ts` / `proposal-resend.test.ts` の射程。
      //    ここで確かめるのは:
      //    ① `S-021` は `SUBMIT_FAILED` で「送信する」を出さず、再送ボタンも置かず、`S-022` への導線だけを描く
      //    ② `S-022` に行が出て、**応答不明が「失敗」と別の語・別の印**で描かれる。一括再送・自動再送の語が無い
      //    ③ 🔴 #44 は `acknowledged: false` なら 400 `RESEND_NOT_ACKNOWLEDGED`（`F-023 AC-2`）
      //    ④ 🔴 「再送する」→ 確認ステップ（**届いている可能性があります** + 提案先・単価・最終試行の再掲）→ チェック + 理由が揃うまで
      //       送れない → 202（`attemptSeq: 2` / `state: 'APPROVED'`）→ `S-021` へ戻る。「送信済み」と見せない。外部 0
      //    ⑤ 再送後（`APPROVED`）にもう一度 #44 を叩くと 422（`SUBMIT_FAILED` からしか戻せない）
      settleProposalSendAsFailedForE2e(proposalId);
      await session.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      const failedScreen = session.page.getByTestId('proposal-approval');
      await expect(failedScreen).toHaveAttribute('data-proposal-state', 'SUBMIT_FAILED');
      await expect(session.page.getByTestId('proposal-approval-notice')).toHaveAttribute('data-disposition', 'SUBMIT_FAILED');
      await expect(session.page.getByTestId('proposal-approval-submit')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      await expect(session.page.locator('[data-testid*="resend"]')).toHaveCount(0);
      const openSendFailures = session.page.getByTestId('proposal-approval-open-send-failures');
      await expect(openSendFailures).toBeVisible();
      await expect(openSendFailures).toHaveText(t('proposals.approval.action.openSendFailures'));
      await openSendFailures.click();
      await session.page.waitForURL('**/proposals/send-failures');

      const sendFailureScreen = session.page.getByTestId('send-failure-screen');
      await expect(sendFailureScreen).toBeVisible();
      await expect(sendFailureScreen).toHaveAttribute('data-can-resend', 'true');
      const failureRow = session.page.getByTestId(`send-failure-row-${proposalId}`);
      await expect(failureRow).toBeVisible();
      await expect(failureRow).toHaveAttribute('data-delivery-unknown', 'true');
      await expect(failureRow).toHaveAttribute('data-failure-category', 'UNKNOWN');
      await expect(session.page.getByTestId(`send-failure-kind-${proposalId}`)).toHaveText(t('sendFailures.failureKind.UNKNOWN'));
      await expect(session.page.getByTestId(`send-failure-recipient-${proposalId}`)).toContainText('T0903 架空エンド株式会社');
      // 🔴 一括再送・自動再送・force / override に相当する導線・語が無い（`F-023 AC-1` / `BR-50`）。
      await expect(session.page.locator('[data-testid*="bulk"], [data-testid*="force"], [data-testid*="override"], [data-testid*="auto"]')).toHaveCount(0);
      expect(await session.page.content()).not.toMatch(/一括再送|自動再送|自動で再送|無視して|再試行/);
      expectNoHiddenCountHints('S-022 送信失敗一覧（モバイル）', await session.page.locator('body').innerText());
      await expectNoHorizontalOverflow('S-022 送信失敗一覧', session.page);
      await expectNoBrokenLabels('S-022 送信失敗一覧', session.page);

      // ③ 確認を経ない #44 は 400（状態は動かない）。
      const notAcknowledged = await apiRequest(session.page, `/api/proposals/${proposalId}/resend`, {
        method: 'POST',
        body: { acknowledged: false, reason: 'T0903 確認していない' },
      });
      expect(notAcknowledged.status, notAcknowledged.text).toBe(400);
      expect((parseJson(notAcknowledged) as { error: { code: string } }).error.code).toBe('RESEND_NOT_ACKNOWLEDGED');

      // ④ 行を選ぶ → 詳細（応答不明の注記）→「再送する」→ 確認ステップ。
      await failureRow.click();
      const detail = session.page.getByTestId('send-failure-detail');
      await expect(detail).toBeVisible();
      await expect(detail).toHaveAttribute('data-failure-category', 'UNKNOWN');
      await expect(session.page.getByTestId('send-failure-detail-notes')).toContainText(t('sendFailures.note.unknown'));
      await expect(session.page.getByTestId('send-failure-resend-confirm')).toHaveCount(0);
      await session.page.getByTestId('send-failure-resend').click();
      const confirm = session.page.getByTestId('send-failure-resend-confirm');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText(t('sendFailures.resend.confirmTitle'));
      await expect(confirm).toContainText('届いている可能性');
      const recap = session.page.getByTestId('send-failure-resend-recap');
      await expect(recap).toContainText('T0903 架空エンド株式会社');
      await expect(recap).toContainText('700,000');
      const resendSubmit = session.page.getByTestId('send-failure-resend-submit');
      await expect(resendSubmit).toBeDisabled();
      await session.page.getByTestId('send-failure-resend-acknowledge').check();
      await expect(resendSubmit).toBeDisabled();
      await session.page.getByTestId('send-failure-resend-reason').fill('T0903 先方に電話で未着を確認した');
      await expect(resendSubmit).toBeEnabled();
      await expectNoBrokenLabels('S-022 再送の確認ステップ', session.page);

      // 🔴 202 の本文は `page.route` で受け止めて読む —— 画面は 202 の直後に `S-021` へ遷移するため、`waitForResponse` で
      //    掴んだ応答の本文を後から読むと（遷移で解放されて）取得が返らない。`route.fetch()` は同一オリジンの API を
      //    ブラウザの経路で実行するだけであり、外部発信の監視（`session.outbound`）の対象外である。
      type ResendBody = { outcome: string; attemptSeq: number; state: string; jobId: string | null; sendHoldReasonKey: string | null };
      const captured: { status: number; body: ResendBody | null } = { status: 0, body: null };
      const resendApiUrl = `**/api/proposals/${proposalId}/resend`;
      await session.page.route(resendApiUrl, async (route) => {
        const response = await route.fetch();
        captured.status = response.status();
        captured.body = (await response.json()) as ResendBody;
        await route.fulfill({ response });
      });
      await resendSubmit.click();
      // 202 の後は S-021 へ。状態は APPROVED（SUBMITTING に入れるのはジョブ）。「送信済み」と見せない。
      await session.page.waitForURL(`**/proposals/${proposalId}/approve`);
      await session.page.unroute(resendApiUrl);
      expect(captured.status).toBe(202);
      expect(captured.body).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, state: 'APPROVED', sendHoldReasonKey: null });
      expect(captured.body?.jobId).toBe(`send.proposal.${proposalId}.2`);
      await expect(session.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'APPROVED');
      expect(await session.page.content()).not.toContain(t('proposals.approval.state.submitted.prefix'));
      await expect(session.page.getByTestId('proposal-approval-open-send-failures')).toHaveCount(0);
      session.outbound.assertNone();

      // ⑤ APPROVED にもう一度 #44 → 422（SUBMIT_FAILED からしか戻せない）。
      const notFailed = await apiRequest(session.page, `/api/proposals/${proposalId}/resend`, {
        method: 'POST',
        body: { acknowledged: true, reason: 'T0903 二度目' },
      });
      expect(notFailed.status, notFailed.text).toBe(422);
      expect((parseJson(notFailed) as { error: { code: string } }).error.code).toBe('INVALID_STATE_TRANSITION');
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
