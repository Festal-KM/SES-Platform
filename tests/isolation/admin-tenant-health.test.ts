// tests/isolation/admin-tenant-health.test.ts
// `A-002` テナント一覧の**異常度順**（`listPlatformTenants` の `sort=health`。docs/02 `F-056 AC-2` / docs/05 §6.9 API-A2
// 「T-11-01 の実装の決着」/ `CLAUDE.md` §10.4-1「異常なテナントを上位に出す」）。T-11-01。
//
// 🔴 ここで実証するのは `F-056 AC-2` である（`admin-sending-domains.test.ts` の作法。**実 DB（RLS 付き）**）:
//   ① 4 種の異常（トライアル期限切れ / 最終アクティビティの停滞 / 席の未利用 / パートナー数 0）をそれぞれ作ると、
//      その順で上位に来る（重みは辞書式。`TRIAL_EXPIRED` > `INACTIVE` > `SEATS_UNUSED` > `NO_PARTNERS` > `TRIAL_EXPIRING`）
//   ② 正常なテナントは下位に来る。`CLOSING` はさらに下（正常な終了）、`PURGED` は最下位（対象外）
//   ③ 同点は `createdAt` 昇順（古いテナント = 長く放置されている方が先）。同じ入力で 2 回呼んでも同じ並び（決定性）
//   ④ `sort=name` / `sort=createdAt` で切り替わる（`createdAt` は SP-03 の既定 = 新しい順）
//   ⑤ 🔴 応答に利用者名・メール・パートナー名・エンジニア名・業務データが無い（fixture に仕込んで JSON 不在。`BR-40`）。
//      各行のキー集合と `health` のキー集合を固定する
//   ⑥ `PLATFORM_SUPPORT` でも読める（書き込みは監査記録以外に 1 行も無い）
//   ⑦ 読み取りが `AuditLog(admin.tenant.list)` に横断（`tenant_id IS NULL`）で記録される（既存の action を維持）
//   ⑧ カーソルページングが並びを保ち、改竄されたカーソルは空ページ（先頭へ戻さない）
//   ⑨ 閾値は引数で受ける（`packages/config` の値を差し替えると判定が変わる。決め打ちしていない）
//
// 🔴 最終アクティビティ = 利用者の `last_login_at` の最大値、使われている席 = 有効な所属のうち `last_login_at` が
//    停滞閾値以内のもの（docs/05 §6.9 API-A2 の定義）。現在時刻は `now` で注入する。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configurePlatformReadDb, resolvePlatformCtx, type AuthenticatedPlatformCtx } from '@ses/db';
import { listPlatformTenants, type PlatformTenantListItemView } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
// 🔴 `@ses/domain` をパッケージ名で import しない（ルートの package.json は依存に持たない。他の isolation テストと同じ）。
import {
  DEFAULT_TENANT_HEALTH_THRESHOLDS,
  TENANT_HEALTH_SIGNAL_WEIGHTS,
  type TenantHealthThresholds,
} from '../../packages/domain/src/health/tenant-health.js';
import { TENANT_A, TENANT_B, USER_A_HOST, USER_A_PARTNER, USER_A_PARTNER2, USER_B_HOST } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const DAY = 86_400_000;

