// tests/e2e/send-unknown.spec.ts
// 🔴 E2E #8（docs/05 §17.3 #8 / `F-022 AC-2` `AC-3` / `F-023` / `UC-20` / docs/05 §10.6）: **応答不明 → `SUBMIT_FAILED` →
//    自動再送されない → 人手再送で 1 回だけ送信**。T-09-07。
//
// ============================================================================
// ⚠️ ハーネスに worker が無い（Issue #47 の既定値。`T-09-11` で設計）ため、本 spec は**契約の確認**である
// ============================================================================
//   #43 が積んだ `send.proposal` は消費されず、応答不明での確定（送信ジョブの ⑤⑥）はブラウザ経路では起きない。したがって:
//   - 「応答不明で `SUBMIT_FAILED` に確定した」前提は `harness/db-admin.ts` の `settleProposalSendAsFailedForE2e`（送信ジョブの ⑥ と
//     同じ列で `SendAttempt.UNKNOWN` + `SUBMIT_FAILED` を作る）で作る。T-09-08 の E2E と同じ作法
//   - 「自動再送されない」は **API 直叩き**で確かめる: 時間を置いても #46 の状態・試行が変わらない / #43 は 422 / 確認の無い #44 は 400 /
//     画面に「自動再送」「再試行」の語が無い。ジョブ側（同じジョブの再実行・`send.hold-release`・BullMQ の再配送・`send.settle-unknown`
//     のいずれでも外部 0）は `tests/isolation/send-proposal-unknown.test.ts` ② が実 Redis + 実 Worker で証明する
//   - 「人手再送で 1 回だけ送信」は **#44 が 202 で seq 2 を積むところまで**。seq 2 の送信（`SUBMITTED` / `SendAttempt` 2 行 /
//     `callCount() = 2`）は結合テスト ④ の射程
//   🔴 **T-09-11 で worker がハーネスに入ったら、本 spec を通し（モックの台本 `unknown` を `WorkerRuntimeOptions.mockEmailScript` で注入 →
//      #43 → worker が ⑤⑥ で `UNKNOWN` + `SUBMIT_FAILED` → `S-022` → #44 → worker が seq 2 を送って `SUBMITTED`）に置き換える。**
//      掴み手: `@ses/connectors` の `MockEmailStep`（`[{ kind: 'unknown' }, { kind: 'deliver' }]`）と `startWorkerRuntime(config, { mockEmailScript })`。
//      その時点で `settleProposalSendAsFailedForE2e` は本 spec から外す（`home.mobile.spec.ts` の T-09-08 の前提としては残る）。
//
// 🔴 外部への発信は 0 件（`session.outbound.assertNone()`）。`development` は全コネクタがモック（`CLAUDE.md` §11）。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import {
  deleteT0903SyntheticProposals,
  settleProposalGateAsPassedForE2e,
  settleProposalSendAsFailedForE2e,
  T0903_SYNTHETIC_PROPOSAL_PREFIX,
} from './harness/db-admin';
import { apiRequest, parseJson } from './support/api';
import { expectNoBrokenLabels, expectNoHorizontalOverflow } from './support/assertions';
import { tenantIds } from './support/population';
import { hostOwner, openTenantSession } from './support/sessions';

const syntheticProposalIds: string[] = [];

test.afterAll(() => {
  deleteT0903SyntheticProposals(syntheticProposalIds);
});

type SendBody = { outcome: string; attemptSeq: number; state: string; jobId: string | null; sendHoldReasonKey: string | null };
type DetailBody = {
  state: string;
  lastFailureReason: string | null;
  sendAttempts: { attemptSeq: number; status: string; failureKind: string | null; externalId: string | null }[];
};

