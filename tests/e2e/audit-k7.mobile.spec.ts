// tests/e2e/audit-k7.mobile.spec.ts
// 🔴 K-7（`CLAUDE.md` §7「スキルシートの閲覧・DL で監査ログが欠落した件数 = 0 件」）の
//    モバイルビューポート側 E2E（③）。`docs/dev-plan.md` §6.1 K-7 /
//    `docs/sprints/SP-05-engineer-ledger.md` §T-05-10。デスクトップ側（①②④）は
//    `tests/e2e/audit-k7.spec.ts`（別プロジェクト）。
//
// 🔴 「モバイルだから省略する」を作らない（`CLAUDE.md` §13.3）。デスクトップと同じ画面
//    （`S-008`）・同じ API 経路をモバイルビューポート（`mobile-chromium` プロジェクト。
//    `playwright.config.ts` の Pixel 5 エミュレーション）で通し、①閲覧 ②DL の両方が
//    ①1 件ずつ記録され ②`deviceKind` が実際に `mobile` として残ることを見る
//    （`classifyDeviceKind` は User-Agent の `Mobile` トークンで判定する。
//    `apps/web/lib/auth/device.ts`）。
//
// 🔴 前提データの作り方・PUT を Node 側から行う理由・`content-length` を外す理由は
//    `audit-k7.spec.ts` 冒頭コメントと同一（二重に書かない。差分は「ビューポートが Pixel 5」
//    という 1 点だけである）。
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { markSkillSheetClean } from './harness/db-admin';
import { objectStorageOrigin } from './harness/object-storage';
import { apiRequest, auditLogPeriodQuery, parseJson } from './support/api';
import { tenantIds } from './support/population';
import { hostOwner, openTenantSession, type Session } from './support/sessions';

type SkillSheetAuditAction = 'skill_sheet.view' | 'skill_sheet.download';

type AuditLogItem = {
  readonly action: string;
  readonly targetId: string | null;
  readonly deviceKind: string | null;
};

const HOST_OWNER_USER_ID = tenantIds(1).hostOwnerUserId;

/** `audit-k7.spec.ts` の同名関数と同一実装（プロジェクトをまたぐため import で共有できない）。 */
async function skillSheetAuditRows(
  session: Session,
  action: SkillSheetAuditAction,
  skillSheetId: string,
): Promise<readonly AuditLogItem[]> {
  const period = auditLogPeriodQuery();
  const response = await apiRequest(
    session.page,
    `/api/audit-logs?${period}&action=ENGINEER_SKILL_SHEET_ACCESS&actorId=${HOST_OWNER_USER_ID}&limit=200`,
  );
  expect(response.status, 'GET /api/audit-logs が失敗しました').toBe(200);
  const body = parseJson(response) as { items: readonly AuditLogItem[] };
  return body.items.filter((item) => item.action === action && item.targetId === skillSheetId);
}

async function provisionCleanSkillSheet(
  session: Session,
  label: string,
): Promise<{ readonly engineerId: string; readonly skillSheetId: string }> {
  const displayName = `K7合成-${label}-${randomUUID().slice(0, 8)}`;

  const createdResponse = await apiRequest(session.page, '/api/engineers', {
    method: 'POST',
    body: { displayName },
  });
  expect(createdResponse.status, 'POST /api/engineers が失敗しました').toBe(201);
  const { id: engineerId } = parseJson(createdResponse) as { id: string };

  const fileBytes = Buffer.from(`K-7 fixture (${displayName})\n`.repeat(64), 'utf8');

  const ticketResponse = await apiRequest(
    session.page,
    `/api/engineers/${engineerId}/skill-sheets/upload-url`,
    {
      method: 'POST',
      body: {
        fileName: 'skill-sheet-e2e.pdf',
        contentType: 'application/pdf',
        byteSize: fileBytes.byteLength,
      },
    },
  );
  expect(ticketResponse.status, 'upload-url（#18）の発行に失敗しました').toBe(201);
  const ticket = parseJson(ticketResponse) as {
    readonly objectKey: string;
    readonly uploadUrl: string;
    readonly requiredHeaders: Readonly<Record<string, string>>;
  };

  const putHeaders = Object.fromEntries(
    Object.entries(ticket.requiredHeaders).filter(([key]) => key.toLowerCase() !== 'content-length'),
  );
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: putHeaders, body: fileBytes });
  expect(put.status, `MinIO への PUT に失敗しました（status=${put.status}）`).toBeLessThan(300);

  const confirmResponse = await apiRequest(
    session.page,
    `/api/engineers/${engineerId}/skill-sheets`,
    { method: 'POST', body: { objectKey: ticket.objectKey, note: null } },
  );
  expect(confirmResponse.status, '確定（#19）に失敗しました').toBe(201);
  const confirmed = parseJson(confirmResponse) as { readonly id: string; readonly scanStatus: string };
  expect(confirmed.scanStatus).toBe('SCANNING');

  markSkillSheetClean(confirmed.id);

  return { engineerId, skillSheetId: confirmed.id };
}

