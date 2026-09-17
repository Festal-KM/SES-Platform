// tests/e2e/admin-demo.spec.ts
// ✅ T-10-07: `A-012`（デモ環境の合成データ管理）のリセット導線（docs/05 §17.3 #26 / `F-053 AC-2` / docs/04 §A-012「操作と結果」）。
// ✅ T-10-06: 🔴 **投入直後（リセットの前）に `UC-21` の実演の順路を挿し込んだ**（`F-053 AC-3`。docs/02 `UC-21` 手順 1〜5 /
//    `apps/web/lib/admin-demo/scenarios.ts` の開始地点 = `A-012` の実演チェックリストが見せる URL とアカウント）。
//
// シナリオ（`development` = `isSeedableAppEnv` が真の環境。`SEED_DATABASE_URL` は `harness/web-server.ts` が web にだけ渡す）。
// 🔴 **直列（`serial`）の 4 test** —— 投入 → 実演 A → 実演 B → リセット の順で 1 つの DB を使い、最後に元の状態に戻す:
//   ① 投入: 運営者で `A-001` → `A-012` に到達し、環境（`APP_ENV`）の再掲と投入状況（未投入）が出る → 投入（確認ステップ → `POST …/seed`）
//      → 投入状況に `demo` プリセットの 2 テナントが出る
//   ② `UC-21` シナリオ A（実演アカウント = `seed:demo` のホスト `SALES` と取引先 1 社目の `PARTNER_SALES`。2 要素認証を要求されない）:
//      未公開案件を取引先 1 社目に公開（`S-013` → worker の `PROJECT_PUBLISH` ゲート）→ 取引先が `S-016` → `S-020` で提案を作成し
//      本文に自社エンジニアの氏名を書いたままレビュー依頼 → worker の `gate.run` が**機械的検出**で PII 層 FAIL（`GATE_FAILED`）→
//      `S-020` / `S-021` に不合格が描かれ承認・送信の導線が無い → 下書きに戻して修正 → 再依頼 → 全層 PASS → ホストが `S-021` で承認 →
//      「送信する」→ worker の `send.proposal` がモックで送って `SUBMITTED`（`SendAttempt(1) = SUCCEEDED` / `externalId` は `mock-`）→
//      `S-024` で面談日程 → 面談実施 → 結果待ち → 決定（`WON`）→ 取引先も自社提案として `WON` を読める
//   ③ `UC-21` シナリオ B: ホストが `S-016`（未公開案件 PJ4）で **自社候補と匿名候補（seed の共有可 10 名）が混在**して出ることを見る →
//      匿名候補の行・右パネルに氏名（姓 + 空白）・取引先の商号・取引先側の ID・メールアドレスが無い → 右パネルから提案依頼
//      （`ProposalRequest`）を送る → ホストの依頼一覧（#32 / `S-017`）に `REQUESTED` の行がちょうど 1 件増える
//   ④ 🔴 リセット導線: 確認入力（環境名 + テナント名）が**両方一致するまで実行ボタンが無効**（片方だけ / 別環境名 / 部分一致は無効のまま）
//      → 一致入力で `POST …/reset` → 「合成データが投入されていません」に戻る（`status.seeded = false`。実演で増えた提案・履歴・依頼も消える）
//      → API 直叩き: 不一致 body は 400 `DEMO_RESET_CONFIRMATION_MISMATCH`、`tenantId` を載せた body は 400 `VALIDATION`、
//        一致 body の 2 回目は 200 `NOTHING_TO_RESET`（冪等）。`GET …/seed` は `seeded: false`
//      → 画面と応答に合成の氏名（`DEMO_SEED_NAME_RULES` の姓 + 空白）が現れない。外向き通信 0 件
//
// 🔴 **E2E ハーネスは `APP_ENV=development` であり、実環境の `demo` ではない**（docs/05 §17.3 #26 の注記）。`isSeedableAppEnv` は
//    `development` を許すので API-A16 の投入・リセットはそのまま使える。実演の通し（②③）で走る外部連携は `development` / `demo` の
//    どちらも**全モック**（AI = `DEMO_MOCK_ANTHROPIC_SCRIPT` の全層 PASS + 機械的検出 / メール = `harness/worker.ts` の台本。`CLAUDE.md` §11）
//    であり、差があるのは環境バナーの文言だけ（`env.development` で見る。`env.demo` は render テスト）。
// 🔴 `seed:demo` は `email_dispatches` を作らず `SendAttempt` だけを残す（T-10-06 の申し送り）。②の送信は実演中に worker が行い、
//    `send_attempts`（#46 の `sendAttempts`）でモックの送信記録を確かめる。外部への発信は 0 件（`session.outbound.assertNone()` +
//    ハーネスの遮断フック〔web / worker の両プロセス〕）。
// 🔴 `production` / `sandbox` / `staging` で「導線が無く API が 403」（`F-053 AC-6`）は**結合テスト**
//    （`tests/isolation/seed-demo.test.ts` ⑤ / ⑦）で担保する。ブラウザから `APP_ENV` を切り替える手段が無い
//    （切り替え可能にすること自体が §11.1 の禁止事項に近い）。
// 🔴 本 spec は投入 → リセットで **DB を元の状態（`demo` プリセット 0 件）に戻す**。`isolation` プリセットの母集団には触れない
//    （`deleteTenantData` が `demo` の `tenantIds` に閉じることは結合テスト ⑦ が固定）。途中で失敗した場合だけ `demo` の
//    2 テナントが残るが（serial のため後続は skip）、E2E の DB は実行ごとの使い捨てである。
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_SEED_IDS, demoSeedCompanyNames, type DemoPartnerIds } from '@ses/db/seed';
// 🔴 開始地点は `A-012` の実演チェックリストと同じ 1 実装から引く（URL・アカウントをここに書き写さない）。
import { demoScenarioStartPoints } from '../../apps/web/lib/admin-demo/scenarios';
import { t } from '../../packages/i18n/src/index';
import { apiRequest, parseJson } from './support/api';
import { expectNoBrokenLabels, expectNoEmailsOfDomainExcept, expectNoMarkers } from './support/assertions';
import { demoPersonNamePatterns } from './support/population';
import {
  approveOnScreen,
  expectApprovalJudgmentMaterial,
  readGateResult,
  readProposalDetail,
  requestSubmitOnScreen,
  waitForProposalState,
} from './support/proposal-flow';
import { openPlatformSession, openTenantSession, type Session, type TenantPersona } from './support/sessions';

