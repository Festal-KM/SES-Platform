// tests/isolation/admin-gate-stalls.test.ts
// `A-005` 項目 12「`GATE_RUNNING` の滞留」の材料 = `listGateStalls`
// （`@ses/db/platform`。docs/02 `F-059 AC-6` / `F-027 AC-5` / docs/05 §7.6 / §9.10 / §16.5 / `CLAUDE.md` §4.2「失敗と保留を混同しない」）。T-11-05。
//
// 🔴 ここで実証するのは `F-059 AC-6` である（`admin-sending-domains.test.ts` / `admin-provider-spend.test.ts` の作法。**実 DB（RLS 付き）**）:
//   ① AI の日次コスト上限で保留された提案（`holdReviewGate` = `gate.run` と同じ書き込み）が **`AI_COST_LIMIT_HELD`** で載る
//   ② `gate.run` が failed に残った提案（BullMQ の failed セット = 呼び出し側が渡す）が **`JOB_FAILED`** で載る
//   ③ 確定行も保留行も失敗記録も無い `GATE_RUNNING` は閾値超過で **`RUNNING_OVERDUE`**、閾値未満は載らない。閾値は引数で変わる
//   ④ `countsByReason` は 3 区分が**別キー**で、保留は失敗に足されない
//   ⑤ 🔴 指標の非加算: 保留した提案は `GATE_FAILED` / `SUBMIT_FAILED` に**なっていない**（状態機械を動かさない）、
//      保留行は `execution='DONE'`（ゲート FAIL 率の分母・分子。docs/05 §16.5）に**入らない**、`JOB_FAILED` は保留行が無い
//   ⑥ 🔴 応答に件名・本文・提案先・エンジニア氏名・エンド企業名・単価・`findings` の抜粋が無い
//      （キー集合の固定 + 既知の値が JSON に 1 バイトも現れない。`BR-40`）
//   ⑦ `PLATFORM_SUPPORT` でも読める（応答は `PLATFORM_OWNER` と同一）
//   ⑧ 読み取りが `AuditLog(admin.monitoring.view)` に横断（`tenant_id IS NULL`）で記録され、書き込みは監査行以外に 1 行も無い
//   ⑨ 🔴 第 1 層（GRANT）: `app_platform` / `app_platform_write` は `proposals` / `review_gates` に INSERT / UPDATE / DELETE を
//      1 つも持たず（= BullMQ の retry に相当する運営者操作は作ろうとしても権限で弾かれる。docs/05 §9.10 ①）、
//      `app_platform` の SELECT 可能列は許可リストと一致する（件名・本文・`findings` は GRANT 外）
//   ⑩ `GATE_RUNNING` でない提案に残った保留行（削除・パージの残骸）は載らない。`PROJECT_PUBLISH` の保留行・失敗記録は載る
//   ⑪ 不正な閾値は `withPlatformRead` の前に落ち、監査行を残さない
//
// 🔴 実 Redis / 実 BullMQ に接続しない。failed セットの読み取りは呼び出し側（T-11-04）の責務であり、ここでは
//    `gate.run` の payload と同じ形（`{ tenantId, targetType, targetId }` + `failedAt`）を引数で渡す。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configurePlatformReadDb,
  configureTenantDb,
  disconnectPlatformReadDb,
  disconnectTenantDb,
  holdReviewGate,
  resolvePlatformCtx,
  systemTenantCtx,
  type AuthenticatedPlatformCtx,
} from '@ses/db';
import { GATE_STALL_REASONS, listGateStalls, type FailedGateRunJob, type GateStallsMeta } from '@ses/db/platform';
import {
  createUnextendedClient,
  hasColumnPrivilege,
  hasTablePrivilege,
  readTableColumns,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  ENGINEER_B_HOST,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P1_PRIVATE,
  PROPOSAL_A_P2,
  TENANT_A,
  TENANT_B,
  USER_B_HOST,
} from './support/fixtures.js';
import { PLATFORM_READ_COLUMN_ALLOWLIST } from './support/platform-grants.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const MINUTE = 60_000;

