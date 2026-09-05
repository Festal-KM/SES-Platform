// playwright.config.ts — E2E（docs/05 §17.1 / §17.3 / §17.6 / docs/03 §4.17）。T-03-11。
//
// 🔴 **直列実行（`workers: 1`）**（docs/05 §17.6 / SP-03 T-03-11）。
//    分離検証のシナリオは RLS の設定漏れが他テストの副作用で偽陽性・偽陰性になるため、
//    並列にしない。将来「分離検証以外」を `workers: 4` で回したくなった場合も、
//    **本ファイルの既定を緩めず**、別プロジェクトとして明示的に分ける。
//
// 🔴 ブラウザは Chromium 系だけを使う（デスクトップ + モバイルエミュレーション）。
//    理由: セッション Cookie は `__Host-` 接頭辞 + `Secure`（`apps/web/lib/auth/cookie-names.ts`）
//    であり、http のローカル環境で保存されるかは「そのブラウザがループバックを
//    信頼できるオリジンとして扱うか」に依存する。Chromium は `127.0.0.1` を信頼するため
//    本番と同じ Cookie 属性のまま検証できる。WebKit / Firefox を足す場合は
//    HTTPS でのローカル起動が前提になるため、別途設計する（`docs/05` §17.6 への申し送り）。
//
// 🔴 `use.baseURL` は globalSetup より前に評価されるため、ポートは固定値
//    （`tests/e2e/harness/endpoint.ts`。`SES_E2E_PORT` で上書き可能）。
import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL } from './tests/e2e/harness/endpoint.js';

const isCi = process.env.CI === 'true' || process.env.CI === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // 🔴 直列。docs/05 §17.6。
  workers: 1,
  fullyParallel: false,
  // 🔴 リトライしない。分離の失敗は「たまたま」ではなく設定漏れであり、再実行で隠さない。
  retries: 0,
  forbidOnly: isCi,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  reporter: isCi ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // 🔴 テスト側からも外部へ出ない（アプリ側の遮断は network-guard.mjs が担う）。
    //    ブラウザが外部を引きに行く経路が無いことは `support/network.ts` が毎テスト検証する。
    bypassCSP: false,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/*.mobile.spec.ts',
    },
    {
      // 🔴 `CLAUDE.md` §13.3 / docs/03 §4.17: モバイルビューポートの検証は Phase 1 の
      //    承認フロー（`F-021`）が本番だが、**基盤は Phase 0 で用意する**（SP-03 §5 テスト計画）。
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/*.mobile.spec.ts',
    },
  ],
});
