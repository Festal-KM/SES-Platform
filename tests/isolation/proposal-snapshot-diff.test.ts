// tests/isolation/proposal-snapshot-diff.test.ts
// 🔴 T-12-16（`docs/sprints/SP-12-phase1-hardening.md` T-12-16「完了の判定」②）: #46b `GET /api/proposals/{id}/snapshot-diff` を
//    **実 DB（RLS 付き）+ 実 Route Handler** で証明する。`F-019 AC-2` / docs/05 §6.5「#46b の境界と記録の確定」/ §4.8 / §16.1 / K-7 /
//    `CLAUDE.md` §3.1 経路 2 / §3.5。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか（docs/05 §6.5「検証」①〜⑦）
// ---------------------------------------------------------------------------
//   ① `F-019 AC-2`: 凍結後に台帳の 7 項目を変更 → `fields[]` の各 `frozen ≠ current`。変更前は 7 キーとも `frozen = current`。
//      **7 キーが常に、固定の順で返る**（変更が無くても落ちない）
//   ② 経歴を 1 行編集・1 行削除・1 行追加 → `careers.frozen` は不変（行数・5 項目）で `careers.current` だけ変わる
//   ③ 🔴 **ホストが取引先所有エンジニアの提案（経路 2）で 404**。対照: 同じ提案の #46 は 200（凍結側は読める）
//   ④ 取引先が他社提案 / ホスト提案で 404、他テナント / 不存在で 404（本文まで同じ）。`VIEWER` は 200（読み取り。`guards: []`）
//   ⑤ 200 のたびに `engineer.view`（`via='SNAPSHOT_DIFF'`, `summary.proposalId`, `targetId = engineerId`）が 1 行増え、`summary` に
//      氏名・単価が無い。404 では増えない
//   ⑥ 🔴 `audit_logs` の INSERT 権限を外すと**応答が返らず（500）**、`engineer.view` が増えない（記録に失敗したら返さない。
//      `proposal-request-respond.test.ts` の注入と同じ手口。プロダクション経路にテスト用の seam を置かない）
//   ⑦ 応答 JSON の深さ走査で `engineerId` / `ownerPartnerCompanyId` / `offeredUnitPrice` / `changed` / `recipient*` /
//      `affiliationLabel` / `skillSheetId` / 連絡先が 0 件。最上位のキー集合と `fields[]` の要素のキー集合が固定
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）と `readRequestMeta` だけ。Redis / worker は要らない（#36 / #46 / #46b はジョブを積まない）。
//    台帳の変更は `S-007` が書くのと同じ列を特権接続で書く（#16 の正しさは `engineers.test.ts` / `engineer-careers.test.ts` の射程）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTenantDb, disconnectTenantDb, resolveTenantCtx, type AuthenticatedTenantCtx } from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  PARTNER_A1,
  PARTNER_A2,
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
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.116' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const proposalRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/route');
const diffRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/snapshot-diff/route');
const { ENGINEER_AUDIT_ACTIONS, ENGINEER_VIEW_VIA } = await import('../../apps/web/lib/engineers/service');
const { PROPOSAL_SNAPSHOT_DIFF_VIEW_KEYS, SNAPSHOT_DIFF_FIELD_KEYS } = await import('../../apps/web/lib/proposals/snapshot-diff-fields');

/** 台帳の裏付け（辞書 1 語）。`skills` は射程外の 4 表なので ID を固定して upsert する。 */
const SKILL_DIFF = '01930000-0000-7000-8000-000000001216';
const SKILL_NAME = 'Kotlin(t1216)';
/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const ABSENT_ID = '01930000-0000-7000-8000-000000000fff';
const RECIPIENT = { recipientCompanyName: 'T1216 架空エンド株式会社', recipientEmail: 't1216@example.test' };

