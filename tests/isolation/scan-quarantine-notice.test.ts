// tests/isolation/scan-quarantine-notice.test.ts
// 🔴 T-05-08 の完了判定を **DB + RLS + 送信の単一経路**で実証する（`docs/02` `F-011` 処理④）。
//
// ============================================================================
// 🔴 何を証明するのか（SP-05 §T-05-08 の「分類 1 / 2 の両方で周知が成立する」）
// ============================================================================
//   ① **アプリ内表示は分類によらず必ず成立する** —— ホストにもパートナーにも、
//      自分が所有する隔離された版が見える（`readQuarantinedSkillSheets`）。
//   ② **メールの宛先は所有側に閉じる** —— ホスト所有の隔離が取引先へ、
//      取引先所有の隔離がホストへ行かない（`CLAUDE.md` §3.1 の第二境界）。
//   ③ 🔴 **`sandbox` の実送信 / モックは宛先分類で分かれる**（`A-22` / `CLAUDE.md` §11.1）——
//      分類 1 は SES ポートに 1 通出て `SENT`、分類 2 は SES ポートに 1 通も出ず `MOCKED`。
//   ④ **重複配信・再実行で 1 通に収束する**（`EmailDispatch.dedupeKey` の `UNIQUE`）。
//
// ============================================================================
// 🔴 MailHog を使わない（`CLAUDE.md` §8.7 で `docs/sprints/SP-05` を訂正済み）
// ============================================================================
// SP-05 §T-05-08 は当初「MailHog + アプリ内表示」と書いていたが、**`sandbox` の分類 1 は
// `SesEmailSender`（SES の HTTP API）を通る**（`resolveConnectorSelection('sandbox')`
// → `sandboxRecipientScoped` → `real` = SES）。MailHog は `development` のローカル SMTP
// キャッチャであり、この経路上に存在しない（SMTP で送る実装はリポジトリに 1 つも無い）。
// これは T-04-10 が `docs/05` §17.4 について下したのと**同じ決着**であり、同じ読み替え
// （**SES ポートの観測 + モック側の記録**）を採る。
//
// 🔴 実 SES / 実 S3 / 実 GuardDuty に接続しない（`SesApi` はスタブ、スキャンは
//    `applyFileScanResult` を直接呼ぶ）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createConnectors,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  type Connectors,
  type ConnectorImplementationKind,
  type SesApi,
  type SesSendEmailRequest,
  type VerifiedSendingDomain,
} from '@ses/connectors';
import {
  applyFileScanResult,
  configureTenantDb,
  disconnectTenantDb,
  readScanQuarantineNotice,
  resolveTenantCtx,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
// 🔴 ルートの package.json は `@ses/config` を依存に持たないため、実装のソースを相対 import する
//    （`tests/isolation/**` の既存ファイルと同じ扱い）。
import { resolveConnectorSelection } from '../../packages/config/src/connector-selection.js';
import { loadAppEnv } from '../../packages/config/src/load-env.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';
import {
  createEmailDispatchHandler,
  type EmailDispatchDeps,
} from '../../apps/worker/src/jobs/email-dispatch.js';
import { createOperationalMailParamsResolver } from '../../apps/worker/src/jobs/operational-mail-params.js';
import {
  notifyScanQuarantine,
  SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
} from '../../apps/worker/src/jobs/scan-quarantine-notice.js';
import { readQuarantinedSkillSheets } from '../../apps/web/lib/skill-sheets/service.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-06T04:00:00.000Z');

const TENANT = ISOLATION_SEED_IDS.tenants[0];
const OTHER_TENANT = ISOLATION_SEED_IDS.tenants[1];
const PARTNER = TENANT.partners[0];
const OTHER_PARTNER = TENANT.partners[1];

/**
 * 🔴 シードの取引先には `PARTNER_SALES` しか居ない（`packages/db/seed/presets/isolation.ts`）。
 *    周知メールの宛先は**所有側の管理ロール**（`PARTNER_ADMIN`）なので、ここで 1 人作る。
 *    運用上、取引先には招待の時点で必ず `PARTNER_ADMIN` が居る（`F-007` / `CLAUDE.md` §1.2）。
 */
