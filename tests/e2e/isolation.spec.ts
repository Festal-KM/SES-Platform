// tests/e2e/isolation.spec.ts
// 🔴 **`CLAUDE.md` §5 Phase 0 の成功条件そのもの**（docs/05 §17.3 #1 / #2 / #15。
//    docs/sprints/SP-03-auth-audit-admin0.md T-03-11）:
//
//    「2 テナント × 2 パートナーを seed した状態で、**URL 直打ち・API 直叩きのいずれでも
//      他テナント / 他パートナーのデータが 1 件も取得できない**ことを自動テストで証明できる」
//
// シナリオ（本ファイルの `describe` と 1 対 1）:
//   ① `seed:isolation`（2 テナント × 2 パートナー）が投入されている
//   ② テナント A の `OWNER` で **URL 直打ち** → テナント B のものが 1 つも現れない
//   ③ 同じ認証で **API 直叩き** → 404 / 0 件。一覧の件数が B の活動で変わらない
//   ④ パートナー A1 の `PARTNER_SALES` → パートナー A2 のものが画面・一覧・集計に 1 件も無い
//      （件数バッジ・並び順の変化・「他 N 件」も無い。`F-004 AC-3` / `AC-4`）
//   ⑤ 運営者 → `A-002` / `A-003` の応答に氏名・本文・秘匿値の平文が現れない（`BR-40`）
//
// 🔴 **Phase 0 に実在する画面 / API を出発点にし、Phase 1 以降は増えたルートを足していく**
//    （SP-03 T-03-11 の読み替え指示）。足し忘れは `docs/05` §17.3 の穴になる。
//    🔴 T-05-02: `docs/05` §17.3 #1 が例示した `GET /api/engineers/{id}`（`S-006` / `S-007`）を
//    `MAIN_PLANE_PAGES` / `MAIN_PLANE_READ_APIS` に足した。**`engineers` は RLS の
//    C3 OWNER_SCOPED**（`docs/05` §4.4 / `apps/web/lib/engineers/service.ts`）であり、
//    ホスト文脈（`app_partner_id() = NULL`）からはパートナー所有の行が**同一テナント内でも**
//    1 件も見えない（越境経路 2 の外。`tests/isolation/engineers.test.ts` の
//    `F-008 AC-3` が同じ境界を DB 層で固定する）。したがって「自テナントの実在 ID」の対照には
//    **ホスト所有のエンジニア**（`tenantIds(1).hostEngineerId`）だけを使い、境界外の確認は
//    ③・④に別テストを足して「他テナントのホスト所有 ID」と「同一テナント内の他パートナー所有 ID」の
//    両方が同じ 404 に畳まれることを見る。
//
// 🔴 T-05-09: `docs/05` §17.3 が例示した `GET /api/engineers`（一覧。`S-005` / `F-009`）を
//    `MAIN_PLANE_PAGES` / `MAIN_PLANE_READ_APIS` に足した（T-05-02 のときと同じ要領）。
//    一覧はロールで到達を止めない（`app/(main)/engineers/page.tsx` 冒頭）ため ID 不要であり、
//    `hostOwner(1)` セッションで走査すれば「ホスト文脈の母集団（ホスト所有のみ）」がそのまま
//    ②③の境界対照になる。④（パートナー）には別途、一覧が**自社所有のみ**であり、
//    ホスト所有・他パートナー所有の**氏名が生文字列に現れない**ことを見るケースを足した
//    （`tests/isolation/engineers.test.ts` の「他社のエンジニアの実名が応答本文に 1 バイトも
//    現れない」と同じ観点。値は各所有者本人の正規の読み取り経路から導く。ベタ書きしない）。
//
// 🔴 T-06-03: `GET /api/projects`（一覧。`S-010` / `F-015`）と `/projects`（画面）を
//    `MAIN_PLANE_PAGES` / `MAIN_PLANE_READ_APIS` に足した。**`projects` は RLS の
//    C4 VISIBILITY** であり、パートナー文脈では `project_visibilities` の行の有無だけが
//    母集団を決める（`tests/isolation/projects.test.ts` の `F-015 AC-1` が DB 層で固定する）。
//    ④（パートナー視点）の掘り下げ —— 自社に公開された案件だけが出ること、他社の公開状況・
//    社数が現れないこと —— は **e2e-tester が `S-010` の導線とあわせて足す**。
//
// 🔴 直列（`workers: 1`。`playwright.config.ts`）。RLS の設定漏れは他テストの副作用で
//    偽陽性・偽陰性になる。
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { ISOLATION_SEED_PASSWORD, isolationSeedEmails } from '@ses/db/seed';
import { t } from '../../packages/i18n/src/index';
import { apiRequest, auditLogPeriodQuery, parseJson, type ApiResponse } from './support/api';
import { expectNoHiddenCountHints, expectNoMarkers } from './support/assertions';
import {
  foreignPartnerMarkers,
  foreignTenantMarkers,
  operatorForbiddenApiMarkers,
  operatorForbiddenMarkers,
  partnerIds,
  tenantIds,
} from './support/population';
import {
  hostOwner,
  openPlatformSession,
  openTenantSession,
  partnerSales,
  type Session,
  type TenantPersona,
} from './support/sessions';

