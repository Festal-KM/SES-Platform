// tests/isolation/project-candidates.test.ts
// 🔴 T-08-05（`docs/sprints/SP-08-anonymous-share.md` §5）: 自社候補と匿名候補の混在を**実 DB・実 Route Handler**で
//    証明する。`F-017 AC-5` / `AC-7` / `F-009` / `docs/05` §4.6「自社候補との混在の並びとページング」/
//    §6.5「#30 の実装の決着」/ `docs/03` §4.13.2-5（閲覧の記録）。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① `F-017 AC-5`: パートナーの応答（`#30` / `#15?projectId=`）に匿名候補が **1 件も**含まれない
//      （`candidateRef` というキーが応答のどの深さにも無い）。他社のエンジニアの値も 1 文字も無い。
//   ② `F-017 AC-1` / `AC-2`: ホストの応答で、**自社候補の行と匿名候補の行が混在したとき**、匿名候補側に
//      自社候補用のフィールド（`displayName` / `id` / `ownership` / `availability` …）が紛れない。
//      実名・共有元・内部 ID・丸める前の値が匿名候補側に 1 文字も現れない（深さ走査 + 対照）。
//   ③ `F-017 AC-7`: `score` / `rank` / `index` / `weight` に相当するキーが応答に無い。`phase` は `'P1'`。
//   ④ 🔴 マージ順序の決定性: **同じ要求を 10 回実行して並びとカーソルが一致する**。
//   ⑤ ページング: 並びのキーのカーソルで重複も欠落も無く辿れる。UUID のカーソルは 400。
//   ⑥ 🔴 閲覧が `AuditLog` に `project.view` / `summary.via = 'CANDIDATES'` で記録され、`summary` に
//      匿名候補の件数・`engineer_id`・参照子が無い。
//   ⑦ `MatchCandidate`（匿名）が一覧の読み取りで案件全体として置き換わり、共有解除が即座に反映される。
//   ⑧ 匿名候補への検索条件は丸め後の区分で効く（`yearsMin=7` と `8` で当たり方が変わらない。`q` /
//      `availability` は匿名候補に効かない）。
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）と `candidateReference`（起動時 DI の鍵。`initializeRuntimeConfig`
//    を要求するため）の 2 点だけ。DB・RLS・共有スコープ・Route Handler はすべて実物である。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  SHARE_A_P1,
  TENANT_A,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.85' } as const;

/**
 * 🔴 テスト専用の HMAC 鍵（`anonymous-candidate-view.test.ts` と同じ理由で `bootstrap` を通さない）。
 */
const TEST_SECRET = 'B'.repeat(43) + '=';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { createCandidateReference } = await import('../../apps/web/lib/anonymize/reference');
const candidateRef = createCandidateReference(TEST_SECRET);

vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  candidateReference: () => candidateRef,
}));

const candidatesRoute = await import(
  '../../apps/web/app/api/(main)/projects/[id]/candidates/route'
);
const engineersRoute = await import('../../apps/web/app/api/(main)/engineers/route');
const { ANONYMOUS_CANDIDATE_VIEW_KEYS } = await import(
  '../../apps/web/lib/anonymize/candidate-view'
);
const { toJstIsoDay } = await import('../../apps/web/lib/format/datetime');

// ---------------------------------------------------------------------------
// 🔴 稼働可能時期は「今日」からの相対区分なので、固定日付ではなく実行日から組む（テストが日付で腐らない）。
//    Host = 10 日前（即日）/ P1 = 翌月 15 日（翌月の帯。最も早い稼働開始は翌月 1 日）/
//    P2 = 4 か月後の 1 日（3 か月以降の帯）。`AVAILABLE_BY` = 翌月 5 日 → Host / P1 は間に合いうる、P2 は外。
// ---------------------------------------------------------------------------
const TODAY_JST = toJstIsoDay(new Date());
function monthStart(monthOffset: number): { readonly year: number; readonly month: number } {
  const total = Number(TODAY_JST.slice(0, 4)) * 12 + (Number(TODAY_JST.slice(5, 7)) - 1) + monthOffset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}
