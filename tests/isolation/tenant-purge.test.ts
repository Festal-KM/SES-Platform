// tests/isolation/tenant-purge.test.ts
// 🔴 T-10-09 の完了判定 = `docs/02` `F-064 AC-1`〜`AC-10` の結合テスト（docs/05 §9.7 `tenant.purge-scan` / `tenant.purge` /
//    §9.6 `export.generate` / §6.7 #77 #78 / §14.2 / §16.1 / §17.3 #17 #24 / `CLAUDE.md` §3.1 §3.4 §4.2 §10.5 §11.1）。
//    **実 DB（RLS + 削除スコープの追加ポリシー + SECURITY DEFINER）+ 実 Redis（BullMQ の `tenant.purge` Worker）+ 実 Route Handler
//    （#77 / #78）+ モック S3（`createObjectStore('mock')` = `demo` / E2E と同一実装）**。実 S3 にも実 SES にも接続しない。
//
// ============================================================================
// 🔴 何を固定するか（AC の番号順ではなく、状態が積み上がる順に並べている）
// ============================================================================
//   AC-10 ① 予告が `QUEUED` / `HELD_PROVIDER_QUOTA` の間は `tenant.purge-scan` が積まず、🔴 **`tenant.purge` を直接呼んでも no-op**
//           （`TenantPurgeRun` 0 件・連絡先・原本・本文が残る）。`SENT` になって初めて進む
//   AC-5/6 ② `CLOSING` の `OWNER` が #77 → `export.generate` → #78。**ホストの CSV に取引先所有で未提案のエンジニアが 0 行**、
//           提案済み（凍結コピー）は `engineer_snapshots.csv` にだけ、`engineer_careers.csv` は別ファイル。`ACTIVE` の #77 は 422。
//           期限切れは 410（`EXPIRED` に確定）
//   AC-1   ③ 29 日目は積まない。予定日を過ぎた日（ジョブを止めた日があっても）に積み、**実 Worker が消費して `PURGED`**。
//           `sandbox` / `production` 相当の `appEnv` でも同じ判定（AC-9）
//   AC-2   ④ `PURGED` 後: 連絡先・`object_key`・`messages.body`・`engineer_careers` が消え、**S3 の DeleteObject がオブジェクト数と一致**、
//           共有 URL の発行（#20 のサービス / #78）が 404 / 410
//   AC-3   ⑤ `TenantPurgeRun.counts` のキー集合 = `PURGE_SPEC.delete` の表
//   AC-4   ⑥ `PURGED` から `ACTIVE` / `CLOSING` に戻す遷移が無い（遷移表 + `app_complete_tenant_purge()` の fail-closed）
//   AC-8   ⑦ `AuditLog` に削除（種別と件数）と返却（作成・DL）が残り、内容を含まない
//   AC-7   ⑧ 運営者の DB ロールが返却データ（`object_key`）に到達できず、書けない
//          ⑨ 削除スコープの追加ポリシーが `PURGE_SPEC.delete` の表と 1 対 1（DB 側の実測。静的 #12 ④ は migration のテキスト）
//
// 🔴 E2E #17 / #24 はこのファイルで代替する（docs/05 §17.3 の注記）。
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createObjectStore, tenantPurgeJobId, type ObjectStore } from '@ses/connectors';
import { createBullMqTenantPurgeQueue, createBullMqWorker, type BullMqTenantPurgeQueue, type BullMqWorker } from '@ses/connectors/bullmq';
import {
  completeTenantPurge,
  configureTenantDb,
  countPurgePending,
  disconnectTenantDb,
  listPurgeObjectKeys,
  resolveTenantCtx,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { PURGE_SPEC } from '../../packages/config/src/retention.js';
import { tenantMachine } from '../../packages/domain/src/state/index.js';
import { decodeUtf8, listZipEntries } from '../../packages/domain/src/export/index.js';
import { TENANT_CLOSING_NOTICE_TEMPLATE_KEY } from '../../packages/domain/src/retention/closing-notice.js';
import { createExportGenerateHandler } from '../../apps/worker/src/jobs/export-generate.js';
import { createTenantPurgeHandler, TENANT_PURGE_JOB } from '../../apps/worker/src/jobs/tenant-purge.js';
import {
  createTenantPurgeScanHandler,
  TENANT_PURGE_SCAN_JOB,
  TENANT_PURGE_SCAN_POPULATION,
  type TenantPurgeScanOutcome,
} from '../../apps/worker/src/jobs/tenant-purge-scan.js';
import { fanOutToTenants } from '../../apps/worker/src/runtime.js';
import {
  CONTRACT_A_P1,
  CONTRACT_A_P2,
  CONTRACT_DOC_A_P1_DRAFT,
  CONTRACT_DOC_A_P1_SIGNED,
  CONTRACT_DOC_A_P2_SIGNED,
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_B_HOST,
  PARTNER_A1,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const PURGE_GRACE_DAYS = 30;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.42' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
/** `CLOSING` に入った時刻。UTC 00:00 = JST 09:00 → 暦日 2026-09-01。削除予定日 = 2026-10-01。 */
const CLOSING_ENTERED_AT = new Date('2026-09-01T00:00:00.000Z');

const HOST_SHEET_ID = '01930000-0000-7000-8000-00000000d101';
const PARTNER_SHEET_ID = '01930000-0000-7000-8000-00000000d102';
const HOST_SHEET_KEY = `t/${TENANT_A}/skill-sheets/${ENGINEER_A_HOST}/1/01930000-0000-7000-8000-00000000d111.xlsx`;
const PARTNER_SHEET_KEY = `t/${TENANT_A}/skill-sheets/${ENGINEER_A_PARTNER}/1/01930000-0000-7000-8000-00000000d112.xlsx`;
const HOST_CONTACT_EMAIL = 't1009-host-engineer@example.test';
const PARTNER_CONTACT_EMAIL = 't1009-partner-engineer@example.test';
const PARTNER_ENGINEER_NAME = 'Engineer A-Partner';
/** 🔴 対照（テナント B = `ACTIVE`）。A の削除が B の行・S3 に 1 件も届かないことを固定する。 */
const TENANT_B_SHEET_ID = '01930000-0000-7000-8000-00000000d201';
const TENANT_B_SHEET_KEY = `t/${TENANT_B}/skill-sheets/${ENGINEER_B_HOST}/1/01930000-0000-7000-8000-00000000d211.xlsx`;
const TENANT_B_CONTACT_EMAIL = 't1009-tenant-b-engineer@example.test';
const TENANT_B_ENGINEER_NAME = 'Engineer B-Host';
/**
 * 🔴 契約書の原本（docs/05 §14.1 `t/{tenantId}/contracts/{contractId}/{version}/{uuid}.pdf`）。fixtures の値は漏洩検知用の
 *    マーカー文字列で S3 キーの形ではないため、ここで置き換える（このファイルは自分のコンテナを持つ。他テストに影響しない）。
 *    2 版は自テナントのキー（削除される）。**1 版はテナント B のプレフィックス**（テナント A の行が他テナントのキーを指している
 *    = `partitionPurgeObjectKeys` が `skipped` に分け、`DeleteObject` を発行しない。S3 側の二重防御を実 DB + 実 Worker で固定する）。
 */
const CONTRACT_DOC_KEY_P1_V1 = `t/${TENANT_A}/contracts/${CONTRACT_A_P1}/1/01930000-0000-7000-8000-00000000d301.pdf`;
const CONTRACT_DOC_KEY_P1_V2 = `t/${TENANT_A}/contracts/${CONTRACT_A_P1}/2/01930000-0000-7000-8000-00000000d302.pdf`;
const CONTRACT_DOC_KEY_FOREIGN = `t/${TENANT_B}/contracts/${CONTRACT_A_P2}/1/01930000-0000-7000-8000-00000000d303.pdf`;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

/** 🔴 起動時 DI の代わり: `objectStore()` はモック（`demo` / E2E と同一実装）。`purgeGraceDays()` は既定 30。 */
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  objectStore: () => store,
  purgeGraceDays: () => PURGE_GRACE_DAYS,
  ensureDbConfigured: () => undefined,
}));