/** 凍結時点の台帳（7 項目 + 経歴 2 行）。 */
const HOST_BEFORE = {
  displayName: 'T1216 凍結前 太郎',
  unitPriceMin: 650000,
  unitPriceMax: 750000,
  availableFrom: new Date('2026-10-01T00:00:00.000Z'),
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
} as const;
const HOST_AFTER = {
  displayName: 'T1216 凍結後 次郎',
  unitPriceMin: 700000,
  unitPriceMax: 800000,
  availableFrom: new Date('2026-11-01T00:00:00.000Z'),
  prefecture: '27',
  remoteMode: 'FULL_REMOTE',
} as const;
const CAREERS_BEFORE = [
  { periodFrom: '2024-04', periodTo: null, role: 'PL', description: 'T1216 基幹刷新', technologies: 'Kotlin' },
  { periodFrom: '2021-01', periodTo: '2024-03', role: 'SE', description: 'T1216 受託開発', technologies: 'Java' },
] as const;
/** 秘匿キー（応答の JSON にどこにも現れてはならない）。 */
const FORBIDDEN_KEYS = ['engineerId', 'ownerPartnerCompanyId', 'offeredUnitPrice', 'changed', 'affiliationLabel', 'skillSheetId', 'contactEmail', 'contactPhone', 'birthDate'];

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
/** 🔴 GRANT の一時取り外し（注入テスト ⑥）にだけ使う。 */
let migrator: UnextendedClient;
let hostSales: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

type ErrorBody = { readonly error: { readonly code: string } };
type CreatedBody = { readonly id: string };
type SkillView = { readonly skillId: string; readonly name: string; readonly years: number; readonly level: number | null };
type Field = { readonly key: string; readonly frozen: unknown; readonly current: unknown };
type Career = { readonly periodFrom: string; readonly periodTo: string | null; readonly role: string; readonly description: string; readonly technologies: string };
type DiffBody = {
  readonly frozenAt: string;
  readonly fields: readonly Field[];
  readonly careers: { readonly frozen: readonly Career[]; readonly current: readonly (Career & { readonly id: string })[] };
};

const created = { hostProposal: '', partnerProposal: '' };

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function createProposal(ctx: AuthenticatedTenantCtx, engineerId: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.POST(
    new Request('https://app.test/api/proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_A_PUBLISHED, engineerId, subject: 'T1216', body: 'T1216 本文', offeredUnitPrice: 777777, ...RECIPIENT }),
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

async function diff(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return diffRoute.GET(new Request(`https://app.test/api/proposals/${id}/snapshot-diff`), segment(id));
}

async function detail(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return proposalRoute.GET(new Request(`https://app.test/api/proposals/${id}`), segment(id));
}

async function diffOk(ctx: AuthenticatedTenantCtx, id: string): Promise<DiffBody> {
  const response = await diff(ctx, id);
  expect(response.status).toBe(200);
  return (await response.json()) as DiffBody;
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

/** 応答 JSON を深さ優先で走査し、現れたキーの集合を返す。 */
function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
}

function fieldOf(body: DiffBody, key: string): Field {
  const field = body.fields.find((entry) => entry.key === key);
  expect(field, `fields に ${key} が無い`).toBeDefined();
  return field!;
}

async function viewAudits(): Promise<readonly { targetId: string | null; summary: unknown; actorId: string | null; deviceKind: string | null; ipAddress: string | null }[]> {
  return admin.auditLog.findMany({
    where: { action: ENGINEER_AUDIT_ACTIONS.view },
    orderBy: { createdAt: 'asc' },
    select: { targetId: true, summary: true, actorId: true, deviceKind: true, ipAddress: true },
  });
}

async function resetHostLedger(): Promise<void> {
  await admin.engineer.update({ where: { id: ENGINEER_A_HOST }, data: { ...HOST_BEFORE, contactEmail: null, contactPhone: null } });
  await admin.engineerSkill.deleteMany({ where: { engineerId: ENGINEER_A_HOST } });
  await admin.engineerSkill.create({ data: { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, skillId: SKILL_DIFF, yearsOfExperience: 6, level: 4, source: 'MANUAL' } });
  await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_HOST } });
  // 🔴 `created_at` の順を作るため 1 行ずつ（同じ `period_from` は登録順）。
  for (const row of CAREERS_BEFORE) {
    await admin.engineerCareer.create({ data: { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, ...row } });
  }
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  migrator = createUnextendedClient(database.migratorUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  await admin.skill.upsert({ where: { id: SKILL_DIFF }, create: { id: SKILL_DIFF, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 1216 }, update: {} });
  await resetHostLedger();
  // 取引先 A1 所有のエンジニアにも同じ形の台帳（③ / ④ の材料。値は別）。
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER }, data: { displayName: 'T1216 取引先 花子', unitPriceMin: 600000, unitPriceMax: 700000, prefecture: '13', remoteMode: 'ONSITE_ONLY' } });
  await admin.engineerSkill.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerSkill.create({ data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_DIFF, yearsOfExperience: 3, level: 2, source: 'MANUAL' } });
  await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerCareer.create({ data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2023-01', periodTo: null, role: 'PG', description: 'T1216 取引先の経歴', technologies: 'Kotlin' } });

  // 材料は実 #36 で作る（凍結は本物）。
  created.hostProposal = await createProposal(hostSales, ENGINEER_A_HOST);
  created.partnerProposal = await createProposal(partnerA1, ENGINEER_A_PARTNER);
  await admin.auditLog.deleteMany({ where: { action: { in: [ENGINEER_AUDIT_ACTIONS.view, 'proposal.create'] } } });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  const ids = Object.values(created).filter((id) => id !== '');
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.auditLog.deleteMany({ where: { action: { in: [ENGINEER_AUDIT_ACTIONS.view, 'proposal.create'] } } });
  await disconnectTenantDb();
  await migrator?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  await admin.auditLog.deleteMany({ where: { action: ENGINEER_AUDIT_ACTIONS.view } });
});

