import { expect, test } from '@playwright/test';
import { isolationSeedProjectNames } from '@ses/db/seed';
import { apiRequest } from './support/api';
import { partnerIds, tenantIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';

test('🔴 ホストは公開済み案件を貼れて A1 が読めるが、未公開案件は API で拒否される', async ({ browser }) => {
  const own = partnerIds(1, 1);
  const ids = tenantIds(1);
  const names = isolationSeedProjectNames(1);
  const session = await openTenantSession(browser, hostOwner(1));
  const partner = await openTenantSession(browser, partnerSales(1, 1));
  const { page } = session;
  const createdIds = new Set<string>();
  // 予期せず成功した応答も記録し、失敗したテストの発言を残さない。
  const capture = (response: import('@playwright/test').Response) => {
    if (response.url().endsWith(`/api/threads/${own.threadId}/messages`) && response.request().method() === 'POST' && response.status() === 201) {
      pending.push(response.json().then((value: { id: string }) => { createdIds.add(value.id); }));
    }
  };
  const pending: Promise<void>[] = [];
  page.on('response', capture);
  try {
    const candidates = await apiRequest(page, `/api/threads/${own.threadId}/projects`);
    expect(candidates.status).toBe(200);
    expect(candidates.text).toContain(ids.publishedProjectId);
    expect(candidates.text).not.toContain(ids.privateProjectId);
    await page.goto(`/chat?thread=${own.threadId}`);
    await page.getByTestId('chat-compose-body').fill('/');
    await page.getByTestId('chat-compose-slash-project').click();
    await page.getByTestId(`chat-compose-project-option-${ids.publishedProjectId}`).click();
    await expect(page.getByTestId('chat-compose-attached-project')).toBeVisible();
    const sent = page.waitForResponse((response) => response.url().endsWith(`/api/threads/${own.threadId}/messages`) && response.request().method() === 'POST');
    await page.getByTestId('chat-compose-submit').click();
    const response = await sent;
    expect(response.status()).toBe(201);
    const payload = await response.json() as { id: string };
    createdIds.add(payload.id);
    await partner.page.goto(`/chat?thread=${own.threadId}`);
    await expect(partner.page.getByTestId(`chat-message-project-${payload.id}`)).toContainText(names.published);
    const visible = await apiRequest(partner.page, `/api/threads/${own.threadId}/messages`);
    expect(visible.status).toBe(200);
    expect(visible.text).toContain(payload.id);
    expect(visible.text).toContain(names.published);
    const denied = await apiRequest(page, `/api/threads/${own.threadId}/messages`, {
      method: 'POST', body: { body: '', projectId: ids.privateProjectId },
    });
    expect(denied.status).toBe(400);
    expect(denied.text).not.toContain(names.private);
    const after = await apiRequest(partner.page, `/api/threads/${own.threadId}/messages`);
    expect(after.status).toBe(200);
    expect(after.text).not.toContain(names.private);
    expect(after.text).not.toContain(ids.privateProjectId);
  } finally {
    try {
      await Promise.all(pending);
      page.off('response', capture);
      for (const id of createdIds) expect((await apiRequest(page, `/api/threads/${own.threadId}/messages/${id}`, { method: 'DELETE' })).status).toBe(200);
      session.outbound.assertNone();
      partner.outbound.assertNone();
    } finally { await partner.close(); await session.close(); }
  }
});