const exportsRoute = await import('../../apps/web/app/api/(main)/data-exports/route');
const downloadRoute = await import('../../apps/web/app/api/(main)/data-exports/[id]/download-url/route');
const { configureExportGenerateJobQueue, resetExportGenerateJobQueue } = await import('../../apps/web/lib/jobs/export-generate-queue');
const { issueSkillSheetDownloadUrl } = await import('../../apps/web/lib/skill-sheets/service');

/** モックの検証用の口（`ObjectStore` の契約には無い。実体は `createObjectStore('mock')` が返す `MockObjectStore`）。 */
type InspectableStore = ObjectStore & {
  readBody(key: string): Uint8Array | null;
  deletedKeys(): readonly string[];
  keys(): readonly string[];
};

let database: IsolationDatabase;
let redis: IsolationRedis;
let admin: UnextendedClient;
let store: InspectableStore;
let purgeQueue: BullMqTenantPurgeQueue;
let worker: BullMqWorker | null = null;
let hostOwnerA: AuthenticatedTenantCtx;
let hostOwnerB: AuthenticatedTenantCtx;
/** #77 が積んだ `export.generate`（ハンドラは直接呼ぶ）。 */
const exportJobs: { tenantId: string; exportRequestId: string }[] = [];

function jstNoon(dayKey: string): Date {
  return new Date(`${dayKey}T03:00:00.000Z`);
}

function jobCtx(tenantId: string, jobId: string): SystemTenantCtx {
  return systemTenantCtx(tenantId, { queue: TENANT_PURGE_JOB, jobId });
}

async function setNotice(status: string): Promise<void> {
  await admin.$executeRaw`DELETE FROM email_dispatches WHERE tenant_id = ${TENANT_A}::uuid AND template_key = ${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}`;
  await admin.$executeRaw`
    INSERT INTO email_dispatches (id, tenant_id, recipient_class, recipient_email, template_key, dedupe_key, status, held_at)
    VALUES (gen_random_uuid(), ${TENANT_A}::uuid, 'HOST_MEMBER', 'owner-a@t1009.test', ${TENANT_CLOSING_NOTICE_TEMPLATE_KEY},
            ${`${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}:${TENANT_A}#ENTERED#2026-09-01:${status}`}, ${status},
            ${status.startsWith('HELD_') ? new Date() : null})`;
}

/** 🔴 本番と同じ配り方: 母集団（SQL 関数 `CLOSING`）→ 1 テナントずつハンドラ。`now` / `appEnv` / enqueue 先を差し替える。 */
async function scan(
  now: Date,
  appEnv: 'development' | 'sandbox' | 'production',
  enqueue: (job: { tenantId: string }) => Promise<'ENQUEUED' | 'BLOCKED_BY_FAILED_JOB'>,
): Promise<Map<string, TenantPurgeScanOutcome>> {
  const handler = createTenantPurgeScanHandler({ now: () => now, purgeGraceDays: PURGE_GRACE_DAYS, appEnv, enqueueTenantPurge: enqueue });
  const outcomes = new Map<string, TenantPurgeScanOutcome>();
  await fanOutToTenants(
    TENANT_PURGE_SCAN_JOB,
    `repeat:${TENANT_PURGE_SCAN_JOB}:${now.getTime()}`,
    async (payload, jobId) => {
      const outcome = await handler(payload, jobId);
      outcomes.set((payload as { tenantId: string }).tenantId, outcome);
      return outcome;
    },
    TENANT_PURGE_SCAN_POPULATION,
  );
  return outcomes;
}

function purgeHandler(now: Date) {
  return createTenantPurgeHandler({ now: () => now, appEnv: 'development', objectStore: store });
}

async function tenantState(): Promise<{ lifecycle_state: string; closing_entered_at: Date | null }> {
  const rows = await admin.$queryRaw<{ lifecycle_state: string; closing_entered_at: Date | null }[]>`
    SELECT lifecycle_state, closing_entered_at FROM tenants WHERE id = ${TENANT_A}::uuid`;
  return rows[0]!;
}

async function purgeRuns() {
  return admin.tenantPurgeRun.findMany({ where: { tenantId: TENANT_A }, orderBy: { startedAt: 'asc' } });
}

async function piiSnapshot() {
  const engineers = await admin.$queryRaw<{ id: string; contact_email: string | null; display_name: string; pii_purged_at: Date | null }[]>`
    SELECT id::text AS id, contact_email, display_name, pii_purged_at FROM engineers WHERE tenant_id = ${TENANT_A}::uuid ORDER BY id`;
  const sheets = await admin.$queryRaw<{ id: string; object_key: string | null; purged_at: Date | null }[]>`
    SELECT id::text AS id, object_key, purged_at FROM skill_sheets WHERE tenant_id = ${TENANT_A}::uuid ORDER BY id`;
  const messages = await admin.$queryRaw<{ id: string; body: string | null; purged_at: Date | null }[]>`
    SELECT id::text AS id, body, purged_at FROM messages WHERE tenant_id = ${TENANT_A}::uuid ORDER BY id`;
  const careers = await admin.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM engineer_careers WHERE tenant_id = ${TENANT_A}::uuid`;
  const users = await admin.$queryRaw<{ id: string; email: string; display_name: string }[]>`
    SELECT id::text AS id, email, display_name FROM users WHERE tenant_id = ${TENANT_A}::uuid ORDER BY id`;
  const snapshots = await admin.$queryRaw<{ display_name: string; careers: unknown }[]>`
    SELECT display_name, careers FROM engineer_snapshots WHERE tenant_id = ${TENANT_A}::uuid`;
  return { engineers, sheets, messages, careers: careers[0]?.count ?? 0, users, snapshots };
}