const PARTNER_ADMIN_USER_ID = '01930000-0000-7000-8000-00000000aa01';
const PARTNER_ADMIN_MEMBERSHIP_ID = '01930000-0000-7000-8000-00000000aa02';
const PARTNER_ADMIN_EMAIL = 'partner-admin@scan-quarantine.test';
/** 🔴 他社（同一テナント内の別パートナー）の管理者。**1 通も届いてはならない**対照である。 */
const OTHER_PARTNER_ADMIN_USER_ID = '01930000-0000-7000-8000-00000000aa03';
const OTHER_PARTNER_ADMIN_MEMBERSHIP_ID = '01930000-0000-7000-8000-00000000aa04';
const OTHER_PARTNER_ADMIN_EMAIL = 'other-partner-admin@scan-quarantine.test';

const VERIFIED_DOMAIN: VerifiedSendingDomain = {
  domain: 'scan-quarantine.example',
  mailFromDomain: 'mail.scan-quarantine.example',
  verifiedAt: NOW,
};

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続（検証のクエリには使わない）。 */
let admin: UnextendedClient;
let jobCtx: SystemTenantCtx;
let hostCtx: AuthenticatedTenantCtx;
let partnerCtx: AuthenticatedTenantCtx;
let otherPartnerCtx: AuthenticatedTenantCtx;
/** 🔴 SES ポート（外部エンドポイント）に出た通数と宛先。 */
let sesSent: SesSendEmailRequest[];
let enqueued: { dispatchId: string; tenantId: string | null; recipientClass: string }[];

let sheetSeq = 0;

async function createSkillSheet(spec: {
  readonly tenantId: string;
  readonly engineerId: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly uploadedBy: string;
}): Promise<{ readonly id: string; readonly objectKey: string }> {
  sheetSeq += 1;
  const objectKey = `t/${spec.tenantId}/skill-sheets/${spec.engineerId}/${sheetSeq}/${crypto.randomUUID()}.xlsx`;
  const row = await admin.skillSheet.create({
    data: {
      tenantId: spec.tenantId,
      ownerPartnerCompanyId: spec.ownerPartnerCompanyId,
      engineerId: spec.engineerId,
      version: sheetSeq,
      objectKey,
      contentType: 'application/pdf',
      byteSize: 1_000n,
      scanStatus: 'SCANNING',
      isLatest: false,
      uploadedBy: spec.uploadedBy,
      uploadedAt: new Date('2026-09-06T03:00:00.000Z'),
    },
    select: { id: true },
  });
  return { id: row.id, objectKey };
}