/** 🔴 現在時刻は注入する（滞留分数を決定的にする）。 */
const NOW = new Date('2026-09-16T09:00:00.000Z');
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * MINUTE);

const OWNER_USER_ID = '01930000-0000-7000-8000-0000000000ca';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-0000000000cb';

/** 追加する行（fixtures の提案 3 本は `DRAFT`、`PROPOSAL_A_P1_PRIVATE` は `WON`）。 */
const PROPOSAL_A_FRESH = '01930000-0000-7000-8000-000000001151';
const PROJECT_B = '01930000-0000-7000-8000-000000001161';
const PROPOSAL_B_HELD = '01930000-0000-7000-8000-000000001162';

/** 🔴 応答に 1 バイトも現れてはならない値（件名・本文・提案先・エンジニア・エンド企業・単価・指摘の抜粋）。 */
const FORBIDDEN = {
  subject: 'SUBJECT-T1105-社外秘の件名',
  body: 'BODY-T1105-山田太郎（090-1234-5678）を提案します',
  draftBody: 'DRAFT-T1105-ドラフト本文',
  recipientCompanyName: 'Client Co',
  recipientEmail: 'client@example.test',
  engineerName: 'Engineer A-Host',
  endClientName: 'End Client A',
  unitPrice: '900000',
  findingExcerpt: 'EXCERPT-T1105-山田太郎',
} as const;

const THRESHOLD = 30;

/** BullMQ の failed セットの写し（`gate.run` の payload と同じ形 + 失敗時刻）。 */
const FAILED_JOBS: readonly FailedGateRunJob[] = [
  { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_A_P1, failedAt: minutesAgo(59) },
  { tenantId: TENANT_A, targetType: 'PROJECT_PUBLISH', targetId: PROJECT_A_PRIVATE, failedAt: minutesAgo(7) },
];

const META: GateStallsMeta = {
  ipAddress: '203.0.113.31',
  now: NOW,
  stallThresholdMinutes: THRESHOLD,
  failedJobs: FAILED_JOBS,
};

/** 🔴 DTO のキー集合（固定）。増やすときは docs/05 §16.5 項目 12 と T-11-04 の画面を同時に見直す。 */
const ROW_KEYS = ['reason', 'since', 'stalledMinutes', 'targetId', 'targetType', 'tenantId'] as const;

let database: IsolationDatabase;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let superuser: UnextendedClient;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;

async function setGateRunning(proposalId: string, updatedAt: Date, contentHash: string): Promise<void> {
  await superuser.$executeRaw`
    UPDATE proposals
       SET state = 'GATE_RUNNING', content_hash = ${contentHash}, updated_at = ${updatedAt},
           subject = ${FORBIDDEN.subject}, body = ${FORBIDDEN.body}, draft_body = ${FORBIDDEN.draftBody},
           offered_unit_price = 650000
     WHERE id = ${proposalId}::uuid`;
}

async function hold(tenantId: string, targetType: 'PROPOSAL' | 'PROJECT_PUBLISH', targetId: string, heldSince: Date) {
  // 🔴 `gate.run` が上限で呼べなかったときと**同じ書き込み**（docs/05 §7.6。整合層の結果と指摘を保持したまま保留する）。
  return holdReviewGate(systemTenantCtx(tenantId, { queue: 'gate.run', jobId: `t-11-05-${targetId}` }), {
    targetType,
    targetId,
    contentHash: `hash-held-${targetId}`,
    consistencyVerdict: 'FAIL',
    findings: [
      {
        layer: 'CONSISTENCY',
        kind: 'MUST_REQUIREMENT_MISMATCH',
        field: 'body',
        offsetStart: 0,
        offsetEnd: 10,
        excerpt: FORBIDDEN.findingExcerpt,
        severity: 'BLOCK',
      },
    ],
    heldSince,
  });
}

