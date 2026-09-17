// tests/e2e/proposal-cycle.spec.ts
// 🔴 **Phase 1 成功条件 1・2 の E2E**（T-09-11。`CLAUDE.md` §5 Phase 1 / docs/05 §17.3 #3 / #4 / #7 / #8 / #9 / #10 / #13 / §12.1 / §17.5 /
//    `docs/sprints/SP-09-proposal-flow.md` §T-09-11）。
//
// ============================================================================
// 🔴 ハーネスに worker が入った（`harness/worker.ts`。Issue #47 の既定値 = 選択肢 1）
// ============================================================================
//   `gate.run`（モック AI = `DEMO_MOCK_ANTHROPIC_SCRIPT` の全層 PASS + **機械的検出**）と `send.proposal`（モックのメール）が
//   ブラウザ経路で**実際に走る**。本 spec は `harness/db-admin.ts` の「状態を書くシーム」を 1 つも使わない（削除済み）。
//   使うのは「API を通らない経路の模擬」2 つ（送信元ドメインの検証 = E2E #9 / 承認後の `content_hash` のずれ = E2E #10）と後始末だけ。
//   理由は各シナリオに書く。
//
// ============================================================================
// 🔴 SP-07 から引き継ぐ 3 本は**結合層**にあり、ここに書き写さない（同じ検証を 2 箇所に書かない）
// ============================================================================
//   - #4 の案件公開分（公開のゲート FAIL）… `tests/isolation/project-publish-gate.test.ts`（提案分は本 spec シナリオ 2 でブラウザ経路）
//   - #18 プロンプトインジェクション … `tests/isolation/gate-run.test.ts`（`packages/ai/src/untrusted.ts` の境界。判定は変わらない）
//   - #23 前半 AI 上限と HELD … `tests/isolation/gate-hold-release.test.ts`（`S-038` の残量表示は SP-10 / SP-11）
//   同様に、`send.settle-unknown`（⑤ の後のプロセス消失）はブラウザ経路で再現できないため `tests/isolation/send-proposal-unknown.test.ts` ③。
//
// 🔴 外部への発信は 0 件（`session.outbound.assertNone()` + ハーネスの遮断フック〔web / worker の両プロセス〕）。
//    「外部 1 回」の掴み手は `send_attempts`（#46 の `sendAttempts`）である —— 送信ジョブは予約（④）を経ないと外部を呼べず
//    （`EmailSendInput.token` が必須。docs/05 §10.2）、同じ `attemptSeq` の 2 本目は ④ で `ALREADY_RESERVED` になって外部を呼ばない。
//    したがって「試行が 1 行 = 外部 ≤ 1 回」であり、`callCount()`（worker プロセス内。spec からは読めない）は
//    `tests/isolation/send-proposal.test.ts` ① が同じ実装で固定している。
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import {
  deleteT0911SyntheticProjects,
  deleteT0911SyntheticProposals,
  registerVerifiedSendingDomainForE2e,
  shiftProposalContentHashForE2e,
  T0911_SYNTHETIC_PROJECT_PREFIX,
  T0911_SYNTHETIC_PROPOSAL_PREFIX,
} from './harness/db-admin';
import { E2E_VERIFIED_SENDING_DOMAIN } from './harness/sending-domain';
import { E2E_UNKNOWN_ONCE_RECIPIENT_DOMAIN } from './harness/worker';
import { apiRequest, parseJson } from './support/api';
import { expectNoBrokenLabels, expectNoHiddenCountHints, expectNoHorizontalOverflow } from './support/assertions';
import { partnerIds, tenantIds, type TenantIndex } from './support/population';
import {
  approveOnScreen,
  errorCodeOf,
  expectApprovalJudgmentMaterial,
  readGateResult,
  readProposalDetail,
  requestSubmitOnScreen,
  waitForProposalState,
  waitForSendHold,
  type SendRequestBody,
} from './support/proposal-flow';
import { hostOwner, openTenantSession, partnerSales, type Session } from './support/sessions';

/** 合成データ（後始末で消す。`isolation.spec.ts` は母集団を seed で表明する）。 */
const syntheticProposalIds: string[] = [];
const syntheticProjectIds: string[] = [];

test.afterAll(() => {
  deleteT0911SyntheticProposals(syntheticProposalIds);
  deleteT0911SyntheticProjects(syntheticProjectIds);
});

const RECIPIENT_COMPANY = 'T0911 架空エンド株式会社';
const RECIPIENT_EMAIL = 't0911-recipient@example.test';
/** 🔴 E2E #8 用: 試行 1 は応答不明、試行 2 は届く（`harness/worker.ts`）。 */
const UNKNOWN_ONCE_RECIPIENT_EMAIL = `t0911-unknown@${E2E_UNKNOWN_ONCE_RECIPIENT_DOMAIN}`;
const CLEAN_BODY = 'T0911 ご提案します。設計から運用まで一貫して担当できます。合成データです。';

function subjectOf(tag: string): string {
  return `${T0911_SYNTHETIC_PROPOSAL_PREFIX}${tag}-${String(Date.now())}`;
}

/** #36（API 直叩き）。シナリオ 1 以外の**前提づくり**に使う（シナリオ 1 は画面から作る）。 */
async function createProposalViaApi(
  page: Page,
  input: { readonly tenant: TenantIndex; readonly tag: string; readonly body?: string; readonly recipientEmail?: string; readonly unitPrice?: number },
): Promise<string> {
  const ids = tenantIds(input.tenant);
  const created = await apiRequest(page, '/api/proposals', {
    method: 'POST',
    body: {
      projectId: ids.publishedProjectId,
      engineerId: ids.hostEngineerId,
      recipientCompanyName: RECIPIENT_COMPANY,
      recipientEmail: input.recipientEmail ?? RECIPIENT_EMAIL,
      offeredUnitPrice: input.unitPrice ?? 700000,
      offeredStartDate: '2026-11-01',
      subject: subjectOf(input.tag),
      body: input.body ?? CLEAN_BODY,
    },
  });
  expect(created.status, created.text).toBe(201);
  const id = (parseJson(created) as { id: string }).id;
  syntheticProposalIds.push(id);
  return id;
}

