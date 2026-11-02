import { expect, test } from '@playwright/test';
import { partnerIds } from './support/population';
import { hostOwner, openTenantSession } from './support/sessions';

test('左の列の見出し（連絡先）と左の列の開閉を再読み込み後も覚える', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const { page } = session;
  try {
    await page.goto('/chat');
    // ✅ 2026-10-30（F-038 改訂 16 ⑱）: seed の取引先には会社グループの部屋しか無く、左の列に「取引先」が出ないので、
    //    同じ開閉の部品の「連絡先」で確かめる。
    const section = page.getByTestId('chat-rail-section-toggle-contacts');
    const contacts = page.getByTestId('chat-rail-contacts');
    await expect(contacts).toBeVisible();
    await section.click();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(contacts).toBeHidden();
    await page.reload();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(contacts).toBeHidden();
    await section.click();
    await expect(contacts).toBeVisible();
    const toggle = page.getByTestId('chat-rail-desktop-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-chat-rail-container]')).toHaveAttribute('data-collapsed', 'true');
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-chat-rail-container]')).toHaveAttribute('data-collapsed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  } finally {
    try { session.outbound.assertNone(); } finally { await session.close(); }
  }
});

test('スレッド一覧の境目を矢印で動かすと、一覧が広がり会話が狭まる', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const { page } = session;
  const first = partnerIds(1, 1);
  try {
    await page.goto(`/chat?thread=${first.threadId}`);
    const conversation = page.locator(`[data-testid="chat-conversation"][data-thread-id="${first.threadId}"]`);
    await expect(conversation).toBeVisible();
    const separator = page.getByTestId('chat-pane-resize-list');
    await separator.focus();
    const listBefore = Number(await separator.getAttribute('aria-valuenow'));
    const conversationBefore = (await conversation.boundingBox())?.width ?? 0;
    await separator.press('ArrowRight');
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(listBefore);
    await expect.poll(async () => (await conversation.boundingBox())?.width ?? 0).toBeLessThan(conversationBefore);
  } finally {
    try { session.outbound.assertNone(); } finally { await session.close(); }
  }
});

test('会話を二つ並べた境目を右矢印で広げられる', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const { page } = session;
  const first = partnerIds(1, 1);
  const second = partnerIds(1, 2);
  try {
    // ✅ 2026-10-30（F-038 改訂 16 ⑱）: 会社グループの部屋は一覧に出ない（「右に並べる」の行が無い）ので、URL で並べる。
    await page.goto(`/chat?thread=${first.threadId}&pane=${second.threadId}`);
    for (const thread of [first, second]) {
      await expect(page.locator(`[data-testid="chat-conversation"][data-thread-id="${thread.threadId}"]`)).toBeVisible();
    }
    const separator = page.getByTestId('chat-pane-resize-primary');
    await expect(separator).toHaveAttribute('role', 'separator');
    await separator.focus();
    await expect(separator).toBeFocused();
    const before = Number(await separator.getAttribute('aria-valuenow'));
    expect(before).toBeGreaterThanOrEqual(320);
    await separator.press('ArrowRight');
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  } finally {
    try { session.outbound.assertNone(); } finally { await session.close(); }
  }
});
