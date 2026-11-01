// tests/e2e/chat.compose.spec.ts
// ✅ 2026-10-14（チャットレーン）: `S-031` の送信の流れ。
// ✅ 2026-10-29（F-038 ⑮）: 5 秒の取り消し待ちをやめ、**押したその場で**自分の発言を出す形に変えた（`lib/chat/outbox.ts`）。
//    押すとすぐ会話に出ること・サーバに 1 件だけ届くこと・送れなかったら「送れませんでした」と「再送」が出ること
//    を固定する。届いたかどうかは API（#50）を画面の外から撃って確かめる。
import { expect, test } from '@playwright/test';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { openTenantSession, partnerSales } from './support/sessions';

test.describe('S-031 チャット — 送った発言をその場で出す（2026-10-29）', () => {
  test('① 押すとすぐ会話に出て、サーバには 1 件だけ届く（取り消し待ちの欄は出ない）', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      await page.goto(`/chat?thread=${own.threadId}`);
      const marker = `e2e-send-${String(Date.now())}`;

      await page.getByTestId('chat-compose-body').fill(marker);
      await page.getByTestId('chat-compose-submit').click();
      await expect(page.getByTestId('chat-messages')).toContainText(marker);
      await expect(page.getByTestId('chat-compose-body')).toHaveValue('');
      // 🔴 旧い取り消し待ちの欄は出ない。
      await expect(page.getByTestId('chat-compose-pending')).toHaveCount(0);
      // 届いたら「送信中」の吹き出しはサーバの発言に置き換わる（手元の吹き出しが残らない）。
      await expect(page.getByTestId('chat-outbox')).toHaveCount(0);

      const afterSend = await apiRequest(page, `/api/threads/${own.threadId}/messages`);
      expect(afterSend.status).toBe(200);
      expect(afterSend.text.split(marker).length - 1, '🔴 二重に送られている').toBe(1);
      // 画面にも 1 回だけ。
      await expect(page.getByTestId('chat-messages').getByText(marker, { exact: true })).toHaveCount(1);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('② 送れなかったら「送れませんでした」と「再送」「取り消す」。取り消すと文章が入力欄に戻る', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      await page.goto(`/chat?thread=${own.threadId}`);
      const marker = `e2e-fail-${String(Date.now())}`;
      // 投稿だけを 1 回失敗させる（サーバには届かない）。
      await page.route(`**/api/threads/${own.threadId}/messages`, (route) =>
        route.request().method() === 'POST' ? route.fulfill({ status: 500, body: '{}' }) : route.fallback(),
      );
      await page.getByTestId('chat-compose-body').fill(marker);
      await page.getByTestId('chat-compose-submit').click();
      const failed = page.locator('[data-testid^="chat-outbox-status-"]');
      await expect(failed).toContainText('送れませんでした');
      await expect(page.locator('[data-testid^="chat-outbox-resend-"]')).toBeVisible();
      await page.locator('[data-testid^="chat-outbox-discard-"]').click();
      await expect(page.getByTestId('chat-outbox')).toHaveCount(0);
      await expect(page.getByTestId('chat-compose-body')).toHaveValue(marker);
      await page.unroute(`**/api/threads/${own.threadId}/messages`);

      const after = await apiRequest(page, `/api/threads/${own.threadId}/messages`);
      expect(after.text, '🔴 失敗させた発言が届いている').not.toContain(marker);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
