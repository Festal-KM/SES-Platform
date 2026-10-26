import { expect, test } from '@playwright/test';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { openTenantSession, partnerSales } from './support/sessions';

const own = partnerIds(1, 1);
const other = partnerIds(1, 2);

test('保存した発言が保存済みに現れ、保存を外すと消える', async ({ browser }) => {
  const session = await openTenantSession(browser, partnerSales(1, 1));
  const { page } = session;
  const path = `/api/threads/${own.threadId}/messages/${own.hostMessageId}/save`;
  try {
    await page.goto(`/chat?thread=${own.threadId}`);
    await page.getByTestId(`chat-message-${own.hostMessageId}`).hover();
    await page.getByTestId(`chat-message-bookmark-${own.hostMessageId}`).click();
    await expect(page.getByTestId(`chat-message-saved-${own.hostMessageId}`)).toBeVisible();
    await page.getByTestId('chat-rail-saved').click();
    await expect(page).toHaveURL(/[?&]f=saved/);
    await page.getByTestId(`chat-saved-item-${own.hostMessageId}`).click();
    await page.getByTestId(`chat-message-${own.hostMessageId}`).hover();
    await page.getByTestId(`chat-message-bookmark-${own.hostMessageId}`).click();
    await expect(page.getByTestId(`chat-message-saved-${own.hostMessageId}`)).toHaveCount(0);
    await page.goto('/chat?f=saved');
    await expect(page.getByTestId(`chat-saved-item-${own.hostMessageId}`)).toHaveCount(0);
  } finally {
    try {
      expect((await apiRequest(page, path, { method: 'DELETE' })).status).toBe(200);
      session.outbound.assertNone();
    } finally { await session.close(); }
  }
});

test('🔴 A1 は A2 の発言を保存できず、保存済みにも現れない', async ({ browser }) => {
  const session = await openTenantSession(browser, partnerSales(1, 1));
  const control = await openTenantSession(browser, partnerSales(1, 2));
  const path = `/api/threads/${other.threadId}/messages/${other.partnerMessageId}/save`;
  try {
    const visible = await apiRequest(control.page, `/api/threads/${other.threadId}/messages`);
    expect(visible.status).toBe(200);
    expect(visible.text).toContain(other.partnerMessageId);
    const denied = await apiRequest(session.page, path, { method: 'PUT' });
    expect(denied.status).toBe(404);
    expect(denied.text).not.toContain(other.partnerMessageId);
    await session.page.goto('/chat?f=saved');
    await expect(session.page.getByTestId('chat-saved')).toBeVisible();
    await expect(session.page.getByTestId(`chat-saved-item-${other.partnerMessageId}`)).toHaveCount(0);
  } finally {
    try {
      // 境界が壊れていた場合も、誤って作られた保存を本人のセッションで片付ける。
      await apiRequest(session.page, path, { method: 'DELETE' });
      session.outbound.assertNone();
      control.outbound.assertNone();
    } finally { await control.close(); await session.close(); }
  }
});
