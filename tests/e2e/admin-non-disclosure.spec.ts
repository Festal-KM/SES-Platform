// tests/e2e/admin-non-disclosure.spec.ts
// 🔴 **docs/05 §17.3 E2E #15 の全面展開**（T-11-07。`BR-40` / `BR-42` / `CLAUDE.md` §10.5「運営者にも見せないもの」/
//    §7 KPI「テナント越境の情報漏洩 0 件」）:
//
//    「運営者に非開示のもの（スキルシート本文・氏名・チャット本文・トークン平文）が管理平面の**どの応答にも**現れない」
//
// `tests/e2e/isolation.spec.ts` ⑤（T-03-11）は `A-001` / `A-002` / `A-003` と API-A2 / A3 を seed の値で走査する。
// 本 spec はそれを**変更せず**、Phase 1 で増えた画面と API（`A-004` / `A-005` / `A-006` / `A-012`、API-A6 / A7 / A8 / A16、
// API-A2 の並び替え）へ同じ走査を広げ、さらに 2 つの観点を足す:
//
//   (a) 🔴 **禁止キー**（`tests/support/admin-forbidden-keys.ts`。静的テストと同じ 1 つの定数）が JSON の**どの深さにも**無い。
//       値が空でもキーがあれば「型として出せる」ことになる。例外は応答 × キーで根拠付きに列挙した 3 組だけで、
//       例外の値も形（オブジェクト / UUID / 列挙値）を確かめる。`A-006` の `summary` はマスク済み領域として
//       「内容キーはキーごと無い・身元キーの値は `[masked]`」を見る。
//   (b) 🔴 **禁止値**が HTML にも JSON にも 0 件。値は seed（`@ses/db/seed`）と、本 spec が `harness/db-admin.ts` の
//       シームで仕込んだ 1 組（`T1107_NON_DISCLOSURE_MARKERS`。生年月日・連絡先・スキルシートの `object_key` / `note`・
//       ゲートの指摘・DKIM トークン・AI の生成由来・宛先・提案の件名 / 本文・依頼の本文 / 辞退理由・クォータ変更の理由・
//       削除失敗の理由・監査 `summary` の身元と内容）から取る。**テストにベタ書きしない**。
//       仕込んだ行は `A-005` の項目 1 / 4 / 5 / 7 / 11 / 16 に**実際に載る**（0 件の項目は何も漏らさない —— 載っている状態で
//       件数・状態・時刻だけが出ることを見る）。
//   (c) 対照: 各画面がタイトルを表示し、各 API が 200 で仕込んだ行を件数・状態として**含む**（空振り防止）。
//
// 🔴 逆走査（T-11-02 申し送り）: 金額（USD）が現れてよいのは管理平面だけである。同じ seed で**主平面**の `GET /api/usage` と
//    `/settings/usage`（`S-038`）の可視テキストに `Usd` / `USD` / `$` / `ドル` / `cost` / `price` の語・キーが 1 つも無いことを見る
//    （`apps/web/lib/usage/view.types.test.ts` が型で、`tests/static/tenant-usage-no-money.test.ts` が構造で固定済み。
//    ここは実サーバの応答で確かめる。docs/05 §6.9 #69 の ⚠️「E2E は未追加」の解消）。
//
// 🔴 `PLATFORM_SUPPORT`（T-11-02 申し送り ⑤ / `F-057 AC-2` / `BR-44`）: `/admin/usage` の HTML にクォータ変更の導線
//    （`admin-usage-quota-form` / `admin-usage-quota-open-*`）が**存在せず**（グレーアウトではなく不在）、
//    `PUT /api/admin/tenants/{id}/quota` が 403。対照として `PLATFORM_OWNER` には導線がある。
//
// 🔴 直列（`workers: 1`）。仕込みは `beforeAll`、後始末は `afterAll`（失敗しても消す）。同じ実行の中で DB は spec 間で共有される
//    ため、後続の `isolation.spec.ts` などに合成の行を残さない（`harness/db-admin.ts` の後始末の規律）。
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ISOLATION_SEED_PLATFORM_USERS } from '@ses/db/seed';
import { t } from '../../packages/i18n/src/index';
// 🔴 `@ses/domain` をパッケージ名で import しない（ルートの package.json は依存に持たない。`harness/worker.ts` と同じ理由）。
import { TENANT_HEALTH_SIGNALS } from '../../packages/domain/src/health/tenant-health';
import { defaultAuditLogPeriod, toRangeEndIso, toRangeStartIso } from '../../apps/web/lib/admin-audit-logs/period';
import {
  collectForbiddenKeySightings,
  MASKED_VALUE_LITERAL,
  type AdminResponseId,
} from '../support/admin-forbidden-keys';
import {
  plantNonDisclosureFixturesForE2e,
  removeNonDisclosureFixturesForE2e,
  T1107_FIXTURE_IDS,
  T1107_FIXTURE_SENDING_DOMAIN,
  t1107StuckDispatchId,
  type T1107FixtureRefs,
} from './harness/db-admin';
import { apiRequest, parseJson, type ApiResponse } from './support/api';
import { expectNoEmailsOfDomainExcept, expectNoMarkers } from './support/assertions';
import {
  demoPersonNamePatterns,
  demoScenarioAccountEmails,
  isolationSeedEmailDomain,
  operatorNonDisclosureApiMarkers,
  operatorNonDisclosureMarkers,
  partnerIds,
  platformUserEmails,
  tenantIds,
} from './support/population';
import { hostOwner, openPlatformSession, openTenantSession, platformSupport, type Session } from './support/sessions';

