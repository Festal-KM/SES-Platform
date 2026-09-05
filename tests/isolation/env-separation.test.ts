// tests/isolation/env-separation.test.ts
// 🔴 T-04-10「環境分離の検証」= **`docs/05` §17.4 の表をそのままテストに落としたもの**
//    （`docs/02` 章 7.6 NFR-ENV-1 の 3 分類 / `BR-45` / `CLAUDE.md` §11.1）。
//
// ============================================================================
// 本ファイルが担う行と、担わない行
// ============================================================================
// | §17.4 の行 | 担当 |
// |---|---|
// | `development` / `demo` | 🔴 **本ファイル**（全分類を送信して外部発信 0 件。遮断とモックの二重検証） |
// | `sandbox` ② | 🔴 **本ファイル**（分類 1 / 分類外が実送信され、宛先がホスト所属 / `PlatformUser` のみ） |
// | `sandbox` ③ | `tests/isolation/sandbox-invite-link.test.ts`（T-04-08。`F-007 AC-4`） |
// | `production` の起動検証 | `tests/startup/startup-di.test.ts`（T-03-12。子プロセスで実際に起動する） |
// | `sandbox` ① / `staging` | 分類 3 / 4（`F-022` / `F-041` / `F-047` / `F-049`）の送信経路は未実装。
//                             SP-09 / SP-15 / SP-17 / SP-18 が各機能と同時に追加する（SP-04 §T-04-10） |
//
// 🔴 **重複したテストを書かない。** 上表の右 2 行は既に green であり、ここで同じことを
//    書き直すと「どちらかを直したときに片方だけ古くなる」状態を作る。
//
// ============================================================================
// 🔴 「外部発信 0 件」を二重に検証する（`docs/05` §17.4 / `docs/03` §4.17）
// ============================================================================
//   ① **プロセス境界の外向き遮断** —— `tests/support/outbound-network-guard.mjs`（E2E の
//      `network-guard.mjs` と**同一実装**）を差し込み、ループバック以外への接続をその場で
//      失敗させる。実装が誤っていても発信は成立しない。
//   ② **モック / SES スタブの呼び出し回数** —— `EmailSender.callCount()`（インタフェース側の
//      共通シグネチャ。`docs/05` §13.2）と、SES ポートのスタブが受けたリクエストの記録。
//   ①だけだと「そもそも送信経路に入っていない」空振りを見逃し、②だけだと「実装が正しい前提」の
//   検証にしかならない。両方でなければ `CLAUDE.md` §7 の「0 件」を主張できない。
//
// ============================================================================
// 🔴 MailHog を使わない理由（`docs/05` §17.4 の記述を実装に合わせて改訂した。`CLAUDE.md` §8.7）
// ============================================================================
// §17.4 の `sandbox` ② は当初「MailHog で受信を検証」と書かれていたが、**`sandbox` の分類 1 /
// 分類外は `SesEmailSender`（SES の HTTP API）を通る**（`resolveConnectorSelection('sandbox')`
// → `sandboxRecipientScoped` → `real` = SES）。MailHog は `development` のローカル SMTP
// キャッチャであり、この経路上に存在しない（SMTP で送る実装はリポジトリに 1 つも無い）。
// したがって「実際に送信された 1 通の宛先」を読める唯一の場所は **`SesApi` ポート**であり、
// ここをスタブして `Destination.ToAddresses` を全数検査する。`docs/05` §17.4 / `docs/03` §4.17 /
// `docs/sprints/SP-04` の該当記述は本タスクで実装に合わせて改訂した。
//
// 🔴 実 SES / 実 SMTP / 実 DNS に接続しない（接続しようとした時点で①の遮断が落とす）。
import net from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createConnectors,
  dispatchTokenFor,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  isExternalRecipientClass,
  RECIPIENT_CLASSES,
  type ConnectorImplementationKind,
  type Connectors,
  type EmailSendInput,
  type RecipientClass,
  type SesApi,
  type SesSendEmailRequest,
  type VerifiedSendingDomain,
} from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  emailDispatchDedupeKey,
  readEmailDispatch,
  reserveEmailDispatch,
  resolveTenantCtx,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ISOLATION_SEED_IDS,
  ISOLATION_SEED_PLATFORM_USERS,
  isolationSeedEmails,
  runSeed,
} from '@ses/db/seed';
// 🔴 ルートの package.json は `@ses/config` を依存に持たないため、実装のソースを相対 import する
//    （`tests/isolation/**` の既存ファイルと同じ扱い）。
import { resolveConnectorSelection } from '../../packages/config/src/connector-selection.js';
import { loadAppEnv } from '../../packages/config/src/load-env.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';
import {
  createAccountMailHandler,
  type AccountMailDeps,
} from '../../apps/worker/src/jobs/account-mail.js';
import {
  createEmailDispatchHandler,
  PlatformDispatchNotSupportedError,
  type EmailDispatchDeps,
} from '../../apps/worker/src/jobs/email-dispatch.js';
import { performEmailSend, type EmailSendDeps } from '../../apps/worker/src/jobs/email-send.js';
import { requestPasswordReset } from '../../apps/web/lib/auth/password-reset.js';
import {
  configureAccountMailQueue,
  PendingAccountMailQueue,
} from '../../apps/web/lib/jobs/account-mail.js';
import { INVITE_URL_NOT_DISCLOSED } from '../../apps/web/lib/invitations/invite-link.js';
import { issueInvitation } from '../../apps/web/lib/invitations/service.js';
import type { SendingDomainResolver } from '../../apps/web/lib/settings/sending-domains.js';
import {
  installOutboundNetworkGuard,
  isOutboundBlocked,
  OutboundNetworkBlockedError,
  OUTBOUND_PROBE_HOST,
} from '../support/outbound-network-guard.mjs';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（`docs/05` §17.6）。 */
const NOW = new Date('2026-09-06T03:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.10' } as const;

