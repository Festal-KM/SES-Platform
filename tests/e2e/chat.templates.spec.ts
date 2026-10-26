import { expect, test } from '@playwright/test';
import { isolationSeedEmails, ISOLATION_SEED_PASSWORD } from '@ses/db/seed';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { hostOwner, openTenantSession } from './support/sessions';

test('🔴 自分の定型文を作成・挿入・削除でき、同じ会社の同僚には見えない', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const colleague = await openTenantSession(browser, {
    label: '同じ会社の営業', email: isolationSeedEmails(1).hostSales,
    password: ISOLATION_SEED_PASSWORD, twoFactorRequired: false,
  });
  const { page } = session;
  let id: string | undefined;
  try {
    await page.goto('/chat?f=templates');
    const marker = `定型文の確認 ${Date.now()}`;
    await page.getByTestId('chat-template-label').fill(marker);
    await page.getByTestId('chat-template-body').fill(marker);
    const created = page.waitForResponse((response) => response.url().endsWith('/api/chat/templates') && response.request().method() === 'POST');
    await page.getByTestId('chat-template-submit').click();
    const response = await created;
    const payload = await response.json() as { template: { id: string } };
    id = payload.template.id;
    expect(response.status()).toBe(201);
    await expect(page.getByTestId(`chat-template-${id}`)).toBeVisible();
    const thread = partnerIds(1, 1).threadId;
    await page.goto(`/chat?thread=${thread}`);
    const select = page.getByTestId('chat-compose-template');
    await expect(select.locator(`option[value="own:${id}"]`)).toHaveCount(1);
    await select.selectOption(`own:${id}`);
    await expect(page.getByTestId('chat-compose-body')).toHaveValue(marker);
    await colleague.page.goto('/chat?f=templates');
    await expect(colleague.page.getByTestId('chat-templates')).toBeVisible();
    await expect(colleague.page.getByTestId(`chat-template-${id}`)).toHaveCount(0);
    await colleague.page.goto(`/chat?thread=${thread}`);
    await expect(colleague.page.getByTestId('chat-compose-template')).toBeVisible();
    await expect(colleague.page.getByTestId('chat-compose-template').locator(`option[value="own:${id}"]`)).toHaveCount(0);
    // 一覧 GET は存在しないため、ID を知っていても更新・削除できないことを直叩きで確かめる。
    for (const method of ['PATCH', 'DELETE']) {
      const denied = await apiRequest(colleague.page, `/api/chat/templates/${id}`, {
        method, ...(method === 'PATCH' ? { body: { label: marker, body: marker } } : {}),
      });
      expect(denied.status).toBe(404);
      expect(denied.text).not.toContain(marker);
    }
    await page.goto('/chat?f=templates');
    await page.getByTestId(`chat-template-delete-${id}`).click();
    await page.getByTestId(`chat-template-delete-yes-${id}`).click();
    await expect(page.getByTestId(`chat-template-${id}`)).toHaveCount(0);
    await page.goto(`/chat?thread=${thread}`);
    await expect(page.getByTestId('chat-compose-template')).toBeVisible();
    await expect(page.getByTestId('chat-compose-template').locator(`option[value="own:${id}"]`)).toHaveCount(0);
  } finally {
    try {
      if (id !== undefined) await apiRequest(page, `/api/chat/templates/${id}`, { method: 'DELETE' });
      session.outbound.assertNone();
      colleague.outbound.assertNone();
    } finally { await colleague.close(); await session.close(); }
  }
});
