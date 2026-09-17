// tests/e2e/support/proposal-flow.ts
// ✅ T-09-11: 提案フローの E2E（`proposal-cycle.spec.ts` / `home.mobile.spec.ts`）が共有する掴み手。
//
// 🔴 **同じ検証を 2 箇所に書かない**（docs/05 §17.4 の規律）ためのファイルである。`S-021` の「判断材料が省略されていない」
//    （`F-021 AC-4` / `AC-6` / `CLAUDE.md` §13.3）は Pixel 5（`home.mobile.spec.ts`）と iPhone 15（`proposal-cycle.spec.ts`
//    シナリオ 5）の 2 つのビューポートで確かめるが、**判定は 1 実装**（`expectApprovalJudgmentMaterial`）である。
// 🔴 worker が入った（`harness/worker.ts`）ので、ゲートの確定・送信の確定は**ブラウザ経路で本物を待つ**。ここにあるのは
//    「待つ」ための補助（#46 / #40 のポーリング）であり、状態を書く関数は無い。
import { expect, type Page } from '@playwright/test';
import { apiRequest, parseJson } from './api';

/** #46（`GET /api/proposals/{id}`）のうち E2E が読む形。 */
export type ProposalDetailBody = {
  readonly id: string;
  readonly state: string;
  readonly contentHash: string;
  readonly sendHold: { readonly reasonKey: string; readonly since: string } | null;
  readonly lastFailureReason: string | null;
  readonly snapshot: { readonly displayName: string };
  readonly sendAttempts: readonly {
    readonly attemptSeq: number;
    readonly status: string;
    readonly failureKind: string | null;
    readonly externalId: string | null;
  }[];
  readonly events: readonly {
    readonly fromState: string | null;
    readonly toState: string | null;
    readonly entry: { readonly kind: string; readonly note?: string | null };
  }[];
};

/** #40（`GET /api/proposals/{id}/gate`）のうち E2E が読む形。 */
export type GateResultBody = {
  readonly execution: 'RUNNING' | 'DONE' | 'HELD_AI_COST_LIMIT';
  readonly contentHash: string;
  readonly layers: Readonly<Record<'pii' | 'commerce' | 'consistency', { readonly state: string; readonly findings: readonly { readonly kind: string }[] }>>;
  readonly aiWarnings: readonly unknown[];
  readonly aiFailed: boolean;
};

/** #43 / #44 の 202 の本文。 */
export type SendRequestBody = {
  readonly outcome: string;
  readonly attemptSeq: number;
  readonly state: string;
  readonly jobId: string | null;
  readonly sendHoldReasonKey: string | null;
};

type ErrorBody = { readonly error: { readonly code: string } };

export function errorCodeOf(text: string): string {
  return (JSON.parse(text) as ErrorBody).error.code;
}

export async function readProposalDetail(page: Page, proposalId: string): Promise<ProposalDetailBody> {
  const response = await apiRequest(page, `/api/proposals/${proposalId}`);
  expect(response.status, response.text).toBe(200);
  return parseJson(response) as ProposalDetailBody;
}

export async function readGateResult(page: Page, proposalId: string): Promise<GateResultBody> {
  const response = await apiRequest(page, `/api/proposals/${proposalId}/gate`);
  expect(response.status, response.text).toBe(200);
  return parseJson(response) as GateResultBody;
}

/**
 * 🔴 worker の確定を待つ（#46 を 1 秒ごとに読む）。`expected` のどれかになったら返す。`until` を過ぎたら最後の状態を添えて落とす。
 *    「待つ」だけであり、状態を書かない。ゲートは目標 30 秒以内（docs/04 §S-020）、送信はモックなので数秒で確定する。
 */
export async function waitForProposalState(
  page: Page,
  proposalId: string,
  expected: readonly string[],
  options: { readonly timeoutMs?: number; readonly label?: string } = {},
): Promise<ProposalDetailBody> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let last: ProposalDetailBody | null = null;
  for (;;) {
    last = await readProposalDetail(page, proposalId);
    if (expected.includes(last.state)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `${options.label ?? proposalId}: 状態が ${expected.join(' / ')} になりません（現在: ${last.state} / 保留: ${last.sendHold?.reasonKey ?? 'なし'}）。`,
      );
    }
    await page.waitForTimeout(1_000);
  }
}