const NEXT_MONTH = monthStart(1);
const FOUR_MONTHS = monthStart(4);
const HOST_AVAILABLE_FROM = new Date(Date.parse(`${TODAY_JST}T00:00:00.000Z`) - 10 * 86_400_000)
  .toISOString()
  .slice(0, 10);
const P1_AVAILABLE_FROM = ymd(NEXT_MONTH.year, NEXT_MONTH.month, 15);
const P2_AVAILABLE_FROM = ymd(FOUR_MONTHS.year, FOUR_MONTHS.month, 1);
const AVAILABLE_BY = ymd(NEXT_MONTH.year, NEXT_MONTH.month, 5);

/** 🔴 テストが足す辞書スキル（`skills` は射程外表であり `tenant_id` を持たない）。 */
const SKILL_TS = '01930000-0000-7000-8000-0000000009c1';
const SKILL_GO = '01930000-0000-7000-8000-0000000009c2';
const SKILL_TS_NAME = 'TypeScript(candidates)';
const SKILL_GO_NAME = 'Go(candidates)';

/** 2 社目の共有（テストが足す。`F-017 AC-5` の「他社の匿名候補」を作る）。 */
const SHARE_A_P2 = '01930000-0000-7000-8000-0000000009c3';

/** 🔴 応答に 1 文字も現れてはならない値（実 DB に実在させ、対照テストで確かめる）。 */
const P1_DISPLAY_NAME = 'Engineer A-Partner';
const P1_CONTACT_EMAIL = 'candidates-p1@example.test';
const P1_AFFILIATION = '候補一覧検証株式会社';
const P1_CITY = '渋谷区';
const P1_NOTE = '営業メモ（P1）';
const P2_DISPLAY_NAME = 'Engineer A-Partner2';
const P2_CONTACT_EMAIL = 'candidates-p2@example.test';
const HOST_DISPLAY_NAME = 'Engineer A-Host';

/**
 * 更新時刻。JST 暦日にすると Host = 09-10 / P1 = 09-10 / P2 = 09-09 になる。
 * 🔴 Host と P1 を**同じ日**にして、同日内の並びが種別ではなく参照子で決まることを見る。
 */
const UPDATED_HOST = new Date('2026-09-10T01:00:00.000Z');
const UPDATED_P1 = new Date('2026-09-09T20:00:00.000Z'); // JST 09-10 05:00
const UPDATED_P2 = new Date('2026-09-09T02:00:00.000Z'); // JST 09-09 11:00

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostA: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;

type Body = {
  readonly project?: { readonly id: string; readonly name: string };
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly phase?: string;
};
type ErrorBody = { readonly error: { readonly code: string; readonly details?: string[] } };

async function getCandidates(ctx: AuthenticatedTenantCtx, projectId: string, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return candidatesRoute.GET(new Request(`https://app.test/api/projects/${projectId}/candidates${query}`), {
    params: Promise.resolve({ id: projectId }),
  });
}

async function getEngineers(ctx: AuthenticatedTenantCtx, query: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineersRoute.GET(new Request(`https://app.test/api/engineers${query}`));
}

async function bodyOf(response: Response): Promise<Body> {
  expect(response.status).toBe(200);
  return (await response.json()) as Body;
}

function isAnonymous(item: Record<string, unknown>): boolean {
  return 'candidateRef' in item;
}

// ---------------------------------------------------------------------------
// 深さ走査（anonymous-candidate-view.test.ts と同じ手口）
// ---------------------------------------------------------------------------
type Collected = { readonly keys: string[]; readonly values: string[] };

function collect(value: unknown, depth = 0, acc: Collected = { keys: [], values: [] }): Collected {
  if (depth > 6 || value === null || value === undefined) return acc;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    acc.values.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, depth + 1, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      acc.keys.push(key);
      collect(entry, depth + 1, acc);
    }
  }
  return acc;
}