const SEED_ENDPOINT = '/api/admin/demo/seed';
const RESET_ENDPOINT = '/api/admin/demo/reset';
/** ハーネスの `APP_ENV`（`harness/app-env.ts`。`development` 以外にしない）。 */
const HARNESS_APP_ENV = 'development';
/** 投入は同期（docs/05 §13.6「同期実行」。結合テストで数秒）。余裕をもって待つ。 */
const SEED_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// `UC-21` の実演の開始地点とアカウント（`seed:demo` の 1 テナント目 = `demo-alpha`。取引先 5 社）
// ---------------------------------------------------------------------------

const START = demoScenarioStartPoints(1);
const ALPHA = DEMO_SEED_IDS.tenants[0];

/** 取引先 1 社目（シナリオ A の提案側 / シナリオ B の依頼先候補の 1 つ）。 */
function requirePartner1(): DemoPartnerIds {
  const partner = ALPHA.partners[0];
  if (partner === undefined) throw new Error('seed:demo の 1 テナント目に取引先がありません。');
  return partner;
}

/** 🔴 実演アカウント。`SALES` / `PARTNER_SALES` は 2 要素認証を要求されない（`BR-30` の対象は `OWNER` / `ADMIN`）。 */
const demoHostSales: TenantPersona = {
  label: 'demo-alpha のホスト SALES（実演アカウント）',
  email: START.accounts.hostSalesEmail,
  password: START.accounts.password,
  twoFactorRequired: false,
};
const demoPartnerSales: TenantPersona = {
  label: 'demo-alpha の取引先 1 社目の PARTNER_SALES（実演アカウント）',
  email: START.accounts.partnerSalesEmail,
  password: START.accounts.password,
  twoFactorRequired: false,
};

/** 提案先（合成。`BR-47`）。単価・エンド企業名を本文に書かない。 */
const RECIPIENT_COMPANY = 'T1006 架空エンド株式会社';
const RECIPIENT_EMAIL = 't1006-recipient@example.test';
const CLEAN_BODY = 'ご提案のエンジニアは TypeScript での開発経験が 2 年以上あり、設計から参画できます。稼働開始時期はご相談可能です。（合成データ）';
/** 🔴 提案依頼の本文。商流情報（単価・エンド企業名）を含めない（#31 は 422 で弾く）。 */
const REQUEST_MESSAGE = 'データ分析基盤の案件です。Python の経験をお持ちの方をご提案いただけますか。（合成データ）';

/**
 * 🔴 ホストの `S-016` / #30 に 1 文字も現れてはならない**取引先側**の値（`F-017 AC-1` / `BR-06`）:
 *    取引先の商号・取引先の会社 ID・取引先の利用者 ID・取引先所属エンジニアの社内 ID・共有行の ID。
 *    ⚠️ 氏名の形（姓 + 空白）はここに入れない —— 自社候補の行にはホスト所属エンジニアの氏名が正しく出るため、
 *    **匿名候補の行と右パネルにだけ**当てる（`expectNoSyntheticPersonNames`）。
 */
function partnerSideMarkers(): readonly string[] {
  return [
    ...demoSeedCompanyNames(1).partners,
    ...ALPHA.partners.flatMap((partner) => [
      partner.partnerCompanyId,
      partner.adminUserId,
      partner.salesUserId,
      ...partner.engineerIds,
      ...partner.shareIds,
    ]),
  ];
}