const TENANT = ISOLATION_SEED_IDS.tenants[0];
const PARTNER = TENANT.partners[0];
const SEED_EMAILS = isolationSeedEmails(1);
/** 🔴 分類外（運営者）の宛先。`platform_users` に実在する行のアドレスである。 */
const PLATFORM_EMAIL = ISOLATION_SEED_PLATFORM_USERS.owner.email;

/** 本ファイルが作る招待の宛先（後始末の対象を限定するために専用ドメインを使う）。 */
const TEST_MAIL_DOMAIN = 'env-separation.test';
const HOST_INVITEE = `host-invitee@${TEST_MAIL_DOMAIN}`;
const PARTNER_INVITEE = `partner-invitee@${TEST_MAIL_DOMAIN}`;

/**
 * 検証済みの独自ドメイン。
 *
 * 🔴 分類 2 / 3 / 4 は `assertSendingDomainForRecipientClass`（モックと SES の**共通コード**）が
 *    `fromDomain === null` を拒否するため、**ドメイン判定で止まっていないこと**を先に成立させる。
 *    「未検証だから外部に出なかった」では環境分離の検証にならない（`BR-51` の保留は
 *    `sending-domain-hold.test.ts` が別に見る）。
 */
const VERIFIED_DOMAIN: VerifiedSendingDomain = {
  domain: 'env-separation.example',
  mailFromDomain: 'mail.env-separation.example',
  verifiedAt: NOW,
};

/** 🔴 `sandbox` は共通ドメインで動く（`docs/03` §3.2.7-4）。#14 は検証を求めない。 */
const NOT_REQUIRED: SendingDomainResolver = async () => ({ kind: 'NOT_REQUIRED' });

const DAILY_LIMIT = 500;
const MINUTE_LIMIT = 30;
/** 十分に空けておく（枯渇の再現は `provider-quota-hold.test.ts` が扱う）。 */
const PROVIDER_QUOTA = 200;

let database: IsolationDatabase;
/** 🔴 投入と「保存されている生の値」の確認にだけ使う特権接続（検証のクエリには使わない）。 */
let admin: UnextendedClient;
let hostAdmin: AuthenticatedTenantCtx;
let systemCtx: SystemTenantCtx;
let restoreNetworkGuard: (() => void) | null = null;