/**
 * 主平面の画面（`S-003` / `S-041` / `S-035` / `S-006` / `S-007` / `S-005` / `S-012`）。
 * 🔴 ID を取る画面（詳細・編集）は **テナント A のホスト所有の行**で固定する —— この配列は
 *    `hostOwner(1)` のセッションでしか走査しない（②）ため、対照に使えるのは「ホスト文脈から
 *    見える行」だけである（エンジニアは C3 OWNER_SCOPED。上の 🔴 参照）。
 * 🔴 T-05-09: `/engineers`（一覧。`S-005`）を足した。一覧はロールで到達を止めない
 *    （ID 不要）ため、他の 2 画面と違って固定 ID を要らない。
 * 🔴 T-06-01: `/projects/new`（`S-012` 新規）と `/projects/{id}/edit`（同・編集）を足した。
 *    編集側の ID は **`seed:isolation` に既に実在するホスト所有の公開案件**
 *    （`tenantIds(1).publishedProjectId`）を使う —— `readProjectForEdit` は `requireHost` で
 *    パートナー文脈を締め出すだけで母集団は絞らない（`projects` の RLS は C4 VISIBILITY。
 *    `lib/projects/service.ts` 冒頭）ため、この配列を歩く `hostOwner(1)` からは公開 / 未公開の
 *    どちらでも到達できるが、`privateProjectId`（未公開）ではなくあえて `publishedProjectId`
 *    を選んだ理由は無い（どちらでもホスト文脈からは 200 になる）。**新規に案件を作らない**
 *    （E2E がシードの外に行を増やすと、他テストの母集団に対する前提が崩れる）。
 */
const MAIN_PLANE_PAGES = [
  '/',
  '/audit-logs',
  '/settings/organization',
  '/engineers',
  `/engineers/${tenantIds(1).hostEngineerId}`,
  '/engineers/new',
  `/engineers/${tenantIds(1).hostEngineerId}/edit`,
  '/projects/new',
  `/projects/${tenantIds(1).publishedProjectId}/edit`,
  // 🔴 T-06-03: `/projects`（一覧。`S-010`）を足した。`/engineers` と同じくロールで到達を
  //    止めない（ID 不要）ため、固定 ID を要らない。母集団を決めるのは `projects` の
  //    RLS（C4 VISIBILITY）である。
  '/projects',
] as const;

/**
 * 主平面の読み取り API（docs/05 §6.3 #8 / #9 / #10 / #64 / #17 / #15）。
 * 🔴 `GET /api/engineers/{id}` も同じ理由で **ホスト所有エンジニア**の ID で固定する。
 * 🔴 T-05-09: `GET /api/engineers`（一覧。#15）を足した。既存の②③ループに載せることで、
 *    「他テナントの値が 0 件」を一覧の `items` / `total` の両方で確かめる。
 */
