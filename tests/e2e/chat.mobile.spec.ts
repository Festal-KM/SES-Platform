// tests/e2e/chat.mobile.spec.ts
// `S-031` チャットのモバイル表示（`CLAUDE.md` §13.2 **Tier 1: モバイル完結**）。2026-10-14、チャットレーン（担当: 紺野）。
//
// 🔴 チャットは「移動中のスマートフォンで返信が発生する」画面であり、モバイルで**操作まで完結**できなければならない
//    （§13.1）。ここでは Pixel 5（`playwright.config.ts` の `mobile-chromium`）で次を固定する:
//   ① 一覧 → 会話の 2 画面遷移（**遮断ではなく切替**。`docs/04` §S-031 デバイス別）と、会話からの戻り道
//   ② 会話型（企業スレッド）の右寄せがモバイルでも保たれる
//   ③ 送信欄が描かれ、横スクロールが出ない（Tier 1 で入力が画面外に逃げない）
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './support/assertions';
import { partnerIds } from './support/population';
import { openTenantSession, partnerSales } from './support/sessions';

test.describe('S-031 チャット — モバイル（Tier 1）', () => {
  test('① 一覧 → 会話 → 一覧に戻れる（遮断しない）', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      await page.goto('/chat');
      // 未選択のときは一覧が全幅で見える。
      await expect(page.getByTestId(`chat-thread-row-${own.threadId}`)).toBeVisible();

      await page.getByTestId(`chat-thread-link-${own.threadId}`).click();
      await expect(page.getByTestId('chat-conversation')).toBeVisible();
      // 選択中は一覧を畳む（会話を全幅で読む）。
      await expect(page.getByTestId(`chat-thread-row-${own.threadId}`)).toBeHidden();

      // 🔴 戻り道が在る（遮断ではなく切替）。
      await page.getByTestId('chat-back-to-list').click();
      await expect(page.getByTestId(`chat-thread-row-${own.threadId}`)).toBeVisible();

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('② 会話型の右寄せがモバイルでも保たれる', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      await page.goto(`/chat?thread=${own.threadId}`);
      const mine = page.getByTestId(`chat-message-${own.partnerMessageId}`);
      const theirs = page.getByTestId(`chat-message-${own.hostMessageId}`);
      await expect(mine).toHaveAttribute('data-layout', 'chat');

      // 自分の吹き出しの右端が、相手の吹き出しの右端より右に在る（位置で見分けられる）。
      const mineBody = await page.getByTestId(`chat-message-body-${own.partnerMessageId}`).boundingBox();
      const theirsBody = await page.getByTestId(`chat-message-body-${own.hostMessageId}`).boundingBox();
      expect(mineBody, '自分の吹き出しが描かれていません').not.toBeNull();
      expect(theirsBody, '相手の吹き出しが描かれていません').not.toBeNull();
      if (mineBody !== null && theirsBody !== null) {
        expect(mineBody.x + mineBody.width).toBeGreaterThan(theirsBody.x + theirsBody.width);
      }
      await expect(theirs).toHaveAttribute('data-own', 'false');

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('③ 送信欄が描かれ、横スクロールが出ない（モバイルで完結）', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      await page.goto(`/chat?thread=${own.threadId}`);
      await expect(page.getByTestId('chat-compose-body')).toBeVisible();
      await expectNoHorizontalOverflow('S-031 モバイル', page);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
