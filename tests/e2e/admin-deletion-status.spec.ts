// tests/e2e/admin-deletion-status.spec.ts
// 🔴 docs/05 §17.3 E2E #16（T-10-10）: **削除完了の確認が `A-010` の 1 本からしか取れない**（`F-062 AC-7` / `F-064 AC-2` /
//    `BR-40` / docs/04 program-design 申し送り 15 / `CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラーであって内容ではない」）。
//
// 前提は `harness/db-admin.ts` の T-10-10 シームが仕込む: `PURGED` に到達した合成テナント + `TenantPurgeRun`
// （FAILED〔失敗理由あり〕→ 再試行で COMPLETED〔件数あり〕）。`tenant.purge` を実際に動かさない理由は結合 #17 と同じ
// （`CLOSING` へ入れる操作が Phase 1 に無く、30 日を進める手段も無い。削除そのものは `tests/isolation/tenant-purge.test.ts`）。
//
//   ① 運営者（`PLATFORM_OWNER`）が `A-003` → 「削除完了の確認を開く」→ `A-010`（`/admin/tenants/{id}/contract`）に到達し、
//      「削除完了（YYYY-MM-DD、対象 N 件）」と対象種別ごとの件数が出る。**削除された内容・返却データ・失敗理由は HTML に無い。**
//   ② 🔴 `A-003` の HTML と API-A3 の JSON に件数（`counts` / `purgeRuns`）が無い（ライフサイクル状態と導線だけ）。
//   ③ 🔴 API-A8（`A-005`）に完了の事実が無い: 後に `COMPLETED` がある失敗は項目 7 から落ち、`completedAt` / `counts` のキーも無い。
//   ④ 🔴 API-A12 の JSON: 禁止キー（`tests/support/admin-forbidden-keys.ts`。`failureReason` を含む）がどの深さにも無く、
//      仕込んだ失敗理由の値も無く、`purgeRuns[*]` のキー集合は `{ cause, status, startedAt, completedAt, counts }` に固定。
//   ⑤ `PLATFORM_SUPPORT` でも `A-010` と API-A12 が読める（`F-062 AC-7`）。書き込み導線（停止 / 解約 / 再実行）は HTML に無い。
//
// 🔴 直列（`workers: 1`）。仕込みは `beforeAll`、後始末は `afterAll`（後続の spec に合成テナントを残さない）。
import { expect, test, type Browser } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { collectForbiddenKeySightings } from '../support/admin-forbidden-keys';
import {
  plantDeletionStatusFixturesForE2e,
  removeDeletionStatusFixturesForE2e,
  T1010_DELETION_STATUS_MARKERS,
  T1010_DELETION_STATUS_TENANT_ID,
} from './harness/db-admin';
import { apiRequest, parseJson } from './support/api';
import { expectNoEmailsOfDomainExcept, expectNoMarkers } from './support/assertions';
import { isolationSeedEmailDomain, operatorNonDisclosureMarkers, platformUserEmails, tenantIds } from './support/population';
import { openPlatformSession, platformSupport, type Session } from './support/sessions';

const TENANT = T1010_DELETION_STATUS_TENANT_ID;
const COUNTS = T1010_DELETION_STATUS_MARKERS.completedCounts;
const TOTAL = COUNTS.engineers + COUNTS.skill_sheets + COUNTS.messages;
const COUNT_MARKER = String(COUNTS.engineers);

/** 🔴 どの応答にも現れてはならない値（失敗理由 + seed の非開示値）。 */
function forbiddenEverywhere(): readonly string[] {
  return [...operatorNonDisclosureMarkers(), T1010_DELETION_STATUS_MARKERS.failureReason];
}

/** 🔴 削除完了の確認そのもの（件数）。API-A12 / `A-010` 以外に現れてはならない。 */
const CONFIRMATION_MARKERS: readonly string[] = [COUNT_MARKER, 'purgeRuns', 'deletionCounts'];

async function pageContent(session: Session, path: string): Promise<string> {
  const response = await session.page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 0, `${path} が 5xx を返しました`).toBeLessThan(500);
  return session.page.content();
}

