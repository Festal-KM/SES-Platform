// tests/e2e/support/sessions.ts
// 画面（`S-001` / `A-001`）を通したサインイン。
//
// 🔴 **テスト専用のログイン経路・フックを作らない。** 利用者と同じ画面・同じ API を通す。
//    そうしないと「E2E は通るが本物の画面では通らない」状態を検知できない。
// 🔴 2 要素認証は **RFC 6238 の計算をテスト側で行う**（`apps/web/lib/auth/totp.ts` の
//    `totpCode` を再利用する。TOTP の実装を 2 本持たない）。
//    シークレットは**登録ウィザードが本人の画面に返す `otpauth://` URL** から取る
//    （シードに平文のシークレットを置かずに済み、`docs/05` §6.3 #3 の経路もそのまま検証できる）。
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ISOLATION_SEED_PASSWORD, ISOLATION_SEED_PLATFORM_USERS, isolationSeedEmails } from '@ses/db/seed';
import {
  MAIN_SESSION_COOKIE_NAME,
  PLATFORM_SESSION_COOKIE_NAME,
} from '../../../apps/web/lib/auth/cookie-names';
import { totpCode } from '../../../apps/web/lib/auth/totp';
import { readTotpSecret, writeTotpSecret } from '../harness/totp-store';
import { guardOutboundRequests, type OutboundWatcher } from './network';
import type { TenantIndex } from './population';

function secretOf(otpauthUrl: string): string {
  const secret = new URL(otpauthUrl).searchParams.get('secret');
  if (secret === null) throw new Error(`otpauth URL に secret がありません: ${otpauthUrl}`);
  return secret;
}

const SIGN_IN_TIMEOUT_MS = 30_000;

async function submitTwoFactor(
  page: Page,
  subject: string,
  testIds: { readonly otpauth: string; readonly code: string; readonly submit: string },
  expected: { readonly pathname: string; readonly cookieName: string },
): Promise<void> {
  const otpauth = page.getByTestId(testIds.otpauth);
  /**
   * 🔴 登録ウィザード（`otpauth://` URL）が出るのは**初回だけ**である。
   *    2 回目以降の `POST .../2fa/setup` は `ALREADY_ENROLLED` を返し
   *    （確認済みの資格情報を上書きしない。docs/05 §6.3 #3）、画面にシークレットが出ない。
   *    そのため 1 回目に受け取った値を `harness/totp-store.ts` に持ち越す。
   *
   * 🔴 待ち方を「持ち越しの有無」で変える（**即時判定にしない**）:
   *    2 段階目のフォームが描画された時点では、まだ `POST .../2fa/setup` の応答が
   *    返っていない。`otpauth://` はその応答が届いてから描画されるため、
   *    `isVisible()`（リトライしない即時判定）で見ると「ウィザードが出ていない」と
   *    誤認する。持ち越しが無い ＝ 初回なので、`expect().toBeVisible()`（auto-retry）で
   *    描画を待ってから読む。持ち越しがある場合だけ即時判定でよい
   *    （`ALREADY_ENROLLED` ならウィザードは最後まで出ないので、待っても無駄になる）。
   */
  const carried = readTotpSecret(subject);
  if (carried === undefined) {
    // 🔴 既定の expect タイムアウト（15 秒）より長めに取る。`#3 setup` の応答には
    //    リカバリコード 10 本分の Argon2id ハッシュ化が含まれ、負荷の高い環境では数秒かかる。
    await expect(
      otpauth,
      `${subject}: 2 要素認証の登録ウィザード（otpauth:// URL）が描画されません`,
    ).toBeVisible({ timeout: SIGN_IN_TIMEOUT_MS });
    writeTotpSecret(subject, secretOf((await otpauth.textContent()) ?? ''));
  } else if (await otpauth.isVisible().catch(() => false)) {
    // 持ち越しがあるのにウィザードが出た ＝ 資格情報が作り直された。新しい値で上書きする。
    writeTotpSecret(subject, secretOf((await otpauth.textContent()) ?? ''));
  }

  const secret = readTotpSecret(subject);
  if (secret === undefined) {
    throw new Error(
      `${subject} の TOTP シークレットが分かりません（登録ウィザードが出ておらず、持ち越しも無い）。`,
    );
  }

  await page.getByTestId(testIds.code).fill(totpCode(secret, new Date()));
  await page.getByTestId(testIds.submit).click();
  await waitForSignedIn(page, expected.pathname, expected.cookieName, subject);
}

/**
 * サインインの成立を **①セッション Cookie の保存 ②遷移先のパス** の 2 点で確かめる。
 *
 * 🔴 ②だけでは足りない。画面は `window.location.assign()` で移動するため、Cookie が
 *    保存できていなくても一度は目的のパスへ動き、そのあとサーバ側の判定で `/signin` へ
 *    戻される（＝ 一瞬だけ「成功したように見える」）。
 * 🔴 ①だけでも足りない。Cookie があっても `resolveTenantCtx` が ctx を作らなければ
 *    （2 要素認証が未充足など）業務画面には入れない。
 *    セッション Cookie は `__Host-` 接頭辞 + `Secure` であり、保存されるかどうかは
 *    ブラウザがループバックを信頼できるオリジンとして扱うかに依存する
 *    （`apps/web/lib/auth/cookie-names.ts` / `playwright.config.ts` 冒頭）。
 *    ここで名指しで失敗させると、原因が一目で分かる。
 */