/** #39（レビュー依頼）→ worker の `gate.run` を待つ（全層 PASS なら `APPROVAL_PENDING`）。 */
async function requestGateAndWait(page: Page, proposalId: string, expected: readonly string[] = ['APPROVAL_PENDING']): Promise<void> {
  const requested = await apiRequest(page, `/api/proposals/${proposalId}/gate`, { method: 'POST' });
  expect(requested.status, requested.text).toBe(202);
  await waitForProposalState(page, proposalId, expected, { label: `gate ${proposalId}` });
}

/** #41（API 直叩き）。前提づくり用（画面からの承認はシナリオ 1 / 5）。 */
async function approveViaApi(page: Page, proposalId: string): Promise<void> {
  const approved = await apiRequest(page, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
  expect(approved.status, approved.text).toBe(200);
}

async function submitViaApi(page: Page, proposalId: string, body?: unknown): Promise<{ status: number; text: string }> {
  return apiRequest(page, `/api/proposals/${proposalId}/submit`, body === undefined ? { method: 'POST' } : { method: 'POST', body });
}

// ============================================================================
// シナリオ 1（`CLAUDE.md` §5 成功条件 1 / docs/05 §17.3 #3）
// ============================================================================
test.describe('シナリオ 1: 案件登録 → 公開 → 取引先が提案 → ゲート → 承認 → 送信 → 結果記録（ブラウザ操作で完遂）', () => {
  test.setTimeout(240_000);

  test('🔴 1 サイクルを画面から完遂できる（API 直叩きは worker の確定を待つポーリングだけ）', async ({ browser }: { browser: Browser }) => {
    const host = await openTenantSession(browser, hostOwner(1));
    let partner: Session | null = null;
    try {
      const partnerCompanyId = partnerIds(1, 1).partnerCompanyId;
      const partnerEngineerId = partnerIds(1, 1).engineerId;
      const projectName = `${T0911_SYNTHETIC_PROJECT_PREFIX}${String(Date.now())}`;

      // --- ① 案件登録（`S-012`）---------------------------------------------------------------
      await host.page.goto('/projects/new', { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('project-form')).toHaveAttribute('data-mode', 'CREATE');
      await host.page.getByTestId('project-name').fill(projectName);
      await host.page.getByTestId('project-submit').click();
      await host.page.waitForURL((url) => url.pathname !== '/projects/new', { timeout: 15_000 });
      const projectId = new URL(host.page.url()).pathname.split('/')[2] ?? '';
      expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
      syntheticProjectIds.push(projectId);
      await expect(host.page.getByTestId('project-detail-name')).toHaveText(projectName);
      // 🔴 `F-014 AC-2`: 登録しただけでは誰にも公開されていない。
      await expect(host.page.getByTestId('project-detail-visibility-warning')).toBeVisible();

      // --- ② パートナー 1 へ公開（`S-013` → #28 = ゲートに預ける → worker が PROJECT_PUBLISH のゲートを通して行を作る）----
      partner = await openTenantSession(browser, partnerSales(1, 1));
      const beforePublish = await apiRequest(partner.page, `/api/projects/${projectId}`);
      expect(beforePublish.status, '公開前の取引先には存在しない（404）').toBe(404);

      await host.page.goto(`/projects/${projectId}/visibility`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('project-visibility-screen')).toBeVisible();
      const choice = host.page.getByTestId(`project-visibility-choice-${partnerCompanyId}`);
      await expect(choice).not.toBeChecked();
      await choice.check();
      await host.page.getByTestId('project-visibility-submit').click();
      // 🔴 #28 は「ゲートに預けた」だけ（`PENDING_GATE`）。公開の確定は worker（`settleProjectPublish`）。
      await expect(host.page.getByTestId('project-visibility-result')).toContainText(t('projects.visibilitySettings.result.pendingGate'));
      const publishDeadline = Date.now() + 60_000;
      for (;;) {
        const visible = await apiRequest(partner.page, `/api/projects/${projectId}`);
        if (visible.status === 200) break;
        if (Date.now() > publishDeadline) throw new Error(`公開が確定しません（取引先の GET /api/projects/${projectId} = ${String(visible.status)}）`);
        await partner.page.waitForTimeout(1_000);
      }

      // --- ③ 取引先が提案を作成（`S-016` 自社候補 → `S-020` → #36）---------------------------------
      await partner.page.goto(`/projects/${projectId}/candidates?limit=100`, { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('candidate-screen')).toBeVisible();
      await partner.page.getByTestId(`candidate-list-row-${partnerEngineerId}`).click();
      await expect(partner.page.getByTestId('candidate-detail-own')).toBeVisible();
      await partner.page.getByTestId('candidate-detail-create-proposal').click();
      await partner.page.waitForURL(`**/proposals/new?**`);
      const editor = partner.page.getByTestId('proposal-editor');
      await expect(editor).toBeVisible();
      await partner.page.getByTestId('proposal-editor-recipient-company-name').fill(RECIPIENT_COMPANY);
      await partner.page.getByTestId('proposal-editor-recipient-email').fill(RECIPIENT_EMAIL);
      await partner.page.getByTestId('proposal-editor-offered-unit-price').fill('680000');
      await partner.page.getByTestId('proposal-editor-offered-start-date').fill('2026-11-01');
      const subject = subjectOf('cycle');
      await partner.page.getByTestId('proposal-editor-subject').fill(subject);
      await partner.page.getByTestId('proposal-editor-body').fill(CLEAN_BODY);
      await partner.page.getByTestId('proposal-editor-create').click();
      await partner.page.waitForURL(/\/proposals\/[0-9a-f-]{36}\/edit$/);
      const proposalId = new URL(partner.page.url()).pathname.split('/')[2] ?? '';
      expect(proposalId).toMatch(/^[0-9a-f-]{36}$/);
      syntheticProposalIds.push(proposalId);
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'DRAFT');

      // --- ④ レビュー依頼（#39 → `GATE_RUNNING`）→ worker の `gate.run` が全層 PASS → `APPROVAL_PENDING` --------------
      const requestGate = partner.page.getByTestId('proposal-editor-request-gate');
      await expect(requestGate).toBeEnabled();
      const gateResponse = partner.page.waitForResponse(
        (response) => response.url().endsWith(`/api/proposals/${proposalId}/gate`) && response.request().method() === 'POST',
      );
      await requestGate.click();
      expect((await gateResponse).status()).toBe(202);
      // 202 の直後は手元で `GATE_RUNNING` として描く（サーバの状態が正。確定は #40 のポーリングで拾う）。
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'GATE_RUNNING');
      await waitForProposalState(partner.page, proposalId, ['APPROVAL_PENDING', 'GATE_FAILED'], { label: 'シナリオ 1 のゲート' });
      const gate = await readGateResult(partner.page, proposalId);
      expect(gate.execution).toBe('DONE');
      expect(gate.aiFailed).toBe(false);
      expect([gate.layers.pii.state, gate.layers.commerce.state, gate.layers.consistency.state]).toEqual(['PASS', 'PASS', 'PASS']);
      // `S-020` は #40 のポーリングで確定を拾い、層ごとに PASS を描く（取引先も自社提案のゲート結果を読める）。
      await partner.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'APPROVAL_PENDING');
      for (const layer of ['pii', 'commerce', 'consistency']) {
        await expect(partner.page.getByTestId(`proposal-editor-gate-layer-${layer}`)).toHaveAttribute('data-layer-state', 'PASS');
      }
      // 🔴 取引先はホスト宛の最終承認を行わない（`S-021` は読めるが `canApprove = false`。docs/04 §S-020 権限差分）。
      await partner.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-approval')).toHaveAttribute('data-can-approve', 'false');
      await expect(partner.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      const partnerApprove = await apiRequest(partner.page, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
      expect(partnerApprove.status, partnerApprove.text).toBe(403);
      partner.outbound.assertNone();

      // --- ⑤ ホストが承認（`S-021`）------------------------------------------------------------
      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expectApprovalJudgmentMaterial(host.page, { recipientCompanyName: RECIPIENT_COMPANY, unitPriceText: '680,000', body: CLEAN_BODY });
      await approveOnScreen(host.page);
      host.outbound.assertNone();

      // --- ⑥ 送信（`S-021` の「送信する」= #43 → worker の `send.proposal` → `SUBMITTING → SUBMITTED`）------------------
      await host.page.reload({ waitUntil: 'domcontentloaded' });
      await requestSubmitOnScreen(host.page, proposalId);
      // 🔴 押した瞬間に「送信済み」と見せない。確定は #46 のポーリング（画面）とここ（API）の両方で待つ。
      expect(await host.page.content()).not.toContain(t('proposals.approval.state.submitted.prefix'));
      const sent = await waitForProposalState(host.page, proposalId, ['SUBMITTED', 'SUBMIT_FAILED'], { label: 'シナリオ 1 の送信' });
      expect(sent.state).toBe('SUBMITTED');
      expect(sent.sendHold).toBeNull();
      expect(sent.sendAttempts).toEqual([expect.objectContaining({ attemptSeq: 1, status: 'SUCCEEDED' })]);
      expect(sent.sendAttempts[0]?.externalId).toMatch(/^mock-/);
      // 片道: `APPROVED → SUBMITTING → SUBMITTED` の 2 本が履歴に残る（`SUBMITTING` を経ずに `SUBMITTED` にならない）。
      const transitions = sent.events.filter((event) => event.fromState !== null).map((event) => [event.fromState, event.toState]);
      expect(transitions).toEqual(
        expect.arrayContaining([
          ['DRAFT', 'GATE_RUNNING'],
          ['GATE_RUNNING', 'APPROVAL_PENDING'],
          ['APPROVAL_PENDING', 'APPROVED'],
          ['APPROVED', 'SUBMITTING'],
          ['SUBMITTING', 'SUBMITTED'],
        ]),
      );
      // `S-021` のポーリング（#46）が確定を拾って再描画する。
      await expect(host.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'SUBMITTED', { timeout: 20_000 });
      await expect(host.page.getByTestId('proposal-approval-notice')).toHaveAttribute('data-disposition', 'SUBMITTED');
      host.outbound.assertNone();

      // --- ⑦ 面談日程 → 面談実施 → 結果待ち → 決定（`S-024`。人間の操作でのみ確定）--------------------------
      await host.page.goto(`/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-detail')).toHaveAttribute('data-proposal-state', 'SUBMITTED');
      await host.page.getByTestId('proposal-detail-action-link-INTERVIEW').click();
      await host.page.waitForURL(`**/proposals/${proposalId}/interview`);
      const interview = host.page.getByTestId('proposal-interview');
      await expect(interview).toHaveAttribute('data-proposal-state', 'SUBMITTED');

      async function transitionTo(to: string, act: () => Promise<void>): Promise<void> {
        const response = host.page.waitForResponse(
          (candidate) => candidate.url().endsWith(`/api/proposals/${proposalId}/transition`) && candidate.request().method() === 'POST',
        );
        await act();
        expect((await response).status(), `→ ${to}`).toBe(200);
        await expect(host.page.getByTestId('proposal-interview-result')).toHaveAttribute('data-result', to);
        await expect(interview).toHaveAttribute('data-proposal-state', to);
      }
      await host.page.getByTestId('proposal-interview-operation-SCHEDULE').click();
      await host.page.getByTestId('proposal-interview-scheduled-at').fill('2026-11-05T10:00');
      await transitionTo('INTERVIEW_SCHEDULED', () => host.page.getByTestId('proposal-interview-submit').click());
      await host.page.getByTestId('proposal-interview-operation-INTERVIEWED').click();
      await host.page.getByTestId('proposal-interview-interviewed-on').fill('2026-11-05');
      await transitionTo('INTERVIEWED', () => host.page.getByTestId('proposal-interview-submit').click());
      await host.page.getByTestId('proposal-interview-operation-RESULT_PENDING').click();
      await transitionTo('RESULT_PENDING', () => host.page.getByTestId('proposal-interview-submit').click());
      await host.page.getByTestId('proposal-interview-operation-WON').click();
      await host.page.getByTestId('proposal-interview-memo').fill('T0911 11 月開始で合意');
      await host.page.getByTestId('proposal-interview-submit').click();
      await expect(host.page.getByTestId('proposal-interview-confirm')).toHaveAttribute('data-operation', 'WON');
      await transitionTo('WON', () => host.page.getByTestId('proposal-interview-confirm-submit').click());
      await expect(host.page.getByTestId('proposal-interview-closed')).toHaveAttribute('data-closed-state', 'WON');

      // --- ⑧ 完遂の確認: 状態は `WON`（終端）。履歴に商談の 4 遷移。取引先も自社提案として `WON` を読める。外部 0 -----------
      const won = await readProposalDetail(host.page, proposalId);
      expect(won.state).toBe('WON');
      expect(won.events.filter((event) => event.toState === 'WON')).toHaveLength(1);
      const afterWon = await apiRequest(host.page, `/api/proposals/${proposalId}/transition`, { method: 'POST', body: { to: 'LOST' } });
      expect(afterWon.status, afterWon.text).toBe(422);
      await partner.page.goto(`/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-detail')).toHaveAttribute('data-proposal-state', 'WON');
      host.outbound.assertNone();
      partner.outbound.assertNone();
    } finally {
      await partner?.close();
      await host.close();
    }
  });
});

// ============================================================================
// シナリオ 2（`CLAUDE.md` §5 成功条件 2 / docs/05 §17.3 #4 / `F-020 AC-2` / `BR-18`）
// ============================================================================
test.describe('シナリオ 2: ゲート FAIL の提案は送信できない。「了解のうえ送信」の導線・API・設定が無い。直せるのは元データだけ', () => {
  test.setTimeout(180_000);

  test('🔴 PII 層 FAIL → GATE_FAILED に留まり、#41 / #43 は 422（force を送っても届かない）→ 修正して再依頼 → PASS', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      const ids = tenantIds(1);
      // 🔴 FAIL の作り方: 台帳の**既知 PII 値**（エンジニアの実名）を本文に書く。ゲートの PII 層は AI（モックは常時 PASS）とは
      //    独立に**機械的検出**（`packages/ai/src/gate/examine.ts`）で既知値の残存を FAIL にする —— AI が PASS と言っても
      //    止まることの証明でもある（`BR-11` / docs/05 §11.4）。
      const engineer = await apiRequest(host.page, `/api/engineers/${ids.hostEngineerId}`);
      expect(engineer.status, engineer.text).toBe(200);
      const displayName = (parseJson(engineer) as { displayName: string }).displayName;
      expect(displayName.length).toBeGreaterThan(0);
      const piiBody = `T0911 ご提案します。担当は ${displayName} です。合成データです。`;
      const proposalId = await createProposalViaApi(host.page, { tenant: 1, tag: 'gate-fail', body: piiBody });

      // --- `S-020` から「レビューに出す」→ worker → GATE_FAILED ----------------------------------------
      await host.page.goto(`/proposals/${proposalId}/edit`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'DRAFT');
      await host.page.getByTestId('proposal-editor-request-gate').click();
      const failed = await waitForProposalState(host.page, proposalId, ['GATE_FAILED', 'APPROVAL_PENDING'], { label: 'シナリオ 2 のゲート' });
      expect(failed.state).toBe('GATE_FAILED');
      const gate = await readGateResult(host.page, proposalId);
      expect(gate.execution).toBe('DONE');
      expect(gate.layers.pii.state).toBe('FAIL');
      expect(gate.layers.pii.findings.map((finding) => finding.kind)).toContain('FULL_NAME');
      expect(gate.layers.commerce.state).toBe('PASS');

      // `S-020` は層ごとの不合格と指摘を描く。「レビューに出す」は無く、あるのは「修正する（下書きに戻す）」だけ。
      await host.page.reload({ waitUntil: 'domcontentloaded' });
      const editor = host.page.getByTestId('proposal-editor');
      await expect(editor).toHaveAttribute('data-proposal-state', 'GATE_FAILED');
      await expect(host.page.getByTestId('proposal-editor-gate-layer-pii')).toHaveAttribute('data-layer-state', 'FAIL');
      await expect(host.page.getByTestId('proposal-editor-gate-findings').locator('[data-finding-kind="FULL_NAME"]')).toHaveCount(1);
      await expect(host.page.getByTestId('proposal-editor-gate-lead')).toContainText(t('proposals.editor.gate.failedLead'));
      await expect(host.page.getByTestId('proposal-editor-request-gate')).toHaveCount(0);
      await expect(host.page.getByTestId('proposal-editor-body')).toBeDisabled();
      await expect(host.page.getByTestId('proposal-editor-reopen-draft')).toBeVisible();
      // 🔴 「了解のうえ送信」「無視して」「強制」に相当する導線・語が無い（`S-020` / `S-021` の両方）。
      const noOverride = async (page: Page, label: string): Promise<void> => {
        await expect(page.locator('[data-testid*="force"], [data-testid*="override"], [data-testid*="skip"], [data-testid*="bulk"]'), label).toHaveCount(0);
        expect(await page.content(), label).not.toMatch(/無視して|了解のうえ|強制|force|override|skipLayers/);
      };
      await noOverride(host.page, 'S-020（GATE_FAILED）');
      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      const approval = host.page.getByTestId('proposal-approval');
      await expect(approval).toHaveAttribute('data-proposal-state', 'GATE_FAILED');
      // `data-can-approve` は**立場**（ホストの OWNER / ADMIN / SALES）の表明であり状態ではない。状態で止まることは、承認・送信の
      // ボタンが描かれず、通知が `GATE_FAILED` の区分であることで表明する。
      await expect(host.page.getByTestId('proposal-approval-notice')).toHaveAttribute('data-disposition', 'GATE_FAILED');
      await expect(host.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      await expect(host.page.getByTestId('proposal-approval-submit')).toHaveCount(0);
      await expect(host.page.getByTestId('proposal-approval-gate-layer-pii')).toHaveAttribute('data-layer-state', 'FAIL');
      await noOverride(host.page, 'S-021（GATE_FAILED）');

      // --- 🔴 API 直叩きでも承認・送信は 422。`force` / `override` を body に載せても読まれない（#41 に body スキーマは無い）---
      for (const body of [undefined, { force: true }, { gate: 'PASS', force: true, override: true, skipLayers: ['pii'] }]) {
        const approve = await apiRequest(host.page, `/api/proposals/${proposalId}/approve`, body === undefined ? { method: 'POST' } : { method: 'POST', body });
        expect(approve.status, approve.text).toBe(422);
        expect(errorCodeOf(approve.text)).toBe('INVALID_STATE_TRANSITION');
        const submit = await submitViaApi(host.page, proposalId, body);
        expect(submit.status, submit.text).toBe(422);
        expect(errorCodeOf(submit.text)).toBe('INVALID_STATE_TRANSITION');
      }
      // 🔴 `GATE_FAILED → APPROVED` を #48 で迂回することもできない —— `to: 'APPROVED'` は #48 の body スキーマに**存在しない**
      //    （400 `VALIDATION`。承認の所有者は #41 だけ）。スキーマが緩んでも §4.2 に無い組として 422 で止まる。
      const bypass = await apiRequest(host.page, `/api/proposals/${proposalId}/transition`, { method: 'POST', body: { to: 'APPROVED' } });
      expect([400, 422], bypass.text).toContain(bypass.status);
      const stillFailed = await readProposalDetail(host.page, proposalId);
      expect(stillFailed.state).toBe('GATE_FAILED');
      expect(stillFailed.sendAttempts).toEqual([]);
      host.outbound.assertNone();

      // --- 元データの修正（`S-020`: 下書きに戻す → 本文から実名を消す → 保存 → 再依頼）→ PASS --------------------
      await host.page.goto(`/proposals/${proposalId}/edit`, { waitUntil: 'domcontentloaded' });
      const reopen = host.page.waitForResponse(
        (response) => response.url().endsWith(`/api/proposals/${proposalId}/transition`) && response.request().method() === 'POST',
      );
      await host.page.getByTestId('proposal-editor-reopen-draft').click();
      expect((await reopen).status()).toBe(200);
      await expect(host.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'DRAFT');
      await expect(host.page.getByTestId('proposal-editor-body')).toBeEnabled();
      await host.page.getByTestId('proposal-editor-body').fill(CLEAN_BODY);
      await host.page.getByTestId('proposal-editor-save').click();
      await expect(host.page.getByTestId('proposal-editor-saved')).toBeVisible();
      await expect(host.page.getByTestId('proposal-editor-request-gate')).toBeEnabled();
      await host.page.getByTestId('proposal-editor-request-gate').click();
      const passed = await waitForProposalState(host.page, proposalId, ['APPROVAL_PENDING', 'GATE_FAILED'], { label: 'シナリオ 2 の再依頼' });
      expect(passed.state).toBe('APPROVAL_PENDING');
      const passedGate = await readGateResult(host.page, proposalId);
      expect([passedGate.layers.pii.state, passedGate.layers.commerce.state, passedGate.layers.consistency.state]).toEqual(['PASS', 'PASS', 'PASS']);
      // 🔴 修正前のハッシュと違う（内容が変わったので新しいゲート結果である。古い FAIL 行が PASS に化けたのではない）。
      expect(passedGate.contentHash).not.toBe(gate.contentHash);
      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });
});

// ============================================================================
// シナリオ 3（冪等性。docs/05 §17.3 #7 / #8 / #9 / `F-022` / `F-023` / `BR-22`）
// ============================================================================
test.describe('シナリオ 3: 送信の冪等性 — 2 回起動で外部 1 回 / 応答不明は人手再送のみ / 未検証の保留は自動復帰', () => {
  test.setTimeout(240_000);

  test('🔴 E2E #7: 同一提案に #43 を 2 回起動しても試行は 1 行（= 外部 1 回）。送信済みへの 3 回目は 422', async ({ browser }: { browser: Browser }) => {
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      const proposalId = await createProposalViaApi(host.page, { tenant: 1, tag: 'idem' });
      await requestGateAndWait(host.page, proposalId);
      await approveViaApi(host.page, proposalId);

      // 🔴 2 回連続で起動する（画面の「送信する」+ 二重押下 / 別タブ相当の API 直叩き）。どちらも 202・同じ attemptSeq・同じ jobId。
      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await requestSubmitOnScreen(host.page, proposalId);
      const again = await submitViaApi(host.page, proposalId);
      // 直後の 2 回目は 202（同じ jobId で BullMQ が 1 本に畳む）か、既に確定していれば 422。どちらでも外部は 1 回。
      expect([202, 422], again.text).toContain(again.status);
      if (again.status === 202) {
        const body = parseJson(again) as SendRequestBody;
        expect(body.attemptSeq).toBe(1);
        expect(body.jobId).toBe(`send.proposal.${proposalId}.1`);
      }
      const sent = await waitForProposalState(host.page, proposalId, ['SUBMITTED', 'SUBMIT_FAILED'], { label: 'E2E #7' });
      expect(sent.state).toBe('SUBMITTED');
      // 🔴 試行は 1 行だけ（`send_attempts` の UNIQUE(entity, attempt_seq)。2 本目のジョブは ② / ④ で外部を呼ばずに終わる）。
      expect(sent.sendAttempts).toEqual([expect.objectContaining({ attemptSeq: 1, status: 'SUCCEEDED' })]);
      // `SUBMITTING → SUBMITTED` は 1 回だけ（多重実行が状態を二重に動かしていない）。
      expect(sent.events.filter((event) => event.fromState === 'SUBMITTING')).toHaveLength(1);
      // しばらく待っても増えない（遅れて来た 2 本目が外部を呼んでいない）。
      await host.page.waitForTimeout(3_000);
      const later = await readProposalDetail(host.page, proposalId);
      expect(later.sendAttempts).toHaveLength(1);
      const third = await submitViaApi(host.page, proposalId);
      expect(third.status, third.text).toBe(422);
      expect(errorCodeOf(third.text)).toBe('INVALID_STATE_TRANSITION');
      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });

  test('🔴 E2E #8: 応答不明 → SUBMIT_FAILED → 時間を置いても自動再送されない → S-022 の確認ステップを経た人手再送で 1 回だけ届く', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      // 🔴 宛先ドメインで「試行 1 は応答不明」を選ぶ（`harness/worker.ts`。順序消費の台本にしない理由も同所）。
      const proposalId = await createProposalViaApi(host.page, { tenant: 1, tag: 'unknown', recipientEmail: UNKNOWN_ONCE_RECIPIENT_EMAIL });
      await requestGateAndWait(host.page, proposalId);
      await approveViaApi(host.page, proposalId);
      const requested = await submitViaApi(host.page, proposalId);
      expect(requested.status, requested.text).toBe(202);
      const failed = await waitForProposalState(host.page, proposalId, ['SUBMIT_FAILED', 'SUBMITTED'], { label: 'E2E #8 応答不明' });
      // 🔴 応答不明 = `SendAttempt(1).status = 'UNKNOWN'`（届いた可能性がある）+ `SUBMIT_FAILED`。`LOST` / `GATE_FAILED` とは別の状態。
      expect(failed.state).toBe('SUBMIT_FAILED');
      expect(failed.lastFailureReason).toBe('UNKNOWN:TimeoutError');
      expect(failed.sendAttempts).toEqual([expect.objectContaining({ attemptSeq: 1, status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError', externalId: null })]);

      // --- `S-022`: 応答不明は「失敗」と別の語・別の印。自動再送・一括・force の語が無い ---------------------------
      await host.page.goto('/proposals/send-failures', { waitUntil: 'domcontentloaded' });
      const row = host.page.getByTestId(`send-failure-row-${proposalId}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-delivery-unknown', 'true');
      await expect(row).toHaveAttribute('data-failure-category', 'UNKNOWN');
      await expect(host.page.getByTestId(`send-failure-kind-${proposalId}`)).toHaveText(t('sendFailures.failureKind.UNKNOWN'));
      await expect(host.page.locator('[data-testid*="bulk"], [data-testid*="force"], [data-testid*="override"], [data-testid*="auto"], [data-testid*="retry-all"]')).toHaveCount(0);
      expect(await host.page.content()).not.toMatch(/一括再送|自動再送|自動で再送|無視して|再試行/);

      // --- 🔴 自動再送されない: 時間を置いても試行が増えず状態も動かない。#43 は 422、確認の無い #44 は 400 --------------
      await host.page.waitForTimeout(5_000);
      const later = await readProposalDetail(host.page, proposalId);
      expect(later.state).toBe('SUBMIT_FAILED');
      expect(later.sendAttempts).toHaveLength(1);
      const submitAgain = await submitViaApi(host.page, proposalId);
      expect(submitAgain.status, submitAgain.text).toBe(422);
      const notAcknowledged = await apiRequest(host.page, `/api/proposals/${proposalId}/resend`, {
        method: 'POST',
        body: { acknowledged: false, reason: 'T0911 確認していない' },
      });
      expect(notAcknowledged.status, notAcknowledged.text).toBe(400);
      expect(errorCodeOf(notAcknowledged.text)).toBe('RESEND_NOT_ACKNOWLEDGED');
      // #41 で `SUBMIT_FAILED → APPROVED` を迂回できない（`RESEND` の所有者は #44）。
      const approveBypass = await apiRequest(host.page, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
      expect(approveBypass.status, approveBypass.text).toBe(422);
      expect((await readProposalDetail(host.page, proposalId)).state).toBe('SUBMIT_FAILED');

      // --- 人手再送（`S-022` → 詳細 → 「再送する」→ 確認〔届いている可能性 + チェック + 理由〕→ #44 = 202 / seq 2）-----------
      await row.click();
      await expect(host.page.getByTestId('send-failure-detail')).toHaveAttribute('data-failure-category', 'UNKNOWN');
      await expect(host.page.getByTestId('send-failure-detail-notes')).toContainText(t('sendFailures.note.unknown'));
      await expect(host.page.getByTestId('send-failure-attempt-1')).toContainText(t('sendFailures.attempt.status.UNKNOWN'));
      await host.page.getByTestId('send-failure-resend').click();
      const confirm = host.page.getByTestId('send-failure-resend-confirm');
      await expect(confirm).toContainText('届いている可能性');
      const resendSubmit = host.page.getByTestId('send-failure-resend-submit');
      await expect(resendSubmit).toBeDisabled();
      await host.page.getByTestId('send-failure-resend-acknowledge').check();
      await expect(resendSubmit).toBeDisabled();
      await host.page.getByTestId('send-failure-resend-reason').fill('T0911 先方に電話で未着を確認した');
      await expect(resendSubmit).toBeEnabled();
      const captured: { status: number; body: SendRequestBody | null } = { status: 0, body: null };
      const resendApiUrl = `**/api/proposals/${proposalId}/resend`;
      await host.page.route(resendApiUrl, async (route) => {
        const response = await route.fetch();
        captured.status = response.status();
        captured.body = (await response.json()) as SendRequestBody;
        await route.fulfill({ response });
      });
      await resendSubmit.click();
      await host.page.waitForURL(`**/proposals/${proposalId}/approve`);
      await host.page.unroute(resendApiUrl);
      expect(captured.status).toBe(202);
      expect(captured.body).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, state: 'APPROVED', sendHoldReasonKey: null });

      // 🔴 seq 2 は届く（試行は `[UNKNOWN(1), SUCCEEDED(2)]`。外部は合計 2 = 応答不明 1 + 人手再送 1。自動の 3 回目は無い）。
      const resent = await waitForProposalState(host.page, proposalId, ['SUBMITTED', 'SUBMIT_FAILED'], { label: 'E2E #8 再送' });
      expect(resent.state).toBe('SUBMITTED');
      expect(resent.sendAttempts.map((attempt) => [attempt.attemptSeq, attempt.status])).toEqual([
        [1, 'UNKNOWN'],
        [2, 'SUCCEEDED'],
      ]);
      // ⚠️ #44 の 202 後に遷移した `S-021` は `APPROVED` として描かれ、送信中のポーリング（#46）は「送信する」を押した直後にしか
      //    走らない（`SUBMIT_REQUESTED` の間だけ）。再送の確定を画面が拾うには読み直しが要る（SP-12 への申し送り）。
      await host.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'SUBMITTED');
      await host.page.goto('/proposals/send-failures', { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('send-failure-screen')).toBeVisible();
      await expect(host.page.getByTestId(`send-failure-row-${proposalId}`)).toHaveCount(0);
      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });

  test('🔴 E2E #9: 送信元ドメイン未検証の保留は SUBMIT_FAILED にならず、検証後に send.hold-release が自動復帰させて送信される', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 テナント 2 を使う: globalSetup はテナント 1 だけを検証済みにしており、テナント 2 は**未検証のまま**である。
    const host = await openTenantSession(browser, hostOwner(2));
    try {
      const proposalId = await createProposalViaApi(host.page, { tenant: 2, tag: 'hold' });
      await requestGateAndWait(host.page, proposalId);
      await approveViaApi(host.page, proposalId);
      // #43 は非本番で `NOT_REQUIRED`（Issue #57 未回答）のため 202 で積む。送信ジョブの ①-d は環境で免除せず、行が無いので保留する。
      const requested = await submitViaApi(host.page, proposalId);
      expect(requested.status, requested.text).toBe(202);
      const held = await waitForSendHold(host.page, proposalId, 'DOMAIN_UNVERIFIED');
      // 🔴 保留 = `APPROVED` のまま + 理由。`SUBMITTING` に入らず、`SUBMIT_FAILED` にも落ちず、試行も作られない（外部 0）。
      expect(held.state).toBe('APPROVED');
      expect(held.sendAttempts).toEqual([]);
      expect(held.events.some((event) => event.toState === 'SUBMITTING')).toBe(false);
      // `S-021`: 保留の理由と `S-036` への導線。自動復帰する保留なので「送信する」は出さない（`send.hold-release` に任せる）。
      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-approval')).toHaveAttribute('data-send-hold', 'DOMAIN_UNVERIFIED');
      const hold = host.page.getByTestId('proposal-approval-send-hold');
      await expect(hold).toHaveAttribute('data-auto-release', 'true');
      await expect(hold).toContainText(t('sendHold.DOMAIN_UNVERIFIED'));
      await expect(host.page.getByTestId('proposal-approval-send-hold-link')).toHaveAttribute('href', '/settings/sending-domains');
      await expect(host.page.getByTestId('proposal-approval-submit')).toHaveCount(0);
      // `S-019` は保留を `SUBMIT_FAILED` と別の表示にする（失敗率の指標に混ぜない。docs/05 §10.4）。
      await host.page.goto('/proposals', { waitUntil: 'domcontentloaded' });
      const listRow = host.page.getByTestId(`proposal-list-row-${proposalId}`);
      await expect(listRow).toHaveAttribute('data-state', 'APPROVED');
      await expect(listRow).toHaveAttribute('data-send-hold', 'true');
      await expect(listRow).not.toHaveAttribute('data-failure-kind', 'SUBMIT_FAILED');

      // --- 検証（API を通らない経路の模擬。`domain.verify` は SES の identity API を要求し development には無い）------------
      registerVerifiedSendingDomainForE2e(tenantIds(2).tenantId, E2E_VERIFIED_SENDING_DOMAIN);
      // 🔴 人間は何もしない。ハーネスが 1 分周期に上書きした `send.hold-release`（本番と同じジョブ・同じ fan-out）が保留を再判定し、
      //    同じ attemptSeq で `send.proposal` を再 enqueue → worker が送る（docs/05 §10.4）。
      const released = await waitForProposalState(host.page, proposalId, ['SUBMITTED', 'SUBMIT_FAILED'], {
        label: 'E2E #9 自動復帰',
        timeoutMs: 150_000,
      });
      expect(released.state).toBe('SUBMITTED');
      expect(released.sendHold).toBeNull();
      // 🔴 試行は 1 行（保留中は ④ に到達していない = 復帰後の 1 回だけ）。
      expect(released.sendAttempts).toEqual([expect.objectContaining({ attemptSeq: 1, status: 'SUCCEEDED' })]);
      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });
});

// ============================================================================
// シナリオ 4（承認の無効化。docs/05 §17.3 #10 / §11.5 手順 3・4 / §10.2 ①-c）
// ============================================================================
test.describe('シナリオ 4: 承認後に内容が変わると再検証なしで送信できない（GATE_STALE の保留。SUBMITTING に入らない）', () => {
  test.setTimeout(180_000);

  test('🔴 承認後に content_hash がずれた提案は #43 で SUBMITTING に入らず GATE_STALE の保留になる。外部 0、SUBMIT_FAILED でもない', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      const proposalId = await createProposalViaApi(host.page, { tenant: 1, tag: 'stale' });
      await requestGateAndWait(host.page, proposalId);
      await approveViaApi(host.page, proposalId);
      const approved = await readProposalDetail(host.page, proposalId);
      expect(approved.state).toBe('APPROVED');

      // 🔴 API からは変更できない（#37 は `DRAFT` のみ。E2E #10 の API 側は `home.mobile.spec.ts`）。したがって「承認後の内容変更」は
      //    API を通らない経路の模擬 = `content_hash` を直接ずらす（`harness/db-admin.ts` の注記。docs/05 §11.5 手順 2〔改訂〕/ Issue #54）。
      shiftProposalContentHashForE2e(proposalId);

      const requested = await submitViaApi(host.page, proposalId);
      expect(requested.status, requested.text).toBe(202);
      const held = await waitForSendHold(host.page, proposalId, 'GATE_STALE');
      expect(held.state).toBe('APPROVED');
      expect(held.sendAttempts).toEqual([]);
      expect(held.events.some((event) => event.toState === 'SUBMITTING')).toBe(false);
      expect(held.lastFailureReason).toBeNull();
      // `S-021`: 「内容が変更されたため再検証が必要」の保留。自動復帰しない保留なので `send.hold-release` の対象外。「無視して送信」は無い。
      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-approval')).toHaveAttribute('data-send-hold', 'GATE_STALE');
      const hold = host.page.getByTestId('proposal-approval-send-hold');
      await expect(hold).toHaveAttribute('data-auto-release', 'false');
      await expect(hold).toContainText(t('sendHold.GATE_STALE'));
      await expect(host.page.locator('[data-testid*="force"], [data-testid*="override"], [data-testid*="skip"]')).toHaveCount(0);
      expect(await host.page.content()).not.toMatch(/無視して/);
      // 🔴 承認をやり直すことも #41 ではできない（`APPROVED → APPROVED` は §4.2 に無い = 422）。再検証は #39 からしか始まらない。
      const approveAgain = await apiRequest(host.page, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
      expect(approveAgain.status, approveAgain.text).toBe(422);
      // 2 回目の #43 も同じ保留に落ち、外部 0 のまま。
      const requestedAgain = await submitViaApi(host.page, proposalId);
      expect(requestedAgain.status, requestedAgain.text).toBe(202);
      await host.page.waitForTimeout(5_000);
      const stillHeld = await readProposalDetail(host.page, proposalId);
      expect(stillHeld.state).toBe('APPROVED');
      expect(stillHeld.sendHold?.reasonKey).toBe('GATE_STALE');
      expect(stillHeld.sendAttempts).toEqual([]);
      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });
});

// ============================================================================
// シナリオ 5（モバイル承認。docs/05 §17.3 #13 / §17.6「`devices['iPhone 15']` で #13 を実行」/ `F-021 AC-4` `AC-6` / `CLAUDE.md` §13.3）
// ============================================================================
// 🔴 判断材料の判定は `support/proposal-flow.ts` の `expectApprovalJudgmentMaterial` の 1 実装であり、`home.mobile.spec.ts`（Pixel 5。
//    承認から `S-019` / `S-023` / `S-022` へ続くモバイルの通し）と**同じ関数**を呼ぶ。ここでは iPhone 15 の幅（393）で、
//    ゲートを worker が通した提案に対して確かめる。
test.describe('シナリオ 5: iPhone 15 で S-021 を開き、判断材料が省略されず、一括承認が既定でない', () => {
  test.use({
    viewport: devices['iPhone 15'].viewport,
    userAgent: devices['iPhone 15'].userAgent,
    deviceScaleFactor: devices['iPhone 15'].deviceScaleFactor,
    isMobile: devices['iPhone 15'].isMobile,
    hasTouch: devices['iPhone 15'].hasTouch,
  });
  test.setTimeout(180_000);

  test('🔴 iPhone 15: 判断材料（ゲートの指摘・警告・提案先・単価・エンジニアの要点）が同一画面にあり、末尾まで確認するまで承認できず、承認が完結する', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      expect(host.page.viewportSize()?.width).toBe(devices['iPhone 15'].viewport.width);
      const proposalId = await createProposalViaApi(host.page, { tenant: 1, tag: 'mobile', unitPrice: 720000 });
      await requestGateAndWait(host.page, proposalId);

      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expectApprovalJudgmentMaterial(host.page, { recipientCompanyName: RECIPIENT_COMPANY, unitPriceText: '720,000', body: CLEAN_BODY });
      expectNoHiddenCountHints('S-021 提案の承認（iPhone 15）', await host.page.locator('body').innerText());
      await expectNoHorizontalOverflow('S-021 提案の承認（iPhone 15）', host.page);
      await expectNoBrokenLabels('S-021 提案の承認（iPhone 15）', host.page);
      // 🔴 承認はモバイルで完結する（Tier 1）。末尾まで到達するまで押せない（モバイル幅では末尾が初期表示の外にある）。
      await approveOnScreen(host.page, { expectScrollGate: true });
      await expectNoBrokenLabels('S-021 提案の承認（iPhone 15・承認後）', host.page);
      expect((await readProposalDetail(host.page, proposalId)).state).toBe('APPROVED');
      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });
});