/** 🔴 隔離まで進める（`scan.apply-result` / `scan.poll` と**同じ関数**を通す）。 */
async function quarantine(objectKey: string, status: 'INFECTED' | 'FAILED' | 'UNSCANNABLE') {
  return applyFileScanResult(jobCtx, {
    objectKey,
    objectVersionId: `v-${sheetSeq}`,
    status,
    rawStatus: status === 'INFECTED' ? 'THREATS_FOUND' : 'ACCESS_DENIED',
    occurredAt: NOW,
    receivedAt: NOW,
  });
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

/** 🔴 `sandbox` のコネクタを**起動時 DI の判断そのもの**（`resolveConnectorSelection`）から組む。 */
function sandboxConnectors(): {
  readonly connectors: Connectors;
  readonly implementationKind: ConnectorImplementationKind;
} {
  const selection = resolveConnectorSelection(loadAppEnv(buildValidEnv('sandbox')));
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

function emailDispatchDeps(): EmailDispatchDeps {
  const { connectors, implementationKind } = sandboxConnectors();
  return {
    emailSender: connectors.email,
    emailImplementationKind: implementationKind,
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    // 🔴 分類 2 は「取引先へ届く送信」なので検証済みドメインが要る（`BR-51`）。
    //    ここで止まると「未検証だから外部に出なかった」になり、分類の検証にならない。
    resolveSendingDomain: async () => VERIFIED_DOMAIN,
    now: () => NOW,
    // 🔴 差し込み値は実装（`createOperationalMailParamsResolver`）をそのまま使う。
    //    テスト専用の `() => ({})` を渡すと、テンプレート未登録の検出が空振りする。
    resolveTemplateParams: createOperationalMailParamsResolver({
      appUrl: 'https://sandbox.example.test',
    }),
  };
}

/** 積まれた `email.dispatch` を 1 件ずつ実行する（BullMQ の配線は SP-07）。 */
async function drainEmailDispatch(): Promise<readonly string[]> {
  const handler = createEmailDispatchHandler(emailDispatchDeps());
  const outcomes: string[] = [];
  for (const job of enqueued) {
    outcomes.push((await handler(job, `job-${outcomes.length}`)).kind);
  }
  return outcomes;
}

async function notify(objectKey: string) {
  return notifyScanQuarantine(
    {
      enqueueEmailDispatch: async (job) => {
        enqueued.push({ ...job });
      },
    },
    jobCtx,
    { objectKey, observedAt: NOW },
  );
}

async function dispatchRows() {
  return admin.emailDispatch.findMany({
    where: { templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY },
    select: { recipientEmail: true, recipientClass: true, status: true, dedupeKey: true },
    orderBy: { recipientEmail: 'asc' },
  });
}

async function tenantCtxOf(
  userId: string,
  partnerCompanyId: string | null,
  role: 'OWNER' | 'PARTNER_ADMIN',
  tenantId: string = TENANT.tenantId,
): Promise<AuthenticatedTenantCtx> {
  return resolveTenantCtx(
    {
      tenantId,
      partnerCompanyId,
      userId,
      role,
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
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

  for (const spec of [
    {
      userId: PARTNER_ADMIN_USER_ID,
      membershipId: PARTNER_ADMIN_MEMBERSHIP_ID,
      email: PARTNER_ADMIN_EMAIL,
      partnerCompanyId: PARTNER.partnerCompanyId,
    },
    {
      userId: OTHER_PARTNER_ADMIN_USER_ID,
      membershipId: OTHER_PARTNER_ADMIN_MEMBERSHIP_ID,
      email: OTHER_PARTNER_ADMIN_EMAIL,
      partnerCompanyId: OTHER_PARTNER.partnerCompanyId,
    },
  ]) {
    await admin.user.create({
      data: {
        id: spec.userId,
        tenantId: TENANT.tenantId,
        ownerPartnerCompanyId: spec.partnerCompanyId,
        email: spec.email,
        displayName: '架空 管理者',
        passwordHash: 'x'.repeat(60),
      },
    });
    await admin.membership.create({
      data: {
        id: spec.membershipId,
        tenantId: TENANT.tenantId,
        userId: spec.userId,
        role: 'PARTNER_ADMIN',
        partnerCompanyId: spec.partnerCompanyId,
        joinedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
  }

  jobCtx = systemTenantCtx(TENANT.tenantId, {
    queue: 'scan.apply-result',
    jobId: 'scan-quarantine-notice',
  });
  hostCtx = await tenantCtxOf(TENANT.hostOwnerUserId, null, 'OWNER');
  partnerCtx = await tenantCtxOf(PARTNER_ADMIN_USER_ID, PARTNER.partnerCompanyId, 'PARTNER_ADMIN');
  otherPartnerCtx = await tenantCtxOf(
    OTHER_PARTNER_ADMIN_USER_ID,
    OTHER_PARTNER.partnerCompanyId,
    'PARTNER_ADMIN',
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.emailDispatch.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: 'EMAIL_COUNT' } });
  await admin.fileScanResult.deleteMany({});
  await admin.skillSheet.deleteMany({});
  sesSent = [];
  enqueued = [];
});

describe('🔴 ① アプリ内表示は宛先分類によらず必ず成立する（F-011 処理④ の 🔴）', () => {
  it('ホスト所有・パートナー所有のどちらの隔離も、所有側の画面に出る', async () => {
    const hostSheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    const partnerSheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: PARTNER.engineerId,
      ownerPartnerCompanyId: PARTNER.partnerCompanyId,
      uploadedBy: PARTNER.userId,
    });
    await quarantine(hostSheet.objectKey, 'INFECTED');
    await quarantine(partnerSheet.objectKey, 'FAILED');

    const hostView = await readQuarantinedSkillSheets(hostCtx);
    const partnerView = await readQuarantinedSkillSheets(partnerCtx);

    // 🔴 どちらも空でない = 「パートナーの担当者が隔離に気づけない状態」が存在しない。
    expect(hostView.map((row) => row.id)).toEqual([hostSheet.id]);
    expect(partnerView.map((row) => row.id)).toEqual([partnerSheet.id]);
  });

  it('🔴 第二境界: ホストは取引先所有の隔離を見ない / 取引先は他社の隔離を見ない', async () => {
    const partnerSheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: PARTNER.engineerId,
      ownerPartnerCompanyId: PARTNER.partnerCompanyId,
      uploadedBy: PARTNER.userId,
    });
    await quarantine(partnerSheet.objectKey, 'INFECTED');

    expect(await readQuarantinedSkillSheets(hostCtx)).toEqual([]);
    expect(await readQuarantinedSkillSheets(otherPartnerCtx)).toEqual([]);
    expect((await readQuarantinedSkillSheets(partnerCtx)).map((row) => row.id)).toEqual([
      partnerSheet.id,
    ]);
  });

  it('🔴 CLEAN / SCANNING の版は出ない（検査中を「失敗」として見せない。F-011 AC-2）', async () => {
    const scanning = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    const clean = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(clean.objectKey, 'INFECTED');
    await admin.skillSheet.update({ where: { id: clean.id }, data: { scanStatus: 'CLEAN' } });

    const view = await readQuarantinedSkillSheets(hostCtx);
    expect(view.map((row) => row.id)).not.toContain(scanning.id);
    expect(view.map((row) => row.id)).not.toContain(clean.id);
  });

  it('🔴 氏名を返さない（BR-27。ホームは 60 秒ごとに読み直される）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'UNSCANNABLE');
    const engineer = await admin.engineer.findUniqueOrThrow({
      where: { id: TENANT.hostEngineerId },
      select: { displayName: true },
    });

    const view = await readQuarantinedSkillSheets(hostCtx);
    expect(JSON.stringify(view)).not.toContain(engineer.displayName);
    expect(Object.keys(view[0] ?? {}).sort()).toEqual([
      'detectedAt',
      'engineerId',
      'id',
      'scanStatus',
      'version',
    ]);
  });
});

