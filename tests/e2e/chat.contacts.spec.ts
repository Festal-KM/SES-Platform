// tests/e2e/chat.contacts.spec.ts
// ✅ 2026-10-30（紺野の決定。F-038 改訂 16 ⑲⑳ / S-031 改訂 47）: 連絡先と「新しいグループ」の人の選び方を
// 「会社から探す」「名前から探す」の 2 つのタブにした（LINE と同じ。既定は会社から）。
//   ① 連絡先: 既定は会社のタブで自社だけが開いている。取引先は押すと開く。名前のタブは全員が 1 列。上の検索欄で絞れる
//   ② 新しいグループ: 同じタブで選べ、取引先の人を選ぶとほかの取引先はどちらのタブにも出ない（取引先 1 社まで）
// 🔴 グループは作らない（送信まではしない。データを増やさない）。
import { expect, test } from '@playwright/test';
import { isolationSeedCompanyNames } from '@ses/db/seed';
import { partnerIds, tenantIds } from './support/population';
import { hostOwner, openTenantSession } from './support/sessions';

const [PARTNER_1_NAME, PARTNER_2_NAME] = isolationSeedCompanyNames(1).partners;

test('① 連絡先は「会社から探す」「名前から探す」の 2 つのタブで、会社を押すとその会社の人が開く', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const { page } = session;
  const hostSales = tenantIds(1).hostUserId;
  const partner = partnerIds(1, 1).userId;
  try {
    await page.goto('/chat?f=contacts');
    await expect(page.getByTestId('chat-contacts-tabs')).toBeVisible();
    await expect(page.getByTestId('chat-contacts-tab-company')).toHaveAttribute('aria-selected', 'true');

    // 自社（先頭）は開いている。
    const byCompany = page.getByTestId('chat-contacts-by-company');
    await expect(page.getByTestId('chat-contacts-company-toggle-0')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('chat-contacts-company-0').getByTestId(`chat-contact-link-${hostSales}`)).toBeVisible();

    // 取引先は閉じていて、押すと開く。
    const partnerToggle = byCompany.locator('[data-testid^="chat-contacts-company-toggle-"]', { hasText: PARTNER_1_NAME });
    // 「最近やり取りした人」にも同じ人が出うるので、その会社の欄の中だけを見る。
    const partnerSection = partnerToggle.locator('xpath=ancestor::section[1]');
    await expect(partnerToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(partnerSection.getByTestId(`chat-contact-link-${partner}`)).toHaveCount(0);
    await partnerToggle.click();
    await expect(partnerToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(partnerSection.getByTestId(`chat-contact-link-${partner}`)).toBeVisible();

    // 名前のタブは全員が 1 列。
    await page.getByTestId('chat-contacts-tab-name').click();
    const byName = page.getByTestId('chat-contacts-by-name');
    await expect(byName.getByTestId(`chat-contact-link-${hostSales}`)).toBeVisible();
    await expect(byName.getByTestId(`chat-contact-link-${partner}`)).toBeVisible();

    // 上の検索欄（会社名）で絞ると、会社のタブで当たった会社だけが開いて出る。
    await page.getByTestId('chat-threads-q').fill(PARTNER_1_NAME);
    await page.getByTestId('chat-threads-search-submit').click();
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByTestId('chat-contacts-by-company').getByTestId(`chat-contact-link-${partner}`)).toBeVisible();
    await expect(page.getByTestId('chat-contacts-by-company').getByTestId(`chat-contact-link-${hostSales}`)).toHaveCount(0);

    // 押すと「その人との会話」へ。
    await page.getByTestId('chat-contacts-by-company').getByTestId(`chat-contact-link-${partner}`).click();
    await expect(page).toHaveURL(new RegExp(`f=person\\.${partner}`));
  } finally {
    try { session.outbound.assertNone(); } finally { await session.close(); }
  }
});

test('② 新しいグループも同じ 2 つのタブで選べ、取引先の人を選ぶとほかの取引先はどちらのタブにも出ない', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const { page } = session;
  const first = partnerIds(1, 1).userId;
  const second = partnerIds(1, 2).userId;
  try {
    await page.goto('/chat?f=newgroup');
    await expect(page.getByTestId('chat-new-group-tabs')).toBeVisible();
    await expect(page.getByTestId('chat-new-group-tab-company')).toHaveAttribute('aria-selected', 'true');

    const byCompany = page.getByTestId('chat-new-group-by-company');
    await byCompany.locator('[data-testid^="chat-new-group-company-toggle-"]', { hasText: PARTNER_1_NAME }).click();
    await page.getByTestId(`chat-new-group-member-${first}`).click();
    await expect(page.getByTestId(`chat-new-group-member-${first}`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId(`chat-new-group-chip-${first}`)).toBeVisible();

    // 🔴 取引先は 1 社まで: ほかの取引先は会社のタブにも名前のタブにも出ず、理由を 1 行で出す。
    await expect(byCompany.locator('[data-testid^="chat-new-group-company-toggle-"]', { hasText: PARTNER_2_NAME })).toHaveCount(0);
    await expect(page.getByTestId('chat-new-group-partner-limit')).toBeVisible();
    await page.getByTestId('chat-new-group-tab-name').click();
    await expect(page.getByTestId('chat-new-group-by-name')).toBeVisible();
    await expect(page.getByTestId(`chat-new-group-member-${second}`)).toHaveCount(0);
    await expect(page.getByTestId(`chat-new-group-member-${first}`)).toHaveAttribute('aria-checked', 'true');

    // 作るボタンは押せる（`disabled` にしない）。ここでは押さない（データを増やさない）。
    await expect(page.getByTestId('chat-new-group-submit')).toBeEnabled();
  } finally {
    try { session.outbound.assertNone(); } finally { await session.close(); }
  }
});
