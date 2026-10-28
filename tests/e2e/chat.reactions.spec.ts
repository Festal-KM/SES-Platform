import { expect, test } from '@playwright/test';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { openTenantSession, partnerSales } from './support/sessions';

test('リアクションの小窓で 👍 を付け、もう一度押すと外れる', async ({ browser }) => {
  const own = partnerIds(1, 1);
  const session = await openTenantSession(browser, partnerSales(1, 1));
  const { page } = session;
  let id: string | undefined;
  try {
    // seed の発言に他のテストのリアクションを残さないよう、専用の発言を作る。
    const created = await apiRequest(page, `/api/threads/${own.threadId}/messages`, {
      method: 'POST', body: { body: `リアクションの確認 ${Date.now()}` },
    });
    const payload = JSON.parse(created.text) as { id: string };
    id = payload.id;
    expect(created.status).toBe(201);
    await page.goto(`/chat?thread=${own.threadId}`);
    await page.getByTestId(`chat-message-${id}`).hover();
    await page.getByTestId(`chat-message-reaction-add-${id}`).click();
    await page.getByTestId(`chat-message-reaction-pick-${id}-THUMBS_UP`).click();
    const reaction = page.getByTestId(`chat-message-reaction-${id}-THUMBS_UP`);
    await expect(reaction).toContainText('👍');
    await expect(reaction).toContainText('1');
    await reaction.click();
    await expect(reaction).toHaveCount(0);
  } finally {
    try {
      if (id !== undefined) {
        const current = await apiRequest(page, `/api/threads/${own.threadId}/messages`);
        expect(current.status).toBe(200);
        const payload = JSON.parse(current.text) as { items: { id: string; reactions?: { reaction: string; mine: boolean }[] }[] };
        const message = payload.items.find((item) => item.id === id);
        if (message?.reactions?.some((reaction) => reaction.reaction === 'THUMBS_UP' && reaction.mine)) {
          expect((await apiRequest(page, `/api/threads/${own.threadId}/messages/${id}/reactions`, {
            method: 'POST', body: { reaction: 'THUMBS_UP' },
          })).status).toBe(200);
        }
        expect((await apiRequest(page, `/api/threads/${own.threadId}/messages/${id}`, { method: 'DELETE' })).status).toBe(200);
      }
      session.outbound.assertNone();
    } finally { await session.close(); }
  }
});

test('閲覧専用にはリアクションを付けるボタンが出ない', () => {
  test.skip(true, 'support/sessions と seed:isolation に閲覧専用の利用者がいないため、セッションを作れない');
});