async function countRows(sql: TemplateStringsArray, ...values: unknown[]): Promise<number> {
  const rows = await superuser.$queryRaw<Array<{ count: bigint }>>(sql, ...values);
  return Number(rows[0]?.count ?? 0);
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  // 🔴 保留の書き込みは主平面のジョブ経路（`systemTenantCtx` + RLS）で行う（`gate.run` と同じ関数）。
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  // --- ① 保留（A / ホスト所属の提案）: 90 分前に GATE_RUNNING、80 分前に上限で保留 ---
  await setGateRunning(PROPOSAL_A_HOST, minutesAgo(90), 'hash-a-host');
  await hold(TENANT_A, 'PROPOSAL', PROPOSAL_A_HOST, minutesAgo(80));

  // --- ② 失敗（A / パートナー A1 の提案）: 60 分前に GATE_RUNNING、failed セットに 59 分前の記録（FAILED_JOBS） ---
  await setGateRunning(PROPOSAL_A_P1, minutesAgo(60), 'hash-a-p1');

  // --- ③ 応答不明（A / パートナー A2 の提案）: 45 分前に GATE_RUNNING、何も無い ---
  await setGateRunning(PROPOSAL_A_P2, minutesAgo(45), 'hash-a-p2');

  // --- ③ 閾値未満（A / 新しい提案）: 5 分前に GATE_RUNNING ---
  await superuser.$executeRaw`
    INSERT INTO proposals (id, tenant_id, owner_partner_company_id, project_id, engineer_id, state, content_hash,
                           recipient_company_name, recipient_email, created_by, created_at, updated_at)
    SELECT ${PROPOSAL_A_FRESH}::uuid, tenant_id, owner_partner_company_id, project_id, engineer_id, 'GATE_RUNNING', 'hash-a-fresh',
           recipient_company_name, recipient_email, created_by, ${minutesAgo(6)}, ${minutesAgo(5)}
      FROM proposals WHERE id = ${PROPOSAL_A_HOST}::uuid`;

  // --- ⑩ 残骸: WON の提案に保留行だけが残っている（載らない） ---
  await hold(TENANT_A, 'PROPOSAL', PROPOSAL_A_P1_PRIVATE, minutesAgo(500));

  // --- ① / ⑩ テナント B: 200 分前に GATE_RUNNING → 199 分前に保留。案件の公開の保留行（3 分前）も載る ---
  await superuser.$executeRaw`
    INSERT INTO projects (id, tenant_id, name, end_client_name, internal_unit_price, public_summary, status)
    VALUES (${PROJECT_B}::uuid, ${TENANT_B}::uuid, 'Project B', 'End Client B-Secret', 950000, '公開用', 'OPEN')`;
  await superuser.$executeRaw`
    INSERT INTO proposals (id, tenant_id, owner_partner_company_id, project_id, engineer_id, state, content_hash,
                           recipient_company_name, recipient_email, created_by, created_at, updated_at)
    VALUES (${PROPOSAL_B_HELD}::uuid, ${TENANT_B}::uuid, NULL, ${PROJECT_B}::uuid, ${ENGINEER_B_HOST}::uuid, 'GATE_RUNNING',
            'hash-b-held', ${FORBIDDEN.recipientCompanyName}, ${FORBIDDEN.recipientEmail}, ${USER_B_HOST}::uuid,
            ${minutesAgo(201)}, ${minutesAgo(200)})`;
  await hold(TENANT_B, 'PROPOSAL', PROPOSAL_B_HELD, minutesAgo(199));
  await hold(TENANT_B, 'PROJECT_PUBLISH', PROJECT_B, minutesAgo(3));
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await disconnectPlatformReadDb();
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('F-059 AC-6 ①②③: 3 区分が別の理由で載り、閾値未満は載らない', () => {
  it('🔴 全体: since の昇順で 6 行。保留 3 / 失敗 2 / 応答不明 1', async () => {
    const result = await listGateStalls(ownerCtx, META);
    expect(result.rows.map((row) => [row.tenantId, row.targetType, row.targetId, row.reason, row.stalledMinutes])).toEqual([
      [TENANT_B, 'PROPOSAL', PROPOSAL_B_HELD, 'AI_COST_LIMIT_HELD', 199],
      [TENANT_A, 'PROPOSAL', PROPOSAL_A_HOST, 'AI_COST_LIMIT_HELD', 80],
      [TENANT_A, 'PROPOSAL', PROPOSAL_A_P1, 'JOB_FAILED', 59],
      [TENANT_A, 'PROPOSAL', PROPOSAL_A_P2, 'RUNNING_OVERDUE', 45],
      [TENANT_A, 'PROJECT_PUBLISH', PROJECT_A_PRIVATE, 'JOB_FAILED', 7],
      [TENANT_B, 'PROJECT_PUBLISH', PROJECT_B, 'AI_COST_LIMIT_HELD', 3],
    ]);
    expect(result.total).toBe(6);
    expect(result.stallThresholdMinutes).toBe(THRESHOLD);
  });

  it('① 保留の since は review_gates.held_since（GATE_RUNNING に入った時刻ではない）', async () => {
    const { rows } = await listGateStalls(ownerCtx, META);
    const held = rows.find((row) => row.targetId === PROPOSAL_A_HOST);
    expect(held).toEqual({
      tenantId: TENANT_A,
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      reason: 'AI_COST_LIMIT_HELD',
      since: minutesAgo(80),
      stalledMinutes: 80,
    });
  });

  it('② 失敗の since は failed の記録時刻（呼び出し側が渡した failedAt）', async () => {
    const { rows } = await listGateStalls(ownerCtx, META);
    const failed = rows.find((row) => row.targetId === PROPOSAL_A_P1);
    expect(failed).toEqual({
      tenantId: TENANT_A,
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_P1,
      reason: 'JOB_FAILED',
      since: minutesAgo(59),
      stalledMinutes: 59,
    });
  });

  it('③ 応答不明の since は proposals.updated_at。閾値未満（5 分）の GATE_RUNNING は載らない', async () => {
    const { rows } = await listGateStalls(ownerCtx, META);
    const overdue = rows.find((row) => row.targetId === PROPOSAL_A_P2);
    expect(overdue).toEqual({
      tenantId: TENANT_A,
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_P2,
      reason: 'RUNNING_OVERDUE',
      since: minutesAgo(45),
      stalledMinutes: 45,
    });
    expect(rows.some((row) => row.targetId === PROPOSAL_A_FRESH)).toBe(false);
  });

  it('③ 閾値は引数で変わる（50 分なら 45 分の応答不明は消え、保留・失敗は残る = 閾値を掛けない）', async () => {
    const result = await listGateStalls(ownerCtx, { ...META, stallThresholdMinutes: 50 });
    expect(result.countsByReason).toEqual({ AI_COST_LIMIT_HELD: 3, JOB_FAILED: 2, RUNNING_OVERDUE: 0 });
    expect(result.total).toBe(5);
  });

  it('② failed セットが空なら JOB_FAILED は 0 件になり、その提案は閾値超過として RUNNING_OVERDUE に出る（失敗記録が唯一の検知元）', async () => {
    const result = await listGateStalls(ownerCtx, { ...META, failedJobs: [] });
    expect(result.countsByReason).toEqual({ AI_COST_LIMIT_HELD: 3, JOB_FAILED: 0, RUNNING_OVERDUE: 2 });
    expect(result.rows.find((row) => row.targetId === PROPOSAL_A_P1)?.reason).toBe('RUNNING_OVERDUE');
    expect(result.rows.some((row) => row.targetId === PROJECT_A_PRIVATE)).toBe(false);
  });
});

describe('F-059 AC-6 ④⑤: 保留は失敗と別キーで、どの障害指標にも加算されない', () => {
  it('④ countsByReason は 3 区分が別キーで、合計が total と一致する', async () => {
    const result = await listGateStalls(ownerCtx, META);
    expect(Object.keys(result.countsByReason).sort()).toEqual([...GATE_STALL_REASONS].sort());
    expect(result.countsByReason).toEqual({ AI_COST_LIMIT_HELD: 3, JOB_FAILED: 2, RUNNING_OVERDUE: 1 });
    expect(Object.values(result.countsByReason).reduce((sum, n) => sum + n, 0)).toBe(result.total);
  });

  it('🔴 ⑤ 保留した提案は GATE_FAILED / SUBMIT_FAILED になっていない（状態機械を動かさない。CLAUDE.md §4.2）', async () => {
    const states = await superuser.$queryRaw<Array<{ id: string; state: string }>>`
      SELECT id, state FROM proposals WHERE id IN (${PROPOSAL_A_HOST}::uuid, ${PROPOSAL_B_HELD}::uuid)`;
    expect(states.map((row) => row.state)).toEqual(['GATE_RUNNING', 'GATE_RUNNING']);
    expect(await countRows`SELECT count(*) AS count FROM proposals WHERE state IN ('GATE_FAILED', 'SUBMIT_FAILED')`).toBe(0);
  });

  it('🔴 ⑤ 保留行は execution=DONE（ゲート FAIL 率の分母・分子。docs/05 §16.5）に入らず、JOB_FAILED の対象は保留行を持たない', async () => {
    const done = await countRows`
      SELECT count(*) AS count FROM review_gates
       WHERE execution = 'DONE' AND target_id IN (${PROPOSAL_A_HOST}::uuid, ${PROPOSAL_B_HELD}::uuid, ${PROJECT_B}::uuid)`;
    expect(done).toBe(0);
    const heldForFailed = await countRows`
      SELECT count(*) AS count FROM review_gates
       WHERE execution <> 'DONE' AND target_id IN (${PROPOSAL_A_P1}::uuid, ${PROJECT_A_PRIVATE}::uuid)`;
    expect(heldForFailed).toBe(0);
    // 対照: 保留行は実在する（検査が空振りでない）。
    expect(await countRows`SELECT count(*) AS count FROM review_gates WHERE execution = 'HELD_AI_COST_LIMIT'`).toBe(4);
  });
});

describe('F-059 AC-6 ⑥ / BR-40: 応答はテナント ID・対象・理由・時刻・分数だけ', () => {
  it('🔴 各行のキー集合が固定で、reason / targetType は宣言した値集合の中', async () => {
    const result = await listGateStalls(ownerCtx, META);
    expect(Object.keys(result).sort()).toEqual(['countsByReason', 'rows', 'stallThresholdMinutes', 'total']);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual([...ROW_KEYS]);
      expect(GATE_STALL_REASONS).toContain(row.reason);
      expect(['PROPOSAL', 'PROJECT_PUBLISH']).toContain(row.targetType);
      expect(row.since).toBeInstanceOf(Date);
      expect(Number.isInteger(row.stalledMinutes) && row.stalledMinutes >= 0).toBe(true);
    }
  });

  it('🔴 既知の値（件名・本文・提案先・氏名・エンド企業名・単価・指摘の抜粋）が JSON に 1 バイトも現れない', async () => {
    const json = JSON.stringify(await listGateStalls(ownerCtx, META));
    for (const [name, value] of Object.entries(FORBIDDEN)) {
      expect(json, `${name} が応答に現れている`).not.toContain(value);
    }
    expect(json).not.toMatch(/findings|aiWarnings|subject|body|recipient|engineer|unitPrice|contentHash/i);
    // 対照: 検査対象の値は DB の行に実在する（検査が空振りでない）。
    const stored = await superuser.$queryRaw<Array<{ subject: string | null; body: string | null; findings: unknown }>>`
      SELECT p.subject, p.body, g.findings
        FROM proposals p JOIN review_gates g ON g.target_id = p.id AND g.target_type = 'PROPOSAL'
       WHERE p.id = ${PROPOSAL_A_HOST}::uuid`;
    expect(stored[0]?.subject).toBe(FORBIDDEN.subject);
    expect(stored[0]?.body).toBe(FORBIDDEN.body);
    expect(JSON.stringify(stored[0]?.findings)).toContain(FORBIDDEN.findingExcerpt);
  });
});