/** 🔴 保留（`sendHold.reasonKey`）が付くまで待つ（`APPROVED` のまま。`SUBMITTING` に入らないことの対照）。 */
export async function waitForSendHold(
  page: Page,
  proposalId: string,
  reasonKey: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<ProposalDetailBody> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const detail = await readProposalDetail(page, proposalId);
    if (detail.sendHold?.reasonKey === reasonKey) return detail;
    if (detail.state !== 'APPROVED') {
      throw new Error(`${proposalId}: 保留 ${reasonKey} を待つ間に状態が ${detail.state} に動きました。`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${proposalId}: 保留 ${reasonKey} が付きません（現在の保留: ${detail.sendHold?.reasonKey ?? 'なし'}）。`);
    }
    await page.waitForTimeout(1_000);
  }
}

/**
 * 🔴 `S-021` の判断材料（docs/05 §17.3 #13 / `F-021 AC-4` / `AC-6` / `CLAUDE.md` §13.3）。
 *
 * 提案先・エンジニア・案件・単価・開始日・作成者・経過時間 / ゲートの 3 層と指摘・警告 / プレビュー本文が**同一画面に、
 * 折りたたみ・タブ無しで**描かれ、一括承認・force / override に相当する操作・語が無いことを表明する。
 * ビューポートを問わず同じ判定（呼び出し側が Pixel 5 / iPhone 15 / デスクトップのどれで開いても同じ）。
 */
export async function expectApprovalJudgmentMaterial(
  page: Page,
  expected: { readonly recipientCompanyName: string; readonly unitPriceText: string; readonly body: string },
): Promise<void> {
  for (const field of ['recipient', 'engineer', 'project', 'unit-price', 'start-date', 'created-by', 'elapsed']) {
    await expect(page.getByTestId(`proposal-approval-header-row-${field}`)).toBeVisible();
  }
  await expect(page.getByTestId('proposal-approval-header-row-unit-price')).toContainText(expected.unitPriceText);
  await expect(page.getByTestId('proposal-approval-header-row-recipient')).toContainText(expected.recipientCompanyName);
  for (const layer of ['pii', 'commerce', 'consistency']) {
    await expect(page.getByTestId(`proposal-approval-gate-layer-${layer}`)).toHaveAttribute('data-layer-state', 'PASS');
  }
  await expect(page.getByTestId('proposal-approval-gate-findings')).toBeVisible();
  await expect(page.getByTestId('proposal-approval-gate-warnings')).toBeVisible();
  await expect(page.getByTestId('proposal-approval-preview-body')).toContainText(expected.body);
  await expect(page.locator('details')).toHaveCount(0);
  await expect(page.locator('[role="tab"]')).toHaveCount(0);
  // 🔴 `F-021 AC-6` / `BR-50`: 一括承認・force / override に相当する操作が存在しない。
  await expect(page.locator('[data-testid*="bulk"]')).toHaveCount(0);
  await expect(page.locator('[data-testid*="force"], [data-testid*="override"], [data-testid*="skip"]')).toHaveCount(0);
  expect(await page.content()).not.toMatch(/一括承認|一括送信|無視して/);
}

/**
 * 🔴 `S-021` で承認する（`docs/04` §S-021 デバイス別: プレビューの末尾までスクロールするまで承認・却下は有効にならない）。
 *    画面は `/proposals/{id}/approve` を開いた状態で渡すこと。
 *
 * @param options.expectScrollGate 🔴 モバイル幅（末尾が初期表示の外にある）では `true` を渡し、「末尾に到達するまで押せない」を
 *   表明する。デスクトップ幅では末尾が最初から見えていて `reachedEnd` が即座に真になるため、初期状態の disabled は表明できない
 *   （ビューポートに依存する事実であり、ゲートの規律が緩んだのではない）。
 */
export async function approveOnScreen(page: Page, options: { readonly expectScrollGate?: boolean } = {}): Promise<void> {
  const screen = page.getByTestId('proposal-approval');
  await expect(screen).toHaveAttribute('data-proposal-state', 'APPROVAL_PENDING');
  await expect(screen).toHaveAttribute('data-can-approve', 'true');
  const approve = page.getByTestId('proposal-approval-approve');
  if (options.expectScrollGate === true) {
    await expect(approve).toBeDisabled();
    await expect(page.getByTestId('proposal-approval-scroll-required')).toBeVisible();
  }
  await page.getByTestId('proposal-approval-preview-end').scrollIntoViewIfNeeded();
  await expect(screen).toHaveAttribute('data-reached-end', 'true');
  await expect(approve).toBeEnabled();
  await expect(page.getByTestId('proposal-approval-reject')).toBeEnabled();
  await approve.click();
  await expect(page.getByTestId('proposal-approval-result')).toHaveAttribute('data-result', 'APPROVED');
  await expect(screen).toHaveAttribute('data-proposal-state', 'APPROVED');
  await expect(page.getByTestId('proposal-approval-approver')).toBeVisible();
  await expect(page.getByTestId('proposal-approval-approve')).toHaveCount(0);
}

/**
 * 🔴 `S-021` の「送信する」（#43）。202 = 受け付け（押した瞬間に「送信済み」と見せない）。確定は呼び出し側が
 *    `waitForProposalState` で待つ。画面は承認済みの `S-021` を開いた状態で渡すこと。
 */
export async function requestSubmitOnScreen(page: Page, proposalId: string): Promise<void> {
  const screen = page.getByTestId('proposal-approval');
  await expect(screen).toHaveAttribute('data-proposal-state', 'APPROVED');
  await expect(screen).toHaveAttribute('data-can-submit', 'true');
  const submitButton = page.getByTestId('proposal-approval-submit');
  await expect(submitButton).toBeVisible();
  // 🔴 末尾まで到達するまで押せない（初期状態の disabled は `home.mobile.spec.ts` が新規ロードの画面で表明する）。
  await page.getByTestId('proposal-approval-preview-end').scrollIntoViewIfNeeded();
  await expect(screen).toHaveAttribute('data-reached-end', 'true');
  await expect(submitButton).toBeEnabled();
  const submitResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/api/proposals/${proposalId}/submit`) && response.request().method() === 'POST',
  );
  await submitButton.click();
  expect((await submitResponse).status()).toBe(202);
  await expect(page.getByTestId('proposal-approval-result')).toHaveAttribute('data-result', 'SUBMIT_REQUESTED');
  await expect(page.getByTestId('proposal-approval-submit')).toHaveCount(0);
}
