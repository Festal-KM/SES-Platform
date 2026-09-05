// tests/isolation/provider-quota-hold.test.ts
// 🔴 SP-04 T-04-04 の完了判定（`docs/05` §17.3 #23 の前半 / §8.3-Q / `F-059 AC-7`）を実データで実証する:
//
//   「`MAIL_PROVIDER_DAILY_QUOTA` を小さく設定した状態で分類 1 のメールを上限 + 1 通起動し、
//     超過分が外部へ発行されず `HELD_PROVIDER_QUOTA`（`heldAt` あり / `failureReason` なし /
//     `FAILED` でない）として記録され、`send.hold-release` が枠の回復後に `headroom` 件だけ
//     復帰させ、モックの `callCount()` が想定どおりになること」
//
// 🔴 **テスト専用フックを作らない。到達は環境変数の値だけで再現する。**
//    上限は `packages/config` の `loadAppEnv`（= 起動時と同じ検証経路）に
//    `MAIL_PROVIDER_DAILY_QUOTA` を渡して得る。実装側に「テストのときだけ枠を減らす」分岐は無い。
//
// 🔴 **実 SES / 実 Redis に接続しない。**
//    - SES: `SesApi` のスタブを注入した `SesEmailSender`（`email: 'real'` の実装）を使う。
//      枠を消費するのは「実送信」だけである（モック sink に流した分は数えない。§8.3-Q ③）ため、
//      枯渇を再現するにはこの構成でなければならない。
//    - Redis: 24h カウンタは `InMemoryProviderSendCounter`（同一プロセス）。
//      Redis 版（`RedisProviderSendCounter`）の ZSET の振る舞いは
//      `packages/connectors/src/email/ses/counter.test.ts` が偽クライアントで固定する。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createConnectors,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  type Connectors,
  type SesApi,
} from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  emailDispatchDedupeKey,
  readEmailDispatch,
  reserveEmailDispatch,
  systemTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { loadAppEnv } from '../../packages/config/src/load-env.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';
import { createSendHoldReleaseHandler } from '../../apps/worker/src/jobs/send-hold-release.js';
import { performEmailSend } from '../../apps/worker/src/jobs/email-send.js';
import { TENANT_A } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-05T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const JOB = { queue: 'email.dispatch', jobId: 'email.dispatch:test' } as const;

/**
 * 🔴 上限は**環境変数から**得る（実装と同じ `loadAppEnv` を通す）。
 *    `MAIL_PROVIDER_DAILY_QUOTA=1` は「SES アカウントの 24h 枠が 1 通」という設定であり、
 *    テスト用の抜け道ではない（`staging` / `production` では未設定だと起動に失敗する項目）。
 */
function providerDailyQuotaFromEnv(value: string): number {
  return loadAppEnv(buildValidEnv('sandbox', { MAIL_PROVIDER_DAILY_QUOTA: value }))
    .MAIL_PROVIDER_DAILY_QUOTA;
}

function warnRatioFromEnv(): number {
  return loadAppEnv(buildValidEnv('sandbox')).MAIL_PROVIDER_QUOTA_WARN_RATIO;
}

/** 🔴 実 SES の代わり。ネットワークに出ない。`GetAccount` は十分に大きな枠を返す。 */
function stubSesApi(): SesApi & { sent: number } {
  const api = {
    sent: 0,
    async sendEmail() {
      api.sent += 1;
      return { MessageId: `ses-msg-${api.sent}` };
    },
    async getAccount() {
      // 🔴 SES 側は空いていることにする。**止めるのは `MAIL_PROVIDER_DAILY_QUOTA` である**
      //    （`limit = min(envLimit, provider.max24h)`。設定が効いていることを分離して確かめる）。
      return { SendQuota: { Max24HourSend: 50_000, SentLast24Hours: 0 } };
    },
  };
  return api;
}

let database: IsolationDatabase;
let admin: UnextendedClient;
let ctx: SystemTenantCtx;
let connectors: Connectors;
let sesApi: ReturnType<typeof stubSesApi>;
let providerSentCounter: InMemoryProviderSendCounter;
/**
 * 🔴 送信側（`SesEmailSender` の 24h カウンタへの加算）と判定側（ジョブ）が**同じ時計**を見る。
 *    別々にすると「送った事実」と「枠の判定」が別の時間軸で動き、テストが実時刻に依存する。
 */