describe('F-059 AC-6 ⑦ / ⑧: PLATFORM_SUPPORT でも読め、読み取りが admin.monitoring.view に横断で記録される', () => {
  it('PLATFORM_SUPPORT の応答は PLATFORM_OWNER と同一', async () => {
    const owner = await listGateStalls(ownerCtx, META);
    const support = await listGateStalls(supportCtx, META);
    expect(support).toEqual(owner);
  });

  it('🔴 監査ログ: actor = 運営者、tenant_id IS NULL（横断）、platformRole が summary に載る。書き込みは監査行以外に無い', async () => {
    const before = await countRows`SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    const snapshotBefore = await superuser.$queryRaw<Array<{ id: string; state: string; updated_at: Date }>>`
      SELECT id, state, updated_at FROM proposals ORDER BY id`;
    const gatesBefore = await countRows`SELECT count(*) AS count FROM review_gates`;

    await listGateStalls(supportCtx, META);

    const rows = await superuser.$queryRaw<
      Array<{ tenant_id: string | null; actor_kind: string; actor_id: string; ip_address: string | null; summary: Record<string, unknown> }>
    >`
      SELECT tenant_id, actor_kind, actor_id, ip_address, summary
        FROM audit_logs WHERE action = 'admin.monitoring.view' ORDER BY created_at DESC, id DESC LIMIT 1`;
    const after = await countRows`SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    expect(after - before).toBe(1);
    expect(rows[0]).toEqual({
      tenant_id: null,
      actor_kind: 'PLATFORM_USER',
      actor_id: SUPPORT_USER_ID,
      ip_address: '203.0.113.31',
      summary: { platformRole: 'PLATFORM_SUPPORT' },
    });
    const snapshotAfter = await superuser.$queryRaw<Array<{ id: string; state: string; updated_at: Date }>>`
      SELECT id, state, updated_at FROM proposals ORDER BY id`;
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(await countRows`SELECT count(*) AS count FROM review_gates`).toBe(gatesBefore);
  });

  it('⑪ 不正な閾値は withPlatformRead の前に落ち、監査行を残さない', async () => {
    const before = await countRows`SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    await expect(listGateStalls(ownerCtx, { ...META, stallThresholdMinutes: 0 })).rejects.toThrow(RangeError);
    await expect(listGateStalls(ownerCtx, { ...META, stallThresholdMinutes: 1.5 })).rejects.toThrow(RangeError);
    expect(await countRows`SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`).toBe(before);
  });
});

describe('⑨ 第 1 層（GRANT）: 運営者の retry に相当する操作は権限で弾かれる（docs/05 §9.10 ① / CLAUDE.md §10.5）', () => {
  it.each(['proposals', 'review_gates'])('🔴 app_platform / app_platform_write は %s に INSERT / UPDATE / DELETE を 1 つも持たない', async (table) => {
    for (const role of ['app_platform', 'app_platform_write'] as const) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE'] as const) {
        expect(await hasTablePrivilege(superuser, role, table, privilege), `${role} に ${table} の ${privilege} がある`).toBe(false);
      }
      for (const column of await readTableColumns(superuser, table)) {
        for (const privilege of ['INSERT', 'UPDATE'] as const) {
          expect(
            await hasColumnPrivilege(superuser, role, table, column, privilege),
            `${role} に ${table}.${column} の ${privilege} がある`,
          ).toBe(false);
        }
      }
    }
  });

  it.each(['proposals', 'review_gates'])('app_platform が %s で SELECT できる列は許可リストと一致する（件名・本文・findings は GRANT 外）', async (table) => {
    const selectable: string[] = [];
    for (const column of await readTableColumns(superuser, table)) {
      if (await hasColumnPrivilege(superuser, 'app_platform', table, column, 'SELECT')) selectable.push(column);
    }
    expect(selectable.sort()).toEqual([...PLATFORM_READ_COLUMN_ALLOWLIST[table]!].sort());
    for (const hidden of table === 'proposals' ? ['subject', 'body', 'draft_body', 'recipient_email', 'offered_unit_price'] : ['findings', 'ai_warnings']) {
      expect(selectable, `${table}.${hidden} が app_platform に GRANT されている`).not.toContain(hidden);
    }
  });

  it('実測: 素の app_platform 接続で UPDATE は permission denied（型を破っても DB が止める）', async () => {
    const platform = createUnextendedClient(database.platformUrl);
    try {
      const attempt = platform.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform_user_id', ${OWNER_USER_ID}, true), set_config('app.target_tenant_id', '', true)`;
        return tx.$executeRaw`UPDATE review_gates SET execution = 'DONE' WHERE target_id = ${PROPOSAL_A_HOST}::uuid`;
      });
      await expect(attempt).rejects.toThrow(/permission denied/i);
      const attemptProposal = platform.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform_user_id', ${OWNER_USER_ID}, true), set_config('app.target_tenant_id', '', true)`;
        return tx.$executeRaw`UPDATE proposals SET state = 'DRAFT' WHERE id = ${PROPOSAL_A_P1}::uuid`;
      });
      await expect(attemptProposal).rejects.toThrow(/permission denied/i);
    } finally {
      await platform.$disconnect();
    }
    expect(await countRows`SELECT count(*) AS count FROM review_gates WHERE execution = 'HELD_AI_COST_LIMIT'`).toBe(4);
  });
});

