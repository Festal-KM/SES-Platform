// tests/e2e/home.mobile.spec.ts
// モバイルビューポートのスモーク（`CLAUDE.md` §13.3 / docs/03 §4.17 /
// docs/sprints/SP-03-auth-audit-admin0.md §5 テスト計画の E2E 行）。
//
// 🔴 本ファイルの起点は**基盤の確立**（Phase 0: `S-003` / `S-004` が T1 として破綻しない）だった。
//    ✅ **T-09-03（SP-09）で承認画面 `S-021` ができ、`CLAUDE.md` §13.3 が要求する「モバイルでの承認フロー」
//    （`F-021 AC-4` / `AC-6` / docs/05 §17.3 #13 / `.claude/agents/e2e-tester.md` シナリオ #14）をホストの test に足した**
//    （test の本数は増やさない。`expectNoBrokenLabels` / `expectNoHiddenCountHints` を同じ画面で呼ぶ）。
//    ✅ **T-09-04 で E2E #10（承認後に内容を変更できない。docs/05 §17.3 #10）を同じ test の続きに足した**（承認直後の
//    状態をそのまま使う）。
//    ✅ **T-09-06 で承認後の primary「送信する」（#43）を同じ test の続きに足した**（docs/05 §6.5 #43 / §10.2）。
//    ✅ **T-09-08 で送信失敗 → `S-022` → 確認ステップを経た人手再送（#44）を同じ test の続きに足した**（docs/05 §6.5 #44 / §10.6 /
//    `F-023`）。
//    ✅ **T-09-11 で E2E ハーネスに worker が入った**（`harness/worker.ts`。Issue #47 の既定値）。それまで `harness/db-admin.ts` の
//    シーム（`settleProposalGateAsPassedForE2e` / `settleProposalSendAsFailedForE2e` / `settleProposalSendAsSucceededForE2e`）で
//    **作っていた前提は、すべてブラウザ経路の本物に置き換えた**: ゲートは #39 → `gate.run`（モック AI + 機械的検出）、送信失敗は
//    宛先ドメイン `E2E_UNKNOWN_ONCE_RECIPIENT_DOMAIN`（試行 1 が応答不明）→ `send.proposal` の ⑤⑥、送信済みは #43 → `send.proposal`。
//    🔴 判断材料の判定（`S-021`）は `support/proposal-flow.ts` の `expectApprovalJudgmentMaterial` の 1 実装であり、
//    `proposal-cycle.spec.ts` シナリオ 5（iPhone 15）と同じ関数を呼ぶ（同じ検証を 2 箇所に書かない）。冪等性（#7 / #8 / #9）と
//    承認の無効化の送信側（#10）の**契約そのもの**は `proposal-cycle.spec.ts` が表明し、本ファイルは**モバイルでの通し**を見る。
//
// 🔴 「モバイルだから省略する」を作らない（`CLAUDE.md` §13.3）。サインイン（2 要素認証を含む）が
//    モバイルで完結することを、デスクトップと同じ経路で確かめる。
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { deleteT0903SyntheticProposals, T0903_SYNTHETIC_PROPOSAL_PREFIX } from './harness/db-admin';
import { E2E_UNKNOWN_ONCE_RECIPIENT_DOMAIN } from './harness/worker';
import { apiRequest, parseJson } from './support/api';
import { expectApprovalJudgmentMaterial, waitForProposalState } from './support/proposal-flow';
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

/**
 * ✅ T-09-11: 前提づくり「送信済み（`SUBMITTED`）」を worker の実経路で作る（API 直叩き + 確定待ち）。
 *   作成者のセッションで #39（レビュー依頼）→ `gate.run` が全層 PASS → ホストのセッションで #41（承認）→ #43（送信）→
 *   `send.proposal` が `SUBMITTED` に確定。🔴 状態を直接書かない（シームは削除済み）。
 */
