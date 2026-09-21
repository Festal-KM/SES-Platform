// tests/e2e/ai-limit.spec.ts
// 🔴 **E2E #23 前半（AI 上限と HELD）の (b) 後半**（SP-12 `T-12-14` ⑤ / `T-12-03` 表 A #23 = 既定 (b)。docs/05 §17.3 #23 /
//    `F-027 AC-1` / `AC-5` / `AC-6` / docs/04 §S-038 / §S-020 の HELD 行 / §S-021 / `U-19`〔Issue #70 既定 = `S-038` への導線を出さない〕）。
//
// ============================================================================
// 🔴 ここで見るのは**表示**だけである（同じ検証を 2 箇所に書かない。docs/05 §17.4）
// ============================================================================
//   上限到達の**判定**（`reserveAiCost` の `LIMIT_REACHED` → `GATE_RUNNING` のまま `HELD` / 自動復帰 / 多重化防止 / 他テナント非走査）は
//   結合層に固定済み: `tests/isolation/gate-hold-release.test.ts` と `tests/isolation/ai-degraded.test.ts` ④（HELD 中の #41 / #43 が 422、
//   `S-021` の view model が `GATE_RUNNING` の形で `heldResetAt` あり・USD 無し）。本 spec はブラウザ経路で
//     ① `S-038` の残量表示が**件数単位**で「上限到達」を示し、金額（USD）が 1 つも出ない
//     ② `S-021` が HELD を描き（`proposal-approval-gate-held`。停止理由 + 再開条件のみ。`S-038` への導線なし）、承認・送信の
//        導線が無く、API 直叩きの #41 / #43 が 422 を返し、その状態の表示（「検査中」）が画面にある
//     ③ `S-023` セクション 4（`T-12-14` ②）が同じ実行を HELD の行として描く
//   を確かめる。
//
// ============================================================================
// 🔴 上限到達は「API を通らない経路の模擬」（`harness/db-admin.ts` のシーム）で作る
// ============================================================================
//   ハーネスの env は 1 組（`app-env.ts`）で、他の全シナリオがゲート PASS を前提にする。spec 単位で上限を下げた worker を起動する
//   形（選択肢 (a)）は採らず、`usage_counters` を上限値に置く（`reachAiDailyCostLimitForE2e` / `reachAiUnitQuotaForE2e`）。
//   🔴 上限値は spec に書き写さず、web / worker と同じ出所から取る（`e2eAiDailyCostLimitUsd()` / `GET /api/usage` の `quota`）。
//   🔴 後始末（`clearAiLimitFixturesForE2e`）を**必ず**呼ぶ —— 同じ実行の後続 spec（`proposal-cycle.spec.ts` 等）はゲート PASS が前提。
//
// 🔴 ゲート本体（`gate.run`）はハーネスの worker（`harness/worker.ts`）が**実際に走る**。上限到達中は `reserveAiCost` が予約できず、
//    AI を 1 回も呼ばずに保留する（台本は PASS でも使われない）。外部への発信は 0 件（`session.outbound.assertNone()`）。
// 🔴 承認・送信の 409（`GATE_STALE` = 承認後の内容のずれ）は HELD の提案では到達しない（承認待ちですらない）。409 の表示は
//    `proposal-cycle.spec.ts` シナリオ（E2E #10）が固定しており、ここでは HELD の 422 だけを見る。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { e2eAiDailyCostLimitUsd } from './harness/app-env';
import {
  clearAiLimitFixturesForE2e,
  deleteT1214SyntheticProposals,
  reachAiDailyCostLimitForE2e,
  reachAiUnitQuotaForE2e,
  T1214_SYNTHETIC_PROPOSAL_PREFIX,
} from './harness/db-admin';
import { apiRequest, parseJson } from './support/api';
import { expectNoBrokenLabels, expectNoHiddenCountHints, expectNoHorizontalOverflow, expectNoMarkers } from './support/assertions';
import { tenantIds } from './support/population';
import { errorCodeOf, readGateResult, readProposalDetail, type GateResultBody } from './support/proposal-flow';
import { hostOwner, openTenantSession, type Session } from './support/sessions';

/** 金額の語・キー（`admin-non-disclosure.spec.ts` 3 件目 / `tests/static/tenant-usage-no-money.test.ts` と同じ語彙。`S-038` 用）。 */
const MONEY_MARKERS = ['USD', 'Usd', 'usd', '$', 'ドル', 'cost', 'Cost', 'price', 'Price'] as const;
/** 通貨の語だけ（`S-021` / `S-023` 用。`F-027 AC-6`「金額（USD）を載せない」の走査。提案画面は単価〔円〕を正当に描く）。 */
const USD_MARKERS = ['USD', 'Usd', 'usd', '$', 'ドル'] as const;

