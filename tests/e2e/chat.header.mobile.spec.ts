import { expect, test } from '@playwright/test';
import { partnerIds } from './support/population';
import { openTenantSession, partnerSales } from './support/sessions';

// 既存 chat.mobile.spec.ts と同じ mobile-chromium（Pixel 5）で実行する。
test('スマホの一覧に三つの切り替えがあり、会話の見出しから操作を開ける', async ({ browser }) => {
  const session = await openTenantSession(browser, partnerSales(1, 1));
  const { page } = session;
  const own = partnerIds(1, 1);
  try {
    await page.goto('/chat');
    await expect(page.getByTestId('chat-rail-tabs')).toBeVisible();
    for (const tab of ['all', 'unread', 'saved']) await expect(page.getByTestId(`chat-rail-tab-${tab}`)).toBeVisible();
    await page.getByTestId(`chat-thread-link-${own.threadId}`).click();
    await expect(page.getByTestId('chat-back-to-list')).toBeVisible();
    await expect(page.getByTestId('chat-conversation-title')).toBeVisible();
    const menu = page.getByTestId(`chat-header-menu-${own.threadId}`);
    await expect(menu).toBeVisible();
    await menu.click();
    for (const action of ['export', 'pin', 'mute', 'info']) await expect(page.getByTestId(`chat-thread-${action}-${own.threadId}`)).toBeVisible();
  } finally {
    try { session.outbound.assertNone(); } finally { await session.close(); }
  }
});