/**
 * 🔴 **SES ポート（外部エンドポイント）に出た通数と宛先**。
 *
 * `EmailSender.callCount()` は実送信 + モックの**合計**なので、「外部へ 0 通」「外部へ出た
 * 全通の宛先」を言うにはこちらを読む必要がある（`sandbox-invite-link.test.ts` と同じ読み方）。
 */
let sesSent: SesSendEmailRequest[];

/** 🔴 実 SES の代わり。`sendEmail` が 1 度でも呼ばれたら記録が残る。 */
function stubSesApi(): SesApi {
  return {
    async sendEmail(request) {
      sesSent.push(request);
      return { MessageId: `ses-${sesSent.length}` };
    },
    async getAccount() {
      return { SendQuota: { Max24HourSend: PROVIDER_QUOTA, SentLast24Hours: 0 } };
    },
  };
}

/**
 * 🔴 環境ごとのコネクタを、**起動時 DI の判断（`resolveConnectorSelection`）そのもの**から組む。
 *
 * 🔴 `email` 以外を `mock` に固定する理由: `development` / `sandbox` の `objectStore` /
 *    `malwareScanner` は MinIO / ClamAV（ローカル実サービス）であり、その実装は本スプリントの
 *    射程外でまだ `createConnectors` に登録されていない（未登録は throw = 意図した挙動）。
 *    §17.4 が見るのはメール送信の単一経路なので、**`email` だけを実際の選択から取る**。
 * 🔴 `ses` の実行時オプションは常に渡す。`development` / `demo` では
 *    `createConnectors` がこれを**一度も使わない**（= SES 実装が組み立て可能な状態でも
 *    選ばれない）ことが、そのまま「全モック」の証拠になる。
 */
function connectorsFor(kind: 'development' | 'demo' | 'sandbox'): {
  readonly connectors: Connectors;
  readonly implementationKind: ConnectorImplementationKind;
} {
  const selection = resolveConnectorSelection(loadAppEnv(buildValidEnv(kind)));
  const connectors = createConnectors(
    {
      email: selection.email,
      objectStore: 'mock',
      malwareScanner: 'mock',
      esign: 'mock',
      billing: 'mock',
    },
    {
      ses: {
        api: stubSesApi(),
        defaultFromAddress: 'noreply@ses-platform.example',
        configurationSet: 'ses-platform-test',
        now: () => NOW,
      },
    },
  );
  return { connectors, implementationKind: selection.email };
}

/**
 * 単一経路（`EmailSender.send`）へ 1 通流す入力。
 *
 * 🔴 `token` は「日次枠の予約を経ていない送信をコンパイル不能にする」ためのブランドである
 *    （`docs/05` §10.2）。ここで見たいのは**振り分けそのもの**なので、`dispatchTokenFor`
 *    （唯一のファクトリ）で作る。DB を経由する経路は下の「ジョブ経路」のケースが別に見る。
 */
function sendInput(recipientClass: RecipientClass, to: string): EmailSendInput {
  return {
    recipientClass,
    to,
    templateKey: `ENV_SEPARATION_${recipientClass}`,
    params: {},
    tenantId: recipientClass === 'PLATFORM' ? null : TENANT.tenantId,
    // 🔴 分類 2 / 3 / 4 は検証済みドメインが無いと共通コードが throw する（`BR-51`）。
    fromDomain: isExternalRecipientClass(recipientClass) ? VERIFIED_DOMAIN : null,
    token: dispatchTokenFor({
      dispatchId: `00000000-0000-7000-8000-00000000000${RECIPIENT_CLASSES.indexOf(recipientClass)}`,
      dedupeKey: `env-separation:${recipientClass}`,
    }),
  };
}

/** ジョブ経路（`email.dispatch` / `account.mail`）に共通の依存。 */
function sendDeps(
  connectors: Connectors,
  implementationKind: ConnectorImplementationKind,
): EmailSendDeps {
  return {
    emailSender: connectors.email,
    emailImplementationKind: implementationKind,
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: DAILY_LIMIT,
    minuteLimit: MINUTE_LIMIT,
    providerDailyQuota: PROVIDER_QUOTA,
    providerSentCounter: new InMemoryProviderSendCounter(),
    // 🔴 検証済みのドメインを返す（ドメイン判定で止めない。上の `VERIFIED_DOMAIN` の注記参照）。
    resolveSendingDomain: async () => VERIFIED_DOMAIN,
    now: () => NOW,
  };
}