/** テナント A の `proposal_events.attachment_key`（Phase 1 は `skill_sheets.id`。S3 キーではない）。 */
async function proposalEventAttachmentKeys(): Promise<(string | null)[]> {
  const rows = await admin.$queryRaw<{ attachment_key: string | null }[]>`
    SELECT attachment_key FROM proposal_events WHERE tenant_id = ${TENANT_A}::uuid ORDER BY id`;
  return rows.map((row) => row.attachment_key);
}

/** 🔴 対照: テナント B（`ACTIVE`）の個人情報・原本。A の削除の前後で不変でなければならない。 */
async function tenantBSnapshot() {
  const engineers = await admin.$queryRaw<{ id: string; contact_email: string | null; display_name: string; pii_purged_at: Date | null }[]>`
    SELECT id::text AS id, contact_email, display_name, pii_purged_at FROM engineers WHERE tenant_id = ${TENANT_B}::uuid ORDER BY id`;
  const sheets = await admin.$queryRaw<{ id: string; object_key: string | null; purged_at: Date | null }[]>`
    SELECT id::text AS id, object_key, purged_at FROM skill_sheets WHERE tenant_id = ${TENANT_B}::uuid ORDER BY id`;
  const users = await admin.$queryRaw<{ id: string; email: string; display_name: string }[]>`
    SELECT id::text AS id, email, display_name FROM users WHERE tenant_id = ${TENANT_B}::uuid ORDER BY id`;
  const runs = await admin.tenantPurgeRun.count({ where: { tenantId: TENANT_B } });
  return { engineers, sheets, users, runs };
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({ where: { tenantId: TENANT_A, action }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function postExport(ctx: AuthenticatedTenantCtx): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return exportsRoute.POST(
    new Request('https://app.test/api/data-exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'CLOSING_RETURN' }),
    }),
  );
}

async function getDownloadUrl(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return downloadRoute.GET(new Request(`https://app.test/api/data-exports/${id}/download-url`), segment(id));
}

/** 🔴 T-12-17 ⑲ (a): 先頭が `=` のセル値（技術欄に紛れた数式）。返却 CSV では `'=` で出る（Issue #68）。 */
const CSV_INJECTION_TECHNOLOGIES = '=SUM(A1:A3)';

async function runExportGenerate(job: { tenantId: string; exportRequestId: string }, now: Date) {
  const handler = createExportGenerateHandler({ now: () => now, objectStore: store, exportAvailableDays: 7 });
  return handler(job, `export.generate.${job.exportRequestId}`);
}

function csvRows(archive: Uint8Array, name: string): string[] {
  const entry = listZipEntries(archive).find((e) => e.name === name);
  if (entry === undefined) throw new Error(`${name} が ZIP に無い`);
  return decodeUtf8(entry.data).replace(/^\uFEFF/, '').split('\r\n').filter((line) => line !== '');
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  redis = await startIsolationRedis();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  store = createObjectStore('mock') as InspectableStore;
  purgeQueue = createBullMqTenantPurgeQueue({ url: redis.url });
  configureExportGenerateJobQueue({
    async enqueue(job) {
      exportJobs.push({ ...job });
      return 'ENQUEUED';
    },
  });

  // テナント A を `CLOSING` にする（fixtures は ACTIVE）。テナント B は ACTIVE のまま（対照）。
  await admin.$executeRaw`
    UPDATE tenants SET lifecycle_state = 'CLOSING', lifecycle_changed_at = ${CLOSING_ENTERED_AT}, closing_entered_at = ${CLOSING_ENTERED_AT}
     WHERE id = ${TENANT_A}::uuid`;

  // 🔴 個人情報を仕込む（ホスト所有 + 取引先所有の両方。削除が取引先所有の行にも届くことを確かめる）。
  await admin.$executeRaw`
    UPDATE engineers SET contact_email = ${HOST_CONTACT_EMAIL}, contact_phone = '090-0000-0001', birth_date = DATE '1990-01-01'
     WHERE id = ${ENGINEER_A_HOST}::uuid`;
  await admin.$executeRaw`
    UPDATE engineers SET contact_email = ${PARTNER_CONTACT_EMAIL}, contact_phone = '090-0000-0002', birth_date = DATE '1991-02-02'
     WHERE id = ${ENGINEER_A_PARTNER}::uuid`;
  await admin.$executeRaw`
    INSERT INTO engineer_careers (id, tenant_id, owner_partner_company_id, engineer_id, period_from, period_to, role, description, technologies)
    VALUES (gen_random_uuid(), ${TENANT_A}::uuid, NULL, ${ENGINEER_A_HOST}::uuid, '2020-04', NULL, 'SE', 'ホストの経歴', ${CSV_INJECTION_TECHNOLOGIES}),
           (gen_random_uuid(), ${TENANT_A}::uuid, ${PARTNER_A1}::uuid, ${ENGINEER_A_PARTNER}::uuid, '2019-04', '2021-03', 'PG', '取引先の経歴', 'Go')`;
  await admin.$executeRaw`
    INSERT INTO skill_sheets (id, tenant_id, owner_partner_company_id, engineer_id, version, object_key, content_type, byte_size, scan_status, is_latest, uploaded_by)
    VALUES (${HOST_SHEET_ID}::uuid, ${TENANT_A}::uuid, NULL, ${ENGINEER_A_HOST}::uuid, 1, ${HOST_SHEET_KEY}, 'application/vnd.ms-excel', 12, 'CLEAN', true, ${USER_A_HOST}::uuid),
           (${PARTNER_SHEET_ID}::uuid, ${TENANT_A}::uuid, ${PARTNER_A1}::uuid, ${ENGINEER_A_PARTNER}::uuid, 1, ${PARTNER_SHEET_KEY}, 'application/vnd.ms-excel', 12, 'CLEAN', true, ${USER_A_HOST}::uuid)`;
  await store.put(HOST_SHEET_KEY, new Uint8Array([1, 2, 3]), 'application/vnd.ms-excel');
  await store.put(PARTNER_SHEET_KEY, new Uint8Array([4, 5, 6]), 'application/vnd.ms-excel');
  // 🔴 Phase 1 の #37（T-09-09）は `proposal_events.attachment_key` に**添付した版の `skill_sheets.id`（UUID）**を入れる。
  //    S3 のキーではないので `objectKeyColumns` に載せず、`DeleteObject` に渡さない（渡すと実 S3 では
  //    `ObjectKeyOutOfTenantScopeError` で削除が永久に失敗し `PURGED` に到達しない）。列は NULL 化する。
  await admin.$executeRaw`
    INSERT INTO proposal_events (id, tenant_id, proposal_id, kind, from_state, to_state, actor_user_id, note, attachment_key, occurred_at)
    VALUES (gen_random_uuid(), ${TENANT_A}::uuid, ${PROPOSAL_A_HOST}::uuid, 'NOTE', 'DRAFT', 'DRAFT', ${USER_A_HOST}::uuid,
            'draft-updated:skillSheetId', ${HOST_SHEET_ID}, now())`;
  // 🔴 対照: テナント B（`ACTIVE`）にも連絡先・原本・S3 実体を置く。A の削除が B に 1 件も届かないことを④で固定する。
  await admin.$executeRaw`
    UPDATE engineers SET contact_email = ${TENANT_B_CONTACT_EMAIL}, contact_phone = '090-0000-0003' WHERE id = ${ENGINEER_B_HOST}::uuid`;
  await admin.$executeRaw`
    INSERT INTO skill_sheets (id, tenant_id, owner_partner_company_id, engineer_id, version, object_key, content_type, byte_size, scan_status, is_latest, uploaded_by)
    VALUES (${TENANT_B_SHEET_ID}::uuid, ${TENANT_B}::uuid, NULL, ${ENGINEER_B_HOST}::uuid, 1, ${TENANT_B_SHEET_KEY}, 'application/vnd.ms-excel', 12, 'CLEAN', true, ${USER_B_HOST}::uuid)`;
  await store.put(TENANT_B_SHEET_KEY, new Uint8Array([7, 8, 9]), 'application/vnd.ms-excel');
  // 🔴 契約書の原本（上の定数の 🔴）。3 版とも S3 に置き、③で 2 版だけが消え、B のプレフィックスの 1 版は残ることを固定する。
  await admin.$executeRaw`UPDATE contract_documents SET object_key = ${CONTRACT_DOC_KEY_P1_V1} WHERE id = ${CONTRACT_DOC_A_P1_DRAFT}::uuid`;
  await admin.$executeRaw`UPDATE contract_documents SET object_key = ${CONTRACT_DOC_KEY_P1_V2} WHERE id = ${CONTRACT_DOC_A_P1_SIGNED}::uuid`;
  await admin.$executeRaw`UPDATE contract_documents SET object_key = ${CONTRACT_DOC_KEY_FOREIGN} WHERE id = ${CONTRACT_DOC_A_P2_SIGNED}::uuid`;
  await store.put(CONTRACT_DOC_KEY_P1_V1, new Uint8Array([10]), 'application/pdf');
  await store.put(CONTRACT_DOC_KEY_P1_V2, new Uint8Array([11]), 'application/pdf');
  await store.put(CONTRACT_DOC_KEY_FOREIGN, new Uint8Array([12]), 'application/pdf');
  // 越境経路 2: 取引先の提案の凍結コピー（ホストに開示済み）。
  await admin.$executeRaw`
    INSERT INTO engineer_snapshots (id, tenant_id, owner_partner_company_id, proposal_id, display_name, affiliation_label, skills, careers, frozen_at)
    VALUES (gen_random_uuid(), ${TENANT_A}::uuid, ${PARTNER_A1}::uuid, ${PROPOSAL_A_P1}::uuid, ${PARTNER_ENGINEER_NAME}, 'Partner A1',
            '[{"skillId":"00000000-0000-0000-0000-000000000000","name":"Go","years":2,"level":3}]'::jsonb,
            '[{"periodFrom":"2019-04","periodTo":"2021-03","role":"PG","description":"取引先の経歴","technologies":"Go"}]'::jsonb, now())`;

  const base = { partnerSuspendedAt: null, twoFactor: 'VERIFIED' as const, partnerCompanyId: null };
  hostOwnerA = await resolveTenantCtx({ ...base, tenantId: TENANT_A, lifecycleState: 'CLOSING', userId: USER_A_HOST, role: 'OWNER' }, DEVICE);
  hostOwnerB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, lifecycleState: 'ACTIVE', userId: USER_B_HOST, role: 'OWNER' }, DEVICE);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await worker?.close();
  await purgeQueue.close();
  resetExportGenerateJobQueue();
  await disconnectTenantDb();
  await admin.$disconnect();
  await redis.stop();
  await database.stop();
});

