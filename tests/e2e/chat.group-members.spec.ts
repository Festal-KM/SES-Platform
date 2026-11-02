// tests/e2e/chat.group-members.spec.ts
// ✅ 2026-11-01（紺野の決定。F-038 改訂 17 / S-031 改訂 48）: グループに後から人を足す。
//   ① 会話の見出しの「メンバーを追加」から開き、いまのメンバーは「参加中」で選べない。取引先とのグループには
//      ほかの取引先が出ない。何も選ばずに押すと足りないものを言う（ボタンは押せる）。
//   ② 「追加した時から」で足すと、トーストが出て会話に戻り、右の欄のメンバーに入る。
//   ③ 🔴 足された人からは、足される前の発言が見えない（API でも 0 件）。
// 🔴 部屋はテストの中で作る（seed:isolation にはグループが無い）。外部送信はしない。
import { expect, test } from '@playwright/test';
import { ISOLATION_SEED_PASSWORD, isolationSeedCompanyNames, isolationSeedEmails } from '@ses/db/seed';
import { apiRequest, parseJson } from './support/api';
import { partnerIds, tenantIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales } from './support/sessions';

const [, PARTNER_2_NAME] = isolationSeedCompanyNames(1).partners;

test('① ② ③ メンバーを追加する（追加した時から）。足された人には前の発言が見えない', async ({ browser }) => {
  const host = await openTenantSession(browser, hostOwner(1));
  const hostSales = tenantIds(1).hostUserId;
  const partner1 = partnerIds(1, 1).userId;
  const partner2 = partnerIds(1, 2).userId;
  const marker = `e2eadd${String(Date.now())}`;
  let groupId = '';
  try {
    const { page } = host;
    await page.goto('/chat');
    // 取引先 1 との部屋を作り、足す前の発言を 1 つ置く。
    const created = await apiRequest(page, '/api/threads/groups', { method: 'POST', body: { title: `追加の確認 ${marker}`, userIds: [partner1] } });
    expect(created.status, created.text).toBe(201);
    groupId = (parseJson(created) as { id: string }).id;
    const sent = await apiRequest(page, `/api/threads/${groupId}/messages`, { method: 'POST', body: { body: `足す前 ${marker}` } });
    expect(sent.status, sent.text).toBe(201);

    await page.goto(`/chat?thread=${groupId}`);
    await page.getByTestId(`chat-add-members-open-${groupId}`).click();
    await expect(page).toHaveURL(/[?&]add=1/);
    await expect(page.getByTestId('chat-add-members')).toBeVisible();
    await expect(page.getByTestId('chat-add-members-rule')).toBeVisible();

    // いまのメンバー（取引先 1 の人）は「参加中」。ほかの取引先は出ない。
    await page.getByTestId('chat-add-members-tab-name').click();
    await expect(page.getByTestId(`chat-add-members-fixed-${partner1}`)).toBeVisible();
    await expect(page.getByTestId(`chat-add-members-member-${partner1}`)).toHaveCount(0);
    await expect(page.getByTestId(`chat-add-members-member-${partner2}`)).toHaveCount(0);
    await expect(page.getByTestId('chat-add-members-by-name')).not.toContainText(PARTNER_2_NAME);

    // 何も選ばずに押すと、足りないものを言う（ボタンは押せる）。
    await expect(page.getByTestId('chat-add-members-submit')).toBeEnabled();
    await page.getByTestId('chat-add-members-submit').click();
    await expect(page.getByTestId('chat-add-members-message')).toBeVisible();

    // 自社の営業を「追加した時から」で足す。
    await page.getByTestId(`chat-add-members-member-${hostSales}`).click();
    await page.getByTestId('chat-add-members-history-JOINED').check();
    await expect(page.getByTestId('chat-add-members-history-note')).toBeVisible();
    await page.getByTestId('chat-add-members-submit').click();
    await expect(page).not.toHaveURL(/[?&]add=1/);
    await expect(page.getByTestId('chat-conversation')).toBeVisible();

    await page.goto(`/chat?thread=${groupId}&info=1`);
    await expect(page.getByTestId(`chat-panel-member-${hostSales}`)).toBeVisible();
  } finally {
    try { host.outbound.assertNone(); } finally { await host.close(); }
  }

  // ③ 足された人（自社の営業）からは、足す前の発言が見えない（API でも 0 件）。
  const added = await openTenantSession(browser, {
    label: 'テナント 1 の SALES',
    email: isolationSeedEmails(1).hostSales,
    password: ISOLATION_SEED_PASSWORD,
    twoFactorRequired: false,
  });
  try {
    const search = await apiRequest(added.page, `/api/threads/${groupId}/messages/search?q=${marker}`);
    expect(search.status).toBe(200);
    expect(search.text).not.toContain(marker);
    const messages = await apiRequest(added.page, `/api/threads/${groupId}/messages`);
    expect(messages.status).toBe(200);
    expect(messages.text).not.toContain(`足す前 ${marker}`);
  } finally {
    try { added.outbound.assertNone(); } finally { await added.close(); }
  }

  // 対照: 最初からのメンバー（取引先 1 の人）には足す前の発言が見える（検査の空振りでない）。
  const original = await openTenantSession(browser, partnerSales(1, 1));
  try {
    const own = await apiRequest(original.page, `/api/threads/${groupId}/messages/search?q=${marker}`);
    expect(own.status).toBe(200);
    expect(own.text).toContain(marker);
  } finally {
    try { original.outbound.assertNone(); } finally { await original.close(); }
  }
});