const TENANT = tenantIds(1);
const RECIPIENT_COMPANY = 'T1214 架空エンド株式会社';
const RECIPIENT_EMAIL = 't1214-recipient@example.test';
const CLEAN_BODY = 'T1214 ご提案します。設計から運用まで一貫して担当できます。合成データです。';

const syntheticProposalIds: string[] = [];

test.afterAll(() => {
  // 🔴 順序: 上限を戻す → 合成提案を消す。保留行（`review_gates`）は提案ごと消える（`deleteSyntheticProposals`）。
  clearAiLimitFixturesForE2e(TENANT.tenantId);
  deleteT1214SyntheticProposals(syntheticProposalIds);
});

/** `<script>` / `<style>` / `<template>` を除いた本文のテキスト（RSC ペイロードの `$` を可視テキストと混同しない）。 */
async function visibleText(session: Session): Promise<string> {
  return session.page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('script, style, template, noscript')) node.remove();
    return clone.textContent ?? '';
  });
}

/** #40 を 1 秒ごとに読み、`HELD_AI_COST_LIMIT` になったら返す（待つだけ。状態は書かない）。 */
async function waitForHeld(session: Session, proposalId: string, timeoutMs = 60_000): Promise<GateResultBody> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const gate = await readGateResult(session.page, proposalId);
    if (gate.execution === 'HELD_AI_COST_LIMIT') return gate;
    if (gate.execution === 'DONE') throw new Error(`${proposalId}: 上限到達のはずが DONE で確定しました（シームが効いていない）。`);
    if (Date.now() > deadline) throw new Error(`${proposalId}: ゲートが HELD になりません（現在: ${gate.execution}）。`);
    await session.page.waitForTimeout(1_000);
  }
}