describe('AC-10 ① 予告が配送済みでない間は積まず、tenant.purge を直接呼んでも no-op', () => {
  it.each(['QUEUED', 'HELD_PROVIDER_QUOTA'])('予告が %s: scan は NOTICE_PENDING、直接の tenant.purge は NOOP、個人情報は残る', async (status) => {
    await setNotice(status);
    const enqueued: unknown[] = [];
    const outcomes = await scan(jstNoon('2026-10-05'), 'development', async (job) => {
      enqueued.push(job);
      return 'ENQUEUED';
    });
    expect(outcomes.get(TENANT_A)).toMatchObject({ kind: 'NOTICE_PENDING', purgeScheduledOn: '2026-10-01' });
    expect(outcomes.has(TENANT_B)).toBe(false); // ACTIVE は母集団 CLOSING に無い
    expect(enqueued).toEqual([]);

    // 🔴 直接 enqueue された（= 走査を経ない）`tenant.purge` も同じ関数で偽になり、何もしない。
    const outcome = await purgeHandler(jstNoon('2026-10-05'))({ tenantId: TENANT_A }, tenantPurgeJobId({ tenantId: TENANT_A }));
    expect(outcome).toMatchObject({ kind: 'NOOP', reason: 'NOTICE_PENDING' });
    expect(await purgeRuns()).toEqual([]);
    const pii = await piiSnapshot();
    expect(pii.engineers.map((e) => e.contact_email)).toEqual(expect.arrayContaining([HOST_CONTACT_EMAIL, PARTNER_CONTACT_EMAIL]));
    expect(pii.sheets.every((s) => s.object_key !== null && s.purged_at === null)).toBe(true);
    expect(pii.messages.every((m) => m.body !== null)).toBe(true);
    expect(pii.careers).toBe(2);
    expect((await tenantState()).lifecycle_state).toBe('CLOSING');
    expect(store.deletedKeys()).toEqual([]);
  });
});

