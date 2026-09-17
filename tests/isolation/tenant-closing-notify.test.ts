// tests/isolation/tenant-closing-notify.test.ts
// 🔴 T-10-12 の完了判定 = `docs/02` `F-064 AC-10`（削除の実行前に予告が通知される。保留は通知済みではない）の結合テスト
//    （docs/05 §9.7 `tenant.closing-notify` / §8.3-Q / §13.2 / §16.5 項目 15 / §17.3 #24 / `CLAUDE.md` §11.1 分類 1）。
//    **実 DB（RLS 付き）+ 実 SQL 関数（ファンアウトの母集団）+ 実 `email.dispatch` ハンドラ**。実 SES にも実 Redis の
//    Worker にも接続しない（送信系は `packages/connectors/src/mock` = `development` / `demo` / E2E と同一実装、
//    `sandbox` の分類 1 は SES API のスタブ）。
//
// ============================================================================
// 🔴 何を固定するか（t1012-prompt ⑤ の ①〜⑦ + 項目 15 の整合）
// ============================================================================
//   ① `CLOSING` に入ったテナントで `ENTERED` が **1 回だけ**起票され（2 日連続で走らせても 2 件にならない）、`D7` は 23 日後に 1 回だけ
//   ② `ENTERED` の本文に削除予定日（`closing_entered_at + 30 日`）が含まれる（`sandbox` の SES スタブが受けた `TemplateData`）
//   ③ `FAILED` にした翌日に再起票される（`dedupeKey` の暦日が別）
//   ④ 🔴 `readClosingNoticeDelivery`: `QUEUED` / `HELD_PROVIDER_QUOTA` が残る間は `delivered: false`、`SENT` で `true`、
//      `development` では `MOCKED` で `true`、**`sandbox` 相当の `appEnv` では `MOCKED` を `true` にしない**
//   ⑤ `ACTIVE` / `SUSPENDED` / `PURGED` のテナントには起票しない（母集団 `CLOSING` に含まれず、直接呼んでも SKIPPED）
//   ⑥ 宛先が `OWNER` / `ADMIN` のみ（`SALES` / `PARTNER_*` / `VIEWER` に届かない。`recipientHash` の件数で確認）
//   ⑦ モックの `callCount` が宛先数と一致（重複送信 0）
//   ⑧ `A-005` 項目 15: 予告行が入った状態で `classifyPurgeNotice` が `null` / `NOTICE_PENDING` / `NOTICE_UNDELIVERED` を返す
//      （関数は変えない。`readPurgeNoticePending` を `withPlatformRead` で実際に読む）
//
// 🔴 E2E #24（`MAIL_PROVIDER_DAILY_QUOTA=1` で保留 → 解除後に配送 → `delivered`）は本ファイル ④ で代替する
//    （`tenant.purge-scan` / `tenant.purge` の no-op と合わせた E2E は T-10-09）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConnectors,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  type Connectors,
  type ConnectorImplementationKind,
  type SesApi,
  type SesSendEmailRequest,
} from '@ses/connectors';
import {
  configurePlatformReadDb,
  configureTenantDb,
  disconnectPlatformReadDb,
  disconnectTenantDb,
  listSchedulerFanoutTenants,
  readClosingNoticeDelivery,
  requeueHeldEmailDispatch,
  resolvePlatformCtx,
  systemTenantCtx,
  type AuthenticatedPlatformCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { classifyPurgeNotice, readPurgeNoticePending } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
// 🔴 ルートの package.json は `@ses/config` / `@ses/domain` を依存に持たないため、実装のソースを相対 import する。
import { resolveConnectorSelection } from '../../packages/config/src/connector-selection.js';
import { loadAppEnv } from '../../packages/config/src/load-env.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';
import { TENANT_CLOSING_NOTICE_TEMPLATE_KEY } from '../../packages/domain/src/retention/closing-notice.js';
import { createEmailDispatchHandler, type EmailDispatchDeps } from '../../apps/worker/src/jobs/email-dispatch.js';
import { createOperationalMailParamsResolver } from '../../apps/worker/src/jobs/operational-mail-params.js';
import {
  createTenantClosingNotifyHandler,
  TENANT_CLOSING_NOTIFY_JOB,
  TENANT_CLOSING_NOTIFY_POPULATION,
  type TenantClosingNotifyOutcome,
} from '../../apps/worker/src/jobs/tenant-closing-notify.js';
import { fanOutToTenants } from '../../apps/worker/src/runtime.js';
import { TENANT_A, TENANT_B, USER_A_HOST, USER_A_PARTNER } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
// 🔴 T-12-12: 執行点の deps は固定の上限ではなく既定値（`quotaDefaults`）を受け、`resolveTenantQuotas` が実 DB の上書きと合わせて解く。
import { quotaDefaultsWith } from './support/quota-defaults.js';

const SETUP_TIMEOUT_MS = 600_000;
const PURGE_GRACE_DAYS = 30;
const APP_URL = 'https://app.example.test';

/** `CLOSING` に入った時刻。UTC 00:00 = JST 09:00 → 暦日 2026-09-01。削除予定日 = 2026-10-01 / D7 = 2026-09-24。 */
const CLOSING_ENTERED_AT = new Date('2026-09-01T00:00:00.000Z');
const PURGE_SCHEDULED_ON = '2026-10-01';

/** その暦日（JST）の正午に走ったことにする。 */
function jstNoon(dayKey: string): Date {
  return new Date(`${dayKey}T03:00:00.000Z`);
}

/** 追加するテナント（`CLOSING` 以外の状態の対照）。 */
const TENANT_SUSPENDED = '01930000-0000-7000-8000-00000000c0a3';
const TENANT_PURGED = '01930000-0000-7000-8000-00000000c0a5';

/** テナント A に足す利用者（fixtures の `USER_A_HOST` は `SALES`）。 */
const OWNER_USER_ID = '01930000-0000-7000-8000-00000000c101';
const ADMIN_USER_ID = '01930000-0000-7000-8000-00000000c102';
const VIEWER_USER_ID = '01930000-0000-7000-8000-00000000c103';
const OWNER_EMAIL = 'owner-a@closing-notice.test';
const ADMIN_EMAIL = 'admin-a@closing-notice.test';
const VIEWER_EMAIL = 'viewer-a@closing-notice.test';
const PLATFORM_OWNER_ID = '01930000-0000-7000-8000-00000000c1ca';

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続（検証のクエリには使わない）。 */
let admin: UnextendedClient;
let platformCtx: AuthenticatedPlatformCtx;
let mockConnectors: Connectors;
/** `sandbox` の分類 1 が通る SES API のスタブ（外部エンドポイントに出た要求）。 */
let sesSent: SesSendEmailRequest[];
let sandboxEmail: { readonly connectors: Connectors; readonly kind: ConnectorImplementationKind };
let enqueued: { dispatchId: string; tenantId: string | null; recipientClass: string }[];

type DispatchRow = {
  readonly id: string;
  readonly recipient_email: string;
  readonly recipient_class: string;
  readonly status: string;
  readonly dedupe_key: string;
};

async function dispatchRows(tenantId: string = TENANT_A): Promise<DispatchRow[]> {
  return admin.$queryRaw<DispatchRow[]>`
    SELECT id::text AS id, recipient_email, recipient_class, status, dedupe_key
      FROM email_dispatches
     WHERE tenant_id = ${tenantId}::uuid AND template_key = ${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}
     ORDER BY id ASC`;
}

async function setStatus(dispatchId: string, status: string): Promise<void> {
  await admin.$executeRaw`UPDATE email_dispatches SET status = ${status}, failure_reason = NULL, held_at = NULL WHERE id = ${dispatchId}::uuid`;
}

async function insertTenant(id: string, lifecycleState: string, closingEnteredAt: Date | null): Promise<void> {
  await admin.$executeRaw`
    INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, closing_entered_at, provisioning_request_id)
    VALUES (${id}::uuid, ${`Tenant ${lifecycleState}`}, 'production', ${lifecycleState}, now(), ${closingEnteredAt}, ${`t1012-${lifecycleState.toLowerCase()}`})
    ON CONFLICT (id) DO UPDATE SET lifecycle_state = EXCLUDED.lifecycle_state, closing_entered_at = EXCLUDED.closing_entered_at`;
}

async function insertHostUser(userId: string, email: string, role: 'OWNER' | 'ADMIN' | 'VIEWER'): Promise<void> {
  await admin.user.create({
    data: { id: userId, tenantId: TENANT_A, ownerPartnerCompanyId: null, email, displayName: '架空 管理者', passwordHash: 'x'.repeat(60) },
  });
  await admin.membership.create({
    data: { tenantId: TENANT_A, userId, role, partnerCompanyId: null, joinedAt: new Date('2026-08-01T00:00:00.000Z') },
  });
}

function jobCtx(tenantId: string, jobId: string): SystemTenantCtx {
  return systemTenantCtx(tenantId, { queue: TENANT_CLOSING_NOTIFY_JOB, jobId });
}

/** 🔴 本番と同じ配り方: 母集団（SQL 関数）→ 1 テナントずつハンドラ。`now` だけを差し替える。 */
async function runNotify(now: Date): Promise<Map<string, TenantClosingNotifyOutcome>> {
  const handler = createTenantClosingNotifyHandler({
    now: () => now,
    purgeGraceDays: PURGE_GRACE_DAYS,
    enqueueEmailDispatch: async (job) => {
      enqueued.push({ ...job });
    },
  });
  const outcomes = new Map<string, TenantClosingNotifyOutcome>();
  await fanOutToTenants(
    TENANT_CLOSING_NOTIFY_JOB,
    `repeat:${TENANT_CLOSING_NOTIFY_JOB}:${now.getTime()}`,
    async (payload, jobId) => {
      const outcome = await handler(payload, jobId);
      outcomes.set((payload as { tenantId: string }).tenantId, outcome);
      return outcome;
    },
    TENANT_CLOSING_NOTIFY_POPULATION,
  );
  return outcomes;
}

function stubSesApi(): SesApi {
  return {
    async sendEmail(request) {
      sesSent.push(request);
      return { MessageId: `ses-${sesSent.length}` };
    },
    async getAccount() {
      return { SendQuota: { Max24HourSend: 200, SentLast24Hours: 0 } };
    },
  };
}

function dispatchDeps(input: {
  readonly emailSender: Connectors['email'];
  readonly kind: ConnectorImplementationKind;
  readonly now: Date;
  readonly providerDailyQuota?: number;
  readonly providerSentCounter?: InMemoryProviderSendCounter;
}): EmailDispatchDeps {
  return {
    emailSender: input.emailSender,
    emailImplementationKind: input.kind,
    minuteWindow: new InMemoryMinuteWindowCounter(),
    quotaDefaults: quotaDefaultsWith({ emailDailyLimit: 500 }),
    minuteLimit: 30,
    providerDailyQuota: input.providerDailyQuota ?? 200,
    providerSentCounter: input.providerSentCounter ?? new InMemoryProviderSendCounter(),
    // 分類 1 は共通ドメインで送る（独自ドメインが無くても止まらない。docs/05 §8.3）。
    resolveSendingDomain: async () => null,
    now: () => input.now,
    // 🔴 差し込み値は実装（`createOperationalMailParamsResolver`）をそのまま使う。テスト専用の `() => ({})` を渡さない。
    resolveTemplateParams: createOperationalMailParamsResolver({ appUrl: APP_URL, purgeGraceDays: PURGE_GRACE_DAYS }),
  };
}

/** 積まれた `email.dispatch` を 1 件ずつ実行する（BullMQ の配線ではなく同じハンドラを直接呼ぶ）。 */
async function drain(deps: EmailDispatchDeps): Promise<readonly string[]> {
  const handler = createEmailDispatchHandler(deps);
  const jobs = enqueued.splice(0);
  const outcomes: string[] = [];
  for (const job of jobs) {
    outcomes.push((await handler(job, `email-${outcomes.length}`)).kind);
  }
  return outcomes;
}

async function delivery(appEnv: 'development' | 'demo' | 'sandbox' | 'staging' | 'production') {
  return readClosingNoticeDelivery(jobCtx(TENANT_A, 'delivery'), { appEnv });
}

async function purgeNoticeRows(now: Date) {
  return readPurgeNoticePending(platformCtx, { now, graceDays: PURGE_GRACE_DAYS, ipAddress: '203.0.113.12' });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  platformCtx = await resolvePlatformCtx(
    { platformUserId: PLATFORM_OWNER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  // テナント A を `CLOSING` にする（fixtures は ACTIVE）。テナント B は ACTIVE のまま（対照）。
  await admin.$executeRaw`
    UPDATE tenants SET lifecycle_state = 'CLOSING', lifecycle_changed_at = ${CLOSING_ENTERED_AT}, closing_entered_at = ${CLOSING_ENTERED_AT}
     WHERE id = ${TENANT_A}::uuid`;
  await insertTenant(TENANT_SUSPENDED, 'SUSPENDED', null);
  await insertTenant(TENANT_PURGED, 'PURGED', new Date('2026-06-01T00:00:00.000Z'));
  await insertHostUser(OWNER_USER_ID, OWNER_EMAIL, 'OWNER');
  await insertHostUser(ADMIN_USER_ID, ADMIN_EMAIL, 'ADMIN');
  await insertHostUser(VIEWER_USER_ID, VIEWER_EMAIL, 'VIEWER');

  // 🔴 `development` のコネクタ（`email: 'mock'`）を起動時 DI の判断そのもの（`resolveConnectorSelection`）から組む。
  const development = resolveConnectorSelection(loadAppEnv(buildValidEnv('development')));
  expect(development.email).toBe('mock');
  mockConnectors = createConnectors({ email: development.email, objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' });

  // 🔴 `sandbox` のコネクタ（`sandboxRecipientScoped`）。分類 1 だけが SES（スタブ）へ出る。
  sesSent = [];
  const sandbox = resolveConnectorSelection(loadAppEnv(buildValidEnv('sandbox')));
  expect(sandbox.email).toBe('sandboxRecipientScoped');
  sandboxEmail = {
    kind: sandbox.email,
    connectors: createConnectors(
      { email: sandbox.email, objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' },
      { ses: { api: stubSesApi(), defaultFromAddress: 'noreply@ses-platform.example', configurationSet: 'ses-platform-test' } },
    ),
  };
  enqueued = [];
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await disconnectPlatformReadDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('⑤ 母集団と対照テナント', () => {
  it('🔴 母集団 CLOSING はテナント A だけ（ACTIVE / SUSPENDED / PURGED は配られない）', async () => {
    expect(await listSchedulerFanoutTenants('CLOSING')).toEqual([TENANT_A]);
    expect(await listSchedulerFanoutTenants('LIVE')).toContain(TENANT_B);
    expect(await listSchedulerFanoutTenants('LIVE')).not.toContain(TENANT_A);
  });

  it('🔴 ACTIVE / SUSPENDED / PURGED のテナントに直接ハンドラを当てても SKIPPED で行を作らない', async () => {
    const handler = createTenantClosingNotifyHandler({
      now: () => jstNoon('2026-09-01'),
      purgeGraceDays: PURGE_GRACE_DAYS,
      enqueueEmailDispatch: async (job) => {
        enqueued.push({ ...job });
      },
    });
    for (const tenantId of [TENANT_B, TENANT_SUSPENDED, TENANT_PURGED]) {
      const outcome = await handler({ tenantId }, `direct-${tenantId}`);
      expect(outcome, tenantId).toEqual({ kind: 'SKIPPED', reason: 'NOT_CLOSING' });
      expect(await dispatchRows(tenantId), tenantId).toEqual([]);
    }
    expect(enqueued).toEqual([]);
  });

  it('予告行が 1 件も無い時点: 削除可否は偽、A-005 項目 15 は NOTICE_PENDING（期限超過後）', async () => {
    expect((await delivery('development')).delivered).toBe(false);
    const rows = await purgeNoticeRows(jstNoon('2026-10-02'));
    expect(rows.rows).toEqual([{ tenantId: TENANT_A, cause: 'NOTICE_PENDING', overdueDays: 1 }]);
  });
});

describe('① ENTERED は 1 回だけ / ⑥ 宛先は OWNER・ADMIN のみ / ⑦ 重複送信 0', () => {
  it('入った日（9/1）: ENTERED を 2 通（OWNER / ADMIN）積み、D7 は NOT_DUE', async () => {
    const outcomes = await runNotify(jstNoon('2026-09-01'));
    expect([...outcomes.keys()]).toEqual([TENANT_A]);
    expect(outcomes.get(TENANT_A)).toEqual({
      kind: 'CHECKED',
      todayKey: '2026-09-01',
      purgeScheduledOn: PURGE_SCHEDULED_ON,
      phases: [
        { phase: 'ENTERED', dueOn: '2026-09-01', status: 'FILED', recipients: 2, queued: 2 },
        { phase: 'D7', dueOn: '2026-09-24', status: 'NOT_DUE', recipients: 0, queued: 0 },
      ],
    });

    const rows = await dispatchRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(['QUEUED', 'QUEUED']);
    // ⑥ 宛先 = OWNER / ADMIN だけ。SALES（host-a）/ VIEWER / 取引先（partner-a1 / a2）には 1 行も無い。
    expect(rows.map((row) => row.recipient_email).sort()).toEqual([ADMIN_EMAIL, OWNER_EMAIL].sort());
    expect(rows.every((row) => row.recipient_class === 'HOST_MEMBER')).toBe(true);
    // dedupeKey = 'TENANT_CLOSING_NOTICE:{tenantId}#ENTERED#{yyyy-mm-dd}:{recipientHash}'（宛先の平文は鍵に載らない）
    for (const row of rows) {
      expect(row.dedupe_key).toMatch(new RegExp(`^TENANT_CLOSING_NOTICE:${TENANT_A}#ENTERED#2026-09-01:[0-9a-f]{16}$`, 'u'));
      expect(row.dedupe_key).not.toContain('@');
    }
    // 宛先ハッシュは 2 種（= 2 人）
    expect(new Set(rows.map((row) => row.dedupe_key.split(':')[2])).size).toBe(2);
  });

  it('④ QUEUED が残る間は配送済みではない（development でも）', async () => {
    const result = await delivery('development');
    expect(result).toMatchObject({ delivered: false, pendingCount: 2, deliveredCount: 0, total: 2 });
    expect(classifyPurgeNotice((await dispatchRows()).map((row) => row.status))).toBe('NOTICE_PENDING');
  });

  it('⑦ development（mock）で配送: 2 通が MOCKED、モックの callCount = 宛先数（重複 0）', async () => {
    const before = mockConnectors.email.callCount();
    const outcomes = await drain(dispatchDeps({ emailSender: mockConnectors.email, kind: 'mock', now: jstNoon('2026-09-01') }));
    expect(outcomes).toEqual(['MOCKED', 'MOCKED']);
    expect(mockConnectors.email.callCount() - before).toBe(2);
    expect((await dispatchRows()).map((row) => row.status)).toEqual(['MOCKED', 'MOCKED']);
  });

  it('④ 🔴 MOCKED は development / demo では配送済み、sandbox / staging / production では配送済みにならない', async () => {
    expect(await delivery('development')).toMatchObject({ delivered: true, deliveredCount: 2, pendingCount: 0, mockedIgnoredCount: 0 });
    expect(await delivery('demo')).toMatchObject({ delivered: true, deliveredCount: 2 });
    expect(await delivery('sandbox')).toMatchObject({ delivered: false, deliveredCount: 0, pendingCount: 0, mockedIgnoredCount: 2 });
    expect(await delivery('staging')).toMatchObject({ delivered: false, mockedIgnoredCount: 2 });
    expect(await delivery('production')).toMatchObject({ delivered: false, mockedIgnoredCount: 2 });
    // ⑧ 表示の分類は環境を知らず「SENT / MOCKED あり = 載せない」（null）。削除可否のほうが厳しい。
    expect(classifyPurgeNotice((await dispatchRows()).map((row) => row.status))).toBeNull();
    expect((await purgeNoticeRows(jstNoon('2026-10-02'))).rows).toEqual([]);
  });

  it('🔴 翌日（9/2）に走らせても ENTERED は 2 件のまま（日付一致ではなく未処理判定）。外部送信も増えない', async () => {
    const before = mockConnectors.email.callCount();
    const outcomes = await runNotify(jstNoon('2026-09-02'));
    expect(outcomes.get(TENANT_A)).toMatchObject({
      phases: [
        { phase: 'ENTERED', status: 'ALREADY_FILED', queued: 0 },
        { phase: 'D7', status: 'NOT_DUE' },
      ],
    });
    expect(enqueued).toEqual([]);
    expect(await dispatchRows()).toHaveLength(2);
    expect(mockConnectors.email.callCount()).toBe(before);
  });

  it('9/23（D7 の前日）: まだ D7 は積まれない', async () => {
    const outcomes = await runNotify(jstNoon('2026-09-23'));
    expect(outcomes.get(TENANT_A)).toMatchObject({ phases: [{ phase: 'ENTERED', status: 'ALREADY_FILED' }, { phase: 'D7', status: 'NOT_DUE' }] });
    expect(await dispatchRows()).toHaveLength(2);
  });

  it('② 9/24: D7 を 2 通積み、sandbox（分類 1 = 実送信）で SENT。SES スタブが受けた本文に削除予定日 2026-10-01 が載る', async () => {
    const outcomes = await runNotify(jstNoon('2026-09-24'));
    expect(outcomes.get(TENANT_A)).toMatchObject({
      phases: [
        { phase: 'ENTERED', status: 'ALREADY_FILED' },
        { phase: 'D7', dueOn: '2026-09-24', status: 'FILED', recipients: 2, queued: 2 },
      ],
    });
    const rows = await dispatchRows();
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.dedupe_key.includes('#D7#2026-09-24:')).map((row) => row.status)).toEqual(['QUEUED', 'QUEUED']);

    // sandbox: 分類 1（HOST_MEMBER）は SES（スタブ）へ出て SENT になる（`CLAUDE.md` §11.1 / `F-054 AC-9` の列挙どおり）。
    const mockCallsBefore = mockConnectors.email.callCount();
    const outcomesDrain = await drain(dispatchDeps({ emailSender: sandboxEmail.connectors.email, kind: sandboxEmail.kind, now: jstNoon('2026-09-24') }));
    expect(outcomesDrain).toEqual(['SENT', 'SENT']);
    expect(sesSent).toHaveLength(2);
    expect(mockConnectors.email.callCount()).toBe(mockCallsBefore);
    expect(sesSent.map((request) => request.Destination.ToAddresses[0]).sort()).toEqual([ADMIN_EMAIL, OWNER_EMAIL].sort());

    for (const request of sesSent) {
      expect(request.Content.Template.TemplateName).toBe(TENANT_CLOSING_NOTICE_TEMPLATE_KEY);
      const params = JSON.parse(request.Content.Template.TemplateData) as Record<string, unknown>;
      expect(params.purgeScheduledOn).toBe(PURGE_SCHEDULED_ON);
      expect(params.phase).toBe('D7');
      expect(params.tenantName).toBe('Tenant A');
      expect(params.link).toBe(`${APP_URL}/settings/retention`);
      const body = String(params.body);
      expect(body).toContain(PURGE_SCHEDULED_ON);
      expect(body).toContain('Tenant A');
      expect(body).toContain('7 日を切りました');
      // 🔴 本文に件数の内訳・個人情報・宛先・行 ID を載せない。
      expect(body).not.toContain('@');
      expect(body).not.toContain(rows[0]!.id);
      expect(Object.keys(params).sort()).toEqual(['body', 'link', 'phase', 'purgeScheduledOn', 'subject', 'tenantName']);
    }

    expect((await dispatchRows()).map((row) => row.status).sort()).toEqual(['MOCKED', 'MOCKED', 'SENT', 'SENT']);
  });

  it('② ENTERED の本文にも削除予定日が載る（差し込みの実装を実 DB の行で通す）', async () => {
    const enteredRow = (await dispatchRows()).find((row) => row.dedupe_key.includes('#ENTERED#'))!;
    const resolve = createOperationalMailParamsResolver({ appUrl: APP_URL, purgeGraceDays: PURGE_GRACE_DAYS });
    const params = await resolve(
      { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: enteredRow.id, dedupeKey: enteredRow.dedupe_key },
      jobCtx(TENANT_A, 'params'),
    );
    expect(params.phase).toBe('ENTERED');
    expect(params.purgeScheduledOn).toBe(PURGE_SCHEDULED_ON);
    expect(String(params.body)).toContain(PURGE_SCHEDULED_ON);
    expect(String(params.body)).toContain('解約手続きに入ったため');
  });

  it('④ SENT が入れば sandbox でも配送済み（MOCKED は数えないまま）', async () => {
    expect(await delivery('sandbox')).toMatchObject({ delivered: true, deliveredCount: 2, mockedIgnoredCount: 2, pendingCount: 0, total: 4 });
    expect(await delivery('development')).toMatchObject({ delivered: true, deliveredCount: 4 });
  });

  it('🔴 9/25 に走らせても D7 は 2 件のまま（1 回だけ）', async () => {
    const outcomes = await runNotify(jstNoon('2026-09-25'));
    expect(outcomes.get(TENANT_A)).toMatchObject({ phases: [{ phase: 'ENTERED', status: 'ALREADY_FILED' }, { phase: 'D7', status: 'ALREADY_FILED' }] });
    expect(enqueued).toEqual([]);
    expect(await dispatchRows()).toHaveLength(4);
  });
});

describe('③ FAILED は翌日に再起票される / ⑧ NOTICE_UNDELIVERED', () => {
  it('D7 の 2 行を FAILED にすると、翌日（9/26）に D7 が別の dedupeKey（暦日）で再起票される', async () => {
    const d7 = (await dispatchRows()).filter((row) => row.dedupe_key.includes('#D7#'));
    expect(d7).toHaveLength(2);
    for (const row of d7) await setStatus(row.id, 'FAILED');

    const outcomes = await runNotify(jstNoon('2026-09-26'));
    expect(outcomes.get(TENANT_A)).toMatchObject({
      phases: [{ phase: 'ENTERED', status: 'ALREADY_FILED' }, { phase: 'D7', status: 'FILED', recipients: 2, queued: 2 }],
    });
    const rows = await dispatchRows();
    expect(rows).toHaveLength(6);
    const refiled = rows.filter((row) => row.dedupe_key.includes('#D7#2026-09-26:'));
    expect(refiled.map((row) => row.status)).toEqual(['QUEUED', 'QUEUED']);
    // 同じ宛先ハッシュ・別の暦日 = UNIQUE に当たらない
    const hashesFailed = new Set(d7.map((row) => row.dedupe_key.split(':')[2]));
    const hashesRefiled = new Set(refiled.map((row) => row.dedupe_key.split(':')[2]));
    expect(hashesRefiled).toEqual(hashesFailed);
  });

  it('④ 再起票の QUEUED が残る間は配送済みではない（ENTERED が MOCKED でも）。配送で戻る', async () => {
    expect(await delivery('development')).toMatchObject({ delivered: false, pendingCount: 2, failedCount: 2, deliveredCount: 2 });
    const before = mockConnectors.email.callCount();
    expect(await drain(dispatchDeps({ emailSender: mockConnectors.email, kind: 'mock', now: jstNoon('2026-09-26') }))).toEqual(['MOCKED', 'MOCKED']);
    expect(mockConnectors.email.callCount() - before).toBe(2);
    expect(await delivery('development')).toMatchObject({ delivered: true, pendingCount: 0, failedCount: 2, deliveredCount: 4 });
  });

  it('⑧ 🔴 全行を FAILED にすると A-005 項目 15 は NOTICE_UNDELIVERED、削除可否は偽（関数は変えていない）', async () => {
    const rows = await dispatchRows();
    for (const row of rows) await setStatus(row.id, 'FAILED');
    expect(classifyPurgeNotice((await dispatchRows()).map((row) => row.status))).toBe('NOTICE_UNDELIVERED');
    expect((await purgeNoticeRows(jstNoon('2026-10-03'))).rows).toEqual([{ tenantId: TENANT_A, cause: 'NOTICE_UNDELIVERED', overdueDays: 2 }]);
    expect(await delivery('development')).toMatchObject({ delivered: false, failedCount: 6, deliveredCount: 0 });

    // 翌日に両段とも再起票される（FAILED だけの段は未処理）
    const outcomes = await runNotify(jstNoon('2026-09-27'));
    expect(outcomes.get(TENANT_A)).toMatchObject({ phases: [{ phase: 'ENTERED', status: 'FILED', queued: 2 }, { phase: 'D7', status: 'FILED', queued: 2 }] });
    expect(await dispatchRows()).toHaveLength(10);
    expect(classifyPurgeNotice((await dispatchRows()).map((row) => row.status))).toBe('NOTICE_PENDING');
  });
});

describe('④ 🔴 HELD_PROVIDER_QUOTA（環境枠の到達）は配送済みではない。解除後の配送で初めて配送済み（E2E #24 の代替）', () => {
  it('MAIL_PROVIDER_DAILY_QUOTA=1 相当で 4 通のうち 1 通だけ出て 3 通が HELD_PROVIDER_QUOTA。保留が残る間は delivered=false', async () => {
    const now = jstNoon('2026-09-27');
    const counter = new InMemoryProviderSendCounter();
    // 🔴 `MockEmailSender.getQuota()` は自身の呼び出し履歴を返す（既に 4 通送っているので 24h 枠 1 では即 HOLD）。
    //    新しいモックで 0 から数えさせ、「1 通目は出て 2 通目以降が保留」を再現する。
    const fresh = createConnectors({ email: 'mock', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' });
    const outcomes = await drain(dispatchDeps({ emailSender: fresh.email, kind: 'mock', now, providerDailyQuota: 1, providerSentCounter: counter }));
    expect(outcomes.filter((kind) => kind === 'MOCKED')).toHaveLength(1);
    expect(outcomes.filter((kind) => kind === 'HELD_PROVIDER_QUOTA')).toHaveLength(3);
    expect(fresh.email.callCount()).toBe(1);

    const result = await delivery('development');
    expect(result).toMatchObject({ delivered: false, pendingCount: 3, deliveredCount: 1 });
    // 🔴 保留は失敗ではない: 項目 15 は NOTICE_PENDING でも NOTICE_UNDELIVERED でもない（MOCKED が 1 件ある）が、削除可否は偽。
    expect(classifyPurgeNotice((await dispatchRows()).map((row) => row.status))).toBeNull();
    expect((await dispatchRows()).filter((row) => row.status === 'HELD_PROVIDER_QUOTA')).toHaveLength(3);
  });

  it('保留の解除（send.hold-release と同じ CAS）→ 配送で delivered=true。外部送信は解除した通数だけ', async () => {
    const now = jstNoon('2026-09-28');
    const held = (await dispatchRows()).filter((row) => row.status === 'HELD_PROVIDER_QUOTA');
    expect(held).toHaveLength(3);
    for (const row of held) {
      expect(await requeueHeldEmailDispatch(jobCtx(TENANT_A, 'hold-release'), { dispatchId: row.id, fromStatus: 'HELD_PROVIDER_QUOTA' })).toBe(true);
      enqueued.push({ dispatchId: row.id, tenantId: TENANT_A, recipientClass: 'HOST_MEMBER' });
    }
    expect(await delivery('development')).toMatchObject({ delivered: false, pendingCount: 3 });

    const before = mockConnectors.email.callCount();
    expect(await drain(dispatchDeps({ emailSender: mockConnectors.email, kind: 'mock', now }))).toEqual(['MOCKED', 'MOCKED', 'MOCKED']);
    expect(mockConnectors.email.callCount() - before).toBe(3);
    expect(await delivery('development')).toMatchObject({ delivered: true, pendingCount: 0, deliveredCount: 4, failedCount: 6, total: 10 });
    // 🔴 sandbox 相当では MOCKED を数えないので、同じ行の集合でも配送済みにならない（環境の取り違えは mockedIgnoredCount に現れる）。
    expect(await delivery('sandbox')).toMatchObject({ delivered: false, deliveredCount: 0, mockedIgnoredCount: 4 });
  });

  it('🔴 同じ日にもう一度走らせても 1 行も増えない（保留・配送済みの段は未処理ではない）', async () => {
    const outcomes = await runNotify(jstNoon('2026-09-28'));
    expect(outcomes.get(TENANT_A)).toMatchObject({ phases: [{ status: 'ALREADY_FILED' }, { status: 'ALREADY_FILED' }] });
    expect(await dispatchRows()).toHaveLength(10);
    expect(enqueued).toEqual([]);
  });
});

describe('テナント境界', () => {
  it('テナント B（ACTIVE。分離キーは ctx）から A の予告行は 1 件も読めない', async () => {
    const other = await readClosingNoticeDelivery(jobCtx(TENANT_B, 'other'), { appEnv: 'development' });
    expect(other).toMatchObject({ delivered: false, total: 0 });
    expect(await dispatchRows(TENANT_B)).toEqual([]);
  });

  it('取引先の利用者（PARTNER_SALES）/ SALES / VIEWER には 1 行も無い', async () => {
    const emails = new Set((await dispatchRows()).map((row) => row.recipient_email));
    expect(emails).toEqual(new Set([OWNER_EMAIL, ADMIN_EMAIL]));
    expect(emails.has(VIEWER_EMAIL)).toBe(false);
    const hostSales = await admin.user.findUniqueOrThrow({ where: { id: USER_A_HOST }, select: { email: true } });
    const partner = await admin.user.findUniqueOrThrow({ where: { id: USER_A_PARTNER }, select: { email: true } });
    expect(emails.has(hostSales.email)).toBe(false);
    expect(emails.has(partner.email)).toBe(false);
  });
});