let clock: Date;

function advanceTo(next: Date): Date {
  clock = next;
  return next;
}

function sendDeps(overrides: Record<string, unknown> = {}) {
  return {
    emailSender: connectors.email,
    // 🔴 実装種別は `real`（SES 実装）。モック sink に流していないので枠を消費する。
    emailImplementationKind: 'real' as const,
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    providerDailyQuota: providerDailyQuotaFromEnv('1'),
    providerSentCounter,
    // 分類 1（ホスト所属）なので共通ドメインでよい（`F-001 AC-5`）。
    resolveSendingDomain: async () => null,
    now: () => clock,
    ...overrides,
  } as never;
}

async function reserve(targetId: string) {
  return reserveEmailDispatch(ctx, {
    recipientClass: 'HOST_MEMBER',
    recipientEmail: 'owner@example.co.jp',
    templateKey: 'TENANT_CLOSING_NOTICE',
    dedupeKey: emailDispatchDedupeKey({
      templateKey: 'TENANT_CLOSING_NOTICE',
      targetId,
      recipientEmail: 'owner@example.co.jp',
    }),
    observedAt: NOW,
  });
}

async function send(dispatchId: string, deps = sendDeps()) {
  return performEmailSend(deps, {
    ctx,
    dispatch: (await readEmailDispatch(ctx, dispatchId))!,
    params: {},
  });
}

function holdReleaseDeps(overrides: Record<string, unknown> = {}) {
  const enqueued: { dispatchId: string }[] = [];
  const deps = {
    emailSender: connectors.email,
    providerDailyQuota: providerDailyQuotaFromEnv('1'),
    providerQuotaWarnRatio: warnRatioFromEnv(),
    providerSentCounter,
    // 🔴 `send.hold-release` は再 enqueue するだけで、自分では送らない。
    //    ここでは「再 enqueue されたジョブが §8.3-Q の判定を最初から通る」ことを確かめるため、
    //    受け取った payload をそのまま `email.dispatch` の経路（`performEmailSend`）へ流す。
    enqueueEmailDispatch: async (job: { dispatchId: string }) => {
      enqueued.push(job);
    },
    // 招待・再設定は本テストの対象外（T-04-05 の範囲）。呼ばれたら明確に失敗させる。
    reissueAccountMail: async () => {
      throw new Error('本テストは account.mail 由来の保留を作らない');
    },
    // `send.*`（`Proposal` / `Contract`）は SP-09。枠を使わない。
    releaseSendHolds: async () => 0,
    now: () => clock,
    ...overrides,
  };
  return { deps: deps as never, enqueued };
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctx = systemTenantCtx(TENANT_A, JOB);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.emailDispatch.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: 'EMAIL_COUNT' } });
  sesApi = stubSesApi();
  providerSentCounter = new InMemoryProviderSendCounter();
  clock = NOW;
  connectors = createConnectors(
    { email: 'real', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' },
    {
      ses: {
        api: sesApi,
        defaultFromAddress: 'no-reply@ses-platform.example',
        configurationSet: 'ses-platform-test',
        // 🔴 送信側と判定側が**同一のカウンタ**を見る（別々だと枠が永久に空いて見える）。
        sentCounter: providerSentCounter,
        now: () => clock,
      },
    },
  );
});