describe('AC-5 / AC-6 / AC-7 / AC-8 ② CLOSING 中の返却（#77 → export.generate → #78）', () => {
  let exportId = '';

  it('🔴 #77: CLOSING の OWNER は 202 + QUEUED + 監査（data_export.create）。ACTIVE のテナントは 422', async () => {
    const response = await postExport(hostOwnerA);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string; status: string };
    expect(body.status).toBe('QUEUED');
    exportId = body.id;
    expect(exportJobs).toEqual([{ tenantId: TENANT_A, exportRequestId: exportId }]);
    const created = await auditRows('data_export.create');
    expect(created).toHaveLength(1);
    expect(created[0]?.targetId).toBe(exportId);
    expect(created[0]?.actorId).toBe(USER_A_HOST);

    const active = await postExport(hostOwnerB);
    expect(active.status).toBe(422);
    expect(((await active.json()) as { error: { code: string } }).error.code).toBe('DATA_EXPORT_NOT_ALLOWED');
    // 生成前の #78 は 409（まだ READY でない）。
    const early = await getDownloadUrl(hostOwnerA, exportId);
    expect(early.status).toBe(409);
  });

  it('🔴 export.generate: 二重境界の内側で読み、ZIP を t/{tenantId}/exports/ に置く。取引先所有で未提案の台帳は 0 行', async () => {
    const outcome = await runExportGenerate(exportJobs[0]!, jstNoon('2026-09-20'));
    expect(outcome).toMatchObject({ kind: 'READY', exportRequestId: exportId, fileCount: 12 });
    const row = await admin.dataExportRequest.findUniqueOrThrow({ where: { id: exportId } });
    expect(row.status).toBe('READY');
    expect(row.objectKey).toMatch(new RegExp(`^t/${TENANT_A}/exports/${exportId}/[0-9a-f-]{36}\\.zip$`));
    const archive = store.readBody(row.objectKey!);
    expect(archive).not.toBeNull();

    // engineers.csv: ホスト所有の 1 行だけ（取引先所有 2 人は 0 行）。連絡先は自社データなので含まれる。
    const engineers = csvRows(archive!, 'engineers.csv');
    expect(engineers).toHaveLength(2);
    expect(engineers[1]).toContain(ENGINEER_A_HOST);
    expect(engineers[1]).toContain(HOST_CONTACT_EMAIL);
    expect(engineers.join('\n')).not.toContain(ENGINEER_A_PARTNER);
    expect(engineers.join('\n')).not.toContain(PARTNER_CONTACT_EMAIL);
    expect(engineers.join('\n')).not.toContain(PARTNER_ENGINEER_NAME);
    // engineer_careers.csv: 別ファイル。ホストの経歴 1 行だけ（取引先の経歴 0 行）。
    const careers = csvRows(archive!, 'engineer_careers.csv');
    expect(careers[0]).toBe('engineer_id,period_from,period_to,role,description,technologies,source');
    expect(careers).toHaveLength(2);
    expect(careers[1]).toContain('ホストの経歴');
    expect(careers.join('\n')).not.toContain('取引先の経歴');
    // 🔴 T-12-17 ⑲ (a): 先頭 `=` のセルは `'=` で出る（生の `=SUM(` が無い）。値そのものは失わない。
    expect(careers[1]).toContain(`,'${CSV_INJECTION_TECHNOLOGIES},`);
    expect(careers[1]).not.toContain(`,${CSV_INJECTION_TECHNOLOGIES},`);
    // engineer_snapshots.csv: 越境経路 2 で開示済みの凍結コピーは**ここにだけ**。
    const snapshots = csvRows(archive!, 'engineer_snapshots.csv');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toContain(PARTNER_ENGINEER_NAME);
    const snapshotCareers = csvRows(archive!, 'engineer_snapshot_careers.csv');
    expect(snapshotCareers).toHaveLength(2);
    expect(snapshotCareers[1]).toContain('取引先の経歴');
    // proposals.csv: ホストは全提案（fixtures の 4 件）を読む。engineer_id は不透明な ID。
    const proposalCount = await admin.proposal.count({ where: { tenantId: TENANT_A } });
    expect(csvRows(archive!, 'proposals.csv')).toHaveLength(proposalCount + 1);
    // 2 度目の試行（attempts: 2）は claim が 0 件で何もしない。
    expect(await runExportGenerate(exportJobs[0]!, jstNoon('2026-09-20'))).toEqual({ kind: 'SKIPPED', reason: 'NOT_QUEUED', status: 'READY' });
  });

  it('🔴 #78: READY なら署名 URL（3600 秒）+ 監査（data_export.download）。期限超過は EXPIRED に確定して 410', async () => {
    const response = await getDownloadUrl(hostOwnerA, exportId);
    expect(response.status).toBe(200);
    const ticket = (await response.json()) as { url: string; expiresIn: number };
    expect(ticket.expiresIn).toBe(3600);
    expect(ticket.url).toContain('closing-return.zip');
    const downloads = await auditRows('data_export.download');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.targetId).toBe(exportId);
    expect(JSON.stringify(downloads[0]?.summary)).not.toContain('t/');

    await admin.dataExportRequest.update({ where: { id: exportId }, data: { expiresAt: new Date('2026-09-01T00:00:00.000Z') } });
    const expired = await getDownloadUrl(hostOwnerA, exportId);
    expect(expired.status).toBe(410);
    expect((await admin.dataExportRequest.findUniqueOrThrow({ where: { id: exportId } })).status).toBe('EXPIRED');
    // 境界外（テナント B の OWNER）からは 404。
    expect((await getDownloadUrl(hostOwnerB, exportId)).status).toBe(404);
  });
});