function accountMailDeps(
  connectors: Connectors,
  implementationKind: ConnectorImplementationKind,
): AccountMailDeps {
  return {
    ...sendDeps(connectors, implementationKind),
    appUrl: 'http://localhost:3000',
    // 🔴 payload に宛先を載せない設計（Redis に PII を置かない）ため、DB から引き当てる。
    resolveRecipientEmail: async (job) => {
      if (job.kind === 'INVITATION') {
        const row = await admin.invitation.findFirst({
          where: { id: job.targetId },
          select: { email: true },
        });
        return row?.email ?? null;
      }
      const row = await admin.user.findFirst({
        where: { id: job.targetId },
        select: { email: true },
      });
      return row?.email ?? null;
    },
  };
}

function emailDispatchDeps(
  connectors: Connectors,
  implementationKind: ConnectorImplementationKind,
): EmailDispatchDeps {
  return {
    ...sendDeps(connectors, implementationKind),
    resolveTemplateParams: async () => ({}),
  };
}

/** 積まれた `account.mail` を 1 件ずつ実行する（BullMQ の配線は SP-07）。 */
async function drainAccountMail(
  queue: PendingAccountMailQueue,
  deps: AccountMailDeps,
): Promise<readonly string[]> {
  const handler = createAccountMailHandler(deps);
  const outcomes: string[] = [];
  for (const kind of ['INVITATION', 'PASSWORD_RESET'] as const) {
    for (const job of queue.jobsOf(kind)) {
      outcomes.push((await handler(job, `job-${kind.toLowerCase()}`)).kind);
    }
  }
  return outcomes;
}

/** `email.dispatch` 用に 1 行予約する（宛先分類は分類 1 / 分類外しか載らない）。 */
async function reserveHostDispatch(targetId: string, recipientEmail: string) {
  const templateKey = 'TENANT_CLOSING_NOTICE';
  return reserveEmailDispatch(systemCtx, {
    recipientClass: 'HOST_MEMBER',
    recipientEmail,
    templateKey,
    dedupeKey: emailDispatchDedupeKey({ templateKey, targetId, recipientEmail }),
    observedAt: NOW,
  });
}

/** SES に出た全通の宛先（`Destination.ToAddresses` の先頭）。 */
function sesRecipients(): readonly string[] {
  return sesSent.map((request) => request.Destination.ToAddresses[0] ?? '');
}

/**
 * 🔴 `sandbox` で**実送信してよい宛先の全集合**を DB から導く（テストに書き写さない）。
 *
 * - ホスト所属利用者（`users.owner_partner_company_id IS NULL`）
 * - 招待中のホスト所属本人（`invitations.partner_company_id IS NULL`。`CLAUDE.md` §11.1
 *   「招待中の本人を含む」）
 * - 運営者（`platform_users`。分類外）
 *
 * 🔴 特権接続で引くのは「照合の基準」を作るためであり、検証対象の応答ではない。
 */