test.describe('E2E #8 応答不明 → SUBMIT_FAILED → 自動再送されない → 人手再送（T-09-07。worker 不在のため契約の確認）', () => {
  test('応答不明の提案は S-022 に「届いた可能性」として現れ、時間が経っても状態が動かず、人間の確認を経た #44 だけが seq 2 を積む', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      // --- 前提: 提案（#36）→ 全層 PASS（シーム）→ 承認（#41）→ 送信の要求（#43。202 = 受け付け。seq 1）---
      const ids = tenantIds(1);
      const subject = `${T0903_SYNTHETIC_PROPOSAL_PREFIX}E2E8-${String(Date.now())}`;
      const created = await apiRequest(session.page, '/api/proposals', {
        method: 'POST',
        body: {
          projectId: ids.publishedProjectId,
          engineerId: ids.hostEngineerId,
          recipientCompanyName: 'T0903 架空エンド株式会社',
          recipientEmail: 't0907-recipient@example.test',
          offeredUnitPrice: 680000,
          offeredStartDate: '2026-12-01',
          subject,
          body: 'T0907 ご提案します。応答不明の再現用の合成データです。',
        },
      });
      expect(created.status, created.text).toBe(201);
      const proposalId = (parseJson(created) as { id: string }).id;
      syntheticProposalIds.push(proposalId);
      const gate = await apiRequest(session.page, `/api/proposals/${proposalId}/gate`);
      expect(gate.status, gate.text).toBe(200);
      settleProposalGateAsPassedForE2e(proposalId, (parseJson(gate) as { contentHash: string }).contentHash);
      const approved = await apiRequest(session.page, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
      expect(approved.status, approved.text).toBe(200);
      const requested = await apiRequest(session.page, `/api/proposals/${proposalId}/submit`, { method: 'POST' });
      expect(requested.status, requested.text).toBe(202);
      expect(parseJson(requested) as SendBody).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1, state: 'APPROVED', sendHoldReasonKey: null });
      session.outbound.assertNone();

      // --- 応答不明で確定（シーム。送信ジョブの ⑥ と同じ列: SendAttempt(1) = UNKNOWN / SUBMIT_FAILED / last_failure_reason）---
      settleProposalSendAsFailedForE2e(proposalId);
      const readDetail = async (): Promise<DetailBody> => {
        const detail = await apiRequest(session.page, `/api/proposals/${proposalId}`);
        expect(detail.status, detail.text).toBe(200);
        return parseJson(detail) as DetailBody;
      };
      const failed = await readDetail();
      expect(failed.state).toBe('SUBMIT_FAILED');
      expect(failed.lastFailureReason).toBe('UNKNOWN:TimeoutError');
      expect(failed.sendAttempts).toEqual([expect.objectContaining({ attemptSeq: 1, status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError', externalId: null })]);

      // --- S-022: 応答不明は「失敗」と別の語・別の印。試行ごとの記録に「届いた可能性があります」---
      await session.page.goto('/proposals/send-failures', { waitUntil: 'domcontentloaded' });
      const row = session.page.getByTestId(`send-failure-row-${proposalId}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-delivery-unknown', 'true');
      await expect(row).toHaveAttribute('data-failure-category', 'UNKNOWN');
      await expect(session.page.getByTestId(`send-failure-kind-${proposalId}`)).toHaveText(t('sendFailures.failureKind.UNKNOWN'));
      await row.click();
      const detail = session.page.getByTestId('send-failure-detail');
      await expect(detail).toBeVisible();
      await expect(session.page.getByTestId('send-failure-detail-notes')).toContainText(t('sendFailures.note.unknown'));
      const attemptRow = session.page.getByTestId('send-failure-attempt-1');
      await expect(attemptRow).toBeVisible();
      await expect(attemptRow).toContainText(t('sendFailures.attempt.status.UNKNOWN'));
      await expect(session.page.getByTestId('send-failure-attempt-2')).toHaveCount(0);
      // 🔴 自動再送・再試行・一括に相当する導線・語が無い（`F-023 AC-1` / `BR-50`）。
      await expect(session.page.locator('[data-testid*="bulk"], [data-testid*="force"], [data-testid*="override"], [data-testid*="auto"], [data-testid*="retry-all"]')).toHaveCount(0);
      expect(await session.page.content()).not.toMatch(/一括再送|自動再送|自動で再送|無視して|再試行/);
      await expectNoHorizontalOverflow('S-022 送信失敗一覧（応答不明）', session.page);
      await expectNoBrokenLabels('S-022 送信失敗一覧（応答不明）', session.page);

      // --- 🔴 自動再送されない: 時間を置いても状態・試行が動かない。#43 は 422、確認の無い #44 は 400 ---
      await session.page.waitForTimeout(3_000);
      const later = await readDetail();
      expect(later.state).toBe('SUBMIT_FAILED');
      expect(later.sendAttempts).toHaveLength(1);
      expect(later.sendAttempts[0]).toMatchObject({ attemptSeq: 1, status: 'UNKNOWN' });
      const submitAgain = await apiRequest(session.page, `/api/proposals/${proposalId}/submit`, { method: 'POST' });
      expect(submitAgain.status, submitAgain.text).toBe(422);
      expect((parseJson(submitAgain) as { error: { code: string } }).error.code).toBe('INVALID_STATE_TRANSITION');
      const notAcknowledged = await apiRequest(session.page, `/api/proposals/${proposalId}/resend`, {
        method: 'POST',
        body: { acknowledged: false, reason: 'T0907 確認していない' },
      });
      expect(notAcknowledged.status, notAcknowledged.text).toBe(400);
      expect((parseJson(notAcknowledged) as { error: { code: string } }).error.code).toBe('RESEND_NOT_ACKNOWLEDGED');
      expect((await readDetail()).state).toBe('SUBMIT_FAILED');
      session.outbound.assertNone();

      // --- 人手再送（#44。届いている可能性の了承 + 理由）→ 202 / seq 2 / APPROVED。新しい試行はジョブが予約する（worker は T-09-11）---
      const resent = await apiRequest(session.page, `/api/proposals/${proposalId}/resend`, {
        method: 'POST',
        body: { acknowledged: true, reason: 'T0907 先方に電話で未着を確認した' },
      });
      expect(resent.status, resent.text).toBe(202);
      const resentBody = parseJson(resent) as SendBody;
      expect(resentBody).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, state: 'APPROVED', sendHoldReasonKey: null });
      expect(resentBody.jobId).toBe(`send.proposal.${proposalId}.2`);
      const afterResend = await readDetail();
      expect(afterResend.state).toBe('APPROVED');
      // 🔴 seq 2 の試行は送信ジョブの ④ が予約する（#44 は採番して積むだけ）。worker 不在のここでは 1 行のまま。
      //    T-09-11 の通しでは `[UNKNOWN(1), SUCCEEDED(2)]` と `SUBMITTED` を表明する。
      expect(afterResend.sendAttempts).toHaveLength(1);
      // 🔴 APPROVED にもう一度 #44 → 422（SUBMIT_FAILED からしか戻せない）。S-022 からは消えている。
      const twice = await apiRequest(session.page, `/api/proposals/${proposalId}/resend`, {
        method: 'POST',
        body: { acknowledged: true, reason: 'T0907 二度目' },
      });
      expect(twice.status, twice.text).toBe(422);
      await session.page.goto('/proposals/send-failures', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('send-failure-screen')).toBeVisible();
      await expect(session.page.getByTestId(`send-failure-row-${proposalId}`)).toHaveCount(0);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