/** 直近 7 日（`A-006` の既定。`AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS` の 31 日以内）。 */
const AUDIT_PERIOD_DAYS = 7;

const fixtureRefs: T1107FixtureRefs = {
  tenantId: tenantIds(1).tenantId,
  hostEngineerId: tenantIds(1).hostEngineerId,
  hostUserId: tenantIds(1).hostUserId,
  publishedProjectId: tenantIds(1).publishedProjectId,
  privateProjectId: tenantIds(1).privateProjectId,
  hostProposalId: tenantIds(1).hostProposalId,
  requestPartnerCompanyId: partnerIds(1, 2).partnerCompanyId,
  requestPartnerEngineerId: partnerIds(1, 2).engineerId,
  requestPartnerUserId: partnerIds(1, 2).userId,
  unverifiedTenantId: tenantIds(2).tenantId,
  platformOwnerUserId: ISOLATION_SEED_PLATFORM_USERS.owner.id,
};
const stuckDispatchId = t1107StuckDispatchId(new Date());

test.beforeAll(() => {
  plantNonDisclosureFixturesForE2e(fixtureRefs, stuckDispatchId);
});

test.afterAll(() => {
  removeNonDisclosureFixturesForE2e(fixtureRefs, stuckDispatchId);
});

async function pageContent(session: Session, path: string): Promise<string> {
  const response = await session.page.goto(path, { waitUntil: 'domcontentloaded' });
  // 🔴 500 系は「漏れていない」ではなく「壊れている」。空振りで green にしない。
  expect(response?.status() ?? 0, `${path} が 5xx を返しました`).toBeLessThan(500);
  return session.page.content();
}

function auditPeriodQuery(): string {
  const period = defaultAuditLogPeriod(new Date(), AUDIT_PERIOD_DAYS);
  return `from=${encodeURIComponent(toRangeStartIso(period.from))}&to=${encodeURIComponent(toRangeEndIso(period.to))}`;
}

/**
 * 管理平面の JSON 応答を 3 面で見る: ①200 ②禁止キーがどの深さにも無い（例外は形まで確認）③禁止値が 0 件。
 * 🔴 走査は本文の**文字列**（`response.text`）に対して行う —— JSON.parse で数値が丸まる前の生の桁で照合する。
 */
function expectCleanAdminJson(source: string, response: ApiResponse, responseId: AdminResponseId): unknown {
  expect(response.status, `${source} が 200 ではありません（${response.text.slice(0, 200)}）`).toBe(200);
  const json = parseJson(response);
  const sightings = collectForbiddenKeySightings(json, responseId);
  expect(sightings, `${source} に禁止キーが現れました`).toEqual([]);
  expectNoMarkers(source, response.text, operatorNonDisclosureApiMarkers());
  expectNoEmailsOfDomainExcept(source, response.text, isolationSeedEmailDomain(), platformUserEmails());
  return json;
}