async function allowedSandboxRecipients(): Promise<ReadonlySet<string>> {
  const [hostUsers, hostInvitations, platformUsers] = await Promise.all([
    admin.user.findMany({
      where: { tenantId: TENANT.tenantId, ownerPartnerCompanyId: null },
      select: { email: true },
    }),
    admin.invitation.findMany({
      where: { tenantId: TENANT.tenantId, partnerCompanyId: null },
      select: { email: true },
    }),
    admin.platformUser.findMany({ select: { email: true } }),
  ]);
  return new Set([...hostUsers, ...hostInvitations, ...platformUsers].map((row) => row.email));
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW,
  });

  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  hostAdmin = await resolveTenantCtx(
    {
      tenantId: TENANT.tenantId,
      partnerCompanyId: null,
      userId: TENANT.hostOwnerUserId,
      role: 'ADMIN',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
  systemCtx = systemTenantCtx(TENANT.tenantId, {
    queue: 'email.dispatch',
    jobId: 'env-separation',
  });

  // 🔴 ①外向き遮断はここから有効にする。コンテナ起動とシード投入（Docker / Prisma）の
  //    後ろに置くのは、テストの主張と関係のない経路を巻き込まないためである。
  restoreNetworkGuard = installOutboundNetworkGuard();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  // 🔴 コンテナの後始末より**先に**外す。Vitest のワーカーはファイルをまたいで再利用されうるので、
  //    `node:net` への細工を残すと後続のテストへ漏れる。
  restoreNetworkGuard?.();
  restoreNetworkGuard = null;
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.emailDispatch.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: 'EMAIL_COUNT' } });
  await admin.invitation.deleteMany({ where: { email: { endsWith: `@${TEST_MAIL_DOMAIN}` } } });
  sesSent = [];
});

describe('🔴 ① 外向き遮断そのものの検証（docs/05 §17.4 / §17.6 ⑥）', () => {
  it('自己診断: 遮断が実際に効いている（「読み込まれたが効いていない」で green にしない）', () => {
    expect(isOutboundBlocked()).toBe(true);
  });

  it('🔴 net.connect の呼び出し形態を取りこぼさない（undici / http が渡す形を含む）', () => {
    // `net.connect(options)` / `net.connect(port, host)` は Node 内部で `[options, cb]` の
    // 配列 1 個に正規化されて `Socket.prototype.connect` に渡る。
    expect(() => net.connect({ host: OUTBOUND_PROBE_HOST, port: 443 })).toThrow(
      OutboundNetworkBlockedError,
    );
    expect(() => net.connect(443, OUTBOUND_PROBE_HOST)).toThrow(OutboundNetworkBlockedError);
    // `socket.connect(port, host)` の直接呼び出し（配列にならない形）。
    expect(() => new net.Socket().connect(443, OUTBOUND_PROBE_HOST)).toThrow(
      OutboundNetworkBlockedError,
    );
  });

  it('対照: ループバックは塞がない（この遮断下でも DB / Docker / MailHog は動く）', () => {
    const socket = net.connect(1, '127.0.0.1');
    // 接続の成否は問題にしていない（塞がれていないことだけを見る）。
    socket.on('error', () => {});
    socket.destroy();
    expect(socket.destroyed).toBe(true);
  });
});