/** 匿名候補側に 1 文字も現れてはならない値（実名・共有元・内部 ID・丸める前の値）。 */
const FORBIDDEN_IN_ANONYMOUS: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'P1 の実名', value: P1_DISPLAY_NAME },
  { label: 'P1 の連絡先', value: P1_CONTACT_EMAIL },
  { label: 'P1 の現所属会社名', value: P1_AFFILIATION },
  { label: 'P1 の市区町村', value: P1_CITY },
  { label: 'P1 の営業メモ', value: P1_NOTE },
  { label: 'P2 の実名', value: P2_DISPLAY_NAME },
  { label: 'P2 の連絡先', value: P2_CONTACT_EMAIL },
  { label: 'P1 の engineer_id', value: ENGINEER_A_PARTNER },
  { label: 'P2 の engineer_id', value: ENGINEER_A_PARTNER2 },
  { label: '共有元 P1 の ID', value: PARTNER_A1 },
  { label: '共有元 P2 の ID', value: PARTNER_A2 },
  { label: 'スキル辞書 ID（TS）', value: SKILL_TS },
  { label: 'スキル辞書 ID（Go）', value: SKILL_GO },
  { label: '丸める前の単価', value: '650000' },
  { label: '具体的な稼働開始日', value: P1_AVAILABLE_FROM },
  { label: '丸めていない更新日時', value: UPDATED_P1.toISOString() },
];

/** 匿名候補側のどの深さにも現れてはならないキー名（自社候補用のフィールドを含む）。 */
const FORBIDDEN_KEYS_IN_ANONYMOUS: readonly string[] = [
  'id',
  'displayName',
  'ownership',
  'primarySkills',
  'moreSkillCount',
  'availability',
  'availableFrom',
  'unitPriceMin',
  'unitPriceMax',
  'yearsMax',
  'engineerId',
  'skillId',
  'sortKey',
  'yearsOfExperience',
  'updatedAt',
  'contactEmail',
  'contactPhone',
  'affiliationLabel',
  'birthDate',
  'city',
  'preferenceNote',
  'ownerPartnerCompanyId',
  'partnerCompanyId',
  'careers',
  'careerCount',
  'skillSheet',
  'score',
  'rank',
  'index',
  'weight',
];

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = {
    tenantId: TENANT_A,
    lifecycleState: 'ACTIVE' as const,
    partnerSuspendedAt: null,
    twoFactor: 'NOT_ENROLLED' as const,
  };
  hostA = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' },
    { deviceKind: 'api' },
  );
  partnerA1 = await resolveTenantCtx(
    { ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' },
    { deviceKind: 'api' },
  );
  partnerA2 = await resolveTenantCtx(
    { ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' },
    { deviceKind: 'api' },
  );

  await admin.skill.createMany({
    data: [
      { id: SKILL_TS, name: SKILL_TS_NAME, category: 'LANGUAGE', sortKey: 1 },
      { id: SKILL_GO, name: SKILL_GO_NAME, category: 'LANGUAGE', sortKey: 2 },
    ],
    skipDuplicates: true,
  });

  // 🔴 P1 のエンジニアに PII と商流情報を全部入れる（出ないことを示すには「DB には在る」ことが要る）。
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER },
    data: {
      displayName: P1_DISPLAY_NAME,
      contactEmail: P1_CONTACT_EMAIL,
      affiliationLabel: P1_AFFILIATION,
      city: P1_CITY,
      preferenceNote: P1_NOTE,
      unitPriceMin: 650000,
      unitPriceMax: 650000,
      availableFrom: dateOnly(P1_AVAILABLE_FROM),
      prefecture: '13',
      remoteMode: 'PARTIAL_REMOTE',
      availability: 'STANDBY_SCHEDULED',
    },
  });
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER2 },
    data: {
      displayName: P2_DISPLAY_NAME,
      contactEmail: P2_CONTACT_EMAIL,
      unitPriceMin: 800000,
      unitPriceMax: 900000,
      availableFrom: dateOnly(P2_AVAILABLE_FROM),
      prefecture: '27',
      remoteMode: 'ONSITE_ONLY',
    },
  });
  await admin.engineer.update({
    where: { id: ENGINEER_A_HOST },
    data: {
      displayName: HOST_DISPLAY_NAME,
      unitPriceMin: 600000,
      unitPriceMax: 700000,
      availableFrom: dateOnly(HOST_AVAILABLE_FROM),
      prefecture: '13',
      remoteMode: 'FULL_REMOTE',
    },
  });
  await admin.engineerSkill.createMany({
    data: [
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_TS, yearsOfExperience: 7, source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_GO, yearsOfExperience: 3, source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER2, skillId: SKILL_GO, yearsOfExperience: 12, source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, skillId: SKILL_TS, yearsOfExperience: 5, source: 'MANUAL' },
    ],
    skipDuplicates: true,
  });
  // 🔴 2 社目も共有する（他社の匿名候補がパートナーに 1 件も出ないことの検証に要る）。
  await admin.engineerShare.upsert({
    where: { id: SHARE_A_P2 },
    create: {
      id: SHARE_A_P2,
      tenantId: TENANT_A,
      engineerId: ENGINEER_A_PARTNER2,
      partnerCompanyId: PARTNER_A2,
      sharedAt: new Date('2026-09-01T00:00:00.000Z'),
      sharedBy: USER_A_PARTNER2,
    },
    update: { revokedAt: null },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  await admin.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: null } });
  await admin.engineerShare.update({ where: { id: SHARE_A_P2 }, data: { revokedAt: null } });
  // 🔴 `updated_at` は `@updatedAt` なので、毎回明示して固定する（並びの前提）。
  await admin.engineer.update({ where: { id: ENGINEER_A_HOST }, data: { updatedAt: UPDATED_HOST } });
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER }, data: { updatedAt: UPDATED_P1 } });
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER2 }, data: { updatedAt: UPDATED_P2 } });
});