describe('AC-1 / AC-9 ③ 期限を過ぎ、予告が配送済みになって初めて積み、実 Worker が消費して PURGED', () => {
  it('29 日目は NOT_DUE。予定日を過ぎた日は sandbox / production 相当の appEnv でも同じ ENQUEUED', async () => {
    await setNotice('SENT');
    const capture = async () => 'ENQUEUED' as const;
    expect((await scan(jstNoon('2026-09-30'), 'development', capture)).get(TENANT_A)).toMatchObject({ kind: 'NOT_DUE', todayKey: '2026-09-30' });
    for (const appEnv of ['sandbox', 'production'] as const) {
      expect((await scan(jstNoon('2026-10-03'), appEnv, capture)).get(TENANT_A)).toMatchObject({ kind: 'ENQUEUED', purgeScheduledOn: '2026-10-01' });
    }
  });

  it('🔴 実 Redis + 実 Worker: scan が積んだ tenant.purge を消費し、S3 → DB → PURGED の順で完了する', async () => {
    const listing = await listPurgeObjectKeys(jobCtx(TENANT_A, 'list'));
    const expectedKeys = listing.targets.map((t) => t.key).sort();
    expect(expectedKeys).toEqual(expect.arrayContaining([HOST_SHEET_KEY, PARTNER_SHEET_KEY]));
    // 取引先所有のスキルシートも、返却 ZIP も、契約書のキーも列挙される（削除スコープ = テナント境界だけ）。
    expect(expectedKeys.some((key) => key.includes('/exports/'))).toBe(true);
    // 🔴 `targets` は全件が自テナントのプレフィックス。`proposal_events.attachment_key`（UUID）は列挙されない（`objectKeyColumns`
    //    に載せていない = 振り分けに来ない）。テナント B の行のキーは削除スコープでも見えない。
    expect(expectedKeys.every((key) => key.startsWith(`t/${TENANT_A}/`))).toBe(true);
    expect(expectedKeys).toEqual(expect.arrayContaining([CONTRACT_DOC_KEY_P1_V1, CONTRACT_DOC_KEY_P1_V2]));
    expect(expectedKeys).not.toContain(HOST_SHEET_ID);
    expect(expectedKeys).not.toContain(TENANT_B_SHEET_KEY);
    // 🔴 テナント A の行が持つ **B のプレフィックスのキー**は `skipped`（出所だけ。値を載せない）に分けられ、`targets` に入らない。
    expect(expectedKeys).not.toContain(CONTRACT_DOC_KEY_FOREIGN);
    expect(listing.skipped).toEqual([{ table: 'contract_documents', column: 'object_key' }]);
    expect(JSON.stringify(listing.skipped)).not.toContain(TENANT_B);
    const tenantBBefore = await tenantBSnapshot();
    expect(tenantBBefore.engineers.map((e) => e.contact_email)).toContain(TENANT_B_CONTACT_EMAIL);

    worker = createBullMqWorker({
      queueName: TENANT_PURGE_JOB,
      connection: { url: redis.url },
      handler: purgeHandler(jstNoon('2026-10-03')),
    });
    // 🔴 ジョブを 2 日止めたことにして 10/03 に走らせる（日付一致ではなく「期限を過ぎ、かつ未処理」）。
    const outcomes = await scan(jstNoon('2026-10-03'), 'development', (job) => purgeQueue.enqueue(job));
    expect(outcomes.get(TENANT_A)).toMatchObject({ kind: 'ENQUEUED', outcome: 'ENQUEUED' });

    let state = (await tenantState()).lifecycle_state;
    for (let attempt = 0; attempt < 200 && state !== 'PURGED'; attempt += 1) {
      await delay(100);
      state = (await tenantState()).lifecycle_state;
    }
    expect(state, 'tenant.purge の Worker がジョブを消費していない').toBe('PURGED');
    let jobState = await purgeQueue.jobState({ tenantId: TENANT_A });
    for (let attempt = 0; attempt < 50 && jobState !== null; attempt += 1) {
      await delay(100);
      jobState = await purgeQueue.jobState({ tenantId: TENANT_A });
    }
    expect(jobState).toBeNull(); // removeOnComplete: true

    // AC-2: S3 の DeleteObject がオブジェクト数と一致。
    expect([...store.deletedKeys()].sort()).toEqual(expectedKeys);
    expect(store.keys().filter((key) => key.startsWith(`t/${TENANT_A}/`))).toEqual([]);
    // 🔴 `proposal_events.attachment_key`（`skill_sheets.id`）を DeleteObject に渡していない（モックは実装と同じキー検査を持つので、
    //    渡していれば Worker が `OBJECT_DELETE:ObjectKeyOutOfTenantScopeError` で落ちて `PURGED` に到達しない）。
    expect(store.deletedKeys()).not.toContain(HOST_SHEET_ID);
    // 🔴 中-3: 消したキーは全件がテナント A のプレフィックス。テナント B の S3 実体は残る。
    expect(store.deletedKeys().every((key) => key.startsWith(`t/${TENANT_A}/`))).toBe(true);
    expect(store.keys()).toContain(TENANT_B_SHEET_KEY);
    expect(store.readBody(TENANT_B_SHEET_KEY)).toEqual(new Uint8Array([7, 8, 9]));
    // 🔴 S3 側の二重防御: テナント A の行が指していた B のプレフィックスのオブジェクトは **消えていない**（`DeleteObject` 未発行）。
    //    一方、DB の列（`contract_documents.object_key`）は 3 版とも NULL 化されている（列の消去は S3 の可否と独立に届く）。
    expect(store.deletedKeys()).not.toContain(CONTRACT_DOC_KEY_FOREIGN);
    expect(store.readBody(CONTRACT_DOC_KEY_FOREIGN)).toEqual(new Uint8Array([12]));
    expect(store.readBody(CONTRACT_DOC_KEY_P1_V1)).toBeNull();
    expect(store.readBody(CONTRACT_DOC_KEY_P1_V2)).toBeNull();
    const contractDocs = await admin.$queryRaw<{ object_key: string | null }[]>`
      SELECT object_key FROM contract_documents WHERE tenant_id = ${TENANT_A}::uuid`;
    expect(contractDocs).toHaveLength(3);
    expect(contractDocs.every((row) => row.object_key === null)).toBe(true);
    expect(await tenantBSnapshot()).toEqual(tenantBBefore);
  });
});