async function sendViaWorker(creatorPage: Page, hostPage: Page, proposalId: string): Promise<void> {
  const requestedGate = await apiRequest(creatorPage, `/api/proposals/${proposalId}/gate`, { method: 'POST' });
  expect(requestedGate.status, requestedGate.text).toBe(202);
  await waitForProposalState(creatorPage, proposalId, ['APPROVAL_PENDING', 'GATE_FAILED'], { label: `gate ${proposalId}` });
  const approved = await apiRequest(hostPage, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
  expect(approved.status, approved.text).toBe(200);
  const requestedSend = await apiRequest(hostPage, `/api/proposals/${proposalId}/submit`, { method: 'POST' });
  expect(requestedSend.status, requestedSend.text).toBe(202);
  const sent = await waitForProposalState(hostPage, proposalId, ['SUBMITTED', 'SUBMIT_FAILED'], { label: `send ${proposalId}` });
  expect(sent.state).toBe('SUBMITTED');
}

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
      //    前提: ホストが自社エンジニアで提案を作り（#36）、#39 でレビューに出し、worker の `gate.run` が全層 PASS にする
      //    （✅ T-09-11。シームは無い）。🔴 宛先は「試行 1 が応答不明になる」合成ドメイン —— 後段の T-09-08（`S-022` → 人手再送）の
      //    前提「送信失敗」をブラウザ経路の本物で作るため（`harness/worker.ts`）。
      const ids = tenantIds(1);
      const subject = `${T0903_SYNTHETIC_PROPOSAL_PREFIX}${String(Date.now())}`;
      const body = 'T0903 ご提案します。設計から運用まで一貫して担当できます。';
      const created = await apiRequest(session.page, '/api/proposals', {
        method: 'POST',
        body: {
          projectId: ids.publishedProjectId,
          engineerId: ids.hostEngineerId,
          recipientCompanyName: 'T0903 架空エンド株式会社',
          recipientEmail: `t0903-recipient@${E2E_UNKNOWN_ONCE_RECIPIENT_DOMAIN}`,
          offeredUnitPrice: 700000,
          offeredStartDate: '2026-11-01',
          subject,
          body,
        },
      });
      expect(created.status, created.text).toBe(201);
      const proposalId = (parseJson(created) as { id: string }).id;
      syntheticProposalIds.push(proposalId);
      const requestedGate = await apiRequest(session.page, `/api/proposals/${proposalId}/gate`, { method: 'POST' });
      expect(requestedGate.status, requestedGate.text).toBe(202);
      await waitForProposalState(session.page, proposalId, ['APPROVAL_PENDING', 'GATE_FAILED'], { label: 'T-09-03 のゲート' });
      const gate = await apiRequest(session.page, `/api/proposals/${proposalId}/gate`);
      expect(gate.status, gate.text).toBe(200);
      const { contentHash } = parseJson(gate) as { contentHash: string };

      await session.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      const screen = session.page.getByTestId('proposal-approval');
      await expect(screen).toHaveAttribute('data-proposal-state', 'APPROVAL_PENDING');
      await expect(screen).toHaveAttribute('data-can-approve', 'true');

      // 🔴 `F-021 AC-4` / `AC-6`: 判断材料が**同一画面に、省略されずに**描かれ、一括承認・force / override が無い
      //    （判定は `support/proposal-flow.ts` の 1 実装。iPhone 15 は `proposal-cycle.spec.ts` シナリオ 5 が同じ関数で見る）。
      await expectApprovalJudgmentMaterial(session.page, { recipientCompanyName: 'T0903 架空エンド株式会社', unitPriceText: '700,000', body });
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
      //    ③✅ T-09-11: 確定は worker の送信ジョブが行う。この提案の宛先は「試行 1 が応答不明」の合成ドメインなので、
      //       `SUBMITTING → SUBMIT_FAILED`（`SendAttempt(1) = UNKNOWN`）に確定する（T-09-08 の前提をブラウザ経路の本物で作る）
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
      await expectNoHorizontalOverflow('S-021 提案の承認（送信受け付け後）', session.page);
      await expectNoBrokenLabels('S-021 提案の承認（送信受け付け後）', session.page);

      // ✅ T-09-11: worker が確定させる。宛先ドメインにより応答不明 → `SUBMIT_FAILED`（試行 1 = `UNKNOWN`）。冪等性（2 回起動で外部 1 回）の
      //    契約は `proposal-cycle.spec.ts` シナリオ 3 が表明する（ここでは繰り返さない）。
      const failed = await waitForProposalState(session.page, proposalId, ['SUBMIT_FAILED', 'SUBMITTED'], { label: 'T-09-06 の送信' });
      expect(failed.state).toBe('SUBMIT_FAILED');
      expect(failed.sendAttempts).toEqual([expect.objectContaining({ attemptSeq: 1, status: 'UNKNOWN' })]);
      // `S-021` のポーリング（#46）が確定を拾う。
      await expect(approvalScreen).toHaveAttribute('data-proposal-state', 'SUBMIT_FAILED', { timeout: 20_000 });
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
      // 🔴 ブラウザからの外部への発信は 0 件（送信はモック。worker 側の遮断は `harness/worker.ts`）。
      session.outbound.assertNone();

      // ✅ T-09-08: 🔴 **送信失敗（`SUBMIT_FAILED`）→ `S-022` → 確認ステップを経た人手再送（#44）**（docs/05 §6.5 #44 / §10.6 /
      //    `F-023 AC-1`〜`AC-3` / `docs/04` §S-022）。モバイルでも 1 件ずつの再送は可能（Tier 2。確認ステップは省略しない）。
      //    前提の「応答不明で `SUBMIT_FAILED` に確定した」は上で worker が本物で作った（✅ T-09-11。シームは無い）。
      //    ここで確かめるのは:
      //    ① `S-021` は `SUBMIT_FAILED` で「送信する」を出さず、再送ボタンも置かず、`S-022` への導線だけを描く
      //    ② `S-022` に行が出て、**応答不明が「失敗」と別の語・別の印**で描かれる。一括再送・自動再送の語が無い
      //    ③ 🔴 #44 は `acknowledged: false` なら 400 `RESEND_NOT_ACKNOWLEDGED`（`F-023 AC-2`）
      //    ④ 🔴 「再送する」→ 確認ステップ（**届いている可能性があります** + 提案先・単価・最終試行の再掲）→ チェック + 理由が揃うまで
      //       送れない → 202（`attemptSeq: 2`）→ `S-021` へ戻る → worker が seq 2 を送って `SUBMITTED`（試行 `[UNKNOWN(1), SUCCEEDED(2)]`）
      //    ⑤ 再送後にもう一度 #44 を叩くと 422（`SUBMIT_FAILED` からしか戻せない）

      // ✅ T-09-09: 🔴 **`S-019`（提案一覧）→ `S-023`（詳細と履歴）→ メモ追加（#47）→ `S-022` への導線**（docs/05 §6.5 #45 / #46 / #47 /
      //    `F-024 AC-2` / `docs/04` §S-019 / §S-023）。Tier 2 だがモバイルで破綻しないことも同じ画面で見る。
      //    ① `S-019`: 4 つの「うまくいかなかった」が**別のチップ**（`GATE_FAILED` / `SUBMIT_FAILED` / `LOST` の 3 チップ + 提案依頼の
      //       `DECLINED` は**別ブロック**）。`SUBMIT_FAILED` の行は `data-failure-kind="SUBMIT_FAILED"` で、`S-022` への導線が出る
      //    ② 行 → `S-023`。状態は `SUBMIT_FAILED`、履歴に作成・承認・送信失敗が別の kind で描かれ、`S-022` への導線がある
      //    ③ メモを追加（#47）→ 201 → 履歴に `NOTE` の行が現れ、🔴 **状態は `SUBMIT_FAILED` のまま**（メモは状態を動かさない）
      //    ④ `S-023` の導線から `S-022` へ（以降は T-09-08 の流れ = `S-021` から入り直す）
      await session.page.goto('/proposals', { waitUntil: 'domcontentloaded' });
      const listScreen = session.page.getByTestId('proposal-list-screen');
      await expect(listScreen).toHaveAttribute('data-audience', 'HOST');
      for (const state of ['GATE_FAILED', 'SUBMIT_FAILED', 'LOST', 'WITHDRAWN']) {
        await expect(session.page.getByTestId(`proposal-list-state-chip-${state}`)).toBeVisible();
      }
      await expect(session.page.getByTestId('proposal-list-state-chip-SUBMIT_FAILED')).toHaveAttribute('data-failure-kind', 'SUBMIT_FAILED');
      await expect(session.page.getByTestId('proposal-list-state-chip-LOST')).toHaveAttribute('data-failure-kind', 'LOST');
      await expect(session.page.getByTestId('proposal-list-state-chip-GATE_FAILED')).toHaveAttribute('data-failure-kind', 'GATE_FAILED');
      // 提案依頼の `DECLINED` は提案のチップに無く、別ブロックにだけある。
      await expect(session.page.getByTestId('proposal-list-state-chip-DECLINED')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-list-request-chip-DECLINED')).toBeVisible();
      await expect(session.page.getByTestId('proposal-list-request-chip-DECLINED')).toHaveText(new RegExp(t('proposals.list.requestState.DECLINED')));
      const listRow = session.page.getByTestId(`proposal-list-row-${proposalId}`);
      await expect(listRow).toBeVisible();
      await expect(listRow).toHaveAttribute('data-state', 'SUBMIT_FAILED');
      await expect(listRow).toHaveAttribute('data-failure-kind', 'SUBMIT_FAILED');
      await expect(listRow).toHaveAttribute('data-send-hold', '');
      await expect(session.page.getByTestId('proposal-list-open-send-failures')).toHaveAttribute('href', '/proposals/send-failures');
      // 🔴 一括承認・一括送信・自動再送の語・testid が無い（`BR-50`）。
      await expect(session.page.locator('[data-testid*="bulk"], [data-testid*="force"], [data-testid*="override"]')).toHaveCount(0);
      expect(await session.page.content()).not.toMatch(/一括承認|一括送信|自動再送|無視して/);
      expectNoHiddenCountHints('S-019 提案一覧（モバイル）', await session.page.locator('body').innerText());
      await expectNoHorizontalOverflow('S-019 提案一覧', session.page);
      await expectNoBrokenLabels('S-019 提案一覧', session.page);

      // ② 行 → S-023。
      await session.page.getByTestId(`proposal-list-link-${proposalId}`).click();
      await session.page.waitForURL(`**/proposals/${proposalId}`);
      const detailScreen = session.page.getByTestId('proposal-detail');
      await expect(detailScreen).toHaveAttribute('data-proposal-state', 'SUBMIT_FAILED');
      await expect(detailScreen).toHaveAttribute('data-failure-kind', 'SUBMIT_FAILED');
      await expect(detailScreen).toHaveAttribute('data-can-add-note', 'true');
      await expect(session.page.getByTestId('proposal-detail-fixed-recipient')).toContainText('T0903 架空エンド株式会社');
      await expect(session.page.getByTestId('proposal-detail-fixed-unit-price')).toContainText('700,000');
      await expect(session.page.getByTestId('proposal-detail-timeline').locator('[data-event-kind="CREATED"]')).toHaveCount(1);
      await expect(session.page.getByTestId('proposal-detail-timeline').locator('[data-event-kind="APPROVAL"]')).toHaveCount(1);
      await expect(session.page.getByTestId('proposal-detail-timeline').locator('[data-event-kind="NOTE"]')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-detail-send-attempts')).toBeVisible();
      await expect(session.page.getByTestId('proposal-detail-action-link-SEND_FAILURES')).toHaveAttribute('href', '/proposals/send-failures');
      await expect(session.page.locator('[data-testid*="resend"]')).toHaveCount(0);
      expect(await session.page.content()).not.toMatch(/無視して|最新の情報に更新/);
      expectNoHiddenCountHints('S-023 提案の詳細（モバイル）', await session.page.locator('body').innerText());
      await expectNoHorizontalOverflow('S-023 提案の詳細と履歴', session.page);
      await expectNoBrokenLabels('S-023 提案の詳細と履歴', session.page);

      // ③ メモを追加（#47）。状態は動かない。
      const noteText = 'T0903 先方に電話で未着を確認する予定';
      const noteResponse = session.page.waitForResponse(
        (response) => response.url().endsWith(`/api/proposals/${proposalId}/events`) && response.request().method() === 'POST',
      );
      await session.page.getByTestId('proposal-detail-note-input').fill(noteText);
      await session.page.getByTestId('proposal-detail-note-submit').click();
      expect((await noteResponse).status()).toBe(201);
      await expect(session.page.getByTestId('proposal-detail-note-added')).toBeVisible();
      const noteRow = session.page.getByTestId('proposal-detail-timeline').locator('[data-event-kind="NOTE"]');
      await expect(noteRow).toHaveCount(1);
      await expect(noteRow).toContainText(noteText);
      await expect(detailScreen).toHaveAttribute('data-proposal-state', 'SUBMIT_FAILED');
      // 🔴 #46（API 直叩き）でも状態は SUBMIT_FAILED のまま、履歴に NOTE が 1 件。
      const detailApi = await apiRequest(session.page, `/api/proposals/${proposalId}`);
      expect(detailApi.status, detailApi.text).toBe(200);
      const detailBody = parseJson(detailApi) as { state: string; events: { entry: { kind: string } }[] };
      expect(detailBody.state).toBe('SUBMIT_FAILED');
      expect(detailBody.events.filter((event) => event.entry.kind === 'NOTE')).toHaveLength(1);
      session.outbound.assertNone();

      // ④ S-023 → S-022。
      await session.page.getByTestId('proposal-detail-action-link-SEND_FAILURES').click();
      await session.page.waitForURL('**/proposals/send-failures');
      await expect(session.page.getByTestId(`send-failure-row-${proposalId}`)).toBeVisible();

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
      // 202 の後は S-021 へ。#44 は積むだけ（202 の本文は `APPROVED`）。押した瞬間に「送信済み」と見せない。
      await session.page.waitForURL(`**/proposals/${proposalId}/approve`);
      await session.page.unroute(resendApiUrl);
      expect(captured.status).toBe(202);
      expect(captured.body).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, state: 'APPROVED', sendHoldReasonKey: null });
      expect(captured.body?.jobId).toBe(`send.proposal.${proposalId}.2`);
      await expect(session.page.getByTestId('proposal-approval-open-send-failures')).toHaveCount(0);
      // ✅ T-09-11: worker が seq 2 を送る（試行 2 は届く）。試行は `[UNKNOWN(1), SUCCEEDED(2)]` = 外部 2 回（自動の 3 回目は無い）。
      const resent = await waitForProposalState(session.page, proposalId, ['SUBMITTED', 'SUBMIT_FAILED'], { label: 'T-09-08 の再送' });
      expect(resent.state).toBe('SUBMITTED');
      expect(resent.sendAttempts.map((attempt) => [attempt.attemptSeq, attempt.status])).toEqual([
        [1, 'UNKNOWN'],
        [2, 'SUCCEEDED'],
      ]);
      // #44 の 202 後の `S-021` は送信中のポーリングを持たない（`proposal-cycle.spec.ts` シナリオ 3 の注記）。読み直して確定を見る。
      await session.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'SUBMITTED');
      await expectNoBrokenLabels('S-021 提案の承認（送信済み）', session.page);
      session.outbound.assertNone();

      // ⑤ SUBMITTED にもう一度 #44 → 422（SUBMIT_FAILED からしか戻せない）。
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
      //    ✅ T-11-11: `S-015` は 1 表 + 検索 3 条件 + 共有状態フィルタ（既定 `共有中` = `U-15`）になった。既定の URL で
      //    出る表の testid は `engineer-share-shared-table`（母集団 = 共有中）のまま。🔴 **検索 3 条件はモバイルでも
      //    省略されない**（`CLAUDE.md` §13.3 / `docs/04` §S-015 デバイス別）ので、入力欄 3 つの可視も併せて見る。
      await session.page.goto('/engineer-shares', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('engineer-share-screen')).toBeVisible();
      await expect(session.page.getByTestId('engineer-share-filter-q')).toBeVisible();
      await expect(session.page.getByTestId('engineer-share-filter-available-by')).toBeVisible();
      await expect(session.page.getByTestId('engineer-share-filter-shared')).toBeVisible();
      await expect(session.page.getByTestId('engineer-share-shared-table')).toBeVisible();
      await expect(
        session.page.getByTestId(`engineer-share-revoke-${partnerIds(1, 1).engineerId}`),
      ).toBeVisible();
      // 🔴 一括の入口（チェックボックス）が無い（`F-016 AC-1`）。
      await expect(session.page.locator('[data-testid="engineer-share-screen"] input[type="checkbox"]')).toHaveCount(0);
      await expectNoHorizontalOverflow('S-015 匿名共有の設定', session.page);
      await expectNoBrokenLabels('S-015 匿名共有の設定', session.page);
      // 🔴 共有の開始・停止は監査対象の実行系操作（`F-016 AC-4`）。スモークで動かさない。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});