afterEach(async () => {
  await admin.auditLog.deleteMany({ where: { action: 'project.view' } });
});

describe('🔴 F-017 AC-5: パートナーの応答に匿名候補が 1 件も含まれない', () => {
  it('公開された案件の候補一覧は自社台帳だけであり、candidateRef がどの深さにも無い', async () => {
    const body = await bodyOf(await getCandidates(partnerA1, PROJECT_A_PUBLISHED));
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.items[0]?.['id']).toBe(ENGINEER_A_PARTNER);
    const collected = collect(body);
    expect(collected.keys).not.toContain('candidateRef');
    // 他社（ホスト・P2）の値が 1 文字も無い。
    const haystack = collected.values.join('|');
    expect(haystack).not.toContain(HOST_DISPLAY_NAME);
    expect(haystack).not.toContain(P2_DISPLAY_NAME);
    expect(haystack).not.toContain(ENGINEER_A_HOST);
    expect(haystack).not.toContain(ENGINEER_A_PARTNER2);
    expect(haystack).not.toContain(PARTNER_A2);
  });

  it('`GET /api/engineers?projectId=` でもパートナーには匿名候補が 0 件', async () => {
    const body = await bodyOf(await getEngineers(partnerA1, `?projectId=${PROJECT_A_PUBLISHED}`));
    expect(body.items).toHaveLength(1);
    expect(collect(body).keys).not.toContain('candidateRef');
    expect(body.project).toBeUndefined();
    expect(body.phase).toBeUndefined();
  });

  it('公開されていない案件・他社に公開された案件は 404（存在と区別が付かない）', async () => {
    expect((await getCandidates(partnerA1, PROJECT_A_PRIVATE)).status).toBe(404);
    expect((await getCandidates(partnerA2, PROJECT_A_PUBLISHED)).status).toBe(404);
    const missing = await getCandidates(hostA, '01930000-0000-7000-8000-00000000fee1');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });
});