describe('🔴 ② メールの宛先は所有側に閉じる（CLAUDE.md §3.1 の第二境界）', () => {
  it('ホスト所有の隔離は分類 1 だけに届く（取引先には 1 通も行かない）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');
    const outcome = await notify(sheet.objectKey);

    expect(outcome).toEqual({ kind: 'NOTIFIED', recipients: 1, queued: 1 });
    const rows = await dispatchRows();
    expect(rows.map((row) => row.recipientClass)).toEqual(['HOST_MEMBER']);
    // 🔴 取引先の管理者は 1 人も含まれない。
    expect(rows.map((row) => row.recipientEmail)).not.toContain(PARTNER_ADMIN_EMAIL);
    expect(rows.map((row) => row.recipientEmail)).not.toContain(OTHER_PARTNER_ADMIN_EMAIL);
  });

  it('🔴 取引先所有の隔離はその取引先の管理者だけに届く（ホストにも他社にも行かない）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: PARTNER.engineerId,
      ownerPartnerCompanyId: PARTNER.partnerCompanyId,
      uploadedBy: PARTNER.userId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');
    await notify(sheet.objectKey);

    const rows = await dispatchRows();
    expect(rows.map((row) => row.recipientEmail)).toEqual([PARTNER_ADMIN_EMAIL]);
    expect(rows.map((row) => row.recipientClass)).toEqual(['PARTNER_MEMBER']);
  });

  it('🔴 所有側は入力ではなく DB の行（owner_partner_company_id）から決まる', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: PARTNER.engineerId,
      ownerPartnerCompanyId: PARTNER.partnerCompanyId,
      uploadedBy: PARTNER.userId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');

    // 🔴 ジョブ文脈はホスト（`partnerCompanyId = null`）である。それでも
    //    `app_scan_quarantine_target` 経由で取引先所有だと分かる（C3 を素通りしない）。
    const notice = await readScanQuarantineNotice(jobCtx, { objectKey: sheet.objectKey });
    expect(notice?.target.ownerPartnerCompanyId).toBe(PARTNER.partnerCompanyId);
    expect(notice?.recipients.map((row) => row.recipientClass)).toEqual(['PARTNER_MEMBER']);
  });

  it('🔴 他テナントの文脈からは同じオブジェクトキーに到達できない', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');

    const foreign = systemTenantCtx(OTHER_TENANT.tenantId, {
      queue: 'scan.apply-result',
      jobId: 'foreign',
    });
    expect(await readScanQuarantineNotice(foreign, { objectKey: sheet.objectKey })).toBeNull();
  });

  it('隔離でない（CLEAN）版は 1 通も積まない', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');
    await admin.skillSheet.update({ where: { id: sheet.id }, data: { scanStatus: 'CLEAN' } });

    await expect(notify(sheet.objectKey)).resolves.toEqual({ kind: 'NOT_QUARANTINED' });
    expect(await dispatchRows()).toEqual([]);
  });
});