test.describe('E2E #23 (b) 後半: AI の上限到達の表示（S-038 の残量 / S-021 の HELD / 承認・送信の 422 / S-023 の履歴）', () => {
  test.setTimeout(180_000);

  test('🔴 ① S-038: 件数クォータに到達した単位が「あと 0 件」「上限に達しました」で描かれ、金額（USD）が 1 つも無い（F-027 AC-6）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      // 🔴 クォータの値は `GET /api/usage`（#69）が返す上限（`resolveTenantQuotas` = ワーカー・画面と同じ 1 関数）から取る。
      const before = await apiRequest(session.page, '/api/usage');
      expect(before.status, before.text).toBe(200);
      const quota = (parseJson(before) as { aiUnits: { proposalDraft: { quota: number; used: number } } }).aiUnits.proposalDraft.quota;
      expect(quota).toBeGreaterThan(0);
      reachAiUnitQuotaForE2e(TENANT.tenantId, quota);

      await session.page.goto('/settings/usage', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('usage-screen')).toBeVisible({ timeout: 30_000 });
      const unit = session.page.getByTestId('usage-ai-unit-proposalDraft');
      await expect(unit).toHaveAttribute('data-level', 'REACHED');
      // 🔴 残量は**件数**（「あと 0 件 / N 件」）。メーター・ゲージに金額は無い。
      await expect(session.page.getByTestId('usage-ai-unit-remaining-proposalDraft')).toContainText(
        `${t('usage.remaining.prefix')} 0 ${t('usage.unit.count')}`,
      );
      await expect(session.page.getByTestId('usage-ai-unit-level-proposalDraft')).toHaveAttribute('data-level', 'REACHED');
      await expect(session.page.getByTestId('usage-ai-unit-level-proposalDraft')).toContainText(t('usage.level.reached'));
      // 対照: 到達していない単位は REACHED ではない。
      await expect(session.page.getByTestId('usage-ai-unit-sheetParse')).not.toHaveAttribute('data-level', 'REACHED');

      const text = await visibleText(session);
      expect(text).toContain(t('usage.title'));
      expectNoMarkers('/settings/usage の可視テキスト（上限到達中）', text, [...MONEY_MARKERS]);
      expectNoHiddenCountHints('S-038 利用量と上限', text);
      await expectNoHorizontalOverflow('S-038 利用量と上限', session.page);
      await expectNoBrokenLabels('S-038 利用量と上限', session.page);

      // API 側も同じ判定（件数 / `level`）で、金額のキーが無い。
      const after = await apiRequest(session.page, '/api/usage');
      expect(after.status, after.text).toBe(200);
      const view = parseJson(after) as { aiUnits: { proposalDraft: { remaining: number; level: string } } };
      expect(view.aiUnits.proposalDraft).toMatchObject({ remaining: 0, level: 'REACHED' });
      expectNoMarkers('GET /api/usage（上限到達中）', after.text, [...MONEY_MARKERS]);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('🔴 ② S-021: AI の日次コスト上限に到達すると、ゲートは HELD（GATE_RUNNING のまま）で描かれ、承認・送信は 422。③ S-023 の履歴にも同じ実行が HELD で残る', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      // 🔴 上限値は worker と同じ env の値（`AI_DAILY_COST_LIMIT_USD_DEFAULT`）。spec に数値を書かない。
      reachAiDailyCostLimitForE2e(TENANT.tenantId, e2eAiDailyCostLimitUsd());

      // 前提づくり: #36 で提案を作り、#39 でレビューに出す（ハーネスの worker が `gate.run` を実行し、予約できずに保留する）。
      const created = await apiRequest(session.page, '/api/proposals', {
        method: 'POST',
        body: {
          projectId: TENANT.publishedProjectId,
          engineerId: TENANT.hostEngineerId,
          recipientCompanyName: RECIPIENT_COMPANY,
          recipientEmail: RECIPIENT_EMAIL,
          offeredUnitPrice: 700000,
          offeredStartDate: '2026-11-01',
          subject: `${T1214_SYNTHETIC_PROPOSAL_PREFIX}held-${String(Date.now())}`,
          body: CLEAN_BODY,
        },
      });
      expect(created.status, created.text).toBe(201);
      const proposalId = (parseJson(created) as { id: string }).id;
      syntheticProposalIds.push(proposalId);
      const requested = await apiRequest(session.page, `/api/proposals/${proposalId}/gate`, { method: 'POST' });
      expect(requested.status, requested.text).toBe(202);

      // #40: 3 値目（HELD）。PII / 商流は未実行、整合層は機械的照合が確定。金額（USD）は載らない。
      const gate = await waitForHeld(session, proposalId);
      expect(gate.layers.pii.state).toBe('HELD');
      expect(gate.layers.commerce.state).toBe('HELD');
      expect(gate.layers.consistency.state).toBe('PASS');
      expect(JSON.stringify(gate).toLowerCase()).not.toContain('usd');
      // 🔴 `GATE_FAILED` にしない（元データの欠陥ではない）。
      expect((await readProposalDetail(session.page, proposalId)).state).toBe('GATE_RUNNING');

      // --- ② S-021 の表示 -------------------------------------------------------------------------
      await session.page.goto(`/proposals/${proposalId}/approve`, { waitUntil: 'domcontentloaded' });
      const screen = session.page.getByTestId('proposal-approval');
      await expect(screen).toHaveAttribute('data-proposal-state', 'GATE_RUNNING');
      await expect(session.page.getByTestId('proposal-approval-gate')).toHaveAttribute('data-gate-execution', 'HELD_AI_COST_LIMIT');
      const held = session.page.getByTestId('proposal-approval-gate-held');
      await expect(held).toBeVisible();
      // 停止理由 + 再開条件（リセット時刻）。「修正して再実行」を促す語は無い（`docs/04` §S-020 の HELD 行）。
      await expect(held).toContainText(t('proposals.approval.gate.held'));
      await expect(held).toContainText(t('proposals.approval.gate.heldResetAtPrefix'));
      await expect(held).toContainText('JST');
      await expect(session.page.getByTestId('proposal-approval-gate-layer-pii')).toHaveAttribute('data-layer-state', 'HELD');
      await expect(session.page.getByTestId('proposal-approval-gate-layer-commerce')).toHaveAttribute('data-layer-state', 'HELD');
      await expect(session.page.getByTestId('proposal-approval-gate-layer-consistency')).toHaveAttribute('data-layer-state', 'PASS');
      // 🔴 承認・送信の導線が無い（判断材料が揃っていない状態で押せるボタンを描かない）。「検査中」の表示がある。
      await expect(session.page.getByTestId('proposal-approval-approve')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-approval-submit')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-approval-reject')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-approval-notice')).toHaveAttribute('data-disposition', 'GATE_RUNNING');
      await expect(session.page.getByTestId('proposal-approval-notice')).toContainText(t('proposals.approval.state.gateRunning'));
      // 🔴 Issue #70 既定（`U-19`）: HELD のブロックに `S-038` への導線を出さない。金額も無い。
      await expect(session.page.getByTestId('proposal-approval-gate').locator('a[href="/settings/usage"]')).toHaveCount(0);
      await expect(session.page.locator('a[href="/settings/usage"]')).toHaveCount(0);
      expect(await session.page.content()).not.toMatch(/修正して再実行|無視して|一括承認|一括送信/);
      expectNoMarkers('S-021（HELD）の可視テキスト', await visibleText(session), [...USD_MARKERS]);
      await expectNoHorizontalOverflow('S-021 提案の承認（HELD）', session.page);
      await expectNoBrokenLabels('S-021 提案の承認（HELD）', session.page);

      // --- 承認・送信の API 直叩き: 422（承認の前提 `execution='DONE'` かつ 3 層 PASS を満たさない）。状態は動かない。外部送信 0 -----
      const approve = await apiRequest(session.page, `/api/proposals/${proposalId}/approve`, { method: 'POST' });
      expect(approve.status, approve.text).toBe(422);
      expect(errorCodeOf(approve.text)).toBe('INVALID_STATE_TRANSITION');
      const submit = await apiRequest(session.page, `/api/proposals/${proposalId}/submit`, { method: 'POST' });
      expect(submit.status, submit.text).toBe(422);
      expect(errorCodeOf(submit.text)).toBe('INVALID_STATE_TRANSITION');
      const detail = await readProposalDetail(session.page, proposalId);
      expect(detail.state).toBe('GATE_RUNNING');
      expect(detail.sendAttempts).toHaveLength(0);
      // 🔴 422 の後も画面は同じ表示（読み直しても承認の導線が現れない）。
      await session.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-approval')).toHaveAttribute('data-proposal-state', 'GATE_RUNNING');
      await expect(session.page.getByTestId('proposal-approval-gate-held')).toBeVisible();
      await expect(session.page.getByTestId('proposal-approval-approve')).toHaveCount(0);

      // --- ③ S-023 セクション 4（T-12-14 ②）: 同じ実行が HELD の行として履歴に描かれる。#40b も同じ 1 行 ----------------------
      const history = await apiRequest(session.page, `/api/proposals/${proposalId}/gate-results`);
      expect(history.status, history.text).toBe(200);
      const items = (parseJson(history) as { items: { reviewGateId: string; execution: string; matchesCurrentContent: boolean; held?: unknown }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ execution: 'HELD_AI_COST_LIMIT', matchesCurrentContent: true });
      expect(items[0]?.held).toBeDefined();
      expect(history.text.toLowerCase()).not.toContain('usd');

      await session.page.goto(`/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('proposal-detail')).toHaveAttribute('data-proposal-state', 'GATE_RUNNING');
      await expect(session.page.getByTestId('proposal-detail-section-gate')).toHaveAttribute('data-gate-execution', 'HELD_AI_COST_LIMIT');
      await expect(session.page.getByTestId('proposal-detail-gate-held')).toBeVisible();
      await expect(session.page.getByTestId('proposal-detail-section-gate-history')).toHaveAttribute('data-history-count', '1');
      const row = session.page.getByTestId(`proposal-detail-gate-history-item-${items[0]?.reviewGateId ?? ''}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-gate-execution', 'HELD_AI_COST_LIMIT');
      await expect(row).toHaveAttribute('data-matches-current-content', 'true');
      await expect(session.page.getByTestId(`proposal-detail-gate-history-title-${items[0]?.reviewGateId ?? ''}`)).toContainText(
        t('proposals.detail.gateHistory.held.prefix'),
      );
      await expect(session.page.getByTestId('proposal-detail-section-gate').locator('a[href="/settings/usage"]')).toHaveCount(0);
      await expect(session.page.getByTestId('proposal-detail-section-gate-history').locator('a[href="/settings/usage"]')).toHaveCount(0);
      expectNoMarkers('S-023（HELD）の可視テキスト', await visibleText(session), [...USD_MARKERS]);
      expectNoHiddenCountHints('S-023 提案の詳細と履歴', await session.page.locator('body').innerText());
      await expectNoHorizontalOverflow('S-023 提案の詳細と履歴（HELD）', session.page);
      await expectNoBrokenLabels('S-023 提案の詳細と履歴（HELD）', session.page);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