describe.each(['development', 'demo'] as const)(
  '🔴 %s: 全分類の送信を実行し、外部エンドポイントへの発信が 0 件（docs/05 §17.4）',
  (appEnvKind) => {
    it('起動時 DI の選択が email=mock である（判断は 1 箇所。CLAUDE.md §11.1）', () => {
      expect(resolveConnectorSelection(loadAppEnv(buildValidEnv(appEnvKind))).email).toBe('mock');
    });

    it('🔴 全分類を単一経路に流しても SES へ 0 通。モックが全通を受ける（二重検証）', async () => {
      const { connectors } = connectorsFor(appEnvKind);

      for (const recipientClass of RECIPIENT_CLASSES) {
        await connectors.email.send(sendInput(recipientClass, `${recipientClass}@example.co.jp`));
      }

      // 🔴 対照: 分類の集合が縮んでいたら「全分類」の主張が空振りする。
      expect(RECIPIENT_CLASSES).toHaveLength(5);
      // ② モックの呼び出し回数（`docs/05` §13.2 の共通シグネチャから読む）。
      expect(connectors.email.callCount()).toBe(RECIPIENT_CLASSES.length);
      // ①' SES ポートは 1 度も呼ばれていない（実装が組み立て可能でも選ばれない）。
      expect(sesSent).toEqual([]);
    });

    it('🔴 ジョブ経路（email.dispatch）でも SES へ 0 通で、MOCKED として記録される', async () => {
      const { connectors, implementationKind } = connectorsFor(appEnvKind);
      const reservation = await reserveHostDispatch(
        `dispatch-${appEnvKind}`,
        SEED_EMAILS.hostOwner,
      );

      const outcome = await performEmailSend(sendDeps(connectors, implementationKind), {
        ctx: systemCtx,
        dispatch: (await readEmailDispatch(systemCtx, reservation.dispatchId))!,
        params: {},
      });

      expect(outcome).toEqual({ kind: 'MOCKED' });
      expect(sesSent).toEqual([]);
      const row = await admin.emailDispatch.findFirst({ where: { id: reservation.dispatchId } });
      // 🔴 `SENT` と取り違えない（`tenant.purge-scan` が配送済み判定に使う。`docs/05` §9.7）。
      expect(row?.status).toBe('MOCKED');
      expect(row?.sesMessageId).toBeNull();
    });

    it('🔴 ジョブ経路（account.mail）で取引先の担当者宛（分類 2）も SES へ 0 通', async () => {
      const { connectors, implementationKind } = connectorsFor(appEnvKind);
      const queue = new PendingAccountMailQueue();
      configureAccountMailQueue(queue);

      await issueInvitation(
        hostAdmin,
        {
          email: PARTNER_INVITEE,
          role: 'PARTNER_ADMIN',
          targetPartnerCompanyId: PARTNER.partnerCompanyId,
        },
        META,
        NOT_REQUIRED,
        // 🔴 `development` / `demo` は招待リンクを開示しない（開示は `sandbox` だけ。T-04-08）。
        () => INVITE_URL_NOT_DISCLOSED,
        NOW,
      );

      const outcomes = await drainAccountMail(
        queue,
        accountMailDeps(connectors, implementationKind),
      );

      expect(outcomes).toEqual(['MOCKED']);
      expect(sesSent).toEqual([]);
      expect(connectors.email.callCount()).toBe(1);
    });
  },
);