describe('🔴 F-017 AC-1 / AC-2 / AC-7: ホストの応答で自社候補と匿名候補が混在しても、匿名側に余計なものが無い', () => {
  it('自社 1 + 匿名 2 が混在し、匿名候補側のキー集合は 8 + ネスト 4 ちょうどである', async () => {
    const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    expect(body.phase).toBe('P1');
    expect(body.project?.id).toBe(PROJECT_A_PUBLISHED);
    expect(body.total).toBe(3);
    const own = body.items.filter((item) => !isAnonymous(item));
    const anonymous = body.items.filter(isAnonymous);
    expect(own).toHaveLength(1);
    expect(anonymous).toHaveLength(2);
    expect(own[0]?.['displayName']).toBe(HOST_DISPLAY_NAME);
    expect(own[0]?.['yearsMax']).toBe(5);

    const collected = collect(anonymous);
    const uniqueKeys = [...new Set(collected.keys)].sort();
    expect(uniqueKeys).toEqual(
      [...ANONYMOUS_CANDIDATE_VIEW_KEYS, 'name', 'kind', 'fromManYen', 'toManYen'].sort(),
    );
    for (const key of FORBIDDEN_KEYS_IN_ANONYMOUS) {
      expect(uniqueKeys, `匿名候補側に禁止キー: ${key}`).not.toContain(key);
    }
    const haystack = collected.values.join('|');
    for (const forbidden of FORBIDDEN_IN_ANONYMOUS) {
      expect(haystack, `匿名候補側に禁止値: ${forbidden.label}`).not.toContain(forbidden.value);
    }
  });

  it('🔴 対照: 禁止した値は DB に実在し、匿名候補側に出てよい値は確かに出ている', async () => {
    const p1 = await admin.engineer.findUniqueOrThrow({
      where: { id: ENGINEER_A_PARTNER },
      select: { displayName: true, contactEmail: true, affiliationLabel: true, city: true, preferenceNote: true, unitPriceMin: true, ownerPartnerCompanyId: true },
    });
    expect(p1.displayName).toBe(P1_DISPLAY_NAME);
    expect(p1.contactEmail).toBe(P1_CONTACT_EMAIL);
    expect(p1.affiliationLabel).toBe(P1_AFFILIATION);
    expect(p1.city).toBe(P1_CITY);
    expect(p1.preferenceNote).toBe(P1_NOTE);
    expect(Number(p1.unitPriceMin?.toString())).toBe(650000);
    expect(p1.ownerPartnerCompanyId).toBe(PARTNER_A1);

    const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    const values = collect(body.items.filter(isAnonymous)).values;
    expect(values).toContain(SKILL_TS_NAME);
    expect(values).toContain('Y5_10');
    expect(values).toContain('GTE_10Y');
    expect(values).toContain('PARTIAL_REMOTE');
    expect(values).toContain('2026-09-10'); // 🔴 JST 暦日（UTC 切り出しなら 09-09）
  });

  it('🔴 応答のどこにも score / rank / index / weight が無い（F-017 AC-7）', async () => {
    const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    const keys = new Set(collect(body).keys);
    for (const key of ['score', 'rank', 'index', 'weight', 'breakdown', 'rationale', 'cutoffReason']) {
      expect(keys.has(key), `応答に ${key} が現れた`).toBe(false);
    }
  });

  it('同日内の並びは種別ではなく参照子で決まり、自社候補と匿名候補が同じ比較子で混ざる', async () => {
    const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    // Host と P1 は同じ JST 暦日（09-10）、P2 は 09-09 → P2 は必ず最後。
    expect(isAnonymous(body.items[2] as Record<string, unknown>)).toBe(true);
    const lastRef = body.items[2]?.['candidateRef'];
    expect(lastRef).toBe(candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER2));
    // 先頭 2 件（Host / P1）の順序は参照子の昇順で決まる。
    const hostRef = candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_HOST);
    const p1Ref = candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER);
    const expectedFirstIsHost = hostRef < p1Ref;
    expect(isAnonymous(body.items[0] as Record<string, unknown>)).toBe(!expectedFirstIsHost);
  });
});