/** JSON をどの深さまでも歩き、キー名を集める。 */
function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

test.beforeAll(() => {
  plantDeletionStatusFixturesForE2e();
});

test.afterAll(() => {
  removeDeletionStatusFixturesForE2e();
});

test.describe('E2E #16 削除完了の確認は A-010 の 1 本からしか取れない（F-062 AC-7 / BR-40）', () => {
  test('🔴 A-003 → A-010 で完了と件数が出る。A-003 / API-A3 / API-A8 に件数が無く、API-A12 に failureReason が無い', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(120_000);
    const session = await openPlatformSession(browser);
    try {
      // --- ① 対照: ACTIVE のテナント（seed）には A-010 への導線が無い（CLOSING / PURGED のときだけ描く）------------
      const activeHtml = await pageContent(session, `/admin/tenants/${tenantIds(1).tenantId}`);
      expect(activeHtml).not.toContain('admin-tenant-detail-deletion-status-link');

      // --- ② A-003（PURGED）: ライフサイクル状態のみ + A-010 への導線。件数は無い ---------------------------------------
      const detailHtml = await pageContent(session, `/admin/tenants/${TENANT}`);
      expect(detailHtml).toContain(t('admin.tenantDetail.purged.notice'));
      expect(detailHtml).toContain('admin-tenant-detail-deletion-status-link');
      expectNoMarkers('A-003 テナント詳細（PURGED）', detailHtml, [...forbiddenEverywhere(), ...CONFIRMATION_MARKERS]);
      expect(detailHtml).not.toContain(t('admin.deletionStatus.completed.prefix'));

      const detailApi = await apiRequest(session.page, `/api/admin/tenants/${TENANT}`);
      expect(detailApi.status).toBe(200);
      const detailJson = parseJson(detailApi) as { lifecycleState: string };
      expect(detailJson.lifecycleState).toBe('PURGED');
      expectNoMarkers('API-A3', detailApi.text, [...forbiddenEverywhere(), ...CONFIRMATION_MARKERS]);
      for (const key of ['counts', 'purgeRuns', 'deletionCounts']) expect(collectKeys(detailJson).has(key), `API-A3 に ${key}`).toBe(false);

      // --- ③ API-A8（A-005）: 後に COMPLETED がある失敗は項目 7 から落ち、完了の事実（completedAt / counts）は無い --------
      const monitoring = await apiRequest(session.page, '/api/admin/monitoring');
      expect(monitoring.status).toBe(200);
      const monitoringJson = parseJson(monitoring) as { items: Array<{ kind: string; rows?: Array<{ tenantId: string }> }> };
      const purgeFailed = monitoringJson.items.find((item) => item.kind === 'PURGE_JOB_FAILED');
      expect(purgeFailed, 'API-A8 に PURGE_JOB_FAILED が無い').toBeDefined();
      expect(purgeFailed?.rows?.some((row) => row.tenantId === TENANT)).toBe(false);
      expectNoMarkers('API-A8', monitoring.text, [...forbiddenEverywhere(), ...CONFIRMATION_MARKERS]);
      expect(collectKeys(purgeFailed).has('counts')).toBe(false);
      expect([...collectKeys(purgeFailed)].some((key) => /^completed/i.test(key))).toBe(false);

      // --- ① A-003 の導線から A-010 へ。完了（日付・合計）と対象種別ごとの件数が出る ---------------------------------------
      await session.page.goto(`/admin/tenants/${TENANT}`, { waitUntil: 'domcontentloaded' });
      await session.page.getByTestId('admin-tenant-detail-deletion-status-link').click();
      await expect(session.page).toHaveURL(new RegExp(`/admin/tenants/${TENANT}/contract$`));
      await expect(session.page.getByTestId('admin-deletion-status-completed')).toBeVisible({ timeout: 30_000 });
      await expect(session.page.getByTestId('admin-deletion-status-total')).toHaveText(String(TOTAL));
      await expect(session.page.getByTestId('admin-deletion-status-count-engineers')).toContainText(COUNT_MARKER);
      await expect(session.page.getByTestId('admin-deletion-status-run-FAILED')).toBeVisible();
      const contractHtml = await session.page.content();
      expect(contractHtml).toContain(t('admin.deletionStatus.title'));
      expect(contractHtml).toContain(t('admin.deletionStatus.completed.prefix'));
      expectNoMarkers('A-010 削除完了の確認', contractHtml, forbiddenEverywhere());
      expectNoEmailsOfDomainExcept('A-010 削除完了の確認', contractHtml, isolationSeedEmailDomain(), platformUserEmails());
      // 🔴 書き込み導線・返却データへの導線・「閲覧のみ」バッジ（書き込みが許される画面。docs/04 §4.9）が無い。
      //    クライアント遷移後の `page.content()` には直前の `A-003` の RSC ペイロード（`<script>`）が残るため、
      //    `A-010` の `<main>` の DOM だけを見る。
      const screenHtml = await session.page.getByTestId('admin-deletion-status-screen').evaluate((node) => node.outerHTML);
      for (const absent of ['<button', '<form', 'downloadUrl', 'data-exports', t('admin.readOnly.badge')]) {
        expect(screenHtml, `A-010 に ${absent}`).not.toContain(absent);
      }

      // --- ④ API-A12: 禁止キー 0 件・失敗理由 0 件・キー集合固定 --------------------------------------------------------
      const status = await apiRequest(session.page, `/api/admin/tenants/${TENANT}/deletion-status`);
      expect(status.status, status.text.slice(0, 200)).toBe(200);
      const statusJson = parseJson(status) as {
        tenantId: string;
        lifecycleState: string;
        purgeRuns: Array<{ status: string; counts: Record<string, number> }>;
      };
      expect(collectForbiddenKeySightings(statusJson, 'API-A12'), 'API-A12 に禁止キー').toEqual([]);
      expectNoMarkers('API-A12', status.text, forbiddenEverywhere());
      expectNoEmailsOfDomainExcept('API-A12', status.text, isolationSeedEmailDomain(), platformUserEmails());
      expect(Object.keys(statusJson).sort()).toEqual(['lifecycleState', 'purgeRuns', 'tenantId']);
      expect(statusJson.lifecycleState).toBe('PURGED');
      expect(statusJson.purgeRuns.map((run) => run.status)).toEqual(['COMPLETED', 'FAILED']);
      for (const run of statusJson.purgeRuns) {
        expect(Object.keys(run).sort()).toEqual(['cause', 'completedAt', 'counts', 'startedAt', 'status']);
      }
      expect(statusJson.purgeRuns[0]?.counts).toEqual({ engineers: COUNTS.engineers, messages: COUNTS.messages, skill_sheets: COUNTS.skill_sheets });
      expect(statusJson.purgeRuns[1]?.counts).toEqual({});

      // 存在しないテナントは 404（存在の示唆をしない）。
      const missing = await apiRequest(session.page, '/api/admin/tenants/0193b110-0000-7000-8000-0000000010ff/deletion-status');
      expect(missing.status).toBe(404);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('⑤ PLATFORM_SUPPORT でも A-010 と API-A12 が読める（F-062 AC-7）。書き込み導線は無い', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(120_000);
    const session = await openPlatformSession(browser, platformSupport);
    try {
      const html = await pageContent(session, `/admin/tenants/${TENANT}/contract`);
      expect(html).toContain(t('admin.deletionStatus.completed.prefix'));
      expect(html).toContain('admin-deletion-status-total');
      expectNoMarkers('A-010（PLATFORM_SUPPORT）', html, forbiddenEverywhere());
      for (const absent of ['<button', '<form', 'downloadUrl']) expect(html).not.toContain(absent);

      const status = await apiRequest(session.page, `/api/admin/tenants/${TENANT}/deletion-status`);
      expect(status.status).toBe(200);
      expect(collectForbiddenKeySightings(parseJson(status), 'API-A12')).toEqual([]);
      expectNoMarkers('API-A12（PLATFORM_SUPPORT）', status.text, forbiddenEverywhere());
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
