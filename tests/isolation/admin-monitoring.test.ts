// tests/isolation/admin-monitoring.test.ts
// API-A8 `GET /api/admin/monitoring`（`A-005` 運用監視。docs/02 `F-059 AC-1`〜`AC-4` / `AC-7` / docs/05 §6.9 / §16.5 / §9.9 /
// `CLAUDE.md` §4.2「失敗と保留を混同しない」/ §10.5）。T-11-04。
//
// 🔴 実 DB（RLS 付き）+ 実 Redis（BullMQ の failed セット）で、**各事象を作ると当該項目に現れる**ことを実測する
//    （`admin-gate-stalls.test.ts` の作法。Route Handler を実物で呼ぶ）:
//   ① `SUBMITTING` の滞留（`AC-1`）: 閾値超過は載り、閾値未満は載らない
//   ② 未対応の `SUBMIT_FAILED`（`AC-2`）: `LOST` / `GATE_FAILED` / `DECLINED`（提案依頼）と混ざらない
//   ③ ウイルススキャン失敗（隔離状態ごと）+ `SCANNING` 滞留
//   ④ 計測欠測（`AC-4`）
//   ⑤ 送信ドメイン未検証（`AC-5`。T-11-06 の材料を写す）
//   ⑥ `GATE_RUNNING` の 3 区分（`AC-6`。保留 / 実 BullMQ の failed / 応答不明）
//   ⑦ 🔴 項目 13（`AC-7`）: 80% / 100%（`MAIL_PROVIDER_DAILY_QUOTA` を注入）で `consumptionRate` / `nearingSince` / `reachedAt` /
//      `heldCount`、`getQuota()` の失敗で `available: false`（0 で埋めない）、`tenantId` を持たない
//   ⑧ 項目 14: `PROVIDER_QUOTA` は `ENVIRONMENT` で `tenantId` を持たず、`RATE_LIMIT` は `TENANT`
//   ⑨ 項目 15 / 16 / 7 / スケジューラ
//   ⑩ 🔴 非加算: 保留（項目 12 の HELD / 13 / 14 / 15）が項目 1 / 3 / 5 のどれにも足されない
//   ⑪ 🔴 応答に本文・件名・氏名・宛先・DKIM トークン・MAIL FROM・payload が 1 バイトも現れない（fixture に仕込んで JSON 不在）
//   ⑫ `PLATFORM_SUPPORT` でも読める
//   ⑬ 🔴 独立性: 1 項目の材料が throw しても他の項目が返る（Redis 不通 → 項目 3 は `ok: false`、項目 12 は `failedJobsAvailable: false`）
//   ⑭ 読み取りが `admin.monitoring.view` に材料ごとに記録され、書き込みは監査行以外に無い
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { InMemoryProviderQuotaNearingMarker, type ProviderQuota } from '@ses/connectors';
import {
  createBullMqFailedJobsReader,
  createBullMqGateRunQueue,
  createBullMqGateRunWorker,
  type BullMqFailedJobsReader,
  type BullMqGateRunQueue,
} from '@ses/connectors/bullmq';
import type { MonitoringRuntime } from '../../apps/web/lib/admin-monitoring/runtime';
import type { MonitoringItemView, MonitoringKind, MonitoringSnapshotView } from '../../apps/web/lib/admin-monitoring/view';
import { buildMonitoringSnapshot } from '../../apps/web/lib/admin-monitoring/snapshot';
import {
  CONTRACT_A_P1,
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_B_HOST,
  PARTNER_A1,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P2,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

const OWNER_USER_ID = '01930000-0000-7000-8000-0000000000ca';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-0000000000cb';
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.44' } as const;

/** 🔴 fixture に仕込む、応答に 1 バイトも現れてはならない値。 */
const FORBIDDEN = {
  subject: 'SUBJECT-T1104-社外秘の件名',
  body: 'BODY-T1104-山田太郎（090-1234-5678）を提案します',
  recipientEmail: 'client-t1104@example.test',
  recipientCompanyName: 'Client T1104 Co',
  engineerName: 'Engineer A-Host',
  dkimToken: 'dkim-token-t1104-secret-value',
  mailFromDomain: 'mail.t1104.example.jp',
  lastFailureReason: 'DKIM_NOT_FOUND-T1104',
  dispatchRecipient: 'owner-t1104@example.test',
  purgeFailureReason: 'purge failed: table engineers locked (T1104)',
  skillSheetObjectKey: 'tenants/a/skill-sheets/t1104-object-key',
  skillSheetNote: 'NOTE-T1104-山田太郎の職務経歴',
} as const;

// 追加する行の ID（fixtures と衝突しない範囲）。
const PROPOSAL_FAILED_1 = '01930000-0000-7000-8000-000000001201';
const PROPOSAL_FAILED_2 = '01930000-0000-7000-8000-000000001202';
const PROPOSAL_LOST = '01930000-0000-7000-8000-000000001203';
const PROPOSAL_GATE_FAILED = '01930000-0000-7000-8000-000000001204';
const PROPOSAL_SUBMITTING_STALLED = '01930000-0000-7000-8000-000000001205';
const PROPOSAL_SUBMITTING_FRESH = '01930000-0000-7000-8000-000000001206';
const PROPOSAL_HOLD_PROVIDER_A = '01930000-0000-7000-8000-000000001207';
const PROPOSAL_HOLD_RATE_A = '01930000-0000-7000-8000-000000001208';
const PROPOSAL_REQUEST_DECLINED = '01930000-0000-7000-8000-000000001209';
const SKILL_SHEET_FAILED = '01930000-0000-7000-8000-000000001211';
const SKILL_SHEET_INFECTED = '01930000-0000-7000-8000-000000001212';
const SKILL_SHEET_SCANNING_STALLED = '01930000-0000-7000-8000-000000001213';
const SKILL_SHEET_CLEAN = '01930000-0000-7000-8000-000000001214';
const FINDING_GAP = '01930000-0000-7000-8000-000000001221';
const PURGE_RUN_B_FAILED = '01930000-0000-7000-8000-000000001231';
const PURGE_RUN_A_FAILED = '01930000-0000-7000-8000-000000001232';
const PURGE_RUN_A_COMPLETED = '01930000-0000-7000-8000-000000001233';
const DOMAIN_B = '01930000-0000-7000-8000-000000001241';
const TENANT_CLOSING_PENDING = '01930000-0000-7000-8000-0000000000c3';
const TENANT_CLOSING_UNDELIVERED = '01930000-0000-7000-8000-0000000000c4';
const TENANT_CLOSING_SENT = '01930000-0000-7000-8000-0000000000c5';
const TENANT_CLOSING_RECENT = '01930000-0000-7000-8000-0000000000c6';
const PROJECT_B = '01930000-0000-7000-8000-000000001261';
const PROPOSAL_B_HOLD = '01930000-0000-7000-8000-000000001262';
const GATE_RUN_CONTENT_HASH = 'hash-t1104-job-failed';

const THRESHOLDS = {
  submittingStallMinutes: 30,
  gateStallMinutes: 30,
  mailDispatchStuckMinutes: 15,
  scanStallMinutes: 10,
  purgeGraceDays: 30,
  schedulerStaleHours: 24,
  gateFailRateWindowHours: 24,
  gateFailRateBaselineDays: 7,
} as const;

/** 🔴 `MAIL_PROVIDER_DAILY_QUOTA` の注入値（`F-059 AC-7` ①）。 */
const MAIL_ENV_LIMIT = 10;

/** テスト中に差し替える送信基盤の口（`bootstrap` のモックが返す）。 */
const mailProvider = {
  quota: { max24h: 50_000, sentLast24h: 3, observedAt: new Date() } as ProviderQuota | null,
  localSent24h: 2,
  marker: new InMemoryProviderQuotaNearingMarker(),
};
let failedJobsReader: BullMqFailedJobsReader;
let failedJobsShouldFail = false;

function runtime(): MonitoringRuntime {
  return {
    thresholds: THRESHOLDS,
    providerSpend: { capUsd: 500, warnPercent: 80 },
    mailProvider: {
      envLimit: MAIL_ENV_LIMIT,
      warnRatio: 0.8,
      readQuota: async () => {
        if (mailProvider.quota === null) throw new Error('GetAccount failed (test)');
        return mailProvider.quota;
      },
      readLocalSent24h: async () => mailProvider.localSent24h,
      observeNearing: (nearing, now) => mailProvider.marker.observe(nearing, now),
    },
    failedJobs: {
      list: () => {
        if (failedJobsShouldFail) return Promise.reject(new Error('ECONNREFUSED (test)'));
        return failedJobsReader.list();
      },
    },
  };
}

/** 🔴 差し替えるのは「セッション → ctx」と「起動時 DI」の 2 点だけ（`admin-audit-logs.test.ts` と同じ手口）。 */
const requirePlatformCtxMock = vi.fn<() => Promise<AuthenticatedPlatformCtx>>();
vi.mock('../../apps/web/lib/auth/platform-session', () => ({
  requirePlatformCtx: () => requirePlatformCtxMock(),
  readPlatformRequestMeta: async () => META,
}));
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: async () => {
    throw new Error('管理平面のルートが主平面の requireTenantCtx を呼んだ');
  },
  readRequestMeta: async () => META,
}));
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  monitoringRuntime: () => runtime(),
}));
const monitoringRoute = await import('../../apps/web/app/api/admin/monitoring/route');
const { createMonitoringReaders } = await import('../../apps/web/app/api/admin/monitoring/_lib/readers');