/** 🔴 現在時刻は注入する（経過日数を決定的にする）。 */
const NOW = new Date('2026-09-16T09:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const daysAhead = (days: number) => new Date(NOW.getTime() + days * DAY);

const OWNER_USER_ID = '01930000-0000-7000-8000-00000011010a';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-00000011010b';

/** 追加するテナント（fixtures の A / B はどちらも `ACTIVE`）。 */
const TENANT_INACTIVE = '01930000-0000-7000-8000-000000110101';
const TENANT_SEATS = '01930000-0000-7000-8000-000000110102';
const TENANT_TRIAL_EXPIRED = '01930000-0000-7000-8000-000000110103';
const TENANT_TRIAL_EXPIRING = '01930000-0000-7000-8000-000000110104';
const TENANT_ALL = '01930000-0000-7000-8000-000000110105';
const TENANT_NO_PARTNERS_OLD = '01930000-0000-7000-8000-000000110106';
const TENANT_CLOSING = '01930000-0000-7000-8000-000000110107';
const TENANT_PURGED = '01930000-0000-7000-8000-000000110108';

/** 🔴 応答に 1 バイトも現れてはならない値（利用者の氏名・メール / パートナー名 / エンジニア名 / 業務データ）。 */
const FORBIDDEN_STRINGS = [
  'Health Seats User',
  'seats-user-',
  '@health.example.test',
  'Partner Health Seats',
  'Engineer Health Seats',
  'Engineer A-Host',
  'Engineer A-Partner',
  'partner1 からの本文',
  'End Client A',
  'Host A',
  'host-a@example.test',
  'Partner A1',
] as const;

/** 🔴 DTO のキー集合（固定）。増やすときは docs/05 §6.9 API-A2 と `A-002` の画面を同時に見直す。 */
const ITEM_KEYS = [
  'activeMemberCount',
  'createdAt',
  'engineerCount',
  'environment',
  'health',
  'id',
  'lastActivityAt',
  'lifecycleChangedAt',
  'lifecycleState',
  'name',
  'partnerCompanyCount',
  'projectCount',
  'seatCount',
] as const;

const META = { ipAddress: '203.0.113.31', now: NOW, healthThresholds: DEFAULT_TENANT_HEALTH_THRESHOLDS } as const;

let database: IsolationDatabase;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let superuser: UnextendedClient;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;

async function insertTenant(input: {
  readonly id: string;
  readonly name: string;
  readonly environment: 'production' | 'sandbox';
  readonly lifecycleState: 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' | 'CLOSING' | 'PURGED';
  readonly createdAt: Date;
  readonly sandboxExpiresAt?: Date;
}): Promise<void> {
  // 🔴 T-10-09: `CHECK (lifecycle_state <> 'CLOSING' OR closing_entered_at IS NOT NULL)`（migration 20260927000000）。
  //    `CLOSING` の行は入った時刻を持たなければならない（ここでは `createdAt` 相当）。
  const closingEnteredAt = input.lifecycleState === 'CLOSING' ? input.createdAt : null;
  await superuser.$executeRaw`
    INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, sandbox_expires_at,
                         provisioning_request_id, created_at, closing_entered_at)
    VALUES (${input.id}::uuid, ${input.name}, ${input.environment}, ${input.lifecycleState}, ${input.createdAt},
            ${input.sandboxExpiresAt ?? null}, ${`t-11-01-${input.id}`}, ${input.createdAt}, ${closingEnteredAt})`;
}

/** ホスト所属の利用者 + 有効な所属を 1 組。`lastLoginAt` が `null` なら一度もログインしていない。 */
async function insertMember(input: {
  readonly tenantId: string;
  readonly seq: number;
  readonly lastLoginAt: Date | null;
  readonly revokedAt?: Date;
}): Promise<void> {
  const suffix = `${input.tenantId.slice(-2)}${input.seq.toString(16).padStart(2, '0')}`;
  const userId = `01930000-0000-7000-8000-00001102${suffix}`;
  const membershipId = `01930000-0000-7000-8000-00001103${suffix}`;
  await superuser.$executeRaw`
    INSERT INTO users (id, tenant_id, owner_partner_company_id, email, display_name, password_hash, last_login_at)
    VALUES (${userId}::uuid, ${input.tenantId}::uuid, NULL, ${`seats-user-${suffix}@health.example.test`},
            ${`Health Seats User ${suffix}`}, 'seed-hash', ${input.lastLoginAt})`;
  await superuser.$executeRaw`
    INSERT INTO memberships (id, tenant_id, user_id, role, partner_company_id, joined_at, revoked_at)
    VALUES (${membershipId}::uuid, ${input.tenantId}::uuid, ${userId}::uuid, 'SALES', NULL, ${daysAgo(30)},
            ${input.revokedAt ?? null})`;
}

async function insertPartner(tenantId: string, seq: number): Promise<void> {
  const id = `01930000-0000-7000-8000-00001104${tenantId.slice(-2)}${seq.toString(16).padStart(2, '0')}`;
  await superuser.$executeRaw`
    INSERT INTO partner_companies (id, tenant_id, name, contact_name, contact_email, invited_at)
    VALUES (${id}::uuid, ${tenantId}::uuid, ${`Partner Health Seats ${seq}`}, 'Health Contact',
            ${`partner-${seq}@health.example.test`}, ${daysAgo(20)})`;
}

async function insertEngineer(tenantId: string, seq: number): Promise<void> {
  const id = `01930000-0000-7000-8000-00001105${tenantId.slice(-2)}${seq.toString(16).padStart(2, '0')}`;
  await superuser.$executeRaw`
    INSERT INTO engineers (id, tenant_id, owner_partner_company_id, display_name)
    VALUES (${id}::uuid, ${tenantId}::uuid, NULL, ${`Engineer Health Seats ${seq}`})`;
}

async function list(ctx: AuthenticatedPlatformCtx, query: Parameters<typeof listPlatformTenants>[1] = { limit: 200 }, meta = META) {
  return listPlatformTenants(ctx, query, meta);
}

function idsOf(items: readonly PlatformTenantListItemView[]): string[] {
  return items.map((item) => item.id);
}

function byId(items: readonly PlatformTenantListItemView[], id: string): PlatformTenantListItemView {
  const found = items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`tenant ${id} が応答に無い`);
  return found;
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  // --- ② 正常（fixtures の A）: 開設 100 日前、3 席すべて 1 日前にログイン、パートナー 2 社 ---
  await superuser.$executeRaw`UPDATE tenants SET created_at = ${daysAgo(100)} WHERE id = ${TENANT_A}::uuid`;
  await superuser.$executeRaw`
    UPDATE users SET last_login_at = ${daysAgo(1)}
     WHERE id IN (${USER_A_HOST}::uuid, ${USER_A_PARTNER}::uuid, ${USER_A_PARTNER2}::uuid)`;

  // --- ① NO_PARTNERS（fixtures の B）: 開設 100 日前、1 席は使われている、パートナー 0 ---
  await superuser.$executeRaw`UPDATE tenants SET created_at = ${daysAgo(100)} WHERE id = ${TENANT_B}::uuid`;
  await superuser.$executeRaw`UPDATE users SET last_login_at = ${daysAgo(2)} WHERE id = ${USER_B_HOST}::uuid`;

  // --- ③ 同点の順序: NO_PARTNERS だけを持つ、より古いテナント（300 日前）。B より先に来る ---
  await insertTenant({ id: TENANT_NO_PARTNERS_OLD, name: 'Health NoPartners Old', environment: 'production', lifecycleState: 'ACTIVE', createdAt: daysAgo(300) });
  await insertMember({ tenantId: TENANT_NO_PARTNERS_OLD, seq: 1, lastLoginAt: daysAgo(1) });

  // --- ① INACTIVE: 開設 60 日前、所属 0（誰も参加していない = 最終アクティビティ無し）、パートナー 1 社 ---
  //     席 0 なので SEATS_UNUSED は付かない（0 / 0 を異常にしない）。
  await insertTenant({ id: TENANT_INACTIVE, name: 'Health Inactive', environment: 'production', lifecycleState: 'ACTIVE', createdAt: daysAgo(60) });
  await insertPartner(TENANT_INACTIVE, 1);

  // --- ① SEATS_UNUSED: 10 席のうち 2 席だけが 14 日以内にログイン（20% < 30%）。最終アクティビティは 1 日前 ---
  //     取り消された所属（revoked）は席に数えない（11 人目。ログインは最近でも母集団に入らない）。
  await insertTenant({ id: TENANT_SEATS, name: 'Health Seats', environment: 'production', lifecycleState: 'ACTIVE', createdAt: daysAgo(60) });
  for (let seq = 1; seq <= 10; seq += 1) {
    await insertMember({ tenantId: TENANT_SEATS, seq, lastLoginAt: seq <= 2 ? daysAgo(1) : seq <= 6 ? daysAgo(30) : null });
  }
  await insertMember({ tenantId: TENANT_SEATS, seq: 11, lastLoginAt: daysAgo(1), revokedAt: daysAgo(5) });
  await insertPartner(TENANT_SEATS, 1);
  await insertEngineer(TENANT_SEATS, 1);
  await insertEngineer(TENANT_SEATS, 2);

  // --- ① TRIAL_EXPIRED: SANDBOX、期限 2 日前。他は正常 ---
  await insertTenant({ id: TENANT_TRIAL_EXPIRED, name: 'Health Trial Expired', environment: 'sandbox', lifecycleState: 'SANDBOX', createdAt: daysAgo(40), sandboxExpiresAt: daysAgo(2) });
  await insertMember({ tenantId: TENANT_TRIAL_EXPIRED, seq: 1, lastLoginAt: daysAgo(1) });
  await insertPartner(TENANT_TRIAL_EXPIRED, 1);

  // --- 接近: SANDBOX、期限 5 日後。他は正常 ---
  await insertTenant({ id: TENANT_TRIAL_EXPIRING, name: 'Health Trial Expiring', environment: 'sandbox', lifecycleState: 'SANDBOX', createdAt: daysAgo(25), sandboxExpiresAt: daysAhead(5) });
  await insertMember({ tenantId: TENANT_TRIAL_EXPIRING, seq: 1, lastLoginAt: daysAgo(1) });
  await insertPartner(TENANT_TRIAL_EXPIRING, 1);

  // --- 4 つ同時: SANDBOX 期限切れ + 一度もログイン無し（開設 40 日）+ 1 席が未利用 + パートナー 0 ---
  await insertTenant({ id: TENANT_ALL, name: 'Health All Four', environment: 'sandbox', lifecycleState: 'SANDBOX', createdAt: daysAgo(40), sandboxExpiresAt: daysAgo(2) });
  await insertMember({ tenantId: TENANT_ALL, seq: 1, lastLoginAt: null });

  // --- ② CLOSING（材料はどれも異常だが正常な終了。最下位の層）/ PURGED（対象外。さらに下） ---
  await insertTenant({ id: TENANT_CLOSING, name: 'Health Closing', environment: 'production', lifecycleState: 'CLOSING', createdAt: daysAgo(200) });
  await insertTenant({ id: TENANT_PURGED, name: 'Health Purged', environment: 'production', lifecycleState: 'PURGED', createdAt: daysAgo(400) });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 4 種の異常が、その順で上位に来る（F-056 AC-2）', () => {
  it('🔴 既定（sort 省略）= 異常度の高い順。期限切れ > 停滞 > 席の未利用 > パートナー 0 > 接近 > 正常 > CLOSING > PURGED', async () => {
    const page = await list(supportCtx);
    expect(idsOf(page.items)).toEqual([
      TENANT_ALL,
      TENANT_TRIAL_EXPIRED,
      TENANT_INACTIVE,
      TENANT_SEATS,
      TENANT_NO_PARTNERS_OLD,
      TENANT_B,
      TENANT_TRIAL_EXPIRING,
      TENANT_A,
      TENANT_CLOSING,
      TENANT_PURGED,
    ]);
    expect(page.nextCursor).toBeNull();
    expect(page.observedAt).toBe(NOW.toISOString());
  });

  it('各テナントのシグナルが期待どおり（1 種類ずつ孤立させた fixture）', async () => {
    const { items } = await list(supportCtx);
    expect(byId(items, TENANT_TRIAL_EXPIRED).health).toEqual({ score: TENANT_HEALTH_SIGNAL_WEIGHTS.TRIAL_EXPIRED, signals: ['TRIAL_EXPIRED'] });
    expect(byId(items, TENANT_INACTIVE).health).toEqual({ score: TENANT_HEALTH_SIGNAL_WEIGHTS.INACTIVE, signals: ['INACTIVE'] });
    expect(byId(items, TENANT_SEATS).health).toEqual({ score: TENANT_HEALTH_SIGNAL_WEIGHTS.SEATS_UNUSED, signals: ['SEATS_UNUSED'] });
    expect(byId(items, TENANT_B).health).toEqual({ score: TENANT_HEALTH_SIGNAL_WEIGHTS.NO_PARTNERS, signals: ['NO_PARTNERS'] });
    expect(byId(items, TENANT_TRIAL_EXPIRING).health).toEqual({ score: TENANT_HEALTH_SIGNAL_WEIGHTS.TRIAL_EXPIRING, signals: ['TRIAL_EXPIRING'] });
  });

  it('4 つ同時に成立したテナントは signals が固定順で 4 つ、score は重みの合計', async () => {
    const { items } = await list(supportCtx);
    const all = byId(items, TENANT_ALL);
    expect(all.health.signals).toEqual(['TRIAL_EXPIRED', 'INACTIVE', 'SEATS_UNUSED', 'NO_PARTNERS']);
    expect(all.health.score).toBe(
      TENANT_HEALTH_SIGNAL_WEIGHTS.TRIAL_EXPIRED +
        TENANT_HEALTH_SIGNAL_WEIGHTS.INACTIVE +
        TENANT_HEALTH_SIGNAL_WEIGHTS.SEATS_UNUSED +
        TENANT_HEALTH_SIGNAL_WEIGHTS.NO_PARTNERS,
    );
  });

  it('🔴 席の材料: 有効な所属のうち停滞閾値内にログインした利用者を「使われている席」と数える（取り消し済みは母集団外）', async () => {
    const { items } = await list(supportCtx);
    const seats = byId(items, TENANT_SEATS);
    expect(seats.seatCount).toBe(10);
    expect(seats.activeMemberCount).toBe(2);
    expect(seats.lastActivityAt).toBe(daysAgo(1).toISOString());
    expect(seats.engineerCount).toBe(2);
    // INACTIVE: 所属 0 のテナントは最終アクティビティが無く、開設日から数える。席 0 なので SEATS_UNUSED は付かない。
    const inactive = byId(items, TENANT_INACTIVE);
    expect(inactive.seatCount).toBe(0);
    expect(inactive.activeMemberCount).toBe(0);
    expect(inactive.lastActivityAt).toBeNull();
  });
});