const MAIN_PLANE_READ_APIS = [
  '/api/me',
  '/api/home',
  '/api/settings/organization',
  `/api/audit-logs?${auditLogPeriodQuery()}`,
  '/api/engineers',
  `/api/engineers/${tenantIds(1).hostEngineerId}`,
  // 🔴 T-06-03: `GET /api/projects`（一覧。#25）を足した。既存の②③ループに載せることで、
  //    「他テナントの値が 0 件」を一覧の `items` / `total` の両方で確かめる。
  '/api/projects',
] as const;

/** 実在しない UUID（`404` と `403` を区別しないことの確認に使う）。 */
const ABSENT_UUID = '01999999-9999-7999-8999-999999999999';

async function pageContent(session: Session, path: string): Promise<string> {
  const response = await session.page.goto(path, { waitUntil: 'domcontentloaded' });
  // 🔴 500 系は「越境していない」ではなく「壊れている」。空振りで green にしない。
  expect(response?.status() ?? 0, `${path} が 5xx を返しました`).toBeLessThan(500);
  return session.page.content();
}

function bodyOf(response: ApiResponse): string {
  return response.text;
}

test.describe('① seed:isolation（2 テナント × 2 パートナー）の母集団', () => {
  test('2 テナントの OWNER と、テナント A の 2 パートナーが互いに別の主体として認証される', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const sessions: Session[] = [];
    try {
      const ownerA = await openTenantSession(browser, hostOwner(1));
      sessions.push(ownerA);
      const ownerB = await openTenantSession(browser, hostOwner(2));
      sessions.push(ownerB);
      const partnerA1 = await openTenantSession(browser, partnerSales(1, 1));
      sessions.push(partnerA1);
      const partnerA2 = await openTenantSession(browser, partnerSales(1, 2));
      sessions.push(partnerA2);

      const meA = parseJson(await apiRequest(ownerA.page, '/api/me')) as {
        user: { id: string };
        role: string;
        partnerCompanyId: string | null;
        tenantState: string;
        env: string;
      };
      const meB = parseJson(await apiRequest(ownerB.page, '/api/me')) as typeof meA;
      const meP1 = parseJson(await apiRequest(partnerA1.page, '/api/me')) as typeof meA;
      const meP2 = parseJson(await apiRequest(partnerA2.page, '/api/me')) as typeof meA;

      expect(meA.role).toBe('OWNER');
      expect(meB.role).toBe('OWNER');
      expect(meA.partnerCompanyId).toBeNull();
      expect(meA.user.id).toBe(tenantIds(1).hostOwnerUserId);
      expect(meB.user.id).toBe(tenantIds(2).hostOwnerUserId);
      expect(meA.user.id).not.toBe(meB.user.id);

      expect(meP1.role).toBe('PARTNER_SALES');
      expect(meP1.partnerCompanyId).toBe(partnerIds(1, 1).partnerCompanyId);
      expect(meP2.partnerCompanyId).toBe(partnerIds(1, 2).partnerCompanyId);
      expect(meP1.partnerCompanyId).not.toBe(meP2.partnerCompanyId);

      // 🔴 実行環境は development（全コネクタがモック。`CLAUDE.md` §11）。
      expect(meA.env).toBe('development');
      expect(meA.tenantState).toBe('ACTIVE');
    } finally {
      for (const session of sessions) await session.close();
    }
  });
});

