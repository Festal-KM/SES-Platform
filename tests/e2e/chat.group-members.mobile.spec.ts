// tests/e2e/chat.group-members.mobile.spec.ts
// ✅ 2026-11-01（F-038 改訂 17 / S-031 改訂 48）: スマホ（mobile-chromium）でもグループにメンバーを追加できる（Tier 1）。
//   見出しの「…」→「メンバーを追加」→ 1 列の画面で選んで追加 → 会話に戻る。横にはみ出さない。
// 🔴 部屋はテストの中で作る（seed:isolation にはグループが無い）。外部送信はしない。
import { expect, test } from '@playwright/test';
import { apiRequest, parseJson } from './support/api';
import { tenantIds } from './support/population';
import { hostOwner, openTenantSession } from './support/sessions';

test('スマホ: 「…」からメンバーを追加し、会話に戻る', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const hostSales = tenantIds(1).hostUserId;
  try {
    const { page } = session;
    await page.goto('/chat');
    // 社内だけのグループ（自社の営業と 2 人）。
    const created = await apiRequest(page, '/api/threads/groups', {
      method: 'POST',
      body: { title: `スマホの追加 ${String(Date.now())}`, userIds: [hostSales] },
    });
    expect(created.status, created.text).toBe(201);
    const groupId = (parseJson(created) as { id: string }).id;

    await page.goto(`/chat?thread=${groupId}`);
    await page.getByTestId(`chat-header-menu-${groupId}`).click();
    await page.getByTestId(`chat-add-members-open-${groupId}`).click();
    await expect(page.getByTestId('chat-add-members')).toBeVisible();
    await expect(page.getByTestId('chat-add-members-submit')).toBeVisible();
    // いまのメンバーは「参加中」。
    await page.getByTestId('chat-add-members-tab-name').click();
    await expect(page.getByTestId(`chat-add-members-fixed-${hostSales}`)).toBeVisible();
    // 横にはみ出さない。
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // 戻り道。
    await page.getByTestId('chat-add-members-back').click();
    await expect(page.getByTestId('chat-conversation')).toBeVisible();
  } finally {
    try { session.outbound.assertNone(); } finally { await session.close(); }
  }
});