// ✅ T-09-10: 🔴 **`S-024` 商談結果の記録がモバイルで完結する**（docs/04 §S-024〔Tier 1〕/ `F-025 AC-1`〜`AC-3` / docs/05 §6.5 #48 /
//    `CLAUDE.md` §13.1「面談日程の確定は移動中に発生する」/ §13.3）。
//    ビューポートは docs/05 §17.6 の `devices['iPhone 15']`（幅 393。`e2e-tester.md` シナリオ #14 と同じモバイル幅）。ブラウザは
//    本ファイルの他の test と同じ Chromium のまま（`__Host-` Cookie の理由。`playwright.config.ts` 冒頭）。
//    前提の「送信済み（`SUBMITTED`）」は ✅ T-09-11 で worker の実経路（#39 → `gate.run` → #41 → #43 → `send.proposal`）に置き換えた
//    （`sendViaWorker`）。🔴 **商談の記録そのもの（`SUBMITTED` 以降）は画面から人の操作で進める。**
test.describe('S-024 商談結果の記録（iPhone 15 / T1）', () => {
  // 🔴 `defaultBrowserType`（worker スコープ）は describe の `test.use` に置けない。コンテキストの寸法・UA・タッチだけを iPhone 15 にする
  //    （ブラウザは project の Chromium のまま）。
  test.use({
    viewport: devices['iPhone 15'].viewport,
    userAgent: devices['iPhone 15'].userAgent,
    deviceScaleFactor: devices['iPhone 15'].deviceScaleFactor,
    isMobile: devices['iPhone 15'].isMobile,
    hasTouch: devices['iPhone 15'].hasTouch,
  });

  test('ホストが S-024 で SUBMITTED → INTERVIEW_SCHEDULED → INTERVIEWED → RESULT_PENDING → WON を完遂する。取引先には日程の確定・結果の確定が無い', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      // 🔴 iPhone 15 のビューポート（幅 393）で走っている（`test.use` がコンテキストに効いていることの対照）。
      expect(session.page.viewportSize()?.width).toBe(devices['iPhone 15'].viewport.width);

      // 前提: 提案を作り（#36）、#39 → worker の `gate.run`（全層 PASS）→ 承認（#41。API 直叩き）→ #43 → worker の `send.proposal` → `SUBMITTED`。
      const ids = tenantIds(1);
      const subject = `${T0903_SYNTHETIC_PROPOSAL_PREFIX}T0910-${String(Date.now())}`;
      const created = await apiRequest(session.page, '/api/proposals', {
        method: 'POST',
        body: {
          projectId: ids.publishedProjectId,
          engineerId: ids.hostEngineerId,
          recipientCompanyName: 'T0910 架空エンド株式会社',
          recipientEmail: 't0910-recipient@example.test',
          offeredUnitPrice: 720000,
          offeredStartDate: '2026-11-01',
          subject,
          body: 'T0910 ご提案します。',
        },
      });
      expect(created.status, created.text).toBe(201);
      const proposalId = (parseJson(created) as { id: string }).id;
      syntheticProposalIds.push(proposalId);
      await sendViaWorker(session.page, session.page, proposalId);

      // 🔴 S-023 の商談中の導線が S-024 を指す（T-09-09 の申し送り 1）。
      await session.page.goto(`/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-detail')).toHaveAttribute('data-proposal-state', 'SUBMITTED');
      await session.page.getByTestId('proposal-detail-action-link-INTERVIEW').click();
      await session.page.waitForURL(`**/proposals/${proposalId}/interview`);

      const screen = session.page.getByTestId('proposal-interview');
      await expect(screen).toHaveAttribute('data-proposal-state', 'SUBMITTED');
      await expect(screen).toHaveAttribute('data-audience', 'HOST');
      await expect(screen).toHaveAttribute('data-can-record', 'true');
      // 🔴 判断材料（提案先 / エンジニア / 案件 / 単価 / 開始日 / 状態 / 直近の履歴）が同じ画面に、折りたたみ・タブ無しで出る。
      for (const field of ['recipient', 'engineer', 'project', 'unit-price', 'start-date', 'state']) {
        await expect(session.page.getByTestId(`proposal-interview-header-row-${field}`)).toBeVisible();
      }
      await expect(session.page.getByTestId('proposal-interview-header-row-recipient')).toContainText('T0910 架空エンド株式会社');
      await expect(session.page.getByTestId('proposal-interview-header-row-unit-price')).toContainText('720,000');
      await expect(session.page.getByTestId('proposal-interview-lead')).toContainText(t('proposals.interview.lead'));
      await expect(session.page.locator('details')).toHaveCount(0);
      await expect(session.page.locator('[role="tab"]')).toHaveCount(0);
      // 🔴 SUBMITTED では「面談日程を確定する」と「辞退を記録する」だけ。結果の確定・面談実施は出ない。
      await expect(session.page.getByTestId('proposal-interview-operation-SCHEDULE')).toBeVisible();
      await expect(session.page.getByTestId('proposal-interview-operation-WITHDRAWN')).toBeVisible();
      for (const kind of ['INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST']) {
        await expect(session.page.getByTestId(`proposal-interview-operation-${kind}`)).toHaveCount(0);
      }
      // 🔴 自動確定・一括に相当する導線・語が無い（`F-025 AC-1` / `BR-50`）。
      await expect(session.page.locator('[data-testid*="auto"], [data-testid*="bulk"], [data-testid*="expire"], [data-testid*="force"]')).toHaveCount(0);
      expect(await session.page.content()).not.toMatch(/自動的に|一括|期限で見送り/);
      expectNoHiddenCountHints('S-024 商談結果の記録（iPhone 15）', await session.page.locator('body').innerText());
      await expectNoHorizontalOverflow('S-024 商談結果の記録', session.page);
      await expectNoBrokenLabels('S-024 商談結果の記録', session.page);

      async function waitTransition(to: string): Promise<void> {
        const response = await session.page.waitForResponse(
          (candidate) => candidate.url().endsWith(`/api/proposals/${proposalId}/transition`) && candidate.request().method() === 'POST',
        );
        expect(response.status(), `→ ${to}`).toBe(200);
        await expect(session.page.getByTestId('proposal-interview-result')).toHaveAttribute('data-result', to);
        await expect(screen).toHaveAttribute('data-proposal-state', to);
      }

      // ① 面談日程の確定（日時が入るまで押せない。note は「面談日程: 2026-10-01 14:00」）。
      await session.page.getByTestId('proposal-interview-operation-SCHEDULE').click();
      const form = session.page.getByTestId('proposal-interview-form');
      await expect(form).toHaveAttribute('data-operation', 'SCHEDULE');
      await expect(session.page.getByTestId('proposal-interview-submit')).toBeDisabled();
      await session.page.getByTestId('proposal-interview-scheduled-at').fill('2026-10-01T14:00');
      await expect(session.page.getByTestId('proposal-interview-note-preview')).toHaveText('面談日程: 2026-10-01 14:00');
      await expect(session.page.getByTestId('proposal-interview-submit')).toBeEnabled();
      await expectNoBrokenLabels('S-024 面談日程の入力', session.page);
      const scheduled = waitTransition('INTERVIEW_SCHEDULED');
      await session.page.getByTestId('proposal-interview-submit').click();
      await scheduled;
      await expect(session.page.getByTestId('proposal-interview-operation-INTERVIEWED')).toBeVisible();
      await expect(session.page.getByTestId('proposal-interview-operation-SCHEDULE')).toHaveCount(0);
      // 直近の履歴に、いま記録した内容がそのまま出る。
      await expect(session.page.getByTestId('proposal-interview-recent')).toContainText('面談日程: 2026-10-01 14:00');

      // ② 面談実施（実施日 + 要点）。
      await session.page.getByTestId('proposal-interview-operation-INTERVIEWED').click();
      await expect(session.page.getByTestId('proposal-interview-form')).toHaveAttribute('data-operation', 'INTERVIEWED');
      await session.page.getByTestId('proposal-interview-interviewed-on').fill('2026-10-01');
      await session.page.getByTestId('proposal-interview-memo').fill('T0910 技術面は好評');
      await expect(session.page.getByTestId('proposal-interview-note-preview')).toHaveText('面談実施: 2026-10-01 / T0910 技術面は好評');
      const interviewed = waitTransition('INTERVIEWED');
      await session.page.getByTestId('proposal-interview-submit').click();
      await interviewed;

      // ③ 結果待ち（入力なし）。
      await session.page.getByTestId('proposal-interview-operation-RESULT_PENDING').click();
      await expect(session.page.getByTestId('proposal-interview-note-preview')).toHaveText(t('proposals.interview.notePreview.none'));
      const pending = waitTransition('RESULT_PENDING');
      await session.page.getByTestId('proposal-interview-submit').click();
      await pending;
      for (const kind of ['WON', 'LOST', 'WITHDRAWN']) {
        await expect(session.page.getByTestId(`proposal-interview-operation-${kind}`)).toHaveAttribute('data-terminal', 'true');
      }
      await expectNoHorizontalOverflow('S-024 結果待ち', session.page);
      await expectNoBrokenLabels('S-024 結果待ち', session.page);

      // ④ 決定（終端）: 🔴 確認ステップを経る。確認には提案先・単価と、履歴に残る文字列そのものが再掲される。
      await session.page.getByTestId('proposal-interview-operation-WON').click();
      await session.page.getByTestId('proposal-interview-memo').fill('T0910 11 月開始で合意');
      await session.page.getByTestId('proposal-interview-submit').click();
      const confirm = session.page.getByTestId('proposal-interview-confirm');
      await expect(confirm).toHaveAttribute('data-operation', 'WON');
      await expect(confirm).toContainText(t('proposals.interview.confirm.title'));
      await expect(session.page.getByTestId('proposal-interview-confirm-recap')).toContainText('T0910 架空エンド株式会社');
      await expect(session.page.getByTestId('proposal-interview-confirm-recap')).toContainText('720,000');
      await expect(session.page.getByTestId('proposal-interview-confirm-note')).toHaveText('結果: 決定（T0910 11 月開始で合意）');
      await expect(screen).toHaveAttribute('data-proposal-state', 'RESULT_PENDING');
      await expectNoBrokenLabels('S-024 決定の確認ステップ', session.page);
      const won = waitTransition('WON');
      await session.page.getByTestId('proposal-interview-confirm-submit').click();
      await won;
      // 🔴 WON は終端。操作は 0 個で、稼働の登録は Phase 2（`F-042`）の注記だけ（`Assignment` は作らない）。
      await expect(session.page.getByTestId('proposal-interview-closed')).toHaveAttribute('data-closed-state', 'WON');
      await expect(session.page.getByTestId('proposal-interview-won-note')).toBeVisible();
      await expect(session.page.locator('[data-testid^="proposal-interview-operation-"]')).toHaveCount(0);
      await expectNoHorizontalOverflow('S-024 決定後', session.page);
      await expectNoBrokenLabels('S-024 決定後', session.page);
      // 🔴 外部への発信は 0 件（面談調整の連絡 `F-041` は Phase 2。商談の記録はメールを送らない）。
      session.outbound.assertNone();

      // API 直叩き: 終端からの遷移は 422。#46 の履歴に 4 本の TRANSITION が S-024 の note 付きで残り、状態は WON。
      const afterWon = await apiRequest(session.page, `/api/proposals/${proposalId}/transition`, { method: 'POST', body: { to: 'LOST' } });
      expect(afterWon.status, afterWon.text).toBe(422);
      expect((parseJson(afterWon) as { error: { code: string } }).error.code).toBe('INVALID_STATE_TRANSITION');
      const detailApi = await apiRequest(session.page, `/api/proposals/${proposalId}`);
      expect(detailApi.status, detailApi.text).toBe(200);
      const detailBody = parseJson(detailApi) as {
        state: string;
        events: { fromState: string | null; toState: string | null; entry: { kind: string; note?: string | null } }[];
      };
      expect(detailBody.state).toBe('WON');
      const recorded = detailBody.events.filter(
        (event) => event.fromState !== null && ['INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON'].includes(event.toState ?? ''),
      );
      expect(recorded.map((event) => [event.toState, event.entry.kind, event.entry.note ?? null])).toEqual([
        ['INTERVIEW_SCHEDULED', 'TRANSITION', '面談日程: 2026-10-01 14:00'],
        ['INTERVIEWED', 'TRANSITION', '面談実施: 2026-10-01 / T0910 技術面は好評'],
        ['RESULT_PENDING', 'TRANSITION', null],
        ['WON', 'TRANSITION', '結果: 決定（T0910 11 月開始で合意）'],
      ]);
      // S-023 の履歴でも TRANSITION の連なりとして描かれる。✅ T-09-11: 前提を worker の実経路で作るようになったため、商談の 4 本に
      // 加えてゲート（`DRAFT → GATE_RUNNING → APPROVAL_PENDING`）と送信（`APPROVED → SUBMITTING → SUBMITTED`）の 4 本が履歴に残る（計 8 本。
      // 承認は `APPROVAL` の kind で別に描かれる）。
      await session.page.goto(`/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-detail')).toHaveAttribute('data-proposal-state', 'WON');
      await expect(session.page.getByTestId('proposal-detail-timeline').locator('[data-event-kind="TRANSITION"]')).toHaveCount(8);
      await expect(session.page.getByTestId('proposal-detail-timeline').locator('[data-event-kind="APPROVAL"]')).toHaveCount(1);
      await expect(session.page.getByTestId('proposal-detail-actions-empty')).toBeVisible();

      // 🔴 取引先: ホストの提案の S-024 には到達しない（404。存在も教えない）。自社の提案では日程の確定・結果の確定のボタンが無い。
      const partnerSession = await openTenantSession(browser, partnerSales(1, 1));
      try {
        await partnerSession.page.goto(`/proposals/${proposalId}/interview`, { waitUntil: 'domcontentloaded' });
        await expect(partnerSession.page.getByTestId('proposal-interview-not-found')).toBeVisible();
        await expect(partnerSession.page.getByTestId('proposal-interview')).toHaveCount(0);
        expect(await partnerSession.page.content()).not.toContain('T0910 架空エンド株式会社');
        const forbidden = await apiRequest(partnerSession.page, `/api/proposals/${proposalId}/transition`, { method: 'POST', body: { to: 'WITHDRAWN' } });
        expect(forbidden.status, forbidden.text).toBe(404);

        // 自社の提案（取引先が作成 → ホストが承認 → 送信済み）。
        const partnerCreated = await apiRequest(partnerSession.page, '/api/proposals', {
          method: 'POST',
          body: {
            projectId: ids.publishedProjectId,
            engineerId: partnerIds(1, 1).engineerId,
            recipientCompanyName: 'T0910 架空エンド株式会社',
            recipientEmail: 't0910-recipient@example.test',
            offeredUnitPrice: 680000,
            offeredStartDate: '2026-11-01',
            subject: `${T0903_SYNTHETIC_PROPOSAL_PREFIX}T0910-partner-${String(Date.now())}`,
            body: 'T0910 取引先からのご提案です。',
          },
        });
        expect(partnerCreated.status, partnerCreated.text).toBe(201);
        const partnerProposalId = (parseJson(partnerCreated) as { id: string }).id;
        syntheticProposalIds.push(partnerProposalId);
        // 取引先がレビューに出し（#39）、ホストが承認（#41）・送信（#43）。確定は worker（✅ T-09-11）。
        await sendViaWorker(partnerSession.page, session.page, partnerProposalId);

        await partnerSession.page.goto(`/proposals/${partnerProposalId}/interview`, { waitUntil: 'domcontentloaded' });
        const partnerScreen = partnerSession.page.getByTestId('proposal-interview');
        await expect(partnerScreen).toHaveAttribute('data-proposal-state', 'SUBMITTED');
        await expect(partnerScreen).toHaveAttribute('data-audience', 'PARTNER');
        await expect(partnerSession.page.getByTestId('proposal-interview-partner-notice')).toBeVisible();
        await expect(partnerSession.page.getByTestId('proposal-interview-operation-WITHDRAWN')).toBeVisible();
        await expect(partnerSession.page.getByTestId('proposal-interview-operation-SCHEDULE')).toHaveCount(0);
        await expectNoHorizontalOverflow('S-024 商談結果の記録（取引先）', partnerSession.page);
        await expectNoBrokenLabels('S-024 商談結果の記録（取引先）', partnerSession.page);
        // 🔴 API 直叩きでも面談日程の確定は 403（導線を隠しているだけではない）。
        const partnerSchedule = await apiRequest(partnerSession.page, `/api/proposals/${partnerProposalId}/transition`, {
          method: 'POST',
          body: { to: 'INTERVIEW_SCHEDULED', note: '面談日程: 2026-10-02 10:00' },
        });
        expect(partnerSchedule.status, partnerSchedule.text).toBe(403);
        expect((parseJson(partnerSchedule) as { error: { code: string } }).error.code).toBe('PROPOSAL_TRANSITION_FORBIDDEN');
        // ホストが日程を確定すると、取引先の S-024 は面談実施 + 辞退になり、決定 / 見送りは出ない。
        const hostSchedule = await apiRequest(session.page, `/api/proposals/${partnerProposalId}/transition`, {
          method: 'POST',
          body: { to: 'INTERVIEW_SCHEDULED', note: '面談日程: 2026-10-02 10:00' },
        });
        expect(hostSchedule.status, hostSchedule.text).toBe(200);
        await partnerSession.page.reload({ waitUntil: 'domcontentloaded' });
        await expect(partnerScreen).toHaveAttribute('data-proposal-state', 'INTERVIEW_SCHEDULED');
        await expect(partnerSession.page.getByTestId('proposal-interview-operation-INTERVIEWED')).toBeVisible();
        await expect(partnerSession.page.getByTestId('proposal-interview-operation-WITHDRAWN')).toBeVisible();
        for (const kind of ['SCHEDULE', 'WON', 'LOST']) {
          await expect(partnerSession.page.getByTestId(`proposal-interview-operation-${kind}`)).toHaveCount(0);
        }
        partnerSession.outbound.assertNone();
      } finally {
        await partnerSession.close();
      }
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