test.describe('② テナント A の OWNER で URL 直打ち（他テナントが 1 つも現れない）', () => {
  test('主平面の全画面と管理平面の直打ちに、テナント B の値が 0 件', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const foreign = foreignTenantMarkers(2);
    try {
      for (const path of MAIN_PLANE_PAGES) {
        const html = await pageContent(session, path);
        expectNoMarkers(`URL 直打ち ${path}`, html, foreign);
        expectNoHiddenCountHints(`URL 直打ち ${path}`, html);
      }

      // 🔴 平面をまたいだ直打ち: **主平面のセッションでは管理平面に到達できない**
      //    （`BR-36` / `F-055 AC-2`。別テーブル・別 Cookie・別署名鍵）。
      for (const path of ['/admin', `/admin/tenants/${tenantIds(2).tenantId}`, '/admin/tenants']) {
        await session.page.goto(path, { waitUntil: 'domcontentloaded' });
        expect(session.page.url(), `${path} から /admin/signin へ送られること`).toContain(
          '/admin/signin',
        );
        expectNoMarkers(`URL 直打ち ${path}`, await session.page.content(), foreign);
      }

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('自テナントの画面は実際に描画される（越境 0 件が「何も見えない」ことの言い換えでない）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const home = await pageContent(session, '/');
      expect(home).toContain(t('home.title'));
      expect(home).toContain(t('home.host.empty.title'));

      const auditLogs = await pageContent(session, '/audit-logs');
      expect(auditLogs).toContain(t('auditLogs.title'));
    } finally {
      await session.close();
    }
  });

  test('🔴 T-05-02: ホスト所有のエンジニアには到達できるが、他テナント / 同一テナントの他パートナー所有には到達できない（S-006 / F-008 AC-3）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      // 対照: 自テナントのホスト所有エンジニアには実際に到達できる。
      const own = await pageContent(session, `/engineers/${tenantIds(1).hostEngineerId}`);
      expect(own).toContain(t('engineers.detail.title'));
      expect(own).toContain(t('engineers.ownership.host'));

      // 🔴 境界外: 他テナントのホスト所有エンジニア（第一境界）。
      const foreignTenant = await pageContent(session, `/engineers/${tenantIds(2).hostEngineerId}`);
      expect(foreignTenant).toContain(t('engineers.notFound'));

      // 🔴 境界外: 同一テナント内の他パートナー所有エンジニア（第二境界。`engineers` は
      //    C3 OWNER_SCOPED であり、ホスト文脈からはパートナー所有の行が同一テナント内でも
      //    1 件も見えない）。
      const foreignPartner = await pageContent(session, `/engineers/${partnerIds(1, 1).engineerId}`);
      expect(foreignPartner).toContain(t('engineers.notFound'));

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});

test.describe('③ 同じ認証で API 直叩き（404 / 0 件。一覧の件数が変わらない）', () => {
  test('主平面の全読み取り API の応答に、テナント B の値が 0 件', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const foreign = foreignTenantMarkers(2);
    try {
      for (const path of MAIN_PLANE_READ_APIS) {
        const response = await apiRequest(session.page, path);
        expect(response.status, `${path} が 200 を返すこと（対照）`).toBe(200);
        expectNoMarkers(`API 直叩き ${path}`, bodyOf(response), foreign);
        expectNoHiddenCountHints(`API 直叩き ${path}`, bodyOf(response));
      }
    } finally {
      await session.close();
    }
  });

  test('境界外の ID を指しても 404 で、存在する ID との区別が付かない', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      // 🔴 「見えない ＝ 存在しない」（docs/05 §4.8）。
      //    Phase 0 に実在する ID 受け取り型の主平面 API は `#6 GET /api/invitations/{token}` のみ。
      //    テナント B のリソース ID をトークンとして渡しても、存在しないトークンと同じ 404 になる。
      const foreignIdAsToken = await apiRequest(
        session.page,
        `/api/invitations/${tenantIds(2).hostOwnerUserId}`,
      );
      const unknownToken = await apiRequest(session.page, `/api/invitations/${ABSENT_UUID}`);
      expect(foreignIdAsToken.status).toBe(404);
      expect(unknownToken.status).toBe(404);
      // 🔴 本文まで同一である（403 と 404 を区別しないだけでなく、理由も区別しない）。
      expect(foreignIdAsToken.text).toBe(unknownToken.text);
      expectNoMarkers('GET /api/invitations/{B の ID}', foreignIdAsToken.text, foreignTenantMarkers(2));

      // 🔴 T-05-02: `GET /api/engineers/{id}`（`engineers` は C3 OWNER_SCOPED。docs/05 §4.4）。
      //    他テナントのホスト所有 ID・同一テナント内の他パートナー所有 ID のどちらも、
      //    存在しない ID と同じ 404 に畳まれる（`F-008 AC-3`）。
      const unknownEngineer = await apiRequest(session.page, `/api/engineers/${ABSENT_UUID}`);
      const foreignTenantEngineer = await apiRequest(
        session.page,
        `/api/engineers/${tenantIds(2).hostEngineerId}`,
      );
      const foreignPartnerEngineer = await apiRequest(
        session.page,
        `/api/engineers/${partnerIds(1, 1).engineerId}`,
      );
      expect(unknownEngineer.status).toBe(404);
      expect(foreignTenantEngineer.status).toBe(404);
      expect(foreignPartnerEngineer.status).toBe(404);
      expect(foreignTenantEngineer.text).toBe(unknownEngineer.text);
      expect(foreignPartnerEngineer.text).toBe(unknownEngineer.text);
      expectNoMarkers(
        'GET /api/engineers/{B のホスト所有}',
        foreignTenantEngineer.text,
        foreignTenantMarkers(2),
      );
      expectNoMarkers(
        'GET /api/engineers/{A のパートナー所有}',
        foreignPartnerEngineer.text,
        foreignPartnerMarkers(1, 1),
      );
    } finally {
      await session.close();
    }
  });

  test('監査ログ: 他テナントの利用者で絞り込んでも 0 件、他テナントの活動で件数が動かない', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const period = auditLogPeriodQuery();
      const listBefore = parseJson(
        await apiRequest(session.page, `/api/audit-logs?${period}&limit=200`),
      ) as { items: Array<{ actorId: string | null }> };
      expect(listBefore.items.length, '自テナントの監査ログが存在すること（対照）').toBeGreaterThan(0);

      // 🔴 他テナントの利用者 ID で絞り込む → 0 件（存在しないのと区別が付かない）。
      const foreignActor = parseJson(
        await apiRequest(
          session.page,
          `/api/audit-logs?${period}&actorId=${tenantIds(2).hostOwnerUserId}`,
        ),
      ) as { items: unknown[] };
      expect(foreignActor.items).toEqual([]);

      // 🔴 テナント B で活動を起こしても、A の一覧の件数は変わらない
      //    （`total` は境界適用後の COUNT。docs/05 §4.8）。
      const otherTenant = await openTenantSession(browser, hostOwner(2));
      await otherTenant.close();

      const listAfter = parseJson(
        await apiRequest(session.page, `/api/audit-logs?${period}&limit=200`),
      ) as { items: unknown[] };
      expect(listAfter.items.length).toBe(listBefore.items.length);
    } finally {
      await session.close();
    }
  });

  test('主平面のセッションで管理平面 API を直叩きしても認証されない', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const foreign = foreignTenantMarkers(2);
    try {
      for (const path of ['/api/admin/tenants', `/api/admin/tenants/${tenantIds(2).tenantId}`]) {
        const response = await apiRequest(session.page, path);
        expect(response.status, `${path} は 401`).toBe(401);
        expectNoMarkers(`API 直叩き ${path}`, response.text, foreign);
      }
    } finally {
      await session.close();
    }
  });

  test('🔴 リクエスト入力に tenantId を混ぜても参照範囲が変わらない（F-003 AC-1 / BR-03）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto('/signin');
      // 🔴 サインインの body に**テナント B の ID を混ぜて**送る。
      const signIn = await apiRequest(page, '/api/auth/signin', {
        method: 'POST',
        body: {
          email: isolationSeedEmails(1).partner1,
          password: ISOLATION_SEED_PASSWORD,
          tenantId: tenantIds(2).tenantId,
          partnerCompanyId: partnerIds(1, 2).partnerCompanyId,
        },
      });
      expect(signIn.status).toBe(200);

      const me = parseJson(await apiRequest(page, '/api/me')) as {
        user: { id: string };
        partnerCompanyId: string | null;
      };
      // 入力ではなく、認証で確定した所属が使われている。
      expect(me.user.id).toBe(partnerIds(1, 1).userId);
      expect(me.partnerCompanyId).toBe(partnerIds(1, 1).partnerCompanyId);
    } finally {
      await context.close();
    }
  });
});

