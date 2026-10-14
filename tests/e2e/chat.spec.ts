// tests/e2e/chat.spec.ts
// `S-031` チャット（`CLAUDE.md` §3.1 **越境経路 3**）の E2E。2026-10-13、チャットレーン（担当: 紺野）。
//
// 🔴 それまでチャットの E2E は 1 本も無かった（`HANDOFF.md` / `a05d017`）。境界の回帰が
//    「誰も気づかないまま main に入る」状態を埋めるため、まず**情報境界**と**並べ方**を固定する。
//
// シナリオ（`seed:isolation` = 2 テナント × 2 パートナー。各パートナーに企業スレッド 1 本と発言 2 件）:
//   ① 取引先は自社のスレッドだけを読める。同じテナントの他の取引先のスレッドは、一覧に現れず、
//      直叩きは 404（不存在と区別しない）。本文も 1 バイトも返らない
//   ② 他テナントのスレッドも同じく 404
//   ③ 企業スレッド（会話型）: 取引先から見た自分の発言は右寄せ（`data-layout="chat"`）、
//      ホストの発言は左（名前つき）
//
// 🔴 API は画面を経由せずに撃つ（`support/api.ts`。UI で隠しているだけではないことの証明）。
import { expect, test } from '@playwright/test';
import { apiRequest } from './support/api';
import { partnerIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';
import { isolationSeedCompanyNames } from '@ses/db/seed';

test.describe('S-031 チャット — 越境経路 3 の境界', () => {
  test('① 取引先は自社のスレッドだけを読め、同じテナントの他の取引先のスレッドは見えない', async ({
    browser,
  }) => {
    const own = partnerIds(1, 1);
    const other = partnerIds(1, 2);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const list = await apiRequest(session.page, '/api/threads');
      expect(list.status, '一覧の取得').toBe(200);
      expect(list.text, '自社のスレッドは一覧に出る（対照）').toContain(own.threadId);
      expect(list.text, '🔴 他の取引先のスレッドが一覧に出ている').not.toContain(other.threadId);

      const mine = await apiRequest(session.page, `/api/threads/${own.threadId}/messages`);
      expect(mine.status, '自社のスレッドの会話（対照）').toBe(200);
      expect(mine.text).toContain(own.partnerMessageId);
      expect(mine.text).toContain(own.hostMessageId);

      const foreign = await apiRequest(session.page, `/api/threads/${other.threadId}/messages`);
      expect(foreign.status, '🔴 他の取引先のスレッドは不存在と同じ 404').toBe(404);
      expect(foreign.text, '🔴 他の取引先の発言 ID が応答に現れている').not.toContain(other.partnerMessageId);
      expect(foreign.text).not.toContain(other.hostMessageId);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('② 他テナントのスレッドも 404（テナント境界）', async ({ browser }) => {
    const foreignTenant = partnerIds(2, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const list = await apiRequest(session.page, '/api/threads');
      expect(list.status).toBe(200);
      expect(list.text, '🔴 他テナントのスレッドが一覧に出ている').not.toContain(foreignTenant.threadId);

      const foreign = await apiRequest(session.page, `/api/threads/${foreignTenant.threadId}/messages`);
      expect(foreign.status, '🔴 他テナントのスレッドは不存在と同じ 404').toBe(404);
      expect(foreign.text).not.toContain(foreignTenant.partnerMessageId);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});

test.describe('S-031 チャット — 並べ方（2026-10-13、Lark 寄せ）', () => {
  test('③ 企業スレッド（会話型）: 自分の発言は右寄せ、相手の発言は左で名前つき', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      await session.page.goto(`/chat?thread=${own.threadId}`);
      await expect(session.page.getByTestId('chat-conversation')).toBeVisible();

      // 取引先から見て、自社（パートナー）の発言 = 自分の発言。
      const mine = session.page.getByTestId(`chat-message-${own.partnerMessageId}`);
      await expect(mine).toHaveAttribute('data-own', 'true');
      await expect(mine).toHaveAttribute('data-layout', 'chat');
      await expect(session.page.getByTestId(`chat-message-sender-${own.partnerMessageId}`)).toHaveCount(0);

      // ホストの発言 = 相手の発言。左に名前つきで出る。
      const theirs = session.page.getByTestId(`chat-message-${own.hostMessageId}`);
      await expect(theirs).toHaveAttribute('data-own', 'false');
      await expect(session.page.getByTestId(`chat-message-sender-${own.hostMessageId}`)).toBeVisible();

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});

// ✅ 2026-10-14（チャットレーン）: 会話を右に並べて開く（`?pane=`。`lib/chat/panes.ts`）。
test.describe('S-031 チャット — 会話を右に並べる（2026-10-14）', () => {
  test('④ ホストは 2 社の会話を左右に並べて開き、「閉じる」で 1 列に戻せる', async ({ browser }) => {
    const first = partnerIds(1, 1);
    const second = partnerIds(1, 2);
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const { page } = session;
      await page.goto(`/chat?thread=${first.threadId}`);
      await expect(page.locator(`[data-testid="chat-conversation"][data-thread-id="${first.threadId}"]`)).toBeVisible();

      // ドラッグの代わりの導線（一覧の「右に並べる」）。
      await page.getByTestId(`chat-thread-open-beside-${second.threadId}`).click();
      await expect(page).toHaveURL(new RegExp(`pane=${second.threadId}`));
      const left = page.locator(`[data-testid="chat-conversation"][data-thread-id="${first.threadId}"]`);
      const right = page.locator(`[data-testid="chat-conversation"][data-thread-id="${second.threadId}"]`);
      await expect(left).toBeVisible();
      await expect(right).toBeVisible();
      await expect(right.getByTestId(`chat-message-${second.partnerMessageId}`)).toBeVisible();
      // 並べている間は、どの会話の情報か決まらないので右のスレッド情報を出さない。
      await expect(page.getByTestId('chat-panel')).toHaveCount(0);

      // 再読込しても同じ並びに戻る（並びは URL が持つ）。
      await page.reload();
      await expect(right).toBeVisible();

      await page.getByTestId(`chat-pane-close-${second.threadId}`).click();
      await expect(right).toHaveCount(0);
      await expect(left).toBeVisible();
      await expect(page.getByTestId('chat-panel')).toBeVisible();

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('⑤ 🔴 取引先が URL に他の取引先のスレッドを並べても、中身は 1 文字も出ない', async ({ browser }) => {
    const own = partnerIds(1, 1);
    const other = partnerIds(1, 2);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      const response = await page.goto(`/chat?thread=${own.threadId}&pane=${other.threadId}`);
      const html = (await response?.text()) ?? '';
      // 不存在と同じ「表示できません」（他社・他テナントを区別しない）。
      await expect(page.getByTestId(`chat-pane-missing-${other.threadId}`)).toBeVisible();
      expect(html, '🔴 他の取引先の発言 ID が画面に出ている').not.toContain(other.partnerMessageId);
      expect(html).not.toContain(other.hostMessageId);
      expect(html, '🔴 他の取引先の本文が画面に出ている').not.toContain('seed-forbidden-message-body-p2-t1');
      // 自社の会話は普通に読める（対照）。
      await expect(page.getByTestId(`chat-message-${own.partnerMessageId}`)).toBeVisible();

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});

// ✅ 2026-10-14（チャットレーン）: 一覧を会社ごとの木にし、検索・並べ替えを足した（`lib/chat/thread-tree.ts`）。
test.describe('S-031 チャット — 会社ごとの一覧・検索（2026-10-14）', () => {
  test('⑥ ホストが会社名で検索すると、その会社のチャットだけが残り、会話を開いても検索が保たれる', async ({
    browser,
  }) => {
    const first = partnerIds(1, 1);
    const second = partnerIds(1, 2);
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const { page } = session;
      await page.goto('/chat');
      // 2 社ぶんのチャットが一覧に出ている（対照）。
      await expect(page.getByTestId(`chat-thread-row-${first.threadId}`)).toBeVisible();
      await expect(page.getByTestId(`chat-thread-row-${second.threadId}`)).toBeVisible();

      // 🔴 seed の会社名（`isolationSeedCompanyNames`。架空の社名）で検索する（実在しない語で 0 件を見ても検査にならない）。
      const firstName = isolationSeedCompanyNames(1).partners[0];
      await page.getByTestId('chat-threads-q').fill(firstName);
      await page.getByTestId('chat-threads-search-submit').click();
      await expect(page).toHaveURL(/[?&]q=/);
      await expect(page.getByTestId(`chat-thread-row-${first.threadId}`)).toBeVisible();
      await expect(page.getByTestId(`chat-thread-row-${second.threadId}`)).toHaveCount(0);

      // 会話を開いても検索語は URL に残る。
      await page.getByTestId(`chat-thread-link-${first.threadId}`).click();
      await expect(page.locator(`[data-testid="chat-conversation"][data-thread-id="${first.threadId}"]`)).toBeVisible();
      await expect(page.getByTestId('chat-threads-q')).toHaveValue(firstName);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('⑦ 🔴 取引先が他の取引先の会社名で検索しても、何も出ない（存在を探れない）', async ({ browser }) => {
    const other = partnerIds(1, 2);
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const { page } = session;
      // 🔴 他の取引先の**実在する**社名で検索する（ホストからは当たる語であることを対照で確かめる）。
      const otherName = isolationSeedCompanyNames(1).partners[1];
      const response = await page.goto(`/chat?q=${encodeURIComponent(otherName)}`);
      const html = (await response?.text()) ?? '';
      await expect(page.getByTestId('chat-threads-search-empty')).toBeVisible();
      expect(html, '🔴 他の取引先のスレッド ID が画面に出ている').not.toContain(other.threadId);
      expect(html, '🔴 他の取引先の社名が一覧に出ている').not.toContain(`chat-thread-counterparty-${other.threadId}`);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
