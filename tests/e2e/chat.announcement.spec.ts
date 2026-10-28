// S-031 / F-038 AC-12: アナウンスの操作と取引先の境界を固定する。
// 閲覧専用の利用者は seed:isolation にいないため、この spec では検査しない。
import { expect, test, type Page } from '@playwright/test';
import { apiRequest } from './support/api';
import { foreignPartnerMarkers, partnerIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';
import { expectNoHorizontalOverflow } from './support/assertions';

const first = partnerIds(1, 1);
const second = partnerIds(1, 2);
const path = (threadId: string) => `/api/threads/${threadId}/announcement`;

async function announce(page: Page, threadId: string, messageId: string): Promise<void> {
  await page.getByTestId(`chat-message-${messageId}`).hover();
  await page.getByTestId(`chat-message-announce-${messageId}`).click();
  await expect(page.getByTestId(`chat-announcement-${threadId}`)).toHaveAttribute('data-message-id', messageId);
}

// 途中のアサーションで落ちても、設定した可能性のある発言をすべて外す。
// DELETE は発言 ID が一致するときだけ消すので、置き換え前の ID でも安全に呼べる。
async function cleanup(page: Page, threadId: string, messageIds: readonly string[]): Promise<void> {
  for (const messageId of messageIds) {
    const response = await apiRequest(page, path(threadId), { method: 'DELETE', body: { messageId } });
    expect(response.status, '後片付けでアナウンスを外す').toBe(200);
  }
  const response = await apiRequest(page, path(threadId));
  expect(response.status).toBe(200);
  expect(JSON.parse(response.text)).toEqual({ announcement: null });
}

test.describe('S-031 チャット — アナウンス', () => {
  test('発言から設定し、本文と設定者を読める。帯から移動し、別の発言に置き換えて外せる', async ({ browser }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const { page } = session;
    try {
      await page.goto(`/chat?thread=${first.threadId}`);
      await expect(page.getByTestId('chat-conversation')).toBeVisible();
      const body = await page.getByTestId(`chat-message-body-${first.partnerMessageId}`).innerText();
      await announce(page, first.threadId, first.partnerMessageId);
      const bar = page.getByTestId(`chat-announcement-${first.threadId}`);
      await expect(page.getByTestId(`chat-announcement-body-${first.threadId}`)).toHaveText(body);
      // 設定者の名前は API の認証結果に基づく表示と照合する（seed の乱数名を決め打ちしない）。
      const saved = await apiRequest(page, path(first.threadId));
      expect(saved.status).toBe(200);
      const result = JSON.parse(saved.text) as { announcement: { setByName: string } };
      expect(result.announcement.setByName).toBeTruthy();
      await expect(page.getByTestId(`chat-announcement-meta-${first.threadId}`)).toContainText(`${result.announcement.setByName}さんが設定`);
      await expect(async () => {
        const heading = await page.getByTestId('chat-conversation-title').boundingBox();
        const band = await bar.boundingBox();
        expect(heading).not.toBeNull();
        expect(band).not.toBeNull();
        if (heading && band) expect(band.y).toBeGreaterThanOrEqual(heading.y + heading.height);
      }).toPass({ timeout: 15_000 });

      // seed は発言が 2 件で初めから画面内に収まる。移動が無処理でも通らないよう、
      // 実際のスクロールは保ちつつ、移動先の要素も記録する。
      const destinations = await page.evaluateHandle(() => {
        const ids: (string | null)[] = [];
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (options) {
          ids.push(this.getAttribute('data-testid'));
          original.call(this, options);
        };
        return ids;
      });
      await page.getByTestId(`chat-announcement-jump-${first.threadId}`).click();
      expect(await destinations.jsonValue()).toContain(`chat-message-${first.partnerMessageId}`);
      await expect(page.getByTestId(`chat-message-${first.partnerMessageId}`)).toBeInViewport();
      await expect(page.getByTestId(`chat-announcement-not-loaded-${first.threadId}`)).toHaveCount(0);
      await destinations.dispose();

      await announce(page, first.threadId, first.hostMessageId);
      await expect(bar).toHaveCount(1);
      const replacement = await page.getByTestId(`chat-message-body-${first.hostMessageId}`).innerText();
      await expect(page.getByTestId(`chat-announcement-body-${first.threadId}`)).toHaveText(replacement);
      await expect(page.getByTestId(`chat-message-announce-${first.partnerMessageId}`)).toHaveAttribute('aria-pressed', 'false');
      await page.getByTestId(`chat-announcement-clear-${first.threadId}`).click();
      await expect(bar).toHaveCount(0);
      session.outbound.assertNone();
    } finally {
      try { await cleanup(page, first.threadId, [first.partnerMessageId, first.hostMessageId]); }
      finally { await session.close(); }
    }
  });

  test('会話を切り替えると前の会話の帯が残らない', async ({ browser }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const { page } = session;
    try {
      await page.goto(`/chat?thread=${first.threadId}`);
      await announce(page, first.threadId, first.partnerMessageId);
      await page.getByTestId(`chat-thread-link-${second.threadId}`).click();
      await expect(page.getByTestId('chat-conversation')).toHaveAttribute('data-thread-id', second.threadId);
      await expect(page.getByTestId(`chat-message-${second.partnerMessageId}`)).toBeVisible();
      await expect(page.getByTestId(`chat-announcement-${first.threadId}`)).toHaveCount(0);
      await expect(page.getByTestId(`chat-announcement-${second.threadId}`)).toHaveCount(0);
      await page.getByTestId(`chat-thread-link-${first.threadId}`).click();
      await expect(page.getByTestId(`chat-announcement-${first.threadId}`)).toHaveAttribute('data-message-id', first.partnerMessageId);
      session.outbound.assertNone();
    } finally {
      try { await cleanup(page, first.threadId, [first.partnerMessageId]); }
      finally { await session.close(); }
    }
  });

  test('スマホの幅でも帯を読めて、44px 以上の「外す」を押せる', async ({ browser }) => {
    const session = await openTenantSession(browser, partnerSales(1, 1));
    const { page } = session;
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/chat?thread=${first.threadId}`);
      const seeded = await apiRequest(page, path(first.threadId), { method: 'PUT', body: { messageId: first.partnerMessageId } });
      expect(seeded.status).toBe(200);
      await page.reload();
      await expect(page.getByTestId(`chat-announcement-body-${first.threadId}`)).toBeVisible();
      const clear = page.getByTestId(`chat-announcement-clear-${first.threadId}`);
      await expect(clear).toBeInViewport();
      await expect(async () => {
        const box = await clear.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
      }).toPass({ timeout: 15_000 });
      await expectNoHorizontalOverflow('アナウンスの帯（390px）', page);
      await clear.click();
      await expect(page.getByTestId(`chat-announcement-${first.threadId}`)).toHaveCount(0);
      session.outbound.assertNone();
    } finally {
      try { await cleanup(page, first.threadId, [first.partnerMessageId]); }
      finally { await session.close(); }
    }
  });

  test('取引先 A が取引先 B のアナウンスを直接 GET しても 404 で本文が漏れない', async ({ browser }) => {
    const owner = await openTenantSession(browser, hostOwner(1));
    try {
      const seeded = await apiRequest(owner.page, path(second.threadId), { method: 'PUT', body: { messageId: second.partnerMessageId } });
      expect(seeded.status).toBe(200);
      const control = await apiRequest(owner.page, path(second.threadId));
      expect(control.status).toBe(200);
      const saved = JSON.parse(control.text) as { announcement: { snippet: string; messageId: string } };
      expect(saved.announcement.messageId).toBe(second.partnerMessageId);
      expect(saved.announcement.snippet).toBeTruthy();
      const partner = await openTenantSession(browser, partnerSales(1, 1));
      try {
        const foreign = await apiRequest(partner.page, path(second.threadId));
        expect(foreign.status, '他社の部屋は不存在と同じ 404').toBe(404);
        expect(foreign.text).not.toContain(saved.announcement.snippet);
        for (const marker of foreignPartnerMarkers(1, 2)) expect(foreign.text).not.toContain(marker);
        partner.outbound.assertNone();
      } finally { await partner.close(); }
      owner.outbound.assertNone();
    } finally {
      try { await cleanup(owner.page, second.threadId, [second.partnerMessageId]); }
      finally { await owner.close(); }
    }
  });
});
