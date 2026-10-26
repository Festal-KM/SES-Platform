import { expect, test } from '@playwright/test';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';

test('🔴 ひとこと状態は同じ部屋の相手に表示され、A2 の状態は A1 に漏れない', async ({ browser }) => {
  const own = partnerIds(1, 1);
  const other = partnerIds(1, 2);
  const session = await openTenantSession(browser, partnerSales(1, 1));
  const foreign = await openTenantSession(browser, partnerSales(1, 2));
  const host = await openTenantSession(browser, hostOwner(1));
  const marker = `状態の確認 ${Date.now()}`;
  const foreignMarker = `別会社の状態 ${Date.now()}`;
  try {
    await session.page.goto('/chat');
    await session.page.getByTestId('chat-status-open').click();
    await session.page.getByTestId('chat-status-input').fill(marker);
    const saved = session.page.waitForResponse((response) => response.url().endsWith('/api/chat/status') && response.request().method() === 'PUT');
    await session.page.getByTestId('chat-status-save').click();
    expect((await saved).status()).toBe(200);
    expect((await apiRequest(foreign.page, '/api/chat/status', { method: 'PUT', body: { text: foreignMarker } })).status).toBe(200);
    await host.page.goto(`/chat?thread=${own.threadId}`);
    await expect(host.page.getByTestId(`chat-message-status-${own.partnerMessageId}`)).toHaveText(marker);
    const visible = await apiRequest(host.page, `/api/threads/${own.threadId}/messages`);
    expect(visible.status).toBe(200);
    expect(visible.text).toContain(marker);
    // A2 に実際に設定でき、ホストには読めることを対照にする。
    await host.page.goto(`/chat?thread=${other.threadId}`);
    await expect(host.page.getByTestId(`chat-message-status-${other.partnerMessageId}`)).toHaveText(foreignMarker);
    const control = await apiRequest(host.page, `/api/threads/${other.threadId}/messages`);
    expect(control.status).toBe(200);
    expect(control.text).toContain(foreignMarker);
    await session.page.goto(`/chat?thread=${own.threadId}&pane=${other.threadId}`);
    await expect(session.page.getByTestId(`chat-pane-missing-${other.threadId}`)).toBeVisible();
    await expect(session.page.getByTestId(`chat-message-status-${other.partnerMessageId}`)).toHaveCount(0);
    expect(await session.page.locator('body').textContent()).not.toContain(foreignMarker);
    const denied = await apiRequest(session.page, `/api/threads/${other.threadId}/messages`);
    expect(denied.status).toBe(404);
    expect(denied.text).not.toContain(foreignMarker);
    const ownMessages = await apiRequest(session.page, `/api/threads/${own.threadId}/messages`);
    expect(ownMessages.status).toBe(200);
    expect(ownMessages.text).not.toContain(foreignMarker);
    expect(ownMessages.text).not.toContain(other.userId);
  } finally {
    try {
      for (const actor of [session, foreign]) expect((await apiRequest(actor.page, '/api/chat/status', { method: 'PUT', body: { text: '' } })).status).toBe(200);
      session.outbound.assertNone();
      foreign.outbound.assertNone();
      host.outbound.assertNone();
    } finally { await host.close(); await foreign.close(); await session.close(); }
  }
});