describe('AC-2 / AC-3 / AC-8 ④⑤⑦ PURGED 後の状態', () => {
  it('🔴 連絡先・原本のキー・チャット本文・経歴・利用者のメールが消え、取引先所有の行にも届いている', async () => {
    const pii = await piiSnapshot();
    expect(pii.engineers.every((e) => e.contact_email === null && e.display_name === '' && e.pii_purged_at !== null)).toBe(true);
    expect(pii.sheets.every((s) => s.object_key === null && s.purged_at !== null)).toBe(true);
    expect(pii.messages.every((m) => m.body === null && m.purged_at !== null)).toBe(true);
    expect(pii.careers).toBe(0);
    expect(pii.users.every((u) => u.email === `purged:${u.id}` && u.display_name === '')).toBe(true);
    expect(pii.snapshots.every((s) => s.display_name === '' && JSON.stringify(s.careers) === '[]')).toBe(true);
    const row = await admin.dataExportRequest.findFirstOrThrow({ where: { tenantId: TENANT_A } });
    expect(row.objectKey).toBeNull();
    // 🔴 `proposal_events.attachment_key`（Phase 1 は `skill_sheets.id`）は列として NULL 化されている（S3 は `skill_sheets` 側で消した）。
    const attachmentKeys = await proposalEventAttachmentKeys();
    expect(attachmentKeys.length).toBeGreaterThan(0);
    expect(attachmentKeys.every((key) => key === null)).toBe(true);
    // 再実行は 0 件（冪等）。
    const pending = await countPurgePending(jobCtx(TENANT_A, 'pending'), jstNoon('2026-10-04'));
    expect(Object.values(pending).every((count) => count === 0)).toBe(true);
  });

  it('🔴 中-3: 他テナント（B = ACTIVE）の行・S3 実体は 1 件も消えていない（RLS + WHERE tenant_id + S3 プレフィックス）', async () => {
    const b = await tenantBSnapshot();
    expect(b.engineers).toHaveLength(1);
    expect(b.engineers[0]).toMatchObject({ id: ENGINEER_B_HOST, contact_email: TENANT_B_CONTACT_EMAIL, display_name: TENANT_B_ENGINEER_NAME, pii_purged_at: null });
    expect(b.sheets).toEqual([{ id: TENANT_B_SHEET_ID, object_key: TENANT_B_SHEET_KEY, purged_at: null }]);
    expect(b.users.every((u) => u.email !== `purged:${u.id}` && u.display_name !== '')).toBe(true);
    expect(b.runs).toBe(0);
    expect(store.keys()).toContain(TENANT_B_SHEET_KEY);
    expect(store.deletedKeys().every((key) => key.startsWith(`t/${TENANT_A}/`))).toBe(true);
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_B } })).lifecycleState).toBe('ACTIVE');
  });

  it('🔴 削除後に原本へ到達できる経路が無い: #20 のサービスは 404、#78 は 410', async () => {
    const ctxAfter = await resolveTenantCtx(
      { tenantId: TENANT_A, lifecycleState: 'PURGED', partnerSuspendedAt: null, twoFactor: 'VERIFIED', partnerCompanyId: null, userId: USER_A_HOST, role: 'OWNER' },
      DEVICE,
    );
    await expect(
      issueSkillSheetDownloadUrl(ctxAfter, HOST_SHEET_ID, { objectStore: store }, { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ httpStatus: 404 });
    const exportRow = await admin.dataExportRequest.findFirstOrThrow({ where: { tenantId: TENANT_A } });
    await admin.dataExportRequest.update({ where: { id: exportRow.id }, data: { status: 'READY', expiresAt: new Date('2099-01-01T00:00:00.000Z') } });
    expect((await getDownloadUrl(ctxAfter, exportRow.id)).status).toBe(410);
    // 署名 URL の発行（監査）が増えていない。
    expect(await auditRows('data_export.download')).toHaveLength(1);
    expect(await auditRows('skill_sheet.download')).toHaveLength(0);
  });

  it('AC-3: TenantPurgeRun は COMPLETED 1 件で、counts のキー集合 = PURGE_SPEC.delete の表。AC-8: AuditLog(tenant.purge) は件数と種別だけ', async () => {
    const runs = await purgeRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('COMPLETED');
    expect(runs[0]?.cause).toBe('TENANT_PURGED');
    const counts = runs[0]?.counts as Record<string, number>;
    expect(Object.keys(counts).sort()).toEqual(PURGE_SPEC.delete.map((spec) => spec.table).sort());
    expect(counts.engineers).toBe(3);
    expect(counts.skill_sheets).toBe(2);
    expect(counts.engineer_careers).toBe(2);
    expect(counts.messages).toBe(2);

    const audits = await auditRows('tenant.purge');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorKind).toBe('SYSTEM');
    const summary = JSON.stringify(audits[0]?.summary);
    expect(summary).toContain('"count_engineers":3');
    expect(summary).not.toContain(HOST_CONTACT_EMAIL);
    expect(summary).not.toContain(PARTNER_ENGINEER_NAME);
    expect(summary).not.toContain('t/');
  });
});