async function waitForSignedIn(
  page: Page,
  pathname: string,
  cookieName: string,
  subject: string,
): Promise<void> {
  await page
    .waitForURL((url) => url.pathname === pathname, { timeout: SIGN_IN_TIMEOUT_MS })
    .catch(() => undefined);

  const cookieNames = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(
    cookieNames,
    `${subject}: セッション Cookie（${cookieName}）が保存されていません`,
  ).toContain(cookieName);
  expect(
    new URL(page.url()).pathname,
    `${subject}: サインイン後に ${pathname} へ到達していません`,
  ).toBe(pathname);
}

export type TenantPersona = {
  readonly label: string;
  readonly email: string;
  readonly password: string;
  /** `OWNER` / `ADMIN` は 2 要素認証が必須（`BR-30` / `F-003 AC-2`）。 */
  readonly twoFactorRequired: boolean;
};

export function hostOwner(index: TenantIndex): TenantPersona {
  return {
    label: `テナント ${index} の OWNER`,
    email: isolationSeedEmails(index).hostOwner,
    password: ISOLATION_SEED_PASSWORD,
    twoFactorRequired: true,
  };
}

export function partnerSales(index: TenantIndex, partner: 1 | 2): TenantPersona {
  const emails = isolationSeedEmails(index);
  return {
    label: `テナント ${index} / パートナー ${partner} の PARTNER_SALES`,
    email: partner === 1 ? emails.partner1 : emails.partner2,
    password: ISOLATION_SEED_PASSWORD,
    twoFactorRequired: false,
  };
}

export const platformOwner = {
  label: '運営者（PLATFORM_OWNER）',
  email: ISOLATION_SEED_PLATFORM_USERS.owner.email,
  password: ISOLATION_SEED_PASSWORD,
} as const;

/** `S-001` からサインインする（主平面）。 */
export async function signInAsTenantUser(page: Page, persona: TenantPersona): Promise<void> {
  await page.goto('/signin');
  await page.getByTestId('signin-email').fill(persona.email);
  await page.getByTestId('signin-password').fill(persona.password);
  await page.getByTestId('signin-submit').click();

  if (!persona.twoFactorRequired) {
    await waitForSignedIn(page, '/', MAIN_SESSION_COOKIE_NAME, persona.label);
    return;
  }
  await expect(
    page.getByTestId('signin-2fa-form'),
    `${persona.label}: 2 段階目が出ていません`,
  ).toBeVisible();
  await submitTwoFactor(
    page,
    `tenant:${persona.email}`,
    { otpauth: 'signin-otpauth-uri', code: 'signin-2fa-code', submit: 'signin-2fa-submit' },
    { pathname: '/', cookieName: MAIN_SESSION_COOKIE_NAME },
  );
}

/** `A-001` からサインインする（管理平面。🔴 2 要素認証は必須）。 */
export async function signInAsPlatformUser(page: Page): Promise<void> {
  await page.goto('/admin/signin');
  await page.getByTestId('admin-signin-email').fill(platformOwner.email);
  await page.getByTestId('admin-signin-password').fill(platformOwner.password);
  await page.getByTestId('admin-signin-submit').click();

  await expect(page.getByTestId('admin-signin-2fa-form')).toBeVisible();
  await submitTwoFactor(
    page,
    `platform:${platformOwner.email}`,
    {
      otpauth: 'admin-signin-otpauth-uri',
      code: 'admin-signin-2fa-code',
      submit: 'admin-signin-2fa-submit',
    },
    { pathname: '/admin', cookieName: PLATFORM_SESSION_COOKIE_NAME },
  );
}

export type Session = {
  readonly context: BrowserContext;
  readonly page: Page;
  /** 🔴 ブラウザからの外向き発信が 0 件であること（docs/05 §17.4）。 */
  readonly outbound: OutboundWatcher;
  readonly close: () => Promise<void>;
};

/**
 * 独立したブラウザコンテキストでサインインする。
 * 🔴 テストごと・利用者ごとに Cookie を共有しない（セッションの取り違えは、
 *    分離テストで最もたちの悪い偽陽性になる）。
 */
export async function openTenantSession(
  browser: Browser,
  persona: TenantPersona,
): Promise<Session> {
  const context = await browser.newContext();
  const outbound = await guardOutboundRequests(context);
  const page = await context.newPage();
  await signInAsTenantUser(page, persona);
  return { context, page, outbound, close: () => context.close() };
}

export async function openPlatformSession(browser: Browser): Promise<Session> {
  const context = await browser.newContext();
  const outbound = await guardOutboundRequests(context);
  const page = await context.newPage();
  await signInAsPlatformUser(page);
  return { context, page, outbound, close: () => context.close() };
}