describe('🔴 ③ sandbox の実送信 / モックは宛先分類で分かれる（A-22 / CLAUDE.md §11.1）', () => {
  async function quarantineBoth() {
    const hostSheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    const partnerSheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: PARTNER.engineerId,
      ownerPartnerCompanyId: PARTNER.partnerCompanyId,
      uploadedBy: PARTNER.userId,
    });
    await quarantine(hostSheet.objectKey, 'INFECTED');
    await quarantine(partnerSheet.objectKey, 'INFECTED');
    await notify(hostSheet.objectKey);
    await notify(partnerSheet.objectKey);
    return { hostSheet, partnerSheet };
  }

  it('🔴 分類 1 は SES ポートへ 1 通出て SENT、分類 2 は 1 通も出ず MOCKED になる', async () => {
    await quarantineBoth();
    expect(enqueued).toHaveLength(2);

    const outcomes = [...(await drainEmailDispatch())].sort();
    expect(outcomes).toEqual(['MOCKED', 'SENT']);

    const hostOwner = await admin.user.findUniqueOrThrow({
      where: { id: TENANT.hostOwnerUserId },
      select: { email: true },
    });
    // 🔴 SES ポートに出た宛先は**ホスト所属の 1 通だけ**である。
    const sesRecipients = sesSent.map((request) => request.Destination.ToAddresses[0] ?? '');
    expect(sesRecipients).toEqual([hostOwner.email]);
    expect(sesRecipients).not.toContain(PARTNER_ADMIN_EMAIL);

    const rows = await dispatchRows();
    expect(
      rows.map((row) => [row.recipientClass, row.status]).sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? '')),
    ).toEqual([
      ['HOST_MEMBER', 'SENT'],
      ['PARTNER_MEMBER', 'MOCKED'],
    ]);
  });

  it('🔴 メール本文の差し込み値はアプリへのリンク 1 つだけ（内容を運ばない）', async () => {
    await quarantineBoth();
    await drainEmailDispatch();

    const templateData = sesSent.map((request) => request.Content.Template.TemplateData);
    expect(templateData).toEqual(['{"link":"https://sandbox.example.test/"}']);
    // 🔴 版・エンジニア・オブジェクトキーのいずれも本文に現れない。
    expect(JSON.stringify(sesSent)).not.toContain('skill-sheets/');
    expect(sesSent[0]?.Content.Template.TemplateName).toBe(SKILL_SHEET_QUARANTINE_TEMPLATE_KEY);
  });
});

describe('🔴 ④ 重複配信・再実行で 1 通に収束する（EmailDispatch.dedupeKey の UNIQUE）', () => {
  it('同じ隔離を 3 回周知しても行は 1 つ', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');

    await notify(sheet.objectKey);
    await notify(sheet.objectKey);
    await notify(sheet.objectKey);

    expect(await dispatchRows()).toHaveLength(1);
  });

  it('🔴 送信済みの後に再実行しても積み直さない（空撃ちしない）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');
    await notify(sheet.objectKey);
    await drainEmailDispatch();
    enqueued = [];

    await expect(notify(sheet.objectKey)).resolves.toEqual({
      kind: 'NOTIFIED',
      recipients: 1,
      queued: 0,
    });
    expect(enqueued).toEqual([]);
    expect(sesSent).toHaveLength(1);
  });

  it('🔴 状態が悪化したら改めて 1 通送る（検査不能の通知は感染の周知になっていない）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'UNSCANNABLE');
    await notify(sheet.objectKey);
    await quarantine(sheet.objectKey, 'INFECTED');
    await notify(sheet.objectKey);

    const rows = await dispatchRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.dedupeKey)).size).toBe(2);
  });

  it('🔴 順序逆転（INFECTED の後に CLEAN が届く）でも周知は隔離のままである', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT.tenantId,
      engineerId: TENANT.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT.hostUserId,
    });
    await quarantine(sheet.objectKey, 'INFECTED');
    await applyFileScanResult(jobCtx, {
      objectKey: sheet.objectKey,
      objectVersionId: 'v-late',
      status: 'CLEAN',
      rawStatus: 'NO_THREATS_FOUND',
      occurredAt: NOW,
      receivedAt: NOW,
    });

    await notify(sheet.objectKey);
    const rows = await dispatchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupeKey).toContain('#INFECTED');
  });
});