describe('AC-4 ⑥ PURGED は終端', () => {
  it('遷移表に PURGED → ACTIVE / CLOSING が無く、再実行は InvalidStateTransitionError。母集団 CLOSING からも外れる', async () => {
    expect(tenantMachine.canTransition('PURGED', 'ACTIVE')).toBe(false);
    expect(tenantMachine.canTransition('PURGED', 'CLOSING')).toBe(false);
    expect(tenantMachine.isTerminal('PURGED')).toBe(true);
    // 🔴 `@ses/db`（dist）が投げるのは `@ses/domain`（dist）の型。ソース側のクラスとは別の実体なので名前で判定する。
    await expect(completeTenantPurge(jobCtx(TENANT_A, 'again'))).rejects.toMatchObject({
      name: 'InvalidStateTransitionError',
      entity: 'Tenant',
      from: 'PURGED',
      to: 'PURGED',
    });
    const outcomes = await scan(jstNoon('2026-10-10'), 'development', async () => 'ENQUEUED');
    expect(outcomes.has(TENANT_A)).toBe(false);
    // 直接呼んでも NOT_CLOSING で何もしない。
    expect(await purgeHandler(jstNoon('2026-10-10'))({ tenantId: TENANT_A }, 'direct')).toEqual({ kind: 'NOOP', reason: 'NOT_CLOSING' });
  });

  it('🔴 app_complete_tenant_purge() は RUNNING の TenantPurgeRun と app.purge_scope が無ければ例外（状態だけ PURGED にできない）', async () => {
    const tenantDb = createUnextendedClient(database.tenantUrl);
    try {
      await expect(
        tenantDb.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true), set_config('app.partner_company_id', '', true), set_config('app.actor_user_id', '', true)`;
          return tx.$queryRaw`SELECT app_complete_tenant_purge()`;
        }),
      ).rejects.toThrow(/purge_scope/);
      await expect(
        tenantDb.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true), set_config('app.partner_company_id', '', true), set_config('app.actor_user_id', '', true), set_config('app.purge_scope', 'on', true)`;
          return tx.$queryRaw`SELECT app_complete_tenant_purge()`;
        }),
      ).rejects.toThrow(/TenantPurgeRun/);
      expect((await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_B } })).lifecycleState).toBe('ACTIVE');
    } finally {
      await tenantDb.$disconnect();
    }
  });
});

describe('AC-7 ⑧ 運営者の DB ロールは返却データに到達できない / ⑨ 削除スコープのポリシーが PURGE_SPEC.delete と 1 対 1', () => {
  it('app_platform は data_export_requests.object_key を SELECT できず、app_platform_write は書けない', async () => {
    const rows = await admin.$queryRaw<{ read_key: boolean; write: boolean; read_status: boolean }[]>`
      SELECT has_column_privilege('app_platform', 'data_export_requests', 'object_key', 'SELECT') AS read_key,
             has_table_privilege('app_platform_write', 'data_export_requests', 'INSERT, UPDATE, DELETE') AS write,
             has_column_privilege('app_platform', 'data_export_requests', 'status', 'SELECT') AS read_status`;
    expect(rows[0]).toEqual({ read_key: false, write: false, read_status: true });
  });

  it('pg_policy: {table}_purge_scope_select / _update が PURGE_SPEC.delete の各表にあり、_delete は engineer_careers だけ', async () => {
    const rows = await admin.$queryRaw<{ tablename: string; policyname: string }[]>`
      SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%_purge_scope_%'`;
    const tables = PURGE_SPEC.delete.map((spec) => spec.table).sort();
    expect(rows.filter((r) => r.policyname.endsWith('_purge_scope_select')).map((r) => r.tablename).sort()).toEqual(tables);
    expect(rows.filter((r) => r.policyname.endsWith('_purge_scope_update')).map((r) => r.tablename).sort()).toEqual(tables);
    expect(rows.filter((r) => r.policyname.endsWith('_purge_scope_delete')).map((r) => r.tablename)).toEqual(['engineer_careers']);
  });
});
