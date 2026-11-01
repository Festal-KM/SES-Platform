// tests/isolation/chat-project-panel.test.ts
// ✅ 2026-10-29（チャットレーン・紺野の決定）: 案件カードの「案件詳細を開く」でチャットの中に開く欄の読み取り経路。
// 欄は既存の `GET /api/projects/{id}`（`docs/05` §6.4 #27）だけを呼ぶ。その経路で次を実 DB（RLS 付き）で確かめる。
//
// 🔴 ここで固定すること:
//   ① 取引先は自社に公開中の案件だけを開け、**開くたびに** `project.view` の監査が 1 行残る（`CLAUDE.md` §3.5「案件詳細の閲覧」）
//   ② 🔴 公開されていない案件・別の取引先にだけ公開した案件の代わりの不存在・他テナントは 404 で、本文まで不存在と同じ。監査は残らない
//   ③ 🔴 取引先の応答に商流（エンド企業名・自社単価）と公開先が無い（欄は応答からさらに共通項目だけを拾う）
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureTenantDb, disconnectTenantDb, resolveTenantCtx, type AuthenticatedTenantCtx } from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.94' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const ABSENT_PROJECT = '01930000-0000-7000-8000-0000000009fd';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const projectRoute = await import('../../apps/web/app/api/(main)/projects/[id]/route');
const { chatProjectDetailApiPath, pickChatProjectPanelDetail } = await import('../../apps/web/lib/chat/project-panel');

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;

/** 欄と同じ URL（`chatProjectDetailApiPath`）で、既存の案件詳細の Route Handler を呼ぶ。 */
async function openPanel(ctx: AuthenticatedTenantCtx, projectId: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectRoute.GET(new Request(`https://app.test${chatProjectDetailApiPath(projectId)}`), {
    params: Promise.resolve({ id: projectId }),
  });
}

async function viewCount(ctx: AuthenticatedTenantCtx, projectId: string): Promise<number> {
  return admin.auditLog.count({ where: { action: 'project.view', actorId: ctx.userId, targetId: projectId } });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  const base = { lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  tenantB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { action: 'project.view' } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 自社に公開中の案件は開け、開くたびに監査が残る', () => {
  it('取引先 A1 が公開中の案件を 2 回開くと、`project.view` が 2 行増える', async () => {
    const before = await viewCount(partnerA1, PROJECT_A_PUBLISHED);
    for (let index = 0; index < 2; index += 1) {
      const response = await openPanel(partnerA1, PROJECT_A_PUBLISHED);
      expect(response.status, await response.clone().text()).toBe(200);
    }
    expect(await viewCount(partnerA1, PROJECT_A_PUBLISHED)).toBe(before + 2);
  });

  it('ホストも開ける（自社の案件。監査が残る）', async () => {
    const before = await viewCount(host, PROJECT_A_PRIVATE);
    expect((await openPanel(host, PROJECT_A_PRIVATE)).status).toBe(200);
    expect(await viewCount(host, PROJECT_A_PRIVATE)).toBe(before + 1);
  });
});

describe('② 🔴 開けない案件は不存在と同じ 404（監査は残らない）', () => {
  it('公開されていない案件・別の取引先の案件・他テナントで、状態コードと本文が不存在と一致する', async () => {
    const responses = [
      await openPanel(partnerA1, PROJECT_A_PRIVATE),
      await openPanel(partnerA2, PROJECT_A_PUBLISHED),
      await openPanel(tenantB, PROJECT_A_PUBLISHED),
      await openPanel(partnerA1, ABSENT_PROJECT),
    ];
    const texts = await Promise.all(responses.map((response) => response.text()));
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(texts).size).toBe(1);
    for (const text of texts) {
      expect(text).not.toContain('Project A');
      expect(text).not.toContain('End Client');
    }
    expect(await viewCount(partnerA1, PROJECT_A_PRIVATE)).toBe(0);
    expect(await viewCount(partnerA2, PROJECT_A_PUBLISHED)).toBe(0);
  });
});

describe('③ 🔴 取引先の応答に商流と公開先が無く、欄はさらに共通項目だけを拾う', () => {
  it('エンド企業名・自社単価・公開先を含まない', async () => {
    const body = (await (await openPanel(partnerA1, PROJECT_A_PUBLISHED)).json()) as Record<string, unknown>;
    const text = JSON.stringify(body);
    expect(text).not.toContain('End Client A');
    expect(text).not.toContain('900000');
    expect(body['visibilities']).toBeUndefined();
    const detail = pickChatProjectPanelDetail(body);
    expect(detail?.name).toBe('Project A Published');
    expect(JSON.stringify(detail)).not.toContain('unitPrice');
  });
});