describe('🔴 sandbox ②: 分類 1 / 分類外が実際に送信され、宛先が限定される（docs/05 §17.4）', () => {
  it('起動時 DI の選択が email=sandboxRecipientScoped である', () => {
    expect(resolveConnectorSelection(loadAppEnv(buildValidEnv('sandbox'))).email).toBe(
      'sandboxRecipientScoped',
    );
  });

  it('🔴 全分類を単一経路に流すと、SES へ出るのは分類 1 と分類外だけ', async () => {
    const { connectors } = connectorsFor('sandbox');

    for (const recipientClass of RECIPIENT_CLASSES) {
      await connectors.email.send(
        sendInput(
          recipientClass,
          recipientClass === 'PLATFORM' ? PLATFORM_EMAIL : `${recipientClass}@example.co.jp`,
        ),
      );
    }

    // 実送信 + モックの合計は全分類ぶん（1 通も落としていない）。
    expect(connectors.email.callCount()).toBe(RECIPIENT_CLASSES.length);
    // 🔴 外部へ出たのは分類 1（`HOST_MEMBER`）と分類外（`PLATFORM`）だけである。
    expect(sesRecipients()).toEqual(['HOST_MEMBER@example.co.jp', PLATFORM_EMAIL]);
  });

  it('🔴 F-002: ホスト所属メンバーの招待が実送信され、SENT として記録される', async () => {
    const { connectors, implementationKind } = connectorsFor('sandbox');
    const queue = new PendingAccountMailQueue();
    configureAccountMailQueue(queue);

    await issueInvitation(
      hostAdmin,
      { email: HOST_INVITEE, role: 'SALES' },
      META,
      NOT_REQUIRED,
      () => INVITE_URL_NOT_DISCLOSED,
      NOW,
    );

    const outcomes = await drainAccountMail(queue, accountMailDeps(connectors, implementationKind));

    expect(outcomes).toEqual(['SENT']);
    expect(sesRecipients()).toEqual([HOST_INVITEE]);
    const row = await admin.emailDispatch.findFirst({ where: { recipientEmail: HOST_INVITEE } });
    expect(row?.status).toBe('SENT');
    expect(row?.recipientClass).toBe('HOST_MEMBER');
    // 🔴 実送信なので SES のメッセージ ID が残る（`MOCKED` と取り違えない）。
    expect(row?.sesMessageId).not.toBeNull();
  });

  it('🔴 F-003: パスワード再設定が本人へ実送信される（届かないと sandbox に戻れない）', async () => {
    const { connectors, implementationKind } = connectorsFor('sandbox');
    const queue = new PendingAccountMailQueue();
    configureAccountMailQueue(queue);

    await requestPasswordReset(SEED_EMAILS.hostOwner, META, NOW);

    const outcomes = await drainAccountMail(queue, accountMailDeps(connectors, implementationKind));

    expect(outcomes).toEqual(['SENT']);
    expect(sesRecipients()).toEqual([SEED_EMAILS.hostOwner]);
  });

  it('🔴 F-055（分類外）: ジョブ経路は未実装だが、黙ってモックに倒れず明示的に失敗する', async () => {
    const { connectors, implementationKind } = connectorsFor('sandbox');
    const handler = createEmailDispatchHandler(emailDispatchDeps(connectors, implementationKind));

    // 🔴 運営者宛は `EmailDispatch.tenant_id IS NULL` であり、主平面の DB ロールから到達できない
    //    （`docs/05` §4.4 C2 HOST_ONLY）。`F-055` を実装するタスクがこの分岐を置き換える。
    await expect(
      handler(
        {
          dispatchId: '01930000-0000-7000-8000-0000000000ff',
          tenantId: null,
          recipientClass: 'PLATFORM',
        },
        'job-platform',
      ),
    ).rejects.toBeInstanceOf(PlatformDispatchNotSupportedError);
    // 🔴 「送ったつもりで送れていない」を作らない（`CLAUDE.md` §11.1）。外部にも出ていない。
    expect(sesSent).toEqual([]);
    expect(connectors.email.callCount()).toBe(0);
  });

  it('🔴 全数検査: 分類を混在させても、SES へ出た全通の宛先が許可集合のみ', async () => {
    const { connectors, implementationKind } = connectorsFor('sandbox');
    const queue = new PendingAccountMailQueue();
    configureAccountMailQueue(queue);

    // 分類 1（招待 = `F-002` / 再設定 = `F-003`）と分類 2（取引先招待）を**同じ配線で**混ぜる。
    await issueInvitation(
      hostAdmin,
      { email: HOST_INVITEE, role: 'SALES' },
      META,
      NOT_REQUIRED,
      () => INVITE_URL_NOT_DISCLOSED,
      NOW,
    );
    await issueInvitation(
      hostAdmin,
      {
        email: PARTNER_INVITEE,
        role: 'PARTNER_ADMIN',
        targetPartnerCompanyId: PARTNER.partnerCompanyId,
      },
      META,
      NOT_REQUIRED,
      () => INVITE_URL_NOT_DISCLOSED,
      NOW,
    );
    await requestPasswordReset(SEED_EMAILS.hostOwner, META, NOW);
    await drainAccountMail(queue, accountMailDeps(connectors, implementationKind));
    // 分類外（`F-055`）はジョブ経路が未実装なので単一経路で足す（上のケース参照）。
    await connectors.email.send(sendInput('PLATFORM', PLATFORM_EMAIL));

    const allowed = await allowedSandboxRecipients();
    const recipients = sesRecipients();

    // 🔴 空振り防止: 1 通も送っていなければ「全通が許可集合内」は自明に成立してしまう。
    expect([...recipients].sort()).toEqual(
      [HOST_INVITEE, SEED_EMAILS.hostOwner, PLATFORM_EMAIL].sort(),
    );
    for (const recipient of recipients) {
      expect(
        allowed.has(recipient),
        `${recipient} はホスト所属利用者でも PlatformUser でもない`,
      ).toBe(true);
    }
    // 🔴 取引先の担当者宛は 1 通も外部に出ていない（Issue #9 / #10。最も避けたい事故）。
    expect(recipients).not.toContain(PARTNER_INVITEE);
    expect(allowed.has(PARTNER_INVITEE)).toBe(false);
    // 単一経路（実送信 + モック）としては 4 通すべてが流れている（握り潰していない）。
    expect(connectors.email.callCount()).toBe(4);
  });
});