let database: IsolationDatabase;
let redis: IsolationRedis;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let superuser: UnextendedClient;
let gateQueue: BullMqGateRunQueue;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * MINUTE);
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY);

/** UUID v7（`email_dispatches.id` の時刻 = 行の作成時刻。`packages/db` の `uuidV7` は export されないためテスト内で組む）。 */
function uuidV7At(at: Date, suffix: string): string {
  const ms = at.getTime().toString(16).padStart(12, '0');
  const rand = suffix.padStart(12, '0').slice(-12);
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7000-8000-${rand}`;
}

async function countRows(sql: TemplateStringsArray, ...values: unknown[]): Promise<number> {
  const rows = await superuser.$queryRaw<Array<{ count: bigint }>>(sql, ...values);
  return Number(rows[0]?.count ?? 0);
}

async function insertProposal(id: string, state: string, updatedAt: Date, extra: { approvedAt?: Date | null; holdReason?: string; holdSince?: Date } = {}) {
  await superuser.$executeRaw`
    INSERT INTO proposals (id, tenant_id, owner_partner_company_id, project_id, engineer_id, state, content_hash, approved_at,
                           subject, body, recipient_company_name, recipient_email, offered_unit_price,
                           send_hold_reason_key, send_hold_since, created_by, created_at, updated_at)
    VALUES (${id}::uuid, ${TENANT_A}::uuid, NULL, ${PROJECT_A_PUBLISHED}::uuid, ${ENGINEER_A_HOST}::uuid, ${state}, ${`hash-${id}`},
            ${extra.approvedAt ?? null}, ${FORBIDDEN.subject}, ${FORBIDDEN.body}, ${FORBIDDEN.recipientCompanyName}, ${FORBIDDEN.recipientEmail}, 650000,
            ${extra.holdReason ?? null}, ${extra.holdSince ?? null}, ${USER_A_HOST}::uuid, ${updatedAt}, ${updatedAt})`;
}

async function insertReviewGate(tenantId: string, targetId: string, verdict: 'PASS' | 'FAIL', executedAt: Date) {
  await superuser.$executeRaw`
    INSERT INTO review_gates (id, tenant_id, owner_partner_company_id, target_type, target_id, content_hash, execution,
                              pii_verdict, commerce_verdict, consistency_verdict, findings, ai_warnings, executed_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, NULL, 'PROPOSAL', ${targetId}::uuid, ${`hash-gate-${targetId}-${executedAt.getTime()}`}, 'DONE',
            ${verdict}, 'PASS', 'PASS', '[{"excerpt":"EXCERPT-T1104-山田太郎"}]'::jsonb, '[]'::jsonb, ${executedAt})`;
}

async function insertSkillSheet(id: string, scanStatus: string, uploadedAt: Date, scanUpdatedAt: Date | null) {
  await superuser.$executeRaw`
    INSERT INTO skill_sheets (id, tenant_id, owner_partner_company_id, engineer_id, version, object_key, content_type, byte_size,
                              scan_status, scan_updated_at, note, uploaded_by, uploaded_at)
    VALUES (${id}::uuid, ${TENANT_A}::uuid, NULL, ${ENGINEER_A_HOST}::uuid, ${Number.parseInt(id.slice(-2), 16)}, ${`${FORBIDDEN.skillSheetObjectKey}/${id}`},
            'application/pdf', 1024, ${scanStatus}, ${scanUpdatedAt}, ${FORBIDDEN.skillSheetNote}, ${USER_A_HOST}::uuid, ${uploadedAt})`;
}

async function insertClosingTenant(id: string, name: string, closingEnteredAt: Date) {
  await superuser.$executeRaw`
    INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, closing_entered_at, provisioning_request_id)
    VALUES (${id}::uuid, ${name}, 'production', 'CLOSING', ${closingEnteredAt}, ${closingEnteredAt}, ${`t1104-${id}`})`;
}

async function insertDispatch(input: {
  readonly id: string;
  readonly tenantId: string | null;
  readonly templateKey: string;
  readonly status: string;
  readonly heldAt?: Date | null;
}) {
  await superuser.$executeRaw`
    INSERT INTO email_dispatches (id, tenant_id, recipient_class, recipient_email, template_key, dedupe_key, status, held_at)
    VALUES (${input.id}::uuid, ${input.tenantId}::uuid, 'HOST_MEMBER', ${FORBIDDEN.dispatchRecipient}, ${input.templateKey},
            ${`${input.templateKey}:${input.id}`}, ${input.status}, ${input.heldAt ?? null})`;
}

async function get(): Promise<Response> {
  return monitoringRoute.GET();
}

async function snapshot(): Promise<MonitoringSnapshotView> {
  const response = await get();
  expect(response.status).toBe(200);
  return (await response.json()) as MonitoringSnapshotView;
}

function itemOf<K extends MonitoringKind>(view: MonitoringSnapshotView, kind: K): MonitoringItemView<K> {
  const item = view.items.find((entry) => entry.kind === kind);
  if (item === undefined) throw new Error(`${kind} が応答に無い`);
  return item as MonitoringItemView<K>;
}

function okOf<K extends MonitoringKind>(view: MonitoringSnapshotView, kind: K): Extract<MonitoringItemView<K>, { ok: true }> {
  const item = itemOf(view, kind);
  if (!item.ok) throw new Error(`${kind} が ok: false（${item.errorKind}）`);
  return item as Extract<MonitoringItemView<K>, { ok: true }>;
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  redis = await startIsolationRedis();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  gateQueue = createBullMqGateRunQueue({ url: redis.url });
  failedJobsReader = createBullMqFailedJobsReader({ url: redis.url });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  requirePlatformCtxMock.mockImplementation(async () => ownerCtx);

  // --- ② 項目 1: SUBMIT_FAILED × 2、LOST / GATE_FAILED / DECLINED（提案依頼）は混ぜない ---
  await insertProposal(PROPOSAL_FAILED_1, 'SUBMIT_FAILED', minutesAgo(120), { approvedAt: minutesAgo(130) });
  await insertProposal(PROPOSAL_FAILED_2, 'SUBMIT_FAILED', minutesAgo(50), { approvedAt: minutesAgo(60) });
  await insertProposal(PROPOSAL_LOST, 'LOST', minutesAgo(200), { approvedAt: minutesAgo(300) });
  await insertProposal(PROPOSAL_GATE_FAILED, 'GATE_FAILED', minutesAgo(40));
  await superuser.$executeRaw`
    INSERT INTO proposal_requests (id, tenant_id, project_id, engineer_id, partner_company_id, state, message, expires_at, issued_by, decline_reason, responded_at)
    VALUES (${PROPOSAL_REQUEST_DECLINED}::uuid, ${TENANT_A}::uuid, ${PROJECT_A_PUBLISHED}::uuid, ${ENGINEER_A_PARTNER}::uuid, ${PARTNER_A1}::uuid, 'DECLINED',
            'MESSAGE-T1104', now() + interval '7 days', ${USER_A_HOST}::uuid, 'DECLINE-T1104', now())`;

  // --- ① 項目 2: SUBMITTING の滞留（45 分）と閾値未満（5 分） ---
  await insertProposal(PROPOSAL_SUBMITTING_STALLED, 'SUBMITTING', minutesAgo(45), { approvedAt: minutesAgo(46) });
  await insertProposal(PROPOSAL_SUBMITTING_FRESH, 'SUBMITTING', minutesAgo(5), { approvedAt: minutesAgo(6) });

  // --- ⑧ 項目 14: PROVIDER_QUOTA（A / B）と RATE_LIMIT（A）。契約書（A）は DOMAIN_UNVERIFIED ---
  await insertProposal(PROPOSAL_HOLD_PROVIDER_A, 'APPROVED', minutesAgo(20), {
    approvedAt: minutesAgo(25),
    holdReason: 'PROVIDER_QUOTA',
    holdSince: minutesAgo(20),
  });
  await insertProposal(PROPOSAL_HOLD_RATE_A, 'APPROVED', minutesAgo(15), {
    approvedAt: minutesAgo(16),
    holdReason: 'RATE_LIMIT',
    holdSince: minutesAgo(15),
  });
  // テナント B の提案（fixtures のテナント B は提案を持たない）。PROVIDER_QUOTA で保留中。
  await superuser.$executeRaw`
    INSERT INTO projects (id, tenant_id, name, end_client_name, internal_unit_price, public_summary, status)
    VALUES (${PROJECT_B}::uuid, ${TENANT_B}::uuid, 'Project B T1104', 'End Client B-Secret', 950000, '公開用', 'OPEN')`;
  await superuser.$executeRaw`
    INSERT INTO proposals (id, tenant_id, owner_partner_company_id, project_id, engineer_id, state, content_hash, approved_at,
                           recipient_company_name, recipient_email, send_hold_reason_key, send_hold_since, created_by, created_at, updated_at)
    VALUES (${PROPOSAL_B_HOLD}::uuid, ${TENANT_B}::uuid, NULL, ${PROJECT_B}::uuid, ${ENGINEER_B_HOST}::uuid, 'APPROVED', 'hash-b-hold',
            ${minutesAgo(95)}, ${FORBIDDEN.recipientCompanyName}, ${FORBIDDEN.recipientEmail}, 'PROVIDER_QUOTA', ${minutesAgo(90)}, ${USER_B_HOST}::uuid,
            ${minutesAgo(100)}, ${minutesAgo(90)})`;
  await superuser.$executeRaw`
    UPDATE contracts SET send_hold_reason_key = 'DOMAIN_UNVERIFIED', send_hold_since = ${minutesAgo(10)} WHERE id = ${CONTRACT_A_P1}::uuid`;

  // --- ⑥ 項目 12: 保留（PROPOSAL_A_HOST）/ 失敗（PROPOSAL_A_P1。実 BullMQ）/ 応答不明（PROPOSAL_A_P2。45 分） ---
  for (const [id, updatedAt] of [
    [PROPOSAL_A_HOST, minutesAgo(90)],
    [PROPOSAL_A_P1, minutesAgo(60)],
    [PROPOSAL_A_P2, minutesAgo(45)],
  ] as const) {
    await superuser.$executeRaw`
      UPDATE proposals SET state = 'GATE_RUNNING', content_hash = ${`hash-${id}`}, updated_at = ${updatedAt},
                           subject = ${FORBIDDEN.subject}, body = ${FORBIDDEN.body}, recipient_email = ${FORBIDDEN.recipientEmail}
       WHERE id = ${id}::uuid`;
  }
  await holdReviewGate(systemTenantCtx(TENANT_A, { queue: 'gate.run', jobId: 't-11-04-held' }), {
    targetType: 'PROPOSAL',
    targetId: PROPOSAL_A_HOST,
    contentHash: `hash-${PROPOSAL_A_HOST}`,
    consistencyVerdict: 'FAIL',
    findings: [
      { layer: 'CONSISTENCY', kind: 'MUST_REQUIREMENT_MISMATCH', field: 'body', offsetStart: 0, offsetEnd: 10, excerpt: 'EXCERPT-T1104-山田太郎', severity: 'BLOCK' },
    ],
    heldSince: minutesAgo(80),
  });
  // 実 BullMQ: gate.run を積み、必ず失敗するワーカーで failed セットに残す（docs/05 §16.5 項目 12 ②）。
  const key = { targetType: 'PROPOSAL', targetId: PROPOSAL_A_P1, contentHash: GATE_RUN_CONTENT_HASH } as const;
  expect(await gateQueue.enqueue({ tenantId: TENANT_A, ...key })).toBe('ENQUEUED');
  const failing = createBullMqGateRunWorker({
    connection: { url: redis.url },
    handler: async () => {
      throw new Error('gate.run は失敗した（T-11-04: 項目 3 / 12 の JOB_FAILED を作る）');
    },
  });
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      if ((await gateQueue.jobState(key)) === 'failed') break;
      if (Date.now() > deadline) throw new Error('gate.run が failed になりませんでした');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await failing.close();
  }

  // --- ⑩ 項目 5: A は直近 24h に DONE 4（FAIL 3）+ seed の公開ゲート 1（PASS）= 5、B は基準期間のみ DONE 2（FAIL 0）。保留行は数えない ---
  await insertReviewGate(TENANT_A, PROPOSAL_FAILED_1, 'FAIL', minutesAgo(60));
  await insertReviewGate(TENANT_A, PROPOSAL_FAILED_2, 'FAIL', minutesAgo(70));
  await insertReviewGate(TENANT_A, PROPOSAL_LOST, 'FAIL', minutesAgo(80));
  await insertReviewGate(TENANT_A, PROPOSAL_GATE_FAILED, 'PASS', minutesAgo(90));
  await insertReviewGate(TENANT_B, PROPOSAL_B_HOLD, 'PASS', daysAgo(3));
  await insertReviewGate(TENANT_B, PROPOSAL_B_HOLD, 'PASS', daysAgo(4));

  // --- ③ 項目 4: FAILED × 1、INFECTED × 1、CLEAN × 1（数えない）、SCANNING 25 分（滞留） ---
  await insertSkillSheet(SKILL_SHEET_FAILED, 'FAILED', minutesAgo(200), minutesAgo(190));
  await insertSkillSheet(SKILL_SHEET_INFECTED, 'INFECTED', minutesAgo(100), minutesAgo(95));
  await insertSkillSheet(SKILL_SHEET_CLEAN, 'CLEAN', minutesAgo(50), minutesAgo(49));
  await insertSkillSheet(SKILL_SHEET_SCANNING_STALLED, 'SCANNING', minutesAgo(25), null);

  // --- ④ 項目 6: 未解消の GAP_MISSING × 1 ---
  await superuser.$executeRaw`
    INSERT INTO usage_measurement_findings (id, tenant_id, kind, metric, period_kind, period_key, detected_at, last_seen_at)
    VALUES (${FINDING_GAP}::uuid, ${TENANT_A}::uuid, 'GAP_MISSING', 'EMAIL_COUNT', 'DAY', '2026-09-14', ${daysAgo(1)}, ${daysAgo(1)})`;

  // --- ⑨ 項目 7: B の FAILED（未対応）/ A の FAILED → その後 COMPLETED（対応済み） ---
  await superuser.$executeRaw`
    INSERT INTO tenant_purge_runs (id, tenant_id, cause, status, started_at, completed_at, counts, failure_reason) VALUES
      (${PURGE_RUN_B_FAILED}::uuid, ${TENANT_B}::uuid, 'RETENTION', 'FAILED', ${daysAgo(1)}, NULL, '{}'::jsonb, ${FORBIDDEN.purgeFailureReason}),
      (${PURGE_RUN_A_FAILED}::uuid, ${TENANT_A}::uuid, 'RETENTION', 'FAILED', ${daysAgo(3)}, NULL, '{}'::jsonb, ${FORBIDDEN.purgeFailureReason}),
      (${PURGE_RUN_A_COMPLETED}::uuid, ${TENANT_A}::uuid, 'RETENTION', 'COMPLETED', ${daysAgo(2)}, ${daysAgo(2)}, '{"engineerContacts": 3}'::jsonb, NULL)`;

  // --- ⑤ 項目 11: A は未登録、B は PENDING（DKIM トークン等を仕込む） ---
  await superuser.$executeRaw`
    INSERT INTO tenant_sending_domains (id, tenant_id, domain, state, dkim_tokens, mail_from_domain, last_failure_reason, last_checked_at, created_at)
    VALUES (${DOMAIN_B}::uuid, ${TENANT_B}::uuid, 't1104.example.jp', 'PENDING', ${JSON.stringify([FORBIDDEN.dkimToken])}::jsonb,
            ${FORBIDDEN.mailFromDomain}, ${FORBIDDEN.lastFailureReason}, ${daysAgo(1)}, ${daysAgo(12)})`;

  // --- ⑨ 項目 15: 期限超過 2 日で予告なし / 期限超過 5 日で FAILED のみ / SENT あり（載らない）/ 期限内（載らない） ---
  await insertClosingTenant(TENANT_CLOSING_PENDING, 'Closing Pending', daysAgo(32));
  await insertClosingTenant(TENANT_CLOSING_UNDELIVERED, 'Closing Undelivered', daysAgo(35));
  await insertClosingTenant(TENANT_CLOSING_SENT, 'Closing Sent', daysAgo(40));
  await insertClosingTenant(TENANT_CLOSING_RECENT, 'Closing Recent', daysAgo(10));
  await insertDispatch({ id: uuidV7At(daysAgo(4), '0000000f01'), tenantId: TENANT_CLOSING_UNDELIVERED, templateKey: 'TENANT_CLOSING_NOTICE', status: 'FAILED' });
  await insertDispatch({ id: uuidV7At(daysAgo(9), '0000000f02'), tenantId: TENANT_CLOSING_SENT, templateKey: 'TENANT_CLOSING_NOTICE', status: 'SENT' });

  // --- ⑦ 項目 13: HELD_PROVIDER_QUOTA × 2（最古 40 分前） ---
  await insertDispatch({ id: uuidV7At(minutesAgo(40), '0000000f03'), tenantId: TENANT_A, templateKey: 'INVITATION', status: 'HELD_PROVIDER_QUOTA', heldAt: minutesAgo(40) });
  await insertDispatch({ id: uuidV7At(minutesAgo(30), '0000000f04'), tenantId: TENANT_B, templateKey: 'INVITATION', status: 'HELD_PROVIDER_QUOTA', heldAt: minutesAgo(30) });

  // --- ⑨ 項目 16: QUEUED 20 分（滞留）/ QUEUED 1 分（滞留ではない） ---
  await insertDispatch({ id: uuidV7At(minutesAgo(20), '0000000f05'), tenantId: TENANT_A, templateKey: 'SKILL_SHEET_QUARANTINE', status: 'QUEUED' });
  await insertDispatch({ id: uuidV7At(minutesAgo(1), '0000000f06'), tenantId: TENANT_A, templateKey: 'SKILL_SHEET_QUARANTINE', status: 'QUEUED' });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await failedJobsReader?.close();
  await gateQueue?.close();
  await disconnectTenantDb();
  await disconnectPlatformReadDb();
  await superuser?.$disconnect();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('API-A8 の形: 全項目が項目表の順で独立して返る', () => {
  it('items は 15 項目で、observedAt は ISO 8601。cache-control: no-store', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const view = (await response.json()) as MonitoringSnapshotView;
    expect(view.items.map((item) => item.kind)).toEqual([
      'SUBMIT_FAILED_UNATTENDED',
      'SUBMITTING_STALL',
      'FAILED_JOBS',
      'SCAN_FAILED',
      'GATE_FAIL_RATE',
      'USAGE_MEASUREMENT',
      'PURGE_JOB_FAILED',
      'SENDING_DOMAIN_UNVERIFIED',
      'GATE_STALL',
      'MAIL_PROVIDER_QUOTA',
      'SEND_HOLD',
      'PURGE_NOTICE_PENDING',
      'MAIL_DISPATCH_STUCK',
      'PROVIDER_SPEND',
      'SCHEDULER_HEARTBEAT',
    ]);
    expect(Number.isNaN(new Date(view.observedAt).getTime())).toBe(false);
    for (const item of view.items) expect(item.ok, item.kind).toBe(true);
  });

  it('未認証は 401（応答の形を教えない）', async () => {
    const { AuthenticationError } = await import('../../apps/web/lib/api/errors');
    requirePlatformCtxMock.mockRejectedValueOnce(new AuthenticationError());
    const response = await get();
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('items');
  });
});

describe('F-059 AC-1 / AC-2: SUBMITTING の滞留と未対応の SUBMIT_FAILED', () => {
  it('① SUBMITTING は閾値（30 分）超過の 1 件だけが載り、5 分の行は載らない', async () => {
    const item = okOf(await snapshot(), 'SUBMITTING_STALL');
    expect(item.stallThresholdMinutes).toBe(30);
    expect(item.total).toBe(1);
    expect(item.rows).toHaveLength(1);
    expect(item.rows[0]).toMatchObject({ tenantId: TENANT_A, count: 1 });
    expect(item.rows[0]?.longestStalledMinutes).toBeGreaterThanOrEqual(45);
    expect(item.rows[0]?.longestStalledMinutes).toBeLessThan(50);
  });

  it('🔴 ② SUBMIT_FAILED は 2 件だけ。LOST / GATE_FAILED / DECLINED（提案依頼）を混ぜない', async () => {
    const item = okOf(await snapshot(), 'SUBMIT_FAILED_UNATTENDED');
    expect(item.total).toBe(2);
    expect(item.rows).toEqual([{ tenantId: TENANT_A, count: 2, oldestSince: expect.any(String) }]);
    // 対照: LOST / GATE_FAILED / DECLINED は DB に実在する。
    expect(await countRows`SELECT count(*) AS count FROM proposals WHERE state IN ('LOST', 'GATE_FAILED')`).toBe(2);
    expect(await countRows`SELECT count(*) AS count FROM proposal_requests WHERE state = 'DECLINED'`).toBe(1);
  });
});

describe('項目 4 / 6 / 11: スキャン失敗・計測欠測・送信ドメイン未検証（AC-4 / AC-5）', () => {
  it('③ 隔離状態（FAILED / INFECTED）を数え、CLEAN は数えない。SCANNING の滞留は別枠', async () => {
    const item = okOf(await snapshot(), 'SCAN_FAILED');
    expect(item.total).toBe(2);
    expect(item.rows).toEqual([
      {
        tenantId: TENANT_A,
        countsByStatus: { INFECTED: 1, UNSCANNABLE: 0, FAILED: 1 },
        count: 2,
        oldestSince: expect.any(String),
      },
    ]);
    expect(item.scanningStalled.count).toBe(1);
    expect(item.scanStallThresholdMinutes).toBe(10);
  });

  it('④ 計測欠測（GAP_MISSING）が種別・期間付きで載る', async () => {
    const item = okOf(await snapshot(), 'USAGE_MEASUREMENT');
    expect(item.countsByKind).toEqual({ GAP_MISSING: 1, GAP_MISMATCH: 0, STORAGE_DIVERGENCE: 0 });
    expect(item.items).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, kind: 'GAP_MISSING', metric: 'EMAIL_COUNT', periodKind: 'DAY', periodKey: '2026-09-14' }),
    ]);
    expect(Object.keys(item.items[0] ?? {}).sort()).toEqual(['detectedAt', 'kind', 'lastSeenAt', 'metric', 'periodKey', 'periodKind', 'tenantId']);
  });

  it('⑤ 送信ドメイン未検証: A は NOT_REGISTERED、B は PENDING（経過日数付き）。DKIM トークン等は載らない', async () => {
    const item = okOf(await snapshot(), 'SENDING_DOMAIN_UNVERIFIED');
    expect(item.total).toBe(2);
    expect(item.countsByStatus).toEqual({ NOT_REGISTERED: 1, REGISTERED: 0, PENDING: 1, FAILED: 0, REVOKED: 0 });
    const b = item.items.find((row) => row.tenantId === TENANT_B);
    expect(b).toMatchObject({ status: 'PENDING', domain: 't1104.example.jp', lifecycleState: 'ACTIVE', expectedRecords: 3 });
    expect(b?.daysSinceStarted).toBeGreaterThanOrEqual(11);
  });
});

describe('F-059 AC-6: GATE_RUNNING の 3 区分（実 BullMQ の failed セットを照合）', () => {
  it('⑥ 保留 / 失敗 / 応答不明が別の理由で載り、失敗の検知元は BullMQ の failed セット', async () => {
    const item = okOf(await snapshot(), 'GATE_STALL');
    expect(item.failedJobsAvailable).toBe(true);
    expect(item.unclassifiedOverdue).toBe(0);
    expect(item.countsByReason).toEqual({ AI_COST_LIMIT_HELD: 1, JOB_FAILED: 1, RUNNING_OVERDUE: 1 });
    // 並びは since の昇順（保留 80 分前 → 応答不明 45 分前 → 失敗 = ワーカーが失敗した直前）。
    expect(item.rows.map((row) => [row.targetId, row.reason])).toEqual([
      [PROPOSAL_A_HOST, 'AI_COST_LIMIT_HELD'],
      [PROPOSAL_A_P2, 'RUNNING_OVERDUE'],
      [PROPOSAL_A_P1, 'JOB_FAILED'],
    ]);
  });

  it('項目 3: gate.run の failed が 1 件、他のキューは 0 件で「照合した」事実として全キューが載る', async () => {
    const item = okOf(await snapshot(), 'FAILED_JOBS');
    expect(item.total).toBe(1);
    const gateRun = item.byQueue.find((entry) => entry.queueName === 'gate.run');
    expect(gateRun).toMatchObject({ count: 1 });
    expect(gateRun?.lastFailedAt).toEqual(expect.any(String));
    expect(item.byQueue.length).toBeGreaterThan(10);
    expect(item.byQueue.filter((entry) => entry.count > 0)).toHaveLength(1);
  });
});

describe('F-059 AC-7: 項目 13（環境全体の送信枠）', () => {
  it('🔴 ⑦ 80%: consumptionRate 0.8 / nearingSince が立つ / heldCount と reachedAt（MIN(held_at)）/ tenantId を持たない', async () => {
    mailProvider.quota = { max24h: 50_000, sentLast24h: 8, observedAt: new Date() };
    mailProvider.localSent24h = 6;
    const item = okOf(await snapshot(), 'MAIL_PROVIDER_QUOTA');
    expect(item.scope).toBe('ENVIRONMENT');
    expect(item.envLimit).toBe(MAIL_ENV_LIMIT);
    expect(item.providerReading).toMatchObject({ available: true, max24h: 50_000, sentLast24h: 8, consumptionRate: 0.8 });
    expect(item.nearingSince).toEqual(expect.any(String));
    expect(item.heldCount).toBe(2);
    expect(new Date(item.reachedAt ?? '').getTime()).toBeLessThan(Date.now() - 39 * MINUTE);
    expect(JSON.stringify(item)).not.toContain('tenantId');
  });

  it('🔴 ⑦ 100%: consumptionRate 1.0（手元のカウンタが多ければそちらを採る）', async () => {
    mailProvider.quota = { max24h: 50_000, sentLast24h: 7, observedAt: new Date() };
    mailProvider.localSent24h = 10;
    const item = okOf(await snapshot(), 'MAIL_PROVIDER_QUOTA');
    expect(item.providerReading).toMatchObject({ available: true, sentLast24h: 10, consumptionRate: 1 });
    expect(item.nearingSince).toEqual(expect.any(String));
  });

  it('🔴 ⑦ getQuota() の失敗は available: false で、max24h / consumptionRate を 0 で埋めない。項目は ok: true', async () => {
    mailProvider.quota = null;
    mailProvider.localSent24h = 4;
    const item = okOf(await snapshot(), 'MAIL_PROVIDER_QUOTA');
    expect(item.providerReading).toEqual({ available: false, localSentLast24h: 4, lastObservedAt: expect.any(String) });
    expect(JSON.stringify(item.providerReading)).not.toMatch(/max24h|consumptionRate/);
    expect(item.heldCount).toBe(2);
    // 4 / 10 = 40% なので接近ではない → 目印は消える。
    expect(item.nearingSince).toBeNull();
    mailProvider.quota = { max24h: 50_000, sentLast24h: 3, observedAt: new Date() };
    mailProvider.localSent24h = 2;
  });
});

describe('項目 14 / 15 / 16 / 7 / スケジューラ', () => {
  it('🔴 ⑧ 項目 14: PROVIDER_QUOTA は ENVIRONMENT で tenantId を持たず 1 行に畳まれ、RATE_LIMIT は TENANT のテナント行', async () => {
    const item = okOf(await snapshot(), 'SEND_HOLD');
    expect(item.byReason.PROVIDER_QUOTA).toEqual({ scope: 'ENVIRONMENT', proposals: 2, contracts: 0, oldestSince: expect.any(String) });
    expect(JSON.stringify(item.byReason.PROVIDER_QUOTA)).not.toContain('tenantId');
    expect(item.byReason.RATE_LIMIT).toEqual({
      scope: 'TENANT',
      rows: [{ tenantId: TENANT_A, proposals: 1, contracts: 0, oldestSince: expect.any(String) }],
    });
    expect(item.byReason.DOMAIN_UNVERIFIED).toEqual({
      scope: 'TENANT',
      rows: [{ tenantId: TENANT_A, proposals: 0, contracts: 1, oldestSince: expect.any(String) }],
    });
    expect(item.total).toBe(4);
    expect(Object.keys(item.byReason).sort()).toEqual(
      ['AI_COST_LIMIT', 'DOMAIN_UNVERIFIED', 'ESIGN_DISCONNECTED', 'GATE_STALE', 'PROVIDER_QUOTA', 'RATE_LIMIT', 'TENANT_SUSPENDED'].sort(),
    );
  });

  it('⑨ 項目 15: 期限超過のテナントを NOTICE_PENDING / NOTICE_UNDELIVERED に区別し、SENT 済み・期限内は載せない。項目 7 とは別行', async () => {
    const view = await snapshot();
    const item = okOf(view, 'PURGE_NOTICE_PENDING');
    expect(item.graceDays).toBe(30);
    expect(item.rows).toEqual([
      { tenantId: TENANT_CLOSING_UNDELIVERED, cause: 'NOTICE_UNDELIVERED', overdueDays: 5 },
      { tenantId: TENANT_CLOSING_PENDING, cause: 'NOTICE_PENDING', overdueDays: 2 },
    ]);
    // 項目 7（削除ジョブの失敗）は別の kind で、B の未対応の 1 件だけ（A は後に COMPLETED しているので落ちる）。
    const purge = okOf(view, 'PURGE_JOB_FAILED');
    expect(purge.rows).toEqual([{ tenantId: TENANT_B, cause: 'RETENTION', failedCount: 1, lastFailedAt: expect.any(String) }]);
    expect(purge.total).toBe(1);
    expect(JSON.stringify(purge)).not.toContain(FORBIDDEN.purgeFailureReason);
  });

  it('⑨ 項目 16: QUEUED の滞留は閾値（15 分）超過の 1 件だけ。失敗ジョブ数には加算されない', async () => {
    const view = await snapshot();
    const item = okOf(view, 'MAIL_DISPATCH_STUCK');
    expect(item.count).toBe(1);
    expect(item.stallThresholdMinutes).toBe(15);
    expect(item.countIsLowerBound).toBe(false);
    expect(new Date(item.oldestSince ?? '').getTime()).toBeLessThan(Date.now() - 19 * MINUTE);
    expect(okOf(view, 'FAILED_JOBS').total).toBe(1);
  });

  it('⑨ スケジューラ: seed の実行記録が新しければ稼働中、24h 以上前なら停止', async () => {
    expect(okOf(await snapshot(), 'SCHEDULER_HEARTBEAT')).toMatchObject({ stalled: false, staleHours: 24, lastRunAt: expect.any(String) });
    await superuser.$executeRaw`UPDATE scheduler_runs SET started_at = ${daysAgo(2)}`;
    try {
      expect(okOf(await snapshot(), 'SCHEDULER_HEARTBEAT')).toMatchObject({ stalled: true });
    } finally {
      await superuser.$executeRaw`UPDATE scheduler_runs SET started_at = now()`;
    }
  });

  it('項目 17: 環境全体の当月 AI 支出（BELOW）。tenantId / byRole を持たない', async () => {
    const item = okOf(await snapshot(), 'PROVIDER_SPEND');
    expect(item).toMatchObject({ scope: 'ENVIRONMENT', capUsd: '500.000000', level: 'BELOW', tenantCount: 0 });
    expect(JSON.stringify(item)).not.toMatch(/tenantId|byRole/);
  });
});

describe('🔴 ⑩ 非加算: 保留は項目 1 / 3 / 5 のどれにも足されない（F-059 AC-6 / AC-7 / CLAUDE.md §4.2）', () => {
  it('項目 1 = 2（SUBMIT_FAILED のみ）、項目 3 = 1（gate.run の failed のみ）、項目 5 の分母 = DONE のみ', async () => {
    const view = await snapshot();
    // 保留の事実: 項目 12 HELD 1 / 項目 13 held 2 / 項目 14 = 4 / 項目 15 = 2 / 項目 16 = 1。
    expect(okOf(view, 'GATE_STALL').countsByReason.AI_COST_LIMIT_HELD).toBe(1);
    expect(okOf(view, 'MAIL_PROVIDER_QUOTA').heldCount).toBe(2);
    expect(okOf(view, 'SEND_HOLD').total).toBe(4);
    expect(okOf(view, 'PURGE_NOTICE_PENDING').total).toBe(2);
    expect(okOf(view, 'MAIL_DISPATCH_STUCK').count).toBe(1);
    // 障害の指標はそれぞれの事実だけを数える。
    expect(okOf(view, 'SUBMIT_FAILED_UNATTENDED').total).toBe(2);
    expect(okOf(view, 'FAILED_JOBS').total).toBe(1);
    const rate = okOf(view, 'GATE_FAIL_RATE');
    expect(rate.recent).toEqual({ done: 5, failed: 3, rate: 0.6 });
    expect(rate.baseline).toEqual({ done: 2, failed: 0, rate: 0 });
    expect(rate.rows).toEqual([
      { tenantId: TENANT_A, recent: { done: 5, failed: 3, rate: 0.6 }, baseline: { done: 0, failed: 0, rate: null } },
      { tenantId: TENANT_B, recent: { done: 0, failed: 0, rate: null }, baseline: { done: 2, failed: 0, rate: 0 } },
    ]);
    // 対照: 保留行（HELD_AI_COST_LIMIT）は実在するが分母に入っていない。
    expect(await countRows`SELECT count(*) AS count FROM review_gates WHERE execution = 'HELD_AI_COST_LIMIT'`).toBe(1);
  });
});

describe('🔴 ⑪ BR-40 / F-059 AC-3: 応答に内容が 1 バイトも現れない', () => {
  it('件名・本文・提案先・宛先・氏名・DKIM トークン・MAIL FROM・失敗理由・オブジェクトキー・メモが JSON に無い', async () => {
    const json = JSON.stringify(await snapshot());
    for (const [name, value] of Object.entries(FORBIDDEN)) {
      expect(json, `${name} が応答に現れている`).not.toContain(value);
    }
    expect(json).not.toContain('EXCERPT-T1104');
    expect(json).not.toContain('DECLINE-T1104');
    expect(json).not.toMatch(/"(subject|body|recipientEmail|recipientCompanyName|displayName|dkimTokens|mailFromDomain|lastFailureReason|failureReason|objectKey|note|findings|payload|token)"/);
    // 対照: 仕込んだ値は DB に実在する（検査が空振りでない）。
    const stored = await superuser.$queryRaw<Array<{ subject: string | null; dkim_tokens: unknown; failure_reason: string | null }>>`
      SELECT p.subject, d.dkim_tokens, r.failure_reason
        FROM proposals p, tenant_sending_domains d, tenant_purge_runs r
       WHERE p.id = ${PROPOSAL_FAILED_1}::uuid AND d.id = ${DOMAIN_B}::uuid AND r.id = ${PURGE_RUN_B_FAILED}::uuid`;
    expect(stored[0]?.subject).toBe(FORBIDDEN.subject);
    expect(JSON.stringify(stored[0]?.dkim_tokens)).toContain(FORBIDDEN.dkimToken);
    expect(stored[0]?.failure_reason).toBe(FORBIDDEN.purgeFailureReason);
  });
});

describe('⑫ PLATFORM_SUPPORT / ⑭ 監査', () => {
  it('PLATFORM_SUPPORT の応答は PLATFORM_OWNER と同一（observedAt を除く）', async () => {
    const owner = await snapshot();
    requirePlatformCtxMock.mockImplementation(async () => supportCtx);
    try {
      const support = await snapshot();
      expect(support.items).toEqual(owner.items);
    } finally {
      requirePlatformCtxMock.mockImplementation(async () => ownerCtx);
    }
  });

  it('🔴 1 回の GET で admin.monitoring.view が材料ごと（14 本）に横断で記録され、summary.item で区別できる。書き込みは監査行以外に無い', async () => {
    const before = await countRows`SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    const proposalsBefore = await superuser.$queryRaw<Array<{ id: string; state: string; updated_at: Date }>>`SELECT id, state, updated_at FROM proposals ORDER BY id`;
    const dispatchesBefore = await superuser.$queryRaw<Array<{ id: string; status: string }>>`SELECT id, status FROM email_dispatches ORDER BY id`;

    await snapshot();

    const rows = await superuser.$queryRaw<Array<{ tenant_id: string | null; actor_kind: string; actor_id: string; ip_address: string | null; summary: Record<string, unknown> }>>`
      SELECT tenant_id, actor_kind, actor_id, ip_address, summary FROM audit_logs
       WHERE action = 'admin.monitoring.view' ORDER BY created_at DESC, id DESC LIMIT 14`;
    const after = await countRows`SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    expect(after - before).toBe(14);
    for (const row of rows) {
      expect(row.tenant_id).toBeNull();
      expect(row.actor_kind).toBe('PLATFORM_USER');
      expect(row.actor_id).toBe(OWNER_USER_ID);
      expect(row.ip_address).toBe(META.ipAddress);
      expect(row.summary.platformRole).toBe('PLATFORM_OWNER');
    }
    const items = rows.map((row) => row.summary.item).filter((item): item is string => typeof item === 'string');
    // 本タスクで新設した材料は `summary.item` を持つ（既存 4 材料 = 項目 6 / 11 / 12 / 17 は持たない）。
    expect(items.sort()).toEqual(
      ['GATE_FAIL_RATE', 'MAIL_DISPATCH_STUCK', 'MAIL_PROVIDER_QUOTA', 'PURGE_JOB_FAILED', 'PURGE_NOTICE_PENDING', 'SCAN_FAILED', 'SCHEDULER_HEARTBEAT', 'SEND_HOLD', 'SUBMITTING_STALL', 'SUBMIT_FAILED_UNATTENDED'].sort(),
    );
    expect(await superuser.$queryRaw`SELECT id, state, updated_at FROM proposals ORDER BY id`).toEqual(proposalsBefore);
    expect(await superuser.$queryRaw`SELECT id, status FROM email_dispatches ORDER BY id`).toEqual(dispatchesBefore);
  });
});

describe('🔴 ⑬ 独立性: 1 項目の材料が throw しても他の項目が返る', () => {
  it('Redis（failed セット）を読めない → 項目 3 は ok: false / QUEUE_READ_FAILED、項目 12 は failedJobsAvailable: false で保留だけ残る。他は ok', async () => {
    failedJobsShouldFail = true;
    try {
      const view = await snapshot();
      expect(itemOf(view, 'FAILED_JOBS')).toEqual({ kind: 'FAILED_JOBS', ok: false, errorKind: 'QUEUE_READ_FAILED' });
      const stall = okOf(view, 'GATE_STALL');
      expect(stall.failedJobsAvailable).toBe(false);
      // 🔴 失敗と応答不明を判定できないので RUNNING_OVERDUE に畳まない（2 件は「判定できない」として件数だけ）。
      expect(stall.countsByReason).toEqual({ AI_COST_LIMIT_HELD: 1, JOB_FAILED: 0, RUNNING_OVERDUE: 0 });
      expect(stall.unclassifiedOverdue).toBe(2);
      expect(stall.rows.map((row) => row.reason)).toEqual(['AI_COST_LIMIT_HELD']);
      for (const item of view.items) {
        if (item.kind !== 'FAILED_JOBS') expect(item.ok, item.kind).toBe(true);
      }
    } finally {
      failedJobsShouldFail = false;
    }
  });

  it('DB の材料 1 つが throw しても他の項目は返り、失敗した項目だけが ok: false / DB_READ_FAILED', async () => {
    const readers = createMonitoringReaders(ownerCtx, runtime(), { ipAddress: META.ipAddress, now: new Date() });
    const failures: string[] = [];
    const view = await buildMonitoringSnapshot(
      {
        ...readers,
        SUBMIT_FAILED_UNATTENDED: {
          errorKind: 'DB_READ_FAILED',
          read: async () => {
            throw new Error('connection reset (test)');
          },
        },
      },
      new Date(),
      (kind, errorKind) => failures.push(`${kind}:${errorKind}`),
    );
    expect(itemOf(view, 'SUBMIT_FAILED_UNATTENDED')).toEqual({ kind: 'SUBMIT_FAILED_UNATTENDED', ok: false, errorKind: 'DB_READ_FAILED' });
    expect(failures).toEqual(['SUBMIT_FAILED_UNATTENDED:DB_READ_FAILED']);
    expect(view.items.filter((item) => item.ok)).toHaveLength(14);
    expect(okOf(view, 'SUBMITTING_STALL').total).toBe(1);
  });
});
