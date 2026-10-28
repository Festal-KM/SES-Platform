import { expect, test } from '@playwright/test';
import { partnerIds } from './support/population';
import { hostOwner, openTenantSession } from './support/sessions';

test('取引先の見出しと左の列の開閉を再読み込み後も覚える', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const { page } = session;
  try {
    await page.goto('/chat');
    const section = page.getByTestId('chat-rail-section-toggle-companies');
    const companies = page.getByTestId('chat-rail-companies');
    await expect(companies).toBeVisible();
    await section.click();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(companies).toBeHidden();
    await page.reload();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(companies).toBeHidden();
    await section.click();
    await expect(companies).toBeVisible();
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

test('会話を二つ並べた境目を右矢印で広げられる', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const { page } = session;
  const first = partnerIds(1, 1);
  const second = partnerIds(1, 2);
  try {
    await page.goto(`/chat?thread=${first.threadId}`);
    await page.getByTestId(`chat-thread-row-${second.threadId}`).hover();
    await page.getByTestId(`chat-thread-open-beside-${second.threadId}`).click();
    await expect(page).toHaveURL(new RegExp(`pane=${second.threadId}`));
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