describe('🔴 マージ順序の決定性（10 回実行で一致）とページング', () => {
  it('同じ要求を 10 回実行して、並びと nextCursor が完全に一致する', async () => {
    const baseline = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, '?limit=2'));
    expect(baseline.items).toHaveLength(2);
    expect(baseline.nextCursor).not.toBeNull();
    const signature = (body: Body): string =>
      JSON.stringify([body.items.map((item) => item['id'] ?? item['candidateRef']), body.nextCursor, body.total]);
    for (let run = 0; run < 10; run += 1) {
      const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, '?limit=2'));
      expect(signature(body)).toBe(signature(baseline));
    }
  });

  it('並びのキーのカーソルで重複も欠落も無く全件を辿る（limit=1）', async () => {
    const seen: unknown[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 5; guard += 1) {
      const query = `?limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, query));
      seen.push(...body.items.map((item) => item['id'] ?? item['candidateRef']));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('🔴 行の UUID をカーソルに渡すと 400（黙って先頭ページに戻さない）', async () => {
    const response = await getCandidates(hostA, PROJECT_A_PUBLISHED, `?cursor=${ENGINEER_A_HOST}`);
    expect(response.status).toBe(400);
    // `#15` は組み合わせが逆でも 400。
    const first = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, '?limit=1'));
    const keyed = first.nextCursor as string;
    expect((await getEngineers(hostA, `?cursor=${encodeURIComponent(keyed)}`)).status).toBe(400);
    expect((await getEngineers(hostA, `?projectId=${PROJECT_A_PUBLISHED}&cursor=${ENGINEER_A_HOST}`)).status).toBe(400);
    // 正しい組み合わせは通る。
    const second = await bodyOf(
      await getEngineers(hostA, `?projectId=${PROJECT_A_PUBLISHED}&limit=1&cursor=${encodeURIComponent(keyed)}`),
    );
    expect(second.items).toHaveLength(1);
  });

  it('`GET /api/engineers?projectId=`（ホスト）は #30 と同じ混在（project / phase は載せない）', async () => {
    const viaEngineers = await bodyOf(await getEngineers(hostA, `?projectId=${PROJECT_A_PUBLISHED}`));
    const viaCandidates = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    expect(viaEngineers.items).toEqual(viaCandidates.items);
    expect(viaEngineers.total).toBe(3);
    expect(viaEngineers.project).toBeUndefined();
    expect(viaEngineers.phase).toBeUndefined();
  });
});

describe('🔴 閲覧の記録（docs/03 §4.13.2-5 / BR-27）', () => {
  it('ホストの閲覧が project.view / via=CANDIDATES で記録され、summary に匿名候補の件数・ID・参照子が無い', async () => {
    await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    const rows = await admin.auditLog.findMany({ where: { action: 'project.view' } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.actorId).toBe(USER_A_HOST);
    expect(row?.targetType).toBe('Project');
    expect(row?.targetId).toBe(PROJECT_A_PUBLISHED);
    expect(row?.ipAddress).toBe(META.ipAddress);
    expect(row?.deviceKind).toBe('api');
    expect(row?.summary).toEqual({ via: 'CANDIDATES' });
    const summaryText = JSON.stringify(row?.summary);
    expect(summaryText).not.toContain(ENGINEER_A_PARTNER);
    expect(summaryText).not.toContain(candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER));
    expect(summaryText).not.toMatch(/count/i);
  });

  it('取引先の閲覧も同じ action で記録される（記録が視点で漏れない）', async () => {
    await bodyOf(await getCandidates(partnerA1, PROJECT_A_PUBLISHED));
    const rows = await admin.auditLog.findMany({ where: { action: 'project.view' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(USER_A_PARTNER);
    expect(rows[0]?.summary).toEqual({ via: 'CANDIDATES' });
  });

  it('見えなかった案件（404）では「閲覧した」記録が残らない', async () => {
    expect((await getCandidates(partnerA1, PROJECT_A_PRIVATE)).status).toBe(404);
    expect(await admin.auditLog.count({ where: { action: 'project.view' } })).toBe(0);
  });
});

describe('🔴 MatchCandidate の再生成と共有解除の即時反映（F-016 AC-2）', () => {
  it('一覧の読み取りで匿名候補の MatchCandidate が案件全体として置き換わる', async () => {
    await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    const rows = await admin.matchCandidate.findMany({
      where: { projectId: PROJECT_A_PUBLISHED, isAnonymous: true },
      select: { engineerId: true },
      orderBy: { engineerId: 'asc' },
    });
    expect(rows.map((row) => row.engineerId)).toEqual([ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2].sort());
  });

  it('共有を停止した候補は次の読み取りで応答からも MatchCandidate からも消える', async () => {
    await admin.engineerShare.update({ where: { id: SHARE_A_P2 }, data: { revokedAt: new Date() } });
    const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    const anonymous = body.items.filter(isAnonymous);
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0]?.['candidateRef']).toBe(candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER));
    expect(body.total).toBe(2);
    const rows = await admin.matchCandidate.findMany({
      where: { projectId: PROJECT_A_PUBLISHED, isAnonymous: true },
      select: { engineerId: true },
    });
    expect(rows.map((row) => row.engineerId)).toEqual([ENGINEER_A_PARTNER]);
  });

  it('パートナーの読み取りは MatchCandidate を書かない（共有スコープを開かない）', async () => {
    await admin.matchCandidate.deleteMany({ where: { projectId: PROJECT_A_PUBLISHED, isAnonymous: true } });
    await bodyOf(await getCandidates(partnerA1, PROJECT_A_PUBLISHED));
    expect(await admin.matchCandidate.count({ where: { projectId: PROJECT_A_PUBLISHED, isAnonymous: true } })).toBe(0);
  });
});