test.describe('④ パートナー A1 で、パートナー A2 のものが 1 件も現れない', () => {
  test('画面・API・集計のいずれにも A2 の値が無く、件数バッジも「他 N 件」も無い', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, partnerSales(1, 1));
    // 🔴 同一テナント内の他パートナー（第二境界）と、他テナント（第一境界）の両方を見る。
    const forbidden = [...foreignPartnerMarkers(1, 2), ...foreignTenantMarkers(2)];
    try {
      const home = await pageContent(session, '/');
      expectNoMarkers('パートナーのホーム', home, forbidden);
      expectNoHiddenCountHints('パートナーのホーム', home);
      // 対照: 「自社に見えない情報が存在すること」の説明文は常時表示される（`F-006 AC-2`）。
      expect(home).toContain(t('home.partner.visibilityNotice'));

      for (const path of ['/api/me', '/api/home']) {
        const response = await apiRequest(session.page, path);
        expect(response.status).toBe(200);
        expectNoMarkers(`パートナーの ${path}`, response.text, forbidden);
        expectNoHiddenCountHints(`パートナーの ${path}`, response.text);
      }

      const home9 = parseJson(await apiRequest(session.page, '/api/home')) as {
        audience: string;
        blocks: unknown[];
        visibilityNotice?: { messageKey: string };
      };
      expect(home9.audience).toBe('PARTNER');
      // Phase 0 は空のダッシュボード（`CLAUDE.md` §5）。件数を持つブロックが存在しない。
      expect(home9.blocks).toEqual([]);
      expect(home9.visibilityNotice?.messageKey).toBe('home.partner.visibilityNotice');

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('ホスト専用の画面 / API に到達できない（UI で隠すだけでない）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      // 🔴 API 直叩きで 403（`requireRole`。`F-004 AC-9`）。
      const auditLogs = await apiRequest(
        session.page,
        `/api/audit-logs?${auditLogPeriodQuery()}`,
      );
      expect(auditLogs.status).toBe(403);
      const settings = await apiRequest(session.page, '/api/settings/organization');
      expect(settings.status).toBe(403);
      // 🔴 T-06-01: `POST /api/projects`（`S-012`。`PROJECT_EDITOR_ROLES` は `OWNER` /
      //    `ADMIN` / `SALES` のみ。`lib/projects/policy.ts`）も同じ 1 層目で 403。
      //    パートナーは案件を作れない（`docs/04` §S-012 権限差分「取引先・`VIEWER` は
      //    到達できない」）。body は最小限（`name` は必須だが 403 は body 検証より前で決まる）。
      const createProject = await apiRequest(session.page, '/api/projects', {
        method: 'POST',
        // 🔴 403 は `applyGuards` がボディの検証（Zod）より前に決める（`withApiRoute` 冒頭
        //    「② ガード ③ Zod による境界検証」の順）ため、値そのものは判定に効かない。
        //    それでもベタ書きしない（`audit-k7.spec.ts` の合成データ規約に倣う）。
        body: { name: `T0601合成-isolation-forbidden-${randomUUID().slice(0, 8)}` },
      });
      expect(createProject.status).toBe(403);

      // 画面は自分のホームへ戻される（docs/04 §S-041 の権限差分）。
      await session.page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
      expect(new URL(session.page.url()).pathname).toBe('/');

      // 🔴 T-06-01: `/projects/new`（`S-012`）も同じくホームへ戻される
      //    （`app/(main)/projects/new/page.tsx` 冒頭「到達できるのは `OWNER` / `ADMIN` /
      //    `SALES` だけ」）。画面で止めるのは補助であり、拒否の本体は上の 403 と
      //    `projects` の RLS（C2 の `WITH CHECK` に `app_is_host()`）である。
      await session.page.goto('/projects/new', { waitUntil: 'domcontentloaded' });
      expect(new URL(session.page.url()).pathname).toBe('/');
    } finally {
      await session.close();
    }
  });

  test('🔴 T-05-02: 自社所有のエンジニアには到達できるが、ホスト所有・他社所有には到達できない（S-006 / F-008 AC-3。C3 OWNER_SCOPED）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, partnerSales(1, 1));
    const ownId = partnerIds(1, 1).engineerId;
    try {
      // 対照: 自社所有のエンジニアには画面・API のどちらでも到達できる。
      const ownDetail = await pageContent(session, `/engineers/${ownId}`);
      expect(ownDetail).toContain(t('engineers.detail.title'));
      expect(ownDetail).toContain(t('engineers.ownership.partner'));

      const ownApi = await apiRequest(session.page, `/api/engineers/${ownId}`);
      expect(ownApi.status).toBe(200);
      expect((parseJson(ownApi) as { ownership: string }).ownership).toBe('PARTNER');

      // 🔴 境界外: ホスト所有（同一テナント。第二境界）と、他社（パートナー A2。第二境界）の
      //    どちらも 404 —— `engineers` は C3 OWNER_SCOPED であり、行そのものが見えない
      //    （`tests/isolation/engineers.test.ts` の `F-008 AC-3` と同じ境界）。
      const hostOwnedId = tenantIds(1).hostEngineerId;
      const otherPartnerId = partnerIds(1, 2).engineerId;
      for (const foreignId of [hostOwnedId, otherPartnerId]) {
        const detail = await pageContent(session, `/engineers/${foreignId}`);
        expect(detail).toContain(t('engineers.notFound'));

        const api = await apiRequest(session.page, `/api/engineers/${foreignId}`);
        expect(api.status).toBe(404);
      }

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('🔴 T-05-09: `/engineers` 一覧は自社所有のみで、他社/ホスト所有の氏名が生文字列に現れない（S-005 / F-009 AC-3）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const ownId = partnerIds(1, 1).engineerId;
    const foreignHostId = tenantIds(1).hostEngineerId;
    const foreignPartnerId = partnerIds(1, 2).engineerId;

    /**
     * 🔴 期待する氏名はベタ書きしない（合成氏名は疑似乱数で選ばれ、シード側のコード順序に
     *    依存するため）。各所有者**本人**のセッションで `GET /api/engineers`（自分の一覧）を
     *    通し、実際に投入された値を読む —— `tests/isolation/engineers.test.ts` の
     *    `admin.engineer.findUnique`（DB への直結読み取り）を、E2E では「本人が正規に
     *    到達できる読み取り経路」に置き換えたものである。
     */
    async function ownDisplayName(persona: TenantPersona, engineerId: string): Promise<string> {
      const owner = await openTenantSession(browser, persona);
      try {
        const body = parseJson(await apiRequest(owner.page, '/api/engineers')) as {
          items: ReadonlyArray<{ id: string; displayName: string }>;
        };
        const item = body.items.find((row) => row.id === engineerId);
        if (item === undefined) {
          throw new Error(`${persona.label}: 自社のエンジニア（${engineerId}）が一覧にありません。`);
        }
        return item.displayName;
      } finally {
        await owner.close();
      }
    }

    const foreignHostName = await ownDisplayName(hostOwner(1), foreignHostId);
    const foreignPartnerName = await ownDisplayName(partnerSales(1, 2), foreignPartnerId);

    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      const listBody = parseJson(await apiRequest(session.page, '/api/engineers')) as {
        items: ReadonlyArray<{ id: string; displayName: string }>;
        total: number;
      };
      // 🔴 母集団は自社所有のみ（`F-009 AC-3`）。件数（`total`）にも他社の行が現れない。
      expect(listBody.items.map((item) => item.id)).toEqual([ownId]);
      expect(listBody.total).toBe(1);
      const ownName = listBody.items[0]?.displayName;
      const names = listBody.items.map((item) => item.displayName);

      // 🔴 合成氏名は 8 種を使い回す（`ISOLATION_SEED_PERSON_NAMES`）。自社の氏名と
      //    偶然一致した場合はその文字列だけでは判定できない —— その場合の担保は上の
      //    ID ベースの母集団検査（`toEqual([ownId])`）である。
      if (foreignHostName !== ownName) expect(names).not.toContain(foreignHostName);
      if (foreignPartnerName !== ownName) expect(names).not.toContain(foreignPartnerName);

      // 画面（サーバコンポーネント。API と**同じ** `listEngineers` を通る）でも同じであることを見る。
      const html = await pageContent(session, '/engineers');
      expect(html).toContain(`engineer-list-row-${ownId}`);
      expect(html).not.toContain(`engineer-list-row-${foreignHostId}`);
      expect(html).not.toContain(`engineer-list-row-${foreignPartnerId}`);
      if (foreignHostName !== ownName) expect(html).not.toContain(foreignHostName);
      if (foreignPartnerName !== ownName) expect(html).not.toContain(foreignPartnerName);
      expectNoHiddenCountHints('パートナーの /engineers', html);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('パートナーのセッションで管理平面に到達できない', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, partnerSales(1, 1));
    try {
      await session.page.goto('/admin/tenants', { waitUntil: 'domcontentloaded' });
      expect(session.page.url()).toContain('/admin/signin');
      const response = await apiRequest(session.page, '/api/admin/tenants');
      expect(response.status).toBe(401);
    } finally {
      await session.close();
    }
  });
});