/** 合成の氏名（`DEMO_SEED_NAME_RULES` の姓 + 空白。`support/population.ts` の 1 実装）が 1 つも現れないこと。 */
function expectNoSyntheticPersonNames(source: string, haystack: string): void {
  expectNoMarkers(source, haystack, demoPersonNamePatterns());
}

async function readStatus(page: Page): Promise<{ readonly seeded: boolean; readonly configured: boolean }> {
  const response = await apiRequest(page, SEED_ENDPOINT);
  expect(response.status).toBe(200);
  const body = parseJson(response) as { readonly configured: boolean; readonly status: { readonly seeded: boolean } };
  return { seeded: body.status.seeded, configured: body.configured };
}

async function openDemoScreen(session: Session): Promise<void> {
  // `A-001` の導線（`development` では描かれる。`F-053 AC-6` の裏返し）から `A-012` へ。
  await session.page.goto('/admin', { waitUntil: 'domcontentloaded' });
  const link = session.page.getByTestId('admin-home-demo-link');
  await expect(link).toBeVisible();
  await link.click();
  await session.page.waitForURL(/\/admin\/demo$/);
  await expect(session.page.getByTestId('admin-demo-screen')).toBeVisible();
  await expect(session.page.getByTestId('admin-demo-app-env')).toHaveText(HARNESS_APP_ENV);
  // 「この環境では利用できません」は出ていない（対象環境）。
  await expect(session.page.getByTestId('admin-demo-unavailable')).toHaveCount(0);
}

/** ホストの依頼一覧（#32）のうち E2E が読む形。🔴 依頼先・対象エンジニアの欄は型として存在しない（`F-018 AC-1`）。 */
type HostRequestList = {
  readonly items: readonly { readonly id: string; readonly state: string }[];
  readonly nextCursor: string | null;
};

async function readHostRequests(page: Page): Promise<HostRequestList> {
  const response = await apiRequest(page, '/api/proposal-requests?limit=100');
  expect(response.status, response.text).toBe(200);
  return parseJson(response) as HostRequestList;
}

/** #30 のうち E2E が読む形（匿名候補は `candidateRef` を持ち、自社候補は持たない）。 */
type CandidateListBody = { readonly items: readonly Record<string, unknown>[] };

test.describe.configure({ mode: 'serial' });