test.describe('K-7: ③ モバイルビューポートの閲覧・DL（deviceKind=mobile。CLAUDE.md §13.3）', () => {
  test('モバイルの閲覧（#21）で skill_sheet.view が 0→1 件（deviceKind=mobile）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const { engineerId, skillSheetId } = await provisionCleanSkillSheet(session, 'mview');

      expect(
        await skillSheetAuditRows(session, 'skill_sheet.view', skillSheetId),
      ).toHaveLength(0);

      await session.page.goto(`/engineers/${engineerId}/skill-sheets`, {
        waitUntil: 'domcontentloaded',
      });
      // 🔴 モバイルでも同じ testid で到達できる（`S-008` は Tier 3 だが遮断しない。
      //    `skill-sheet-screen.tsx` 冒頭「表は横スクロールで劣化させ、非表示にはしない」）。
      await expect(session.page.getByTestId('skill-sheet-screen')).toBeVisible();
      await session.page.getByTestId(`skill-sheet-preview-${skillSheetId}`).click();
      await expect(
        session.page.getByTestId(`skill-sheet-preview-panel-${skillSheetId}`),
      ).toBeVisible();

      const rows = await skillSheetAuditRows(session, 'skill_sheet.view', skillSheetId);
      expect(rows, 'モバイルの閲覧も 1 件だけ記録される（欠落 0 件 = BR-28）').toHaveLength(1);
      expect(rows[0]?.deviceKind, 'モバイルの閲覧は deviceKind=mobile').toBe('mobile');

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('モバイルの DL（#20）で skill_sheet.download が 0→1 件、実ファイルが取得できる（deviceKind=mobile）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1), {
      extraAllowedOrigins: [objectStorageOrigin()],
    });
    try {
      const { engineerId, skillSheetId } = await provisionCleanSkillSheet(session, 'mdl');

      expect(
        await skillSheetAuditRows(session, 'skill_sheet.download', skillSheetId),
      ).toHaveLength(0);

      await session.page.goto(`/engineers/${engineerId}/skill-sheets`, {
        waitUntil: 'domcontentloaded',
      });
      const downloadButton = session.page.getByTestId(`skill-sheet-download-${skillSheetId}`);
      await expect(downloadButton).toBeVisible();

      const [download] = await Promise.all([
        session.page.waitForEvent('download'),
        downloadButton.click(),
      ]);

      expect(download.suggestedFilename()).toBe('skill-sheet-v1.pdf');
      const path = await download.path();
      expect(path).not.toBeNull();
      const savedText = await readFile(path as string, 'utf8');
      expect(savedText).toContain('K7合成-mdl-');

      const rows = await skillSheetAuditRows(session, 'skill_sheet.download', skillSheetId);
      expect(rows, 'モバイルの DL も 1 件だけ記録される（欠落 0 件 = BR-28）').toHaveLength(1);
      expect(rows[0]?.deviceKind, 'モバイルの DL は deviceKind=mobile').toBe('mobile');

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