test.describe('⑤ 運営者の応答に、非開示のものが現れない（BR-40 / F-056 AC-1）', () => {
  test('A-002 / A-003 の画面と API に、氏名・案件の内容・本文・秘匿値の平文が 0 件', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openPlatformSession(browser);
    const forbidden = operatorForbiddenMarkers();
    try {
      // 対照: 運営者は自分の画面に到達できている（空振り防止）。
      const adminHome = await pageContent(session, '/admin');
      expect(adminHome).toContain(t('admin.home.title'));
      expectNoMarkers('A-001 運営者ホーム', adminHome, forbidden);

      const list = await pageContent(session, '/admin/tenants');
      expect(list).toContain(t('admin.tenants.title'));
      expectNoMarkers('A-002 テナント一覧（画面）', list, forbidden);

      for (const index of [1, 2] as const) {
        const detail = await pageContent(session, `/admin/tenants/${tenantIds(index).tenantId}`);
        expect(detail).toContain(t('admin.readOnly.badge'));
        expectNoMarkers(`A-003 テナント詳細（画面 / テナント ${index}）`, detail, forbidden);
      }

      const apiForbidden = operatorForbiddenApiMarkers();
      const listApi = await apiRequest(session.page, '/api/admin/tenants?limit=200');
      expect(listApi.status).toBe(200);
      expectNoMarkers('API-A2 GET /api/admin/tenants', listApi.text, apiForbidden);

      for (const index of [1, 2] as const) {
        const detailApi = await apiRequest(
          session.page,
          `/api/admin/tenants/${tenantIds(index).tenantId}`,
        );
        expect(detailApi.status).toBe(200);
        expectNoMarkers(`API-A3 GET /api/admin/tenants/{テナント ${index}}`, detailApi.text, apiForbidden);
      }

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('存在しないテナント ID は 404（403 と区別しない）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openPlatformSession(browser);
    try {
      const missing = await apiRequest(session.page, `/api/admin/tenants/${ABSENT_UUID}`);
      expect(missing.status).toBe(404);

      await session.page.goto(`/admin/tenants/${ABSENT_UUID}`, { waitUntil: 'domcontentloaded' });
      const content = await session.page.content();
      expectNoMarkers('A-003（存在しないテナント）', content, operatorForbiddenMarkers());
    } finally {
      await session.close();
    }
  });
});
