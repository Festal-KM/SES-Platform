// tests/e2e/admin-demo.spec.ts
// ✅ T-10-07: `A-012`（デモ環境の合成データ管理）のリセット導線（docs/05 §17.3 #26 / `F-053 AC-2` / docs/04 §A-012「操作と結果」）。
//
// シナリオ（`development` = `isSeedableAppEnv` が真の環境。`SEED_DATABASE_URL` は `harness/web-server.ts` が web にだけ渡す）:
//   ① 運営者で `A-001` → `A-012` に到達し、環境（`APP_ENV`）の再掲と投入状況（未投入）が出る
//   ② 投入（確認ステップ → `POST …/seed`）→ 投入状況に `demo` プリセットの 2 テナントが出る
//   ③ 🔴 リセット導線: 確認入力（環境名 + テナント名）が**両方一致するまで実行ボタンが無効**（片方だけ / 別環境名 / 部分一致は無効のまま）
//   ④ 一致入力で `POST …/reset` → 「合成データが投入されていません」に戻る（`status.seeded = false`）
//   ⑤ API 直叩き: 不一致 body は 400 `DEMO_RESET_CONFIRMATION_MISMATCH`、`tenantId` を載せた body は 400 `VALIDATION`、
//      一致 body の 2 回目は 200 `NOTHING_TO_RESET`（冪等）。`GET …/seed` は `seeded: false`
//   ⑥ 画面と応答に合成の氏名（`DEMO_SEED_NAME_RULES` の姓 + 空白）が現れない。外向き通信 0 件
//
// 🔴 `production` / `sandbox` / `staging` で「導線が無く API が 403」（`F-053 AC-6`）は**結合テスト**
//    （`tests/isolation/seed-demo.test.ts` ⑤ / ⑦）で担保する。E2E ハーネスは `APP_ENV=development` 固定であり、ブラウザから
//    `APP_ENV` を切り替える手段が無い（切り替え可能にすること自体が §11.1 の禁止事項に近い）。docs/05 §17.3 #26 の注記。
// 🔴 本 spec は投入 → リセットで **DB を元の状態（`demo` プリセット 0 件）に戻す**。`isolation` プリセットの母集団には触れない
//    （`deleteTenantData` が `demo` の `tenantIds` に閉じることは結合テスト ⑦ が固定）。途中で失敗した場合だけ `demo` の
//    2 テナントが残るが、E2E の DB は実行ごとの使い捨てである。
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_SEED_IDS, DEMO_SEED_NAME_RULES, demoSeedCompanyNames } from '@ses/db/seed';
import { t } from '../../packages/i18n/src/index';
import { apiRequest, parseJson } from './support/api';
import { openPlatformSession, type Session } from './support/sessions';

const SEED_ENDPOINT = '/api/admin/demo/seed';
const RESET_ENDPOINT = '/api/admin/demo/reset';
/** ハーネスの `APP_ENV`（`harness/app-env.ts`。`development` 以外にしない）。 */
const HARNESS_APP_ENV = 'development';
/** 投入は同期（docs/05 §13.6「同期実行」。結合テストで数秒）。余裕をもって待つ。 */
const SEED_TIMEOUT_MS = 90_000;

function expectNoSyntheticPersonNames(source: string, haystack: string): void {
  for (const family of DEMO_SEED_NAME_RULES.familyNames) {
    expect(haystack, `${source} に合成の氏名（${family} …）が現れている`).not.toContain(`${family} `);
  }
}

async function readStatus(page: Page): Promise<{ readonly seeded: boolean; readonly configured: boolean }> {
  const response = await apiRequest(page, SEED_ENDPOINT);
  expect(response.status).toBe(200);
  const body = parseJson(response) as { readonly configured: boolean; readonly status: { readonly seeded: boolean } };
  return { seeded: body.status.seeded, configured: body.configured };
}

async function openDemoScreen(session: Session): Promise<void> {
  // ① `A-001` の導線（`development` では描かれる。`F-053 AC-6` の裏返し）から `A-012` へ。
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

test.describe('✅ T-10-07: A-012 のリセット導線（F-053 AC-2。development での到達）', () => {
  test('投入 → 確認入力が一致するまでリセットできない → 一致入力でリセット → 「投入されていません」に戻る。API 直叩きは 400 / 冪等', async ({
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

      // ② 投入（確認ステップで環境名を再掲 → 実行）。
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

      // ③ 🔴 リセット導線: 両方が一致するまで実行ボタンは無効。
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

      // ④ 実行 → 「投入されていません」に戻る。
      await submit.click();
      await expect(page.getByTestId('admin-demo-reset-done')).toBeVisible({ timeout: SEED_TIMEOUT_MS });
      await expect(page.getByTestId('admin-demo-reset-done')).toContainText(t('admin.demo.reset.done'));
      await expect(page.getByTestId('admin-demo-status-not-seeded')).toBeVisible();
      await expect(page.getByTestId('admin-demo-status-seeded')).toHaveCount(0);
      expect((await readStatus(page)).seeded).toBe(false);
      expectNoSyntheticPersonNames('A-012（リセット後）', await page.content());

      // ⑤ API 直叩き（画面の無効化は UX であり、統制はサーバ側）。
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

      // ⑥ 外向き通信 0 件（送信系はモック。`development`）。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