describe('🔴 上限 + 1 通目が外部へ発行されず HELD_PROVIDER_QUOTA になる（F-059 AC-7）', () => {
  it('MAIL_PROVIDER_DAILY_QUOTA=1 のとき 1 通目は送れ、2 通目は保留される', async () => {
    const first = await reserve('target-1');
    const second = await reserve('target-2');

    expect((await send(first.dispatchId)).kind).toBe('SENT');
    const outcome = await send(second.dispatchId);

    expect(outcome).toEqual({ kind: 'HELD_PROVIDER_QUOTA' });
    // 🔴 外部への発行は 1 回だけ（モック / 実装共通の `callCount()`）。
    expect(connectors.email.callCount()).toBe(1);
    expect(sesApi.sent).toBe(1);
  });

  it('🔴 保留の行は heldAt があり、failureReason が無く、FAILED でもない', async () => {
    const first = await reserve('target-1');
    const second = await reserve('target-2');
    await send(first.dispatchId);
    await send(second.dispatchId);

    const row = await admin.emailDispatch.findFirst({ where: { id: second.dispatchId } });
    expect(row?.status).toBe('HELD_PROVIDER_QUOTA');
    expect(row?.heldAt).not.toBeNull();
    expect(row?.failureReason).toBeNull();
    expect(row?.sentAt).toBeNull();
  });

  it('🔴 テナントの日次上限（RATE_LIMIT）と区別される（SUPPRESSED にしない）', async () => {
    const first = await reserve('target-1');
    const second = await reserve('target-2');
    await send(first.dispatchId);
    await send(second.dispatchId);

    const suppressed = await admin.emailDispatch.count({ where: { status: 'SUPPRESSED' } });
    expect(suppressed).toBe(0);
    // 🔴 テナントの日次カウンタも消費していない（送らない 1 通のために枠を減らさない）。
    const counter = await admin.usageCounter.findFirst({
      where: { tenantId: TENANT_A, metric: 'EMAIL_COUNT' },
    });
    expect(Number(counter?.value ?? 0)).toBe(1);
  });
});

describe('🔴 モック実装（development / demo / E2E と同一）でも同じ判定になる', () => {
  it('MAIL_PROVIDER_DAILY_QUOTA=1 のとき callCount() は 1 で、2 通目は HELD_PROVIDER_QUOTA', async () => {
    // 🔴 `packages/connectors/src/mock/**` をそのまま使う（docs/05 §17.5。テスト専用の別モックを書かない）。
    //    モックの `max24h` は既定 `MAX_SAFE_INTEGER` なので、**実効上限は環境変数だけが決める**
    //    （`limit = min(envLimit, provider.max24h)`。§8.3-Q ②）。
    const mockConnectors = createConnectors({
      email: 'mock',
      objectStore: 'mock',
      malwareScanner: 'mock',
      esign: 'mock',
      billing: 'mock',
    });
    const deps = sendDeps({
      emailSender: mockConnectors.email,
      emailImplementationKind: 'mock' as const,
      // 🔴 モック sink に流した分は手元のカウンタに加算されない（§8.3-Q ③）。
      //    それでも枠を守れるのは `consumed = max(local, provider)` を採るからである。
      providerSentCounter: new InMemoryProviderSendCounter(),
    });

    const first = await reserve('mock-1');
    const second = await reserve('mock-2');

    expect((await send(first.dispatchId, deps)).kind).toBe('MOCKED');
    expect(await send(second.dispatchId, deps)).toEqual({ kind: 'HELD_PROVIDER_QUOTA' });

    expect(mockConnectors.email.callCount()).toBe(1);
    const row = await admin.emailDispatch.findFirst({ where: { id: second.dispatchId } });
    expect(row?.status).toBe('HELD_PROVIDER_QUOTA');
    expect(row?.failureReason).toBeNull();
  });
});