describe('② 正常なテナントは下位。CLOSING / PURGED は層で分かれる', () => {
  it('正常（A）は score 0・signals 空で、異常のあるテナントの後ろ', async () => {
    const { items } = await list(supportCtx);
    const a = byId(items, TENANT_A);
    expect(a.health).toEqual({ score: 0, signals: [] });
    expect(a.activeMemberCount).toBe(3);
    expect(a.seatCount).toBe(3);
    const ids = idsOf(items);
    expect(ids.indexOf(TENANT_A)).toBeGreaterThan(ids.indexOf(TENANT_TRIAL_EXPIRING));
  });

  it('🔴 CLOSING は材料がどれも異常でも score 0 で正常の後ろ、PURGED はその後ろ（対象外）', async () => {
    const { items } = await list(supportCtx);
    expect(byId(items, TENANT_CLOSING).health).toEqual({ score: 0, signals: [] });
    expect(byId(items, TENANT_PURGED).health).toEqual({ score: 0, signals: [] });
    const ids = idsOf(items);
    expect(ids.indexOf(TENANT_CLOSING)).toBe(ids.length - 2);
    expect(ids.indexOf(TENANT_PURGED)).toBe(ids.length - 1);
  });
});

describe('③ 同点の順序と決定性', () => {
  it('🔴 同点（NO_PARTNERS のみ）は createdAt 昇順: 300 日前のテナントが 100 日前の B より先', async () => {
    const ids = idsOf((await list(supportCtx)).items);
    expect(ids.indexOf(TENANT_NO_PARTNERS_OLD)).toBe(ids.indexOf(TENANT_B) - 1);
  });

  it('同じ入力で 2 回呼んでも同じ並び（決定性）', async () => {
    const first = idsOf((await list(supportCtx)).items);
    const second = idsOf((await list(ownerCtx)).items);
    expect(second).toEqual(first);
  });
});