describe('🔴 匿名候補への検索条件は丸め後の区分で効く（docs/05 §4.6 線引き表 #8）', () => {
  async function anonymousCount(query: string): Promise<number> {
    const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, query));
    return body.items.filter(isAnonymous).length;
  }

  it('yearsMin=7 と 8 で当たり方が変わらない（P1 は 7 年 = 5〜10 年の帯）。10 で帯の外', async () => {
    expect(await anonymousCount('?yearsMin=7')).toBe(2);
    expect(await anonymousCount('?yearsMin=8')).toBe(2);
    expect(await anonymousCount('?yearsMin=9.5')).toBe(2);
    // 10 年以上: P1（5〜10 年）は外れ、P2（10 年以上）は残る。
    expect(await anonymousCount('?yearsMin=10')).toBe(1);
  });

  it('単価は帯で判定（P1 = 60〜70 万円）。priceMax=640000 でも 600000 でも残り、590000 で外れる', async () => {
    expect(await anonymousCount('?priceMax=640000')).toBe(1); // P1 のみ（P2 は 80〜90 万円）
    expect(await anonymousCount('?priceMax=600000')).toBe(1);
    expect(await anonymousCount('?priceMax=590000')).toBe(0);
  });

  it('フリーワードと稼働状況は匿名候補に効かない（自社候補だけが絞られる）', async () => {
    const byName = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, '?q=zzz-no-such-name'));
    expect(byName.items.filter((item) => !isAnonymous(item))).toHaveLength(0);
    expect(byName.items.filter(isAnonymous)).toHaveLength(2);
    // P1 の稼働状況は STANDBY_SCHEDULED だが、条件 WORKING でも匿名候補は消えない（開示していない属性）。
    const byStatus = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, '?availability=WORKING'));
    expect(byStatus.items.filter(isAnonymous)).toHaveLength(2);
  });

  it('稼働可能時期のソフト条件は帯で判定され、適合が先に並ぶ（P2 = 3 か月以降は後ろ）', async () => {
    const body = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED, `?availableBy=${AVAILABLE_BY}`));
    expect(body.items).toHaveLength(3);
    // Host（即日）と P1（翌月の帯 = 翌月 1 日から稼働できるかもしれない）が先、P2（3 か月以降）が最後。
    //    🔴 P1 の生の稼働開始日（翌月 15 日）は AVAILABLE_BY（翌月 5 日）より**後**だが、帯で判定するので
    //    「間に合いうる」側に残る（生値で判定すると 15 日 > 5 日で外れ、当たり方から日付が漏れる）。
    expect(body.items[2]?.['candidateRef']).toBe(candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER2));
    // チェックボックスをオンにすると P2 は母集団から外れる。
    const strict = await bodyOf(
      await getCandidates(hostA, PROJECT_A_PUBLISHED, `?availableBy=${AVAILABLE_BY}&onlyInTime=1`),
    );
    expect(strict.total).toBe(2);
    expect(strict.items.filter(isAnonymous)).toHaveLength(1);
  });

  it('同一候補は案件が違えば別の参照子になる（F-017 AC-2。混在した応答でも同じ）', async () => {
    const published = await bodyOf(await getCandidates(hostA, PROJECT_A_PUBLISHED));
    const privateBody = await bodyOf(await getCandidates(hostA, PROJECT_A_PRIVATE));
    const refsA = published.items.filter(isAnonymous).map((item) => item['candidateRef']);
    const refsB = privateBody.items.filter(isAnonymous).map((item) => item['candidateRef']);
    expect(refsA).toHaveLength(2);
    expect(refsB).toHaveLength(2);
    expect(refsA.filter((ref) => refsB.includes(ref))).toEqual([]);
  });
});