// ---------------------------------------------------------------------------
// ① F-019 AC-2: 7 項目
// ---------------------------------------------------------------------------

describe('🔴 ① F-019 AC-2: fields は 7 キー固定。凍結後に台帳の 7 項目を変えると frozen ≠ current', () => {
  it('変更前: 7 キーが固定の順で返り、すべて frozen = current。skills は凍結の形（skillId / name / years / level）', async () => {
    await resetHostLedger();
    const body = await diffOk(hostSales, created.hostProposal);
    expect(Object.keys(body).sort()).toEqual([...PROPOSAL_SNAPSHOT_DIFF_VIEW_KEYS].sort());
    expect(body.fields.map((field) => field.key)).toEqual([...SNAPSHOT_DIFF_FIELD_KEYS]);
    for (const field of body.fields) {
      expect(Object.keys(field).sort()).toEqual(['current', 'frozen', 'key']);
      expect(field.current).toEqual(field.frozen);
    }
    expect(fieldOf(body, 'displayName')).toMatchObject({ frozen: HOST_BEFORE.displayName, current: HOST_BEFORE.displayName });
    expect(fieldOf(body, 'skills').frozen).toEqual([{ skillId: SKILL_DIFF, name: SKILL_NAME, years: 6, level: 4 }]);
    expect(fieldOf(body, 'unitPriceMin')).toMatchObject({ frozen: 650000, current: 650000 });
    expect(fieldOf(body, 'unitPriceMax')).toMatchObject({ frozen: 750000, current: 750000 });
    expect(fieldOf(body, 'availableFrom')).toMatchObject({ frozen: '2026-10-01', current: '2026-10-01' });
    expect(fieldOf(body, 'prefecture')).toMatchObject({ frozen: '13', current: '13' });
    expect(fieldOf(body, 'remoteMode')).toMatchObject({ frozen: 'PARTIAL_REMOTE', current: 'PARTIAL_REMOTE' });
    // 対照: #46 の凍結側と同じ値（2 つの直列化を作らない）。
    const snapshot = (await (await detail(hostSales, created.hostProposal)).json()) as { snapshot: { frozenAt: string; skills: SkillView[]; displayName: string } };
    expect(snapshot.snapshot.frozenAt).toBe(body.frozenAt);
    expect(snapshot.snapshot.skills).toEqual(fieldOf(body, 'skills').frozen);
    expect(snapshot.snapshot.displayName).toBe(fieldOf(body, 'displayName').frozen);
  });

  it('🔴 7 項目すべてを変更 → 7 キーとも frozen ≠ current。frozen は凍結時点のまま。1 項目だけ戻すとその 1 キーだけ一致', async () => {
    await admin.engineer.update({ where: { id: ENGINEER_A_HOST }, data: { ...HOST_AFTER } });
    await admin.engineerSkill.update({ where: { tenantId_engineerId_skillId: { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, skillId: SKILL_DIFF } }, data: { yearsOfExperience: 7, level: 5 } });

    const body = await diffOk(hostSales, created.hostProposal);
    expect(body.fields.map((field) => field.key)).toEqual([...SNAPSHOT_DIFF_FIELD_KEYS]);
    for (const field of body.fields) expect(field.current, field.key).not.toEqual(field.frozen);
    expect(fieldOf(body, 'displayName')).toMatchObject({ frozen: HOST_BEFORE.displayName, current: HOST_AFTER.displayName });
    expect(fieldOf(body, 'skills')).toMatchObject({
      frozen: [{ skillId: SKILL_DIFF, name: SKILL_NAME, years: 6, level: 4 }],
      current: [{ skillId: SKILL_DIFF, name: SKILL_NAME, years: 7, level: 5 }],
    });
    expect(fieldOf(body, 'unitPriceMin')).toMatchObject({ frozen: 650000, current: 700000 });
    expect(fieldOf(body, 'unitPriceMax')).toMatchObject({ frozen: 750000, current: 800000 });
    expect(fieldOf(body, 'availableFrom')).toMatchObject({ frozen: '2026-10-01', current: '2026-11-01' });
    expect(fieldOf(body, 'prefecture')).toMatchObject({ frozen: '13', current: '27' });
    expect(fieldOf(body, 'remoteMode')).toMatchObject({ frozen: 'PARTIAL_REMOTE', current: 'FULL_REMOTE' });
    // 🔴 凍結側は 1 バイトも変わっていない（`engineer_snapshots` の行）。
    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.hostProposal }, select: { displayName: true, unitPriceMin: true, prefecture: true } });
    expect(snapshot.displayName).toBe(HOST_BEFORE.displayName);
    expect(Number(snapshot.unitPriceMin?.toString())).toBe(650000);
    expect(snapshot.prefecture).toBe('13');

    // 1 項目だけ戻す → そのキーだけ frozen = current（変更していないキーは落ちない = 7 キーのまま）。
    await admin.engineer.update({ where: { id: ENGINEER_A_HOST }, data: { prefecture: '13' } });
    const partial = await diffOk(hostSales, created.hostProposal);
    expect(partial.fields).toHaveLength(7);
    expect(partial.fields.map((field) => [field.key, JSON.stringify(field.frozen) === JSON.stringify(field.current)])).toEqual([
      ['displayName', false],
      ['skills', false],
      ['unitPriceMin', false],
      ['unitPriceMax', false],
      ['availableFrom', false],
      ['prefecture', true],
      ['remoteMode', false],
    ]);
  });

  it('スキルを 2 件にすると current は skillId 昇順の凍結の形。0 件にすると current = []（frozen は 1 件のまま）', async () => {
    await resetHostLedger();
    const extra = '01930000-0000-7000-8000-000000000001';
    await admin.skill.upsert({ where: { id: extra }, create: { id: extra, name: 'AWS(t1216)', category: 'CLOUD', sortKey: 1217 }, update: {} });
    await admin.engineerSkill.create({ data: { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, skillId: extra, yearsOfExperience: 2.5, level: null, source: 'MANUAL' } });
    const two = await diffOk(hostSales, created.hostProposal);
    expect(fieldOf(two, 'skills').current).toEqual([
      { skillId: extra, name: 'AWS(t1216)', years: 2.5, level: null },
      { skillId: SKILL_DIFF, name: SKILL_NAME, years: 6, level: 4 },
    ]);
    expect(fieldOf(two, 'skills').frozen).toEqual([{ skillId: SKILL_DIFF, name: SKILL_NAME, years: 6, level: 4 }]);

    await admin.engineerSkill.deleteMany({ where: { engineerId: ENGINEER_A_HOST } });
    const none = await diffOk(hostSales, created.hostProposal);
    expect(fieldOf(none, 'skills')).toMatchObject({ frozen: [{ skillId: SKILL_DIFF, name: SKILL_NAME, years: 6, level: 4 }], current: [] });
    expect(none.fields).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// ② 経歴（F-008 AC-6 / F-019 AC-5 の差分側）
// ---------------------------------------------------------------------------

describe('🔴 ② 経歴を 1 行編集・1 行削除・1 行追加 → careers.frozen は不変、careers.current だけ変わる', () => {
  it('凍結側は 2 行のまま 5 項目が変わらず、現在値は編集 + 追加の 2 行（削除した行は無い）。両者は別のキー', async () => {
    await resetHostLedger();
    const before = await diffOk(hostSales, created.hostProposal);
    expect(before.careers.frozen).toEqual([...CAREERS_BEFORE]);
    expect(before.careers.current).toMatchObject([...CAREERS_BEFORE]);
    const frozenText = JSON.stringify(before.careers.frozen);

    const rows = await admin.engineerCareer.findMany({ where: { engineerId: ENGINEER_A_HOST }, orderBy: { periodFrom: 'desc' }, select: { id: true, periodFrom: true } });
    const [pl, se] = rows;
    // 1 行編集（PL の業務内容）/ 1 行削除（SE）/ 1 行追加（2019）。
    await admin.engineerCareer.update({ where: { id: pl!.id }, data: { description: 'T1216 基幹刷新（提案後に改訂）' } });
    await admin.engineerCareer.delete({ where: { id: se!.id } });
    await admin.engineerCareer.create({ data: { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, periodFrom: '2019-01', periodTo: '2020-12', role: 'PG', description: 'T1216 保守', technologies: 'PHP' } });

    const after = await diffOk(hostSales, created.hostProposal);
    // 🔴 凍結側は 1 バイトも変わらない。
    expect(JSON.stringify(after.careers.frozen)).toBe(frozenText);
    expect(after.careers.frozen).toHaveLength(2);
    for (const row of after.careers.frozen) expect(Object.keys(row).sort()).toEqual(['description', 'periodFrom', 'periodTo', 'role', 'technologies']);
    // 現在値だけ変わる（#17 と同じ全順序 = period_from 降順）。
    expect(after.careers.current.map((row) => [row.periodFrom, row.description])).toEqual([
      ['2024-04', 'T1216 基幹刷新（提案後に改訂）'],
      ['2019-01', 'T1216 保守'],
    ]);
    expect(after.careers.current.some((row) => row.description === 'T1216 受託開発')).toBe(false);
    expect(after.careers.current[0]?.id).toBe(pl!.id);
    // 🔴 行の対応付け・changed フラグは無い。
    expect(Object.keys(after.careers).sort()).toEqual(['current', 'frozen']);
  });

  it('経歴 0 行のエンジニアの提案でも 200（frozen = [] / current = []）', async () => {
    await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
    const id = await createProposal(partnerA1, ENGINEER_A_PARTNER);
    try {
      const body = await diffOk(partnerA1, id);
      expect(body.careers).toEqual({ frozen: [], current: [] });
    } finally {
      await admin.engineerSnapshot.deleteMany({ where: { proposalId: id } });
      await admin.proposalEvent.deleteMany({ where: { proposalId: id } });
      await admin.proposal.deleteMany({ where: { id } });
      await admin.engineerCareer.create({ data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2023-01', periodTo: null, role: 'PG', description: 'T1216 取引先の経歴', technologies: 'Kotlin' } });
    }
  });
});

// ---------------------------------------------------------------------------
// ③ ④ 境界（docs/05 §4.8 / 経路 2）
// ---------------------------------------------------------------------------

describe('🔴 ③ ④ 境界: 現在値（engineers。C3）が読めなければ 404。凍結側だけを返さない', () => {
  it('🔴 ホストが取引先所有エンジニアの提案（経路 2）で #46b → 404。対照: 同じ提案の #46 は 200（凍結側は読める）', async () => {
    const forbidden = await errorOf(await diff(hostSales, created.partnerProposal), 404);
    expect(forbidden.code).toBe('NOT_FOUND');
    const contrast = await detail(hostSales, created.partnerProposal);
    expect(contrast.status).toBe(200);
    const view = (await contrast.json()) as { snapshot: { displayName: string; careers: unknown[] } };
    expect(view.snapshot.displayName).toBe('T1216 取引先 花子');
    expect(view.snapshot.careers).toHaveLength(1);
    // 🔴 404 では「閲覧」の記録も残らない（見えない行の閲覧は無い）。
    expect(await viewAudits()).toHaveLength(0);
  });

  it('取引先: 自社提案 × 自社エンジニアは 200。他社（A2）は 404、ホスト提案は 404。他テナント / 不存在は 404。本文まで同じ', async () => {
    const own = await diffOk(partnerA1, created.partnerProposal);
    expect(fieldOf(own, 'displayName')).toMatchObject({ frozen: 'T1216 取引先 花子', current: 'T1216 取引先 花子' });
    expect(own.careers.frozen).toHaveLength(1);

    const responses = await Promise.all([
      diff(partnerA2, created.partnerProposal),
      diff(partnerA1, created.hostProposal),
      diff(hostB, created.hostProposal),
      diff(hostSales, ABSENT_ID),
    ]);
    const bodies = await Promise.all(responses.map((response) => errorOf(response, 404)));
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(bodies[0]?.code).toBe('NOT_FOUND');
  });

  it('形の違う ID は 400（存在を探らせない）。VIEWER は 200（読み取り。guards: []）', async () => {
    expect((await errorOf(await diff(hostSales, 'not-a-uuid'), 400)).code).toBe('VALIDATION');
    const body = await diffOk(hostViewer, created.hostProposal);
    expect(body.fields).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// ⑤ ⑥ 記録（BR-27 / K-7 / §16.1）
// ---------------------------------------------------------------------------

describe('🔴 ⑤ ⑥ engineer.view（via=SNAPSHOT_DIFF）は同一トランザクションで記録され、失敗したら応答が返らない', () => {
  it('200 のたびに 1 行増える: targetId = engineerId、summary = { via, proposalId } だけ（氏名・単価が無い）、deviceKind / ip', async () => {
    await diffOk(hostSales, created.hostProposal);
    const once = await viewAudits();
    expect(once).toHaveLength(1);
    expect(once[0]).toEqual({
      targetId: ENGINEER_A_HOST,
      summary: { via: ENGINEER_VIEW_VIA.snapshotDiff, proposalId: created.hostProposal },
      actorId: USER_A_HOST,
      deviceKind: META.deviceKind,
      ipAddress: META.ipAddress,
    });
    expect(ENGINEER_VIEW_VIA.snapshotDiff).toBe('SNAPSHOT_DIFF');
    const serialized = JSON.stringify(once[0]?.summary);
    expect(serialized).not.toContain(HOST_BEFORE.displayName);
    expect(serialized).not.toContain('650000');
    expect(serialized).not.toMatch(/displayName|unitPrice|changed|affiliation/);

    await diffOk(hostSales, created.hostProposal);
    await diffOk(partnerA1, created.partnerProposal);
    const three = await viewAudits();
    expect(three).toHaveLength(3);
    expect(three[2]).toMatchObject({ targetId: ENGINEER_A_PARTNER, summary: { via: 'SNAPSHOT_DIFF', proposalId: created.partnerProposal }, actorId: USER_A_PARTNER });
  });

  it('🔴 注入テスト: audit_logs の INSERT 権限を外すと 500 で応答が返らず、engineer.view は増えない。戻せば同じ提案で 200', async () => {
    await migrator.$executeRawUnsafe('REVOKE INSERT ON audit_logs FROM app_tenant');
    try {
      const response = await diff(hostSales, created.hostProposal);
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(((): ErrorBody => JSON.parse(text) as ErrorBody)().error.code).toBe('INTERNAL');
      // 🔴 応答の本文に凍結側・現在値のどちらも無い（半端に返さない）。
      expect(text).not.toContain('frozenAt');
      expect(text).not.toContain(HOST_BEFORE.displayName);
    } finally {
      await migrator.$executeRawUnsafe('GRANT INSERT ON audit_logs TO app_tenant');
    }
    expect(await viewAudits()).toHaveLength(0);

    // 対照: 権限を戻すと同じ提案で 200 になり、記録も 1 行残る（注入が空振りでない）。
    await diffOk(hostSales, created.hostProposal);
    expect(await viewAudits()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 応答の形
// ---------------------------------------------------------------------------

describe('🔴 ⑦ 応答 JSON に engineerId / ownerPartnerCompanyId / offeredUnitPrice / changed / recipient* / 添付・連絡先が無い', () => {
  it('深さ走査で秘匿キーが 0 件。最上位は frozenAt / fields / careers。fields[] の要素は key / frozen / current', async () => {
    await resetHostLedger();
    for (const [ctx, id] of [
      [hostSales, created.hostProposal],
      [partnerA1, created.partnerProposal],
    ] as const) {
      const body = await diffOk(ctx, id);
      const keys = new Set<string>();
      collectKeys(body, keys);
      for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
      for (const key of keys) expect(key.startsWith('recipient'), key).toBe(false);
      expect(Object.keys(body).sort()).toEqual([...PROPOSAL_SNAPSHOT_DIFF_VIEW_KEYS].sort());
      for (const field of body.fields) expect(Object.keys(field).sort()).toEqual(['current', 'frozen', 'key']);
      expect(Object.keys(body.careers).sort()).toEqual(['current', 'frozen']);
      const serialized = JSON.stringify(body);
      // 🔴 エンジニア ID / 提案先 / 本文 / 提案単価の値も現れない。
      expect(serialized).not.toContain(ENGINEER_A_HOST);
      expect(serialized).not.toContain(ENGINEER_A_PARTNER);
      expect(serialized).not.toContain(RECIPIENT.recipientCompanyName);
      expect(serialized).not.toContain(RECIPIENT.recipientEmail);
      expect(serialized).not.toContain('T1216 本文');
      expect(serialized).not.toContain('777777');
    }
  });
});