describe('④ sort の切り替え', () => {
  it('sort=name はテナント名の昇順（ロケール非依存）→ id', async () => {
    const page = await list(supportCtx, { limit: 200, sort: 'name' });
    const names = page.items.map((item) => item.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(names[0]).toBe('Health All Four');
  });

  it('sort=createdAt は新しい順（SP-03 の既定と同じ）。異常度は無視される', async () => {
    const page = await list(supportCtx, { limit: 200, sort: 'createdAt' });
    const created = page.items.map((item) => new Date(item.createdAt).getTime());
    expect(created).toEqual([...created].sort((a, b) => b - a));
    // 25 日前に開設した接近テナントが先頭（A / B は 100 日前）。PURGED（400 日前）が末尾。
    expect(page.items[0]?.id).toBe(TENANT_TRIAL_EXPIRING);
    expect(page.items[page.items.length - 1]?.id).toBe(TENANT_PURGED);
  });

  it('sort を変えても各行の health は同じ値（並びだけが変わる）', async () => {
    const byHealth = byId((await list(supportCtx)).items, TENANT_ALL).health;
    const byName = byId((await list(supportCtx, { limit: 200, sort: 'name' })).items, TENANT_ALL).health;
    expect(byName).toEqual(byHealth);
  });
});

describe('⑤ 応答に非開示のものが無い（BR-40）', () => {
  it('🔴 各行のキー集合と health のキー集合が固定されている', async () => {
    const { items } = await list(supportCtx);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([...ITEM_KEYS].sort());
      expect(Object.keys(item.health).sort()).toEqual(['score', 'signals']);
    }
  });

  it('🔴 fixture に仕込んだ利用者名・メール・パートナー名・エンジニア名・本文・エンド企業名が JSON に 1 バイトも現れない', async () => {
    const serialized = JSON.stringify(await list(supportCtx));
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    // シグナルは列挙値だけ。
    expect(serialized).toMatch(/"signals":\["TRIAL_EXPIRED","INACTIVE","SEATS_UNUSED","NO_PARTNERS"\]/);
  });

  it('応答の最上位は items / nextCursor / observedAt だけ（total を持たない）', async () => {
    const page = await list(supportCtx);
    expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor', 'observedAt']);
  });
});