/** 管理平面の HTML を 2 面で見る: ①禁止値が 0 件 ②seed のメールアドレスは運営者自身の分以外 0 件。 */
function expectCleanAdminHtml(source: string, html: string): void {
  expectNoMarkers(source, html, operatorNonDisclosureMarkers());
  expectNoEmailsOfDomainExcept(source, html, isolationSeedEmailDomain(), platformUserEmails());
}

/** `<script>` / `<style>` / `<template>` を除いた本文のテキスト（RSC ペイロードの `$` を可視テキストと混同しない）。 */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('script, style, template, noscript')) node.remove();
    return clone.textContent ?? '';
  });
}

type MonitoringItem = { readonly kind: string; readonly ok: boolean } & Record<string, unknown>;

/** 項目を取り出す。形は呼び出し側が表明する（応答の型を import せず、JSON の側から見る）。 */
function itemOf<T>(snapshot: { readonly items: readonly MonitoringItem[] }, kind: string): T {
  const item = snapshot.items.find((entry) => entry.kind === kind);
  if (item === undefined) throw new Error(`API-A8 の応答に ${kind} が無い`);
  return item as unknown as T;
}

test.describe('E2E #15 運営者に非開示のものが管理平面のどの応答にも現れない（BR-40 / BR-42 / CLAUDE.md §10.5）', () => {
  test('🔴 A-002〜A-006 / A-012 の HTML と API-A2 / A3 / A6 / A7 / A8 / A16 の JSON に禁止キー・禁止値が 0 件（仕込んだ行は件数・状態として載る）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(180_000);
    const session = await openPlatformSession(browser);
    const tenant1 = tenantIds(1);
    try {
      // --- 画面（HTML） ------------------------------------------------------------------------------------------
      const list = await pageContent(session, '/admin/tenants');
      expect(list).toContain(t('admin.tenants.title'));
      expectCleanAdminHtml('A-002 テナント一覧', list);

      for (const index of [1, 2] as const) {
        const detail = await pageContent(session, `/admin/tenants/${tenantIds(index).tenantId}`);
        expect(detail).toContain(t('admin.readOnly.badge'));
        expectCleanAdminHtml(`A-003 テナント詳細（テナント ${index}）`, detail);
      }

      await session.page.goto('/admin/usage', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('admin-usage-table')).toBeVisible({ timeout: 30_000 });
      const usageHtml = await session.page.content();
      expect(usageHtml).toContain(t('admin.usage.title'));
      // 対照: OWNER にはクォータ変更の導線がある（SUPPORT で不在になることの比較対象）。
      expect(usageHtml).toContain('admin-usage-quota-form');
      expectCleanAdminHtml('A-004 利用量・クォータ管理', usageHtml);

      await session.page.goto('/admin/monitoring', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('admin-monitoring-item-SUBMIT_FAILED_UNATTENDED')).toBeVisible({ timeout: 30_000 });
      await expect(session.page.getByTestId('admin-monitoring-item-SCHEDULER_HEARTBEAT')).toBeVisible();
      const monitoringHtml = await session.page.content();
      expect(monitoringHtml).toContain(t('admin.monitoring.title'));
      // 対照: 仕込んだ送信ドメイン（表示してよい列）は項目 11 に載っている。
      expect(monitoringHtml).toContain(T1107_FIXTURE_SENDING_DOMAIN);
      expectCleanAdminHtml('A-005 運用監視', monitoringHtml);

      await session.page.goto(`/admin/audit-logs?targetTenantId=${tenant1.tenantId}`, { waitUntil: 'domcontentloaded' });
      await session.page.getByTestId('admin-audit-logs-search').click();
      await expect(session.page.getByTestId('admin-audit-logs-table')).toBeVisible({ timeout: 30_000 });
      await expect(session.page.getByTestId(`admin-audit-logs-row-${T1107_FIXTURE_IDS.auditLog}`)).toBeVisible();
      const auditHtml = await session.page.content();
      expect(auditHtml).toContain(t('admin.auditLogs.title'));
      // 対照: 仕込んだ監査行は表示され、身元キーは伏せ字で出ている（行が見えないのではなく、値が見えない）。
      expect(auditHtml).toContain(MASKED_VALUE_LITERAL);
      expectCleanAdminHtml('A-006 監査ログ横断検索（直近 7 日・テナント 1）', auditHtml);

      await session.page.goto('/admin/demo', { waitUntil: 'domcontentloaded' });
      await expect(
        session.page.locator('[data-testid="admin-demo-status-not-seeded"], [data-testid="admin-demo-status-seeded"]').first(),
      ).toBeVisible({ timeout: 30_000 });
      const demoHtml = await session.page.content();
      expect(demoHtml).toContain(t('admin.demo.title'));
      expectCleanAdminHtml('A-012 デモ環境の合成データ管理', demoHtml);
      // 🔴 `seed:demo` の人名の形（姓 + 空白）は 0 件。`.example` のメールは実演アカウント 2 件（設計上の表示）以外 0 件。
      expectNoMarkers('A-012 デモ環境の合成データ管理', demoHtml, demoPersonNamePatterns());
      expectNoEmailsOfDomainExcept('A-012 デモ環境の合成データ管理', demoHtml, 'example', demoScenarioAccountEmails());

      // --- API（JSON） ---------------------------------------------------------------------------------------------
      for (const sort of ['health', 'name', 'createdAt'] as const) {
        const response = await apiRequest(session.page, `/api/admin/tenants?limit=200&sort=${sort}`);
        const json = expectCleanAdminJson(`API-A2 GET /api/admin/tenants?sort=${sort}`, response, 'API-A2') as {
          items: Array<{ health: { signals: string[] } }>;
          summary: Record<string, unknown>;
        };
        expect(json.items.length).toBeGreaterThanOrEqual(2);
        // 🔴 T-12-18 ③（正のケース）: `summary` のキー集合は `TENANT_HEALTH_SIGNALS` の列挙値そのもので、値はすべて非負整数
        //    （禁止キー走査は上で通っている = キーも値も「内容」ではない。docs/05 §6.9 API-A2「応答の形」）。
        expect(Object.keys(json.summary)).toEqual([...TENANT_HEALTH_SIGNALS]);
        for (const value of Object.values(json.summary)) expect(Number.isInteger(value) && (value as number) >= 0).toBe(true);
        const expected: Record<string, number> = Object.fromEntries(TENANT_HEALTH_SIGNALS.map((signal) => [signal, 0]));
        for (const item of json.items) for (const signal of item.health.signals) expected[signal] = (expected[signal] ?? 0) + 1;
        expect(json.summary).toEqual(expected);
      }
      // 🔴 T-12-18 ③: `?signal=` の絞り込み応答も禁止キー走査を通り、`items` は指定の種別を持つ行だけ。
      const filtered = expectCleanAdminJson(
        'API-A2 GET /api/admin/tenants?signal=NO_PARTNERS',
        await apiRequest(session.page, '/api/admin/tenants?limit=200&signal=NO_PARTNERS'),
        'API-A2',
      ) as { items: Array<{ health: { signals: string[] } }> };
      expect(filtered.items.every((item) => item.health.signals.includes('NO_PARTNERS'))).toBe(true);
      for (const index of [1, 2] as const) {
        const response = await apiRequest(session.page, `/api/admin/tenants/${tenantIds(index).tenantId}`);
        expectCleanAdminJson(`API-A3 GET /api/admin/tenants/{テナント ${index}}`, response, 'API-A3');
      }

      const usage = expectCleanAdminJson('API-A6 GET /api/admin/usage', await apiRequest(session.page, '/api/admin/usage'), 'API-A6') as {
        items: Array<{
          tenantId: string;
          aiUnits: { AI_UNIT_SHEET_PARSE: { quota: { source: string } } };
          aiMonthly: { byRole: Record<string, string> };
        }>;
      };
      const tenant1Usage = usage.items.find((row) => row.tenantId === tenant1.tenantId);
      // 対照: 仕込んだ上書き（理由つき）と AI 利用（対象・モデル・プロンプト版つき）が、上書きの事実と金額としてだけ載っている。
      expect(tenant1Usage?.aiUnits.AI_UNIT_SHEET_PARSE.quota.source).toBe('OVERRIDE');
      expect(Number(tenant1Usage?.aiMonthly.byRole['proposal-drafter'])).toBeGreaterThan(0);

      const auditPage = expectCleanAdminJson(
        'API-A7 GET /api/admin/audit-logs（直近 7 日・テナント 1）',
        await apiRequest(session.page, `/api/admin/audit-logs?${auditPeriodQuery()}&targetTenantId=${tenant1.tenantId}&limit=200`),
        'API-A7',
      ) as { items: Array<{ id: string; summary: Record<string, unknown> }> };
      const planted = auditPage.items.find((item) => item.id === T1107_FIXTURE_IDS.auditLog);
      // 対照: 仕込んだ監査行は返り、身元キーは `[masked]`、内容キーはキーごと落ち、列挙値は残る（docs/05 §6.9 API-A7 の決着）。
      expect(planted, '仕込んだ監査行が API-A7 の応答に無い').toBeDefined();
      expect(planted?.summary).toEqual({
        displayName: MASKED_VALUE_LITERAL,
        email: MASKED_VALUE_LITERAL,
        objectKey: MASKED_VALUE_LITERAL,
        offeredUnitPrice: MASKED_VALUE_LITERAL,
        via: 'DETAIL',
      });

      const monitoring = expectCleanAdminJson(
        'API-A8 GET /api/admin/monitoring',
        await apiRequest(session.page, '/api/admin/monitoring'),
        'API-A8',
      ) as { items: readonly MonitoringItem[] };
      // 🔴 smoke（T-11-04 レビュー申し送り ⑤）: development の実配線で 15 項目すべてが `ok: true`。
      expect(monitoring.items.map((item) => `${item.kind}:${item.ok}`)).toEqual(monitoring.items.map((item) => `${item.kind}:true`));
      expect(monitoring.items).toHaveLength(15);
      // 対照: 仕込んだ行が件数・状態として載っている（本文・宛先・理由は上で 0 件を確かめた）。
      const submitFailed = itemOf<{ rows: Array<{ tenantId: string; count: number }> }>(monitoring, 'SUBMIT_FAILED_UNATTENDED');
      expect(submitFailed.rows.find((row) => row.tenantId === tenant1.tenantId)?.count).toBeGreaterThanOrEqual(1);
      const scanFailed = itemOf<{ rows: Array<{ tenantId: string; countsByStatus: { FAILED: number } }> }>(monitoring, 'SCAN_FAILED');
      expect(scanFailed.rows.find((row) => row.tenantId === tenant1.tenantId)?.countsByStatus.FAILED).toBeGreaterThanOrEqual(1);
      const purgeFailed = itemOf<{ rows: Array<{ tenantId: string; cause: string; failedCount: number }> }>(monitoring, 'PURGE_JOB_FAILED');
      expect(purgeFailed.rows.find((row) => row.tenantId === tenant1.tenantId && row.cause === 'RETENTION')?.failedCount).toBe(1);
      const unverified = itemOf<{
        items: Array<{ tenantId: string; domain: string | null; status: string; expectedRecords: number }>;
      }>(monitoring, 'SENDING_DOMAIN_UNVERIFIED');
      const tenant2Domain = unverified.items.find((row) => row.tenantId === tenantIds(2).tenantId);
      expect(tenant2Domain?.domain).toBe(T1107_FIXTURE_SENDING_DOMAIN);
      expect(tenant2Domain?.status).toBe('PENDING');
      // DKIM トークンは**本数**（1 本 + MAIL FROM 2 本）としてだけ出る（値は上で 0 件を確かめた）。
      expect(tenant2Domain?.expectedRecords).toBe(3);
      const stuck = itemOf<{ count: number }>(monitoring, 'MAIL_DISPATCH_STUCK');
      expect(stuck.count).toBeGreaterThanOrEqual(1);
      const failRate = itemOf<{ recent: { failed: number } }>(monitoring, 'GATE_FAIL_RATE');
      expect(failRate.recent.failed).toBeGreaterThanOrEqual(1);

      const demo = expectCleanAdminJson('API-A16 GET /api/admin/demo/seed', await apiRequest(session.page, '/api/admin/demo/seed'), 'API-A16') as {
        available: boolean;
      };
      expect(demo.available).toBe(true);
      expectNoMarkers('API-A16 GET /api/admin/demo/seed', JSON.stringify(demo), demoPersonNamePatterns());
      expectNoEmailsOfDomainExcept('API-A16 GET /api/admin/demo/seed', JSON.stringify(demo), 'example', []);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('🔴 PLATFORM_SUPPORT: A-004 にクォータ変更の導線が存在せず、PUT /api/admin/tenants/{id}/quota は 403（F-057 AC-2 / BR-44）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openPlatformSession(browser, platformSupport);
    try {
      await session.page.goto('/admin/usage', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('admin-usage-table')).toBeVisible({ timeout: 30_000 });
      const html = await session.page.content();
      expect(html).toContain(t('admin.usage.title'));
      // 🔴 不在（グレーアウトではない）。
      expect(html).not.toContain('admin-usage-quota-form');
      expect(html).not.toContain('admin-usage-quota-open-');
      expectCleanAdminHtml('A-004（PLATFORM_SUPPORT）', html);

      const denied = await apiRequest(session.page, `/api/admin/tenants/${tenantIds(1).tenantId}/quota`, {
        method: 'PUT',
        body: { metric: 'AI_UNIT_SHEET_PARSE', limit: 999, effectiveFrom: '2099-01-01', notifyTenantAdmins: false, reason: 'e2e' },
      });
      expect(denied.status).toBe(403);

      // 閲覧系は両ロールとも到達できる（`A-005` / `A-006` は閲覧のみ）。
      expectCleanAdminJson('API-A8（PLATFORM_SUPPORT）', await apiRequest(session.page, '/api/admin/monitoring'), 'API-A8');
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('🔴 逆走査: 主平面の GET /api/usage と /settings/usage に金額（Usd / $ / ドル / cost / price）が 1 つも無い（F-027 AC-6）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const response = await apiRequest(session.page, '/api/usage');
      expect(response.status).toBe(200);
      const json = parseJson(response) as Record<string, unknown>;
      // 対照: 4 単位の件数が返っている（空振り防止）。
      expect(Object.keys(json)).toContain('aiUnits');
      const moneyKeys: string[] = [];
      const visit = (node: unknown, path: string): void => {
        if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
        if (typeof node !== 'object' || node === null) return;
        for (const [key, child] of Object.entries(node)) {
          // 🔴 `tests/static/tenant-usage-no-money.test.ts` の MONEY_PATTERN と同じ語彙。円（`overageEstimateJpy` = 超過分の請求見込み）は
          //    残量の提示ではなく請求見込みであり、docs/05 §6.9 #69 / `usage.billing.*` が許す唯一の通貨表記である。
          if (/[Uu]sd|USD|[Cc]ost|COST|[Pp]rice|PRICE|[Aa]mount|AMOUNT|\$|ドル/.test(key)) moneyKeys.push(`${path}.${key}`);
          visit(child, `${path}.${key}`);
        }
      };
      visit(json, '$');
      expect(moneyKeys, 'GET /api/usage に金額のキーが現れました').toEqual([]);
      expectNoMarkers('GET /api/usage', response.text, ['Usd', 'USD', '$', 'ドル', 'cost', 'Cost', 'price', 'Price']);

      await session.page.goto('/settings/usage', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('usage-screen')).toBeVisible({ timeout: 30_000 });
      const text = await visibleText(session.page);
      expect(text).toContain(t('usage.title'));
      expectNoMarkers('/settings/usage の可視テキスト', text, ['USD', 'Usd', 'usd', '$', 'ドル', 'cost', 'Cost', 'price', 'Price']);
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