test.describe('✅ T-10-07 / T-10-06: A-012 の投入 → UC-21 の実演 → リセット（F-053 AC-2 / AC-3。development での到達）', () => {
  test('① 投入: A-001 → A-012 に到達し、未投入 → 確認ステップ → 投入 → demo プリセットの 2 テナントが投入状況に出る', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openPlatformSession(browser);
    const { page } = session;
    try {
      // 前提: E2E の DB に `demo` プリセットは無い（`globalSetup` は `isolation` だけを投入する）。投入経路は設定済み。
      const initial = await readStatus(page);
      expect(initial.configured).toBe(true);
      expect(initial.seeded).toBe(false);

      await openDemoScreen(session);
      await expect(page.getByTestId('admin-demo-status-not-seeded')).toBeVisible();
      // リセットの節は対象（2 テナントの合成の商号）を示す。実行の確認は開くまで描かれない。
      await expect(page.getByTestId('admin-demo-reset-targets')).toContainText(demoSeedCompanyNames(1).host);
      await expect(page.getByTestId('admin-demo-reset-targets')).toContainText(demoSeedCompanyNames(2).host);
      await expect(page.getByTestId('admin-demo-reset-confirm')).toHaveCount(0);

      // 投入（確認ステップで環境名を再掲 → 実行）。
      await page.getByTestId('admin-demo-seed-open-confirm').click();
      await expect(page.getByTestId('admin-demo-seed-confirm-env')).toHaveText(HARNESS_APP_ENV);
      await page.getByTestId('admin-demo-seed-submit').click();
      await expect(page.getByTestId('admin-demo-seed-done')).toBeVisible({ timeout: SEED_TIMEOUT_MS });
      await expect(page.getByTestId('admin-demo-status-seeded')).toBeVisible();
      for (const tenant of DEMO_SEED_IDS.tenants) {
        await expect(page.getByTestId(`admin-demo-status-tenant-${tenant.tenantId}`)).toBeVisible();
      }
      expect((await readStatus(page)).seeded).toBe(true);
      expectNoSyntheticPersonNames('A-012（投入後）', await page.content());
      // 外向き通信 0 件（送信系はモック。`development`）。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  // ==========================================================================
  // ② `UC-21` シナリオ A（`F-053 AC-3` 前半）
  // ==========================================================================
  test('② UC-21 シナリオ A: 案件の公開 → 取引先の提案 → ゲート FAIL → 修正 → 承認 → 送信 → 結果記録（F-053 AC-3。実演アカウントで通す）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 公開のゲート → 提案のゲート 2 回 → 送信 を worker が確定させる。`proposal-cycle.spec.ts` シナリオ 1 と同じ余裕を取る。
    test.setTimeout(300_000);
    const partner1 = requirePartner1();
    const projectId = START.scenarioA.projectId;
    const engineerId = partner1.engineerIds[0];
    if (engineerId === undefined) throw new Error('seed:demo の取引先 1 社目にエンジニアがありません。');

    const host = await openTenantSession(browser, demoHostSales);
    let partner: Session | null = null;
    try {
      // --- `UC-21` 手順 1: 画面最上部に非本番環境の帯が固定表示された状態で始める（`F-028`。ハーネスは `development`）----------
      await host.page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('environment-banner')).toBeVisible();
      await expect(host.page.getByTestId('environment-banner')).toContainText(t('env.development'));
      await expect(host.page.getByRole('heading', { name: t('home.title') })).toBeVisible();

      // --- ① 未公開案件（PJ6）を取引先 1 社目に公開（`S-013` → #28 = ゲートに預ける → worker が公開の行を作る）----------------
      partner = await openTenantSession(browser, demoPartnerSales);
      const beforePublish = await apiRequest(partner.page, `/api/projects/${projectId}`);
      expect(beforePublish.status, '公開前の取引先には未公開案件が存在しない（404）').toBe(404);

      await host.page.goto(START.scenarioA.startUrl, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('project-visibility-screen')).toBeVisible();
      const choice = host.page.getByTestId(`project-visibility-choice-${partner1.partnerCompanyId}`);
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
      host.outbound.assertNone();

      // --- ② 取引先が提案を作成（`S-016` 自社候補 → `S-020` → #36）。🔴 本文に自社エンジニアの氏名を書いたままレビュー依頼 -----------
      //     FAIL の作り方は `proposal-cycle.spec.ts` シナリオ 2 と同じ: 台帳の**既知 PII 値**（凍結の `displayName`）を本文に書く。
      //     AI（モックは常時 PASS）とは独立に**機械的検出**が止める（`BR-11` / docs/05 §11.4）。
      const engineer = await apiRequest(partner.page, `/api/engineers/${engineerId}`);
      expect(engineer.status, engineer.text).toBe(200);
      const displayName = (parseJson(engineer) as { displayName: string }).displayName;
      expect(displayName.length).toBeGreaterThan(0);
      const piiBody = `${displayName} をご提案します。TypeScript での開発経験があり、設計から参画できます。（合成データ）`;

      await partner.page.goto(`/projects/${projectId}/candidates?limit=100`, { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('candidate-screen')).toBeVisible();
      await partner.page.getByTestId(`candidate-list-row-${engineerId}`).click();
      await expect(partner.page.getByTestId('candidate-detail-own')).toBeVisible();
      await partner.page.getByTestId('candidate-detail-create-proposal').click();
      await partner.page.waitForURL('**/proposals/new?**');
      await expect(partner.page.getByTestId('proposal-editor')).toBeVisible();
      await partner.page.getByTestId('proposal-editor-recipient-company-name').fill(RECIPIENT_COMPANY);
      await partner.page.getByTestId('proposal-editor-recipient-email').fill(RECIPIENT_EMAIL);
      await partner.page.getByTestId('proposal-editor-offered-unit-price').fill('680000');
      await partner.page.getByTestId('proposal-editor-offered-start-date').fill('2026-11-01');
      await partner.page.getByTestId('proposal-editor-subject').fill('【ご提案】モバイルアプリの新規開発（API 側）');
      await partner.page.getByTestId('proposal-editor-body').fill(piiBody);
      await partner.page.getByTestId('proposal-editor-create').click();
      await partner.page.waitForURL(/\/proposals\/[0-9a-f-]{36}\/edit$/);
      const proposalId = new URL(partner.page.url()).pathname.split('/')[2] ?? '';
      expect(proposalId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'DRAFT');

      const requestGate = partner.page.getByTestId('proposal-editor-request-gate');
      await expect(requestGate).toBeEnabled();
      const gateResponse = partner.page.waitForResponse(
        (response) => response.url().endsWith(`/api/proposals/${proposalId}/gate`) && response.request().method() === 'POST',
      );
      await requestGate.click();
      expect((await gateResponse).status()).toBe(202);
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'GATE_RUNNING');
      const failed = await waitForProposalState(partner.page, proposalId, ['GATE_FAILED', 'APPROVAL_PENDING'], { label: 'シナリオ A のゲート（氏名あり）' });
      expect(failed.state).toBe('GATE_FAILED');
      const failedGate = await readGateResult(partner.page, proposalId);
      expect(failedGate.execution).toBe('DONE');
      expect(failedGate.aiFailed).toBe(false);
      expect(failedGate.layers.pii.state).toBe('FAIL');
      expect(failedGate.layers.pii.findings.map((finding) => finding.kind)).toContain('FULL_NAME');

      // `S-020`（取引先）: 層ごとの不合格と指摘が描かれ、「レビューに出す」は無く「修正する（下書きに戻す）」だけ。
      await partner.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'GATE_FAILED');
      await expect(partner.page.getByTestId('proposal-editor-gate-layer-pii')).toHaveAttribute('data-layer-state', 'FAIL');
      await expect(partner.page.getByTestId('proposal-editor-gate-findings').locator('[data-finding-kind="FULL_NAME"]')).toHaveCount(1);
      await expect(partner.page.getByTestId('proposal-editor-gate-lead')).toContainText(t('proposals.editor.gate.failedLead'));
      await expect(partner.page.getByTestId('proposal-editor-request-gate')).toHaveCount(0);
      await expect(partner.page.getByTestId('proposal-editor-body')).toBeDisabled();
      await expect(partner.page.getByTestId('proposal-editor-reopen-draft')).toBeVisible();
      expect(await partner.page.content()).not.toMatch(/無視して|了解のうえ|強制/);
      // `S-021`（ホスト）: 不合格の区分で、承認・送信の導線が無い（`F-020 AC-2`。契約そのものは `proposal-cycle.spec.ts` シナリオ 2）。
      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'GATE_FAILED');
      await expect(host.page.getByTestId('proposal-approval-notice')).toHaveAttribute('data-disposition', 'GATE_FAILED');
      await expect(host.page.getByTestId('proposal-approval-gate-layer-pii')).toHaveAttribute('data-layer-state', 'FAIL');
      await expect(host.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      await expect(host.page.getByTestId('proposal-approval-submit')).toHaveCount(0);
      partner.outbound.assertNone();
      host.outbound.assertNone();

      // --- ③ 修正（下書きに戻す → 本文から氏名を消す → 保存 → 再依頼）→ 全層 PASS → `APPROVAL_PENDING` ----------------------------
      await partner.page.goto(`/proposals/${proposalId}/edit`, { waitUntil: 'domcontentloaded' });
      const reopen = partner.page.waitForResponse(
        (response) => response.url().endsWith(`/api/proposals/${proposalId}/transition`) && response.request().method() === 'POST',
      );
      await partner.page.getByTestId('proposal-editor-reopen-draft').click();
      expect((await reopen).status()).toBe(200);
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'DRAFT');
      await expect(partner.page.getByTestId('proposal-editor-body')).toBeEnabled();
      await partner.page.getByTestId('proposal-editor-body').fill(CLEAN_BODY);
      await partner.page.getByTestId('proposal-editor-save').click();
      await expect(partner.page.getByTestId('proposal-editor-saved')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-editor-request-gate')).toBeEnabled();
      await partner.page.getByTestId('proposal-editor-request-gate').click();
      const passed = await waitForProposalState(partner.page, proposalId, ['APPROVAL_PENDING', 'GATE_FAILED'], { label: 'シナリオ A の再依頼' });
      expect(passed.state).toBe('APPROVAL_PENDING');
      const passedGate = await readGateResult(partner.page, proposalId);
      expect([passedGate.layers.pii.state, passedGate.layers.commerce.state, passedGate.layers.consistency.state]).toEqual(['PASS', 'PASS', 'PASS']);
      // 🔴 修正前と別のハッシュ（古い FAIL 行が PASS に化けたのではない）。
      expect(passedGate.contentHash).not.toBe(failedGate.contentHash);
      await partner.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'APPROVAL_PENDING');
      for (const layer of ['pii', 'commerce', 'consistency']) {
        await expect(partner.page.getByTestId(`proposal-editor-gate-layer-${layer}`)).toHaveAttribute('data-layer-state', 'PASS');
      }
      // 🔴 取引先はホスト宛の最終承認を行わない（`S-021` は読めるが `canApprove = false`。#41 は 403）。
      await partner.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-approval')).toHaveAttribute('data-can-approve', 'false');
      await expect(partner.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      const partnerApprove = await apiRequest(partner.page, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
      expect(partnerApprove.status, partnerApprove.text).toBe(403);
      partner.outbound.assertNone();

      // --- ④ ホストが `S-021` で承認（判断材料が省略されない。判定は `support/proposal-flow.ts` の 1 実装）-----------------------
      await host.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      await expectApprovalJudgmentMaterial(host.page, { recipientCompanyName: RECIPIENT_COMPANY, unitPriceText: '680,000', body: CLEAN_BODY });
      await approveOnScreen(host.page);
      // 承認は送信を伴わない。
      host.outbound.assertNone();

      // --- ⑤ 送信（`S-021` の「送信する」= #43 → worker の `send.proposal` がモックで送る → `SUBMITTING → SUBMITTED`）---------------
      await host.page.reload({ waitUntil: 'domcontentloaded' });
      await requestSubmitOnScreen(host.page, proposalId);
      // 🔴 押した瞬間に「送信済み」と見せない。確定は #46 のポーリング（画面）とここ（API）の両方で待つ。
      expect(await host.page.content()).not.toContain(t('proposals.approval.state.submitted.prefix'));
      const sent = await waitForProposalState(host.page, proposalId, ['SUBMITTED', 'SUBMIT_FAILED'], { label: 'シナリオ A の送信' });
      expect(sent.state).toBe('SUBMITTED');
      expect(sent.sendHold).toBeNull();
      // 🔴 `UC-21` 手順 4: 送信操作を行っても実在の宛先に送出されない —— 試行 1 行がモックの送信記録（`mock-` の外部 ID）で確定する。
      expect(sent.sendAttempts).toEqual([expect.objectContaining({ attemptSeq: 1, status: 'SUCCEEDED' })]);
      expect(sent.sendAttempts[0]?.externalId).toMatch(/^mock-/);
      const transitions = sent.events.filter((event) => event.fromState !== null).map((event) => [event.fromState, event.toState]);
      expect(transitions).toEqual(
        expect.arrayContaining([
          ['DRAFT', 'GATE_RUNNING'],
          ['GATE_RUNNING', 'GATE_FAILED'],
          ['GATE_FAILED', 'DRAFT'],
          ['DRAFT', 'GATE_RUNNING'],
          ['GATE_RUNNING', 'APPROVAL_PENDING'],
          ['APPROVAL_PENDING', 'APPROVED'],
          ['APPROVED', 'SUBMITTING'],
          ['SUBMITTING', 'SUBMITTED'],
        ]),
      );
      await expect(host.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'SUBMITTED', { timeout: 20_000 });
      await expect(host.page.getByTestId('proposal-approval-notice')).toHaveAttribute('data-disposition', 'SUBMITTED');
      host.outbound.assertNone();

      // --- ⑥ 結果記録（`S-023` → `S-024`: 面談日程 → 面談実施 → 結果待ち → 決定。人間の操作でのみ確定）--------------------------
      await host.page.goto(`/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-detail')).toHaveAttribute('data-proposal-state', 'SUBMITTED');
      await host.page.getByTestId('proposal-detail-action-link-INTERVIEW').click();
      await host.page.waitForURL(`**/proposals/${proposalId}/interview`);
      const interview = host.page.getByTestId('proposal-interview');
      await expect(interview).toHaveAttribute('data-proposal-state', 'SUBMITTED');
      await expect(interview).toHaveAttribute('data-can-record', 'true');

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
      await host.page.getByTestId('proposal-interview-memo').fill('11 月開始で合意（合成データ）');
      await host.page.getByTestId('proposal-interview-submit').click();
      await expect(host.page.getByTestId('proposal-interview-confirm')).toHaveAttribute('data-operation', 'WON');
      await transitionTo('WON', () => host.page.getByTestId('proposal-interview-confirm-submit').click());
      await expect(host.page.getByTestId('proposal-interview-closed')).toHaveAttribute('data-closed-state', 'WON');

      // --- 完遂の確認: `WON`（終端）。取引先も自社提案として `WON` を読める。外部への発信は 0 件 -------------------------------
      const won = await readProposalDetail(host.page, proposalId);
      expect(won.state).toBe('WON');
      expect(won.events.filter((event) => event.toState === 'WON')).toHaveLength(1);
      await partner.page.goto(`/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-detail')).toHaveAttribute('data-proposal-state', 'WON');
      host.outbound.assertNone();
      partner.outbound.assertNone();
    } finally {
      await partner?.close();
      await host.close();
    }
  });

  // ==========================================================================
  // ③ `UC-21` シナリオ B（`F-053 AC-3` 後半）
  // ==========================================================================
  test('③ UC-21 シナリオ B: 匿名候補が自社候補と混在して検索結果に出る → 提案依頼（F-053 AC-3。匿名候補の行に実名・所属会社名が無い）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const projectId = START.scenarioB.projectId;
    /** seed の共有可エンジニア（各取引先の e1 / e2 = `shareIds` の数）。 */
    const sharedCount = ALPHA.partners.reduce((sum, partner) => sum + partner.shareIds.length, 0);
    const markers = partnerSideMarkers();
    const host = await openTenantSession(browser, demoHostSales);
    try {
      // --- API #30: 自社候補と匿名候補が同じ一覧に混在し、匿名候補は seed の共有可の人数だけ ------------------------------------
      const candidates = await apiRequest(host.page, `/api/projects/${projectId}/candidates?limit=100`);
      expect(candidates.status, candidates.text).toBe(200);
      const items = (parseJson(candidates) as CandidateListBody).items;
      const anonymousItems = items.filter((item) => 'candidateRef' in item);
      const ownItems = items.filter((item) => !('candidateRef' in item));
      expect(anonymousItems, '匿名候補は seed の共有可の人数（5 社 × e1 / e2）だけ').toHaveLength(sharedCount);
      expect(ownItems.length, '自社候補が同じ一覧に混在する').toBeGreaterThan(0);
      expectNoMarkers('GET /api/projects/{PJ4}/candidates（#30）', candidates.text, markers);
      expectNoSyntheticPersonNames('#30 の匿名候補の要素', JSON.stringify(anonymousItems));

      // --- 画面 `S-016`: 実演の開始地点（素の URL = 案件の要件が検索条件の初期値）に匿名候補が出る ---------------------------------
      await host.page.goto(START.scenarioB.startUrl, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('candidate-screen')).toBeVisible();
      const anonymousRows = host.page.locator('[data-testid^="candidate-list-row-"][data-candidate-kind="ANONYMOUS"]');
      expect(await anonymousRows.count(), '開始地点（要件の初期値）で匿名候補が 1 件以上出る').toBeGreaterThan(0);

      // 全件（`?limit=100` = 条件を 1 つ置いて初期値を外す）で**混在**を見る。
      await host.page.goto(`/projects/${projectId}/candidates?limit=100`, { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('candidate-screen')).toBeVisible();
      const ownRows = host.page.locator('[data-testid^="candidate-list-row-"][data-candidate-kind="OWN"]');
      await expect(anonymousRows).toHaveCount(sharedCount);
      expect(await ownRows.count(), '自社候補の行が同じ表に混在する').toBeGreaterThan(0);
      const html = await host.page.content();
      expectNoMarkers('S-016 候補検索（HTML）', html, markers);
      // 🔴 匿名候補の行は「共有候補」の一語だけ（氏名・所属会社名・社内 ID・メールアドレスを持たない）。
      for (let index = 0; index < sharedCount; index += 1) {
        const row = anonymousRows.nth(index);
        const key = ((await row.getAttribute('data-testid')) ?? '').replace('candidate-list-row-', '');
        expect(key).not.toBe('');
        await expect(host.page.getByTestId(`candidate-list-name-${key}`)).toHaveText(t('candidates.kind.anonymous'));
        const rowHtml = await row.innerHTML();
        expectNoSyntheticPersonNames(`S-016 匿名候補の行（${String(index + 1)} 件目）`, rowHtml);
        expectNoEmailsOfDomainExcept(`S-016 匿名候補の行（${String(index + 1)} 件目）`, rowHtml, 'example', []);
      }
      await expectNoBrokenLabels('S-016 候補検索（混在）', host.page);

      // --- 右パネル → 提案依頼（`S-016` → #31）。依頼の前後でホストの一覧（#32）がちょうど 1 件増える ---------------------------
      const before = (await readHostRequests(host.page)).items.map((item) => item.id);
      await anonymousRows.first().click();
      const panel = host.page.getByTestId('candidate-detail-anonymous');
      await expect(panel).toBeVisible();
      for (const field of ['skills', 'years', 'price', 'availability', 'location', 'updated-on']) {
        await expect(panel.locator(`[data-field="${field}"]`)).toBeVisible();
      }
      const panelHtml = await host.page.getByTestId('candidate-detail-panel').innerHTML();
      expectNoSyntheticPersonNames('S-016 右パネル（匿名候補）', panelHtml);
      expectNoMarkers('S-016 右パネル（匿名候補）', panelHtml, markers);
      expectNoEmailsOfDomainExcept('S-016 右パネル（匿名候補）', panelHtml, 'example', []);
      await host.page.getByTestId('candidate-request-open').click();
      const form = host.page.getByTestId('candidate-request-form');
      await expect(form).toBeVisible();
      // 🔴 確定単価の入力欄が無い（`F-017 AC-4` / `BR-58`）。
      await expect(form.locator('input[type="number"]')).toHaveCount(0);
      await host.page.getByTestId('candidate-request-message').fill(REQUEST_MESSAGE);
      const issued = host.page.waitForResponse(
        (response) => response.url().endsWith('/api/proposal-requests') && response.request().method() === 'POST',
      );
      await host.page.getByTestId('candidate-request-submit').click();
      expect((await issued).status()).toBe(201);
      await expect(host.page.getByTestId('candidate-request-sent')).toBeVisible();

      const after = await readHostRequests(host.page);
      const added = after.items.filter((item) => !before.includes(item.id));
      expect(added, '依頼がちょうど 1 件増える').toHaveLength(1);
      const requestId = added[0]?.id ?? '';
      expect(added[0]?.state).toBe('REQUESTED');
      // 🔴 ホストの一覧に依頼先の社名・対象エンジニア・辞退理由の欄が無い（`F-018 AC-1`）。
      expectNoMarkers('GET /api/proposal-requests（#32）', JSON.stringify(after), markers);
      expectNoSyntheticPersonNames('GET /api/proposal-requests（#32）', JSON.stringify(after));

      // `S-017`（ホスト）に `REQUESTED` の行として載る。
      await host.page.goto('/proposal-requests', { waitUntil: 'domcontentloaded' });
      await expect(host.page.getByTestId('proposal-request-screen')).toBeVisible();
      const row = host.page.getByTestId(`proposal-request-row-${requestId}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-request-state', 'REQUESTED');
      expectNoMarkers('S-017 提案依頼一覧（ホスト）', await host.page.content(), markers);
      await expectNoBrokenLabels('S-017 提案依頼一覧（ホスト）', host.page);
      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });

  // ==========================================================================
  // ④ リセット（`F-053 AC-2`。実演で増えた行も seed の行も消える）
  // ==========================================================================
  test('④ リセット: 確認入力が一致するまでリセットできない → 一致入力でリセット → 「投入されていません」に戻る。API 直叩きは 400 / 冪等', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openPlatformSession(browser);
    const { page } = session;
    try {
      // 前提: ①で投入済み（②③の実演で提案・依頼が増えている）。
      expect((await readStatus(page)).seeded).toBe(true);
      await openDemoScreen(session);
      await expect(page.getByTestId('admin-demo-status-seeded')).toBeVisible();
      expectNoSyntheticPersonNames('A-012（実演後）', await page.content());

      // 🔴 リセット導線: 両方が一致するまで実行ボタンは無効。
      await page.getByTestId('admin-demo-reset-open-confirm').click();
      await expect(page.getByTestId('admin-demo-reset-confirm')).toBeVisible();
      await expect(page.getByTestId('admin-demo-reset-confirm-env')).toHaveText(HARNESS_APP_ENV);
      const submit = page.getByTestId('admin-demo-reset-submit');
      const envInput = page.getByTestId('admin-demo-reset-confirm-env-input');
      const tenantInput = page.getByTestId('admin-demo-reset-confirm-tenant-input');
      await expect(submit).toBeDisabled();
      await expect(page.getByTestId('admin-demo-reset-confirm-mismatch')).toBeVisible();
      // 環境名だけ一致 → まだ無効。
      await envInput.fill(HARNESS_APP_ENV);
      await expect(submit).toBeDisabled();
      // テナント名の部分一致 → 無効。
      await tenantInput.fill('株式会社サンプル');
      await expect(submit).toBeDisabled();
      // 別の環境名 + 正しいテナント名 → 無効（「間違った環境で叩いた」を止める板）。
      await envInput.fill('production');
      await tenantInput.fill(demoSeedCompanyNames(1).host);
      await expect(submit).toBeDisabled();
      // 両方一致 → 有効。
      await envInput.fill(HARNESS_APP_ENV);
      await expect(submit).toBeEnabled();
      await expect(page.getByTestId('admin-demo-reset-confirm-mismatch')).toHaveCount(0);

      // 実行 → 「投入されていません」に戻る。
      await submit.click();
      await expect(page.getByTestId('admin-demo-reset-done')).toBeVisible({ timeout: SEED_TIMEOUT_MS });
      await expect(page.getByTestId('admin-demo-reset-done')).toContainText(t('admin.demo.reset.done'));
      await expect(page.getByTestId('admin-demo-status-not-seeded')).toBeVisible();
      await expect(page.getByTestId('admin-demo-status-seeded')).toHaveCount(0);
      expect((await readStatus(page)).seeded).toBe(false);
      expectNoSyntheticPersonNames('A-012（リセット後）', await page.content());

      // API 直叩き（画面の無効化は UX であり、統制はサーバ側）。
      const mismatch = await apiRequest(page, RESET_ENDPOINT, {
        method: 'POST',
        body: { confirmEnv: 'production', confirmTenantName: demoSeedCompanyNames(1).host },
      });
      expect(mismatch.status).toBe(400);
      expect((parseJson(mismatch) as { error: { code: string } }).error.code).toBe('DEMO_RESET_CONFIRMATION_MISMATCH');
      const widened = await apiRequest(page, RESET_ENDPOINT, {
        method: 'POST',
        body: { confirmEnv: HARNESS_APP_ENV, confirmTenantName: demoSeedCompanyNames(1).host, tenantId: DEMO_SEED_IDS.tenants[0].tenantId },
      });
      expect(widened.status).toBe(400);
      expect((parseJson(widened) as { error: { code: string } }).error.code).toBe('VALIDATION');
      const again = await apiRequest(page, RESET_ENDPOINT, {
        method: 'POST',
        body: { confirmEnv: HARNESS_APP_ENV, confirmTenantName: demoSeedCompanyNames(2).host },
      });
      expect(again.status).toBe(200);
      const againBody = parseJson(again) as { outcome: string; status: { seeded: boolean } };
      expect(againBody.outcome).toBe('NOTHING_TO_RESET');
      expect(againBody.status.seeded).toBe(false);
      expectNoSyntheticPersonNames('API-A16 reset の応答', again.text);

      // 外向き通信 0 件（送信系はモック。`development`）。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