describe('⑥ ⑦ ロールと監査', () => {
  it('PLATFORM_SUPPORT / PLATFORM_OWNER のどちらでも同じ応答', async () => {
    const support = await list(supportCtx);
    const owner = await list(ownerCtx);
    expect(owner.items).toEqual(support.items);
  });

  it('🔴 F-056 AC-4: 一覧の閲覧が admin.tenant.list として横断（tenant_id IS NULL）で記録され、呼び出しごとに 1 行増える', async () => {
    const before = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM audit_logs WHERE action = 'admin.tenant.list' AND actor_id = ${SUPPORT_USER_ID}::uuid`;
    await list(supportCtx, { limit: 200, sort: 'name' });
    const rows = await superuser.$queryRaw<Array<{ tenant_id: string | null; actor_kind: string; ip_address: string | null }>>`
      SELECT tenant_id, actor_kind, ip_address FROM audit_logs
       WHERE action = 'admin.tenant.list' AND actor_id = ${SUPPORT_USER_ID}::uuid`;
    expect(rows.length).toBe(Number(before[0]?.count ?? 0n) + 1);
    expect(rows.every((row) => row.tenant_id === null)).toBe(true);
    expect(rows.every((row) => row.actor_kind === 'PLATFORM_USER')).toBe(true);
    expect(rows.every((row) => row.ip_address === META.ipAddress)).toBe(true);
  });

  it('🔴 読み取りが業務データを 1 行も書いていない（tenants / users / memberships の行数が仕込みのまま）', async () => {
    const before = await superuser.$queryRaw<Array<{ tenants: bigint; users: bigint; memberships: bigint }>>`
      SELECT (SELECT count(*) FROM tenants)::bigint AS tenants, (SELECT count(*) FROM users)::bigint AS users,
             (SELECT count(*) FROM memberships)::bigint AS memberships`;
    await list(ownerCtx);
    const after = await superuser.$queryRaw<Array<{ tenants: bigint; users: bigint; memberships: bigint }>>`
      SELECT (SELECT count(*) FROM tenants)::bigint AS tenants, (SELECT count(*) FROM users)::bigint AS users,
             (SELECT count(*) FROM memberships)::bigint AS memberships`;
    expect(after).toEqual(before);
  });
});

describe('⑧ カーソルページング', () => {
  it('limit=3 で辿ったページを連結すると全件の並びと一致する（並びを保つ）', async () => {
    const full = idsOf((await list(supportCtx)).items);
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await list(supportCtx, { limit: 3, ...(cursor === undefined ? {} : { cursor }) });
      collected.push(...idsOf(page.items));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(collected).toEqual(full);
  });

  it('🔴 並びに無い（改竄された）カーソルは空ページ。先頭へ戻して同じページを繰り返させない', async () => {
    const page = await list(supportCtx, { limit: 3, cursor: '01930000-0000-7000-8000-000000000fff' });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('末尾のテナントをカーソルにすると空ページ・nextCursor null', async () => {
    const page = await list(supportCtx, { limit: 3, cursor: TENANT_PURGED });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe('⑨ 閾値は引数で受ける（決め打ちしていない）', () => {
  it('パートナー 0 の猶予を 400 日にすると NO_PARTNERS が消え、B と 300 日前のテナントが正常側に降りる', async () => {
    const thresholds: TenantHealthThresholds = { ...DEFAULT_TENANT_HEALTH_THRESHOLDS, noPartnersGraceDays: 400 };
    const { items } = await list(supportCtx, { limit: 200 }, { ...META, healthThresholds: thresholds });
    expect(byId(items, TENANT_B).health).toEqual({ score: 0, signals: [] });
    expect(byId(items, TENANT_NO_PARTNERS_OLD).health).toEqual({ score: 0, signals: [] });
    // TENANT_ALL からも NO_PARTNERS が落ちる（他の 3 つは残る）。
    expect(byId(items, TENANT_ALL).health.signals).toEqual(['TRIAL_EXPIRED', 'INACTIVE', 'SEATS_UNUSED']);
  });

  it('席の利用率の閾値を 20% にすると 2 / 10 は異常でなくなる（20% ちょうどは「未満」ではない）', async () => {
    const thresholds: TenantHealthThresholds = { ...DEFAULT_TENANT_HEALTH_THRESHOLDS, seatUtilizationMinPercent: 20 };
    const { items } = await list(supportCtx, { limit: 200 }, { ...META, healthThresholds: thresholds });
    expect(byId(items, TENANT_SEATS).health).toEqual({ score: 0, signals: [] });
  });

  it('停滞の窓を 40 日にすると、30 日前にログインした 4 席も「使われている」に入り 6 / 10 = 60% で正常になる', async () => {
    const thresholds: TenantHealthThresholds = { ...DEFAULT_TENANT_HEALTH_THRESHOLDS, inactiveDays: 40 };
    const { items } = await list(supportCtx, { limit: 200 }, { ...META, healthThresholds: thresholds });
    const seats = byId(items, TENANT_SEATS);
    expect(seats.activeMemberCount).toBe(6);
    expect(seats.health).toEqual({ score: 0, signals: [] });
  });

  it('🔴 不正な閾値は DB に触れる前に例外（監査行を残さない）', async () => {
    const before = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM audit_logs WHERE action = 'admin.tenant.list'`;
    await expect(
      list(supportCtx, { limit: 200 }, { ...META, healthThresholds: { ...DEFAULT_TENANT_HEALTH_THRESHOLDS, inactiveDays: 0 } }),
    ).rejects.toThrow(RangeError);
    const after = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM audit_logs WHERE action = 'admin.tenant.list'`;
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});