describe('⑩ 母集団の境界', () => {
  it('🔴 GATE_RUNNING でない提案（WON）に残った保留行は載らない（対象が無いものを滞留と呼ばない）', async () => {
    const { rows } = await listGateStalls(ownerCtx, META);
    expect(rows.some((row) => row.targetId === PROPOSAL_A_P1_PRIVATE)).toBe(false);
    // 対照: その保留行は実在する。
    expect(
      await countRows`SELECT count(*) AS count FROM review_gates WHERE target_id = ${PROPOSAL_A_P1_PRIVATE}::uuid AND execution <> 'DONE'`,
    ).toBe(1);
  });

  it('PROJECT_PUBLISH の保留行・失敗記録は載る（対象の表は app_platform から読めないため、そのまま載せる）', async () => {
    const { rows } = await listGateStalls(ownerCtx, META);
    expect(rows.filter((row) => row.targetType === 'PROJECT_PUBLISH').map((row) => [row.targetId, row.reason])).toEqual([
      [PROJECT_A_PRIVATE, 'JOB_FAILED'],
      [PROJECT_B, 'AI_COST_LIMIT_HELD'],
    ]);
  });

  it('🔴 テナントが違えば同じ対象 ID でも照合しない（分離キーが照合に含まれる）', async () => {
    const result = await listGateStalls(ownerCtx, {
      ...META,
      failedJobs: [{ tenantId: TENANT_B, targetType: 'PROPOSAL', targetId: PROPOSAL_A_P1, failedAt: minutesAgo(1) }],
    });
    // A の提案 P1 は失敗記録が無くなり閾値超過 → RUNNING_OVERDUE。B 名義の失敗記録は対象が無いので載らない。
    expect(result.rows.find((row) => row.targetId === PROPOSAL_A_P1)?.reason).toBe('RUNNING_OVERDUE');
    expect(result.countsByReason.JOB_FAILED).toBe(0);
  });

  it('確定行（execution=DONE。fixtures の PROJECT_A_PUBLISHED）は滞留ではなく、載らない', async () => {
    const { rows } = await listGateStalls(ownerCtx, META);
    expect(rows.every((row) => row.targetId !== PROJECT_A_PUBLISHED)).toBe(true);
    expect(
      await countRows`SELECT count(*) AS count FROM review_gates WHERE target_id = ${PROJECT_A_PUBLISHED}::uuid AND execution = 'DONE'`,
    ).toBe(1);
  });
});