describe('🔴 send.hold-release が headroom 件だけ復帰させる（docs/05 §9.4）', () => {
  it('枠が埋まったままなら 1 件も復帰しない（時刻で判定しない）', async () => {
    const first = await reserve('target-1');
    const second = await reserve('target-2');
    await send(first.dispatchId);
    await send(second.dispatchId);

    const { deps, enqueued } = holdReleaseDeps();
    const outcome = await createSendHoldReleaseHandler(deps)({ tenantId: TENANT_A }, 'job-release');

    expect(outcome.headroom).toBe(0);
    expect(outcome.quotaReleased).toBe(0);
    expect(enqueued).toEqual([]);
    const row = await admin.emailDispatch.findFirst({ where: { id: second.dispatchId } });
    expect(row?.status).toBe('HELD_PROVIDER_QUOTA');
  });

  it('🔴 枠が回復すると QUEUED に戻り、再 enqueue されて送信される（callCount が 2 になる）', async () => {
    const first = await reserve('target-1');
    const second = await reserve('target-2');
    await send(first.dispatchId);
    await send(second.dispatchId);
    expect(connectors.email.callCount()).toBe(1);

    // 24 時間経過（ローリング窓から 1 通目が落ちる）。**時刻を進めるだけ**で枠が戻る。
    advanceTo(new Date(NOW.getTime() + DAY_MS + 1));
    const { deps, enqueued } = holdReleaseDeps();
    const outcome = await createSendHoldReleaseHandler(deps)({ tenantId: TENANT_A }, 'job-release');

    expect(outcome.headroom).toBe(1);
    expect(outcome.quotaReleased).toBe(1);
    expect(enqueued.map((job) => job.dispatchId)).toEqual([second.dispatchId]);

    // 🔴 復帰後の行は `QUEUED` / `held_at = NULL`（判定を最初から通る）。
    const requeued = await admin.emailDispatch.findFirst({ where: { id: second.dispatchId } });
    expect(requeued?.status).toBe('QUEUED');
    expect(requeued?.heldAt).toBeNull();

    // 再 enqueue されたジョブを実行すると、今度は送られる。
    const sent = await send(second.dispatchId);
    expect(sent.kind).toBe('SENT');
    expect(connectors.email.callCount()).toBe(2);
    expect(sesApi.sent).toBe(2);
  });

  it('🔴 headroom を超える分は次回に持ち越す（古い順に配る）', async () => {
    // 上限 2 / 2 通送信済み → 保留 3 件。24h 後に枠が 2 だけ戻る状況を作る。
    const quota = providerDailyQuotaFromEnv('2');
    const deps2 = sendDeps({ providerDailyQuota: quota });

    // 🔴 1 秒ずつずらす。`heldAt` が同一だと「古い順」を検証できない
    //    （並びが id の偶然に左右され、テストが規律を確かめていないことになる）。
    const ids: string[] = [];
    for (const [index, target] of ['t1', 't2', 't3', 't4', 't5'].entries()) {
      advanceTo(new Date(NOW.getTime() + index * 1_000));
      const reservation = await reserve(target);
      ids.push(reservation.dispatchId);
      await send(reservation.dispatchId, deps2);
    }

    // 2 通送られ、3 通が保留。
    expect(connectors.email.callCount()).toBe(2);
    expect(await admin.emailDispatch.count({ where: { status: 'HELD_PROVIDER_QUOTA' } })).toBe(3);

    // 送信した 2 通（`NOW` / `NOW + 1s`）がどちらもローリング窓から落ちる時刻へ進める。
    advanceTo(new Date(NOW.getTime() + DAY_MS + 2_000));
    const { deps, enqueued } = holdReleaseDeps({ providerDailyQuota: quota });
    const outcome = await createSendHoldReleaseHandler(deps)({ tenantId: TENANT_A }, 'job-release');

    // 🔴 headroom は 2（24h 前の 2 通が窓から落ちた）。3 件目は次回に持ち越す。
    expect(outcome.headroom).toBe(2);
    expect(outcome.quotaReleased).toBe(2);
    expect(enqueued.map((job) => job.dispatchId)).toEqual([ids[2], ids[3]]);
    expect(await admin.emailDispatch.count({ where: { status: 'HELD_PROVIDER_QUOTA' } })).toBe(1);
  });

  it('🔴 復帰した行が再び枠に当たれば、また保留される（判定を免れる経路を作らない）', async () => {
    const first = await reserve('target-1');
    const second = await reserve('target-2');
    await send(first.dispatchId);
    await send(second.dispatchId);

    advanceTo(new Date(NOW.getTime() + DAY_MS + 1));
    const { deps } = holdReleaseDeps();
    await createSendHoldReleaseHandler(deps)({ tenantId: TENANT_A }, 'job-release');

    // 復帰の直後に別の送信が枠を使い切った状況を作る（進めた時刻で 1 通送る）。
    const third = await reserve('target-3');
    expect((await send(third.dispatchId)).kind).toBe('SENT');

    // 🔴 復帰済みの行を実行しても、判定を最初から通るので再び保留になる。
    const outcome = await send(second.dispatchId);
    expect(outcome).toEqual({ kind: 'HELD_PROVIDER_QUOTA' });
    expect(connectors.email.callCount()).toBe(2);
  });
});
