// tests/e2e/chat.search.spec.ts
// ✅ 2026-10-29（F-038 ⑰）: `S-031` の会話の中の検索。この部屋の発言だけが見つかり、押すとその発言へ移る。
// 🔴 別の取引先の部屋の検索は 404（不存在と同じ応答）で、本文が出ないことも確かめる。
import { expect, test } from '@playwright/test';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { openTenantSession, partnerSales } from './support/sessions';

test('① 会話の中を検索し、結果を押すとその発言へ移る。🔴 他社の部屋は 404', async ({ browser }) => {
  const own = partnerIds(1, 1);
  const other = partnerIds(1, 2);
  const session = await openTenantSession(browser, partnerSales(1, 1));
  try {
    const { page } = session;
    await page.goto(`/chat?thread=${own.threadId}`);
    const marker = `e2esearch${String(Date.now())}`;
    await page.getByTestId('chat-compose-body').fill(`検索の確認 ${marker}`);
    await page.getByTestId('chat-compose-submit').click();
    await expect(page.getByTestId('chat-messages')).toContainText(marker);
    await expect(page.getByTestId('chat-outbox')).toHaveCount(0);

    await page.getByTestId(`chat-search-toggle-${own.threadId}`).click();
    await page.getByTestId(`chat-search-input-${own.threadId}`).fill(marker);
    const hit = page.locator('[data-testid^="chat-search-hit-"]');
    await expect(hit).toHaveCount(1);
    await hit.click();
    await expect(page.locator('[data-highlighted="true"]')).toContainText(marker);

    const api = await apiRequest(page, `/api/threads/${own.threadId}/messages/search?q=${marker}`);
    expect(api.status).toBe(200);
    expect(api.text).toContain(marker);
    const denied = await apiRequest(page, `/api/threads/${other.threadId}/messages/search?q=${marker}`);
    expect(denied.status).toBe(404);
    session.outbound.assertNone();
  } finally {
    await session.close();
  }
});
