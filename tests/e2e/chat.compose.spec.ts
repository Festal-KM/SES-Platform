// tests/e2e/chat.compose.spec.ts
// ✅ 2026-10-14（チャットレーン）: `S-031` の送信の流れ（送信の取り消し・今すぐ送る・下書き）。
//
// 🔴 送信は「押してから数秒待って送る」に変わった（`lib/chat/live.ts` の `CHAT_UNDO_SEND_MS`）。
//    待っている間に取り消せること・取り消したら**サーバに 1 件も届いていない**こと・今すぐ送れること
//    を固定する。届いたかどうかは API（#50）を画面の外から撃って確かめる。
import { expect, test } from '@playwright/test';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { openTenantSession, partnerSales } from './support/sessions';

test.describe('S-031 チャット — 送信の取り消し（2026-10-14）', () => {
  test('① 取り消すと文章が入力欄に戻り、サーバには届かない。「今すぐ送る」で 1 件だけ届く', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      await page.goto(`/chat?thread=${own.threadId}`);
      const marker = `e2e-undo-${String(Date.now())}`;

      // 送信 → 待っている間に取り消す。
      await page.getByTestId('chat-compose-body').fill(marker);
      await page.getByTestId('chat-compose-submit').click();
      await expect(page.getByTestId('chat-compose-pending')).toBeVisible();
      await page.getByTestId('chat-compose-undo').click();
      await expect(page.getByTestId('chat-compose-pending')).toHaveCount(0);
      await expect(page.getByTestId('chat-compose-body')).toHaveValue(marker);

      // 🔴 取り消した文章はサーバに届いていない（待ち時間を過ぎても）。
      await page.waitForTimeout(6_000);
      const afterUndo = await apiRequest(page, `/api/threads/${own.threadId}/messages`);
      expect(afterUndo.status).toBe(200);
      expect(afterUndo.text, '🔴 取り消した文章が送られている').not.toContain(marker);

      // 今すぐ送る → 1 件だけ届き、画面にも出る。
      await page.getByTestId('chat-compose-submit').click();
      await page.getByTestId('chat-compose-send-now').click();
      await expect(page.getByTestId('chat-compose-pending')).toHaveCount(0);
      await expect(page.getByTestId('chat-messages')).toContainText(marker);
      await expect(page.getByTestId('chat-compose-body')).toHaveValue('');
      const afterSend = await apiRequest(page, `/api/threads/${own.threadId}/messages`);
      expect(afterSend.text.split(marker).length - 1, '🔴 二重に送られている').toBe(1);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
