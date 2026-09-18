// tests/isolation/seed-perf.test.ts
// 🔴 T-12-01（`docs/sprints/SP-12-phase1-hardening.md` §4 T-12-01）: **`seed:perf`（負荷測定の母集団。docs/03 §3.7.2）** を
//    **実 DB（RLS 付き）** で証明する。docs/05 §13.6 / `CLAUDE.md` §7（p95 1 秒）/ `BR-47` / `F-053 AC-2`（冪等な再生成）。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 規模が仕様どおり: `engineers` 10,000 / `projects` 10,000 / `engineer_shares` 2,000（全件が最大テナント）/ 30 テナント /
//      最大テナントがエンジニア 3,000・案件 3,000・取引先 15 社 / `skill_sheets` 0 行 / 経歴は 1 人 2〜4 行（約 3 万行）
//   ② 🔴 合成データのみ（`BR-47`）: 商号は接頭辞規則、氏名は「規則の姓 + 空白 + 規則の名」、メール・送信ドメインは `.example`、
//      電話・生年月日は置かない
//   ③ 検索が当たる分布（`F-009` / `F-015` の条件が最大テナントで数百件当たる。全 47 都道府県が現れる）と、状態機械を通した
//      少量の提案・稼働（`DRAFT` / `APPROVAL_PENDING` / `SUBMITTED` / `WON` + `Assignment(ACTIVE, T+55)`）
//   ④ 🔴 冪等な再生成（`F-053 AC-2`）: `--reset` → 再投入で**行数が不変・ID と値が一致**し、同居する `isolation` プリセットの
//      テナントの行数は 1 行も変わらない（`deleteTenantData` が `preset.tenantIds` に閉じる）
//   ⑤ `readSeedPresence` / `ALREADY_SEEDED` / `SeedIncompleteError` の契約が `demo` と同じ（`reset: false` で投入済みなら
//      何も書かず、テナントが一部だけなら 409 相当の例外）
//
// 🔴 投入は 2 回（① の初回 + ④ の再生成）。1 回あたりローカルで 1 分前後かかるため、タイムアウトは `hookTimeout` と同じ 600 秒。
//    実 API に接続しない（`APP_ENV=development` の環境ガードで投入し、送信系は呼ばれない）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  countTenantRows,
  DEMO_SEED_NAME_RULES,
  GLOBAL_SKILL_IDS,
  ISOLATION_SEED_IDS,
  PERF_SEED_NAME_RULES,
  PERF_SEED_PROFILES,
  PERF_SEED_TENANT_IDS,
  PERF_SEED_TOTALS,
  perfPartnerEngineerCount,
  perfPartnerShareCount,
  perfSeedCompanyNames,
  perfSeedDomain,
  perfSeedIds,
  readPerfSeedScale,
  readSeedPresence,
  runSeed,
  getSeedPreset,
  SeedIncompleteError,
  type RunSeedResult,
} from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const RESEED_TIMEOUT_MS = 600_000;
/** 「実行日 = T」。相対日（満了 `T+55` / 送信 `T-5`）の検証に固定値が要る。 */
const NOW = new Date('2026-09-18T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const LARGEST = perfSeedIds(PERF_SEED_TOTALS.largestTenantIndex);
const LARGEST_PROFILE = PERF_SEED_PROFILES[0]!;
const SMALLEST = perfSeedIds(30);
const ISOLATION_TENANT_IDS = ISOLATION_SEED_IDS.tenants.map((tenant) => tenant.tenantId);

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続（superuser は RLS を素通りする）。 */
let admin: UnextendedClient;
let firstRun: RunSeedResult;
let firstDurationMs: number;
let isolationCountsBefore: Record<string, number>;

function seedOptions(reset: boolean) {
  return { appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'perf' as const, reset, now: NOW };
}

function isRulePersonName(value: string): boolean {
  const [family, given, ...rest] = value.split(' ');
  return (
    rest.length === 0 &&
    family !== undefined &&
    given !== undefined &&
    (PERF_SEED_NAME_RULES.familyNames as readonly string[]).includes(family) &&
    (PERF_SEED_NAME_RULES.givenNames as readonly string[]).includes(given)
  );
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  admin = createUnextendedClient(database.superuserUrl);
  // 🔴 同居する別プリセット（`isolation`）を先に入れておき、`perf` の reset が巻き添えにしないことを見る。
  await runSeed({ appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'isolation', reset: true, now: NOW });
  isolationCountsBefore = await countTenantRows(admin, ISOLATION_TENANT_IDS);
  const startedAt = Date.now();
  firstRun = await runSeed(seedOptions(true));
  firstDurationMs = Date.now() - startedAt;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// ① 規模
// ---------------------------------------------------------------------------

describe('① 🔴 規模が仕様どおり（docs/03 §3.7.2: 1 万 / 1 万 / 匿名共有 2,000。最大テナント 3,000 / 3,000 / 15 社）', () => {
  it('投入は SEEDED で、テナント ID で絞った実測がちょうど仕様の件数になる', async () => {
    expect(firstRun.outcome).toBe('SEEDED');
    expect(firstRun.tenantIds).toEqual(PERF_SEED_TENANT_IDS);
    expect(firstRun.counts.tenants).toBe(PERF_SEED_TOTALS.tenants);
    expect(firstRun.counts.engineers).toBe(PERF_SEED_TOTALS.engineers);
    expect(firstRun.counts.projects).toBe(PERF_SEED_TOTALS.projects);
    expect(firstRun.counts.engineer_shares).toBe(PERF_SEED_TOTALS.engineerShares);
    // 🔴 スキルシートの原本は 1 行も作らない（`countTenantRows` は 0 行の表を載せない）。
    expect(firstRun.counts.skill_sheets).toBeUndefined();
    expect(await admin.skillSheet.count({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } } })).toBe(0);
    // 経歴は 1 人 2〜4 行（T-09-12 の凍結対象。約 3 万行）。
    expect(firstRun.counts.engineer_careers).toBeGreaterThan(20_000);
    expect(firstRun.counts.engineer_careers).toBeLessThan(40_000);
    // 所要時間の実測（目安: ローカルの Postgres で 2 分以内。CI のコンテナでは上限を緩める）。
    console.info(`seed:perf 初回投入 ${firstDurationMs} ms`);
    expect(firstDurationMs).toBeLessThan(SETUP_TIMEOUT_MS);
  });

  it('🔴 最大テナントがエンジニア 3,000 / 案件 3,000 / 取引先 15 社で、匿名共有 2,000 件はすべてそこに置かれている', async () => {
    const scale = await readPerfSeedScale(admin);
    expect(scale).toEqual({
      tenants: 30,
      engineers: 10_000,
      projects: 10_000,
      engineerShares: 2_000,
      skillSheets: 0,
      largestEngineers: 3_000,
      largestProjects: 3_000,
      largestPartners: 15,
      largestShares: 2_000,
    });
    // 各取引先の共有件数は配分（133 / 134）どおりで、共有元 = エンジニアの所属会社。
    const shares = await admin.engineerShare.findMany({
      where: { tenantId: LARGEST.tenantId },
      select: { partnerCompanyId: true, revokedAt: true, engineer: { select: { ownerPartnerCompanyId: true } } },
    });
    expect(shares).toHaveLength(2_000);
    for (const share of shares) {
      expect(share.revokedAt).toBeNull();
      expect(share.engineer.ownerPartnerCompanyId).toBe(share.partnerCompanyId);
    }
    for (const partner of LARGEST.partners) {
      const owned = await admin.engineer.count({ where: { tenantId: LARGEST.tenantId, ownerPartnerCompanyId: partner.partnerCompanyId } });
      expect(owned).toBe(perfPartnerEngineerCount(LARGEST_PROFILE, partner.partnerIndex));
      expect(shares.filter((share) => share.partnerCompanyId === partner.partnerCompanyId)).toHaveLength(
        perfPartnerShareCount(LARGEST_PROFILE, partner.partnerIndex),
      );
    }
  });

  it('🔴 均等割ではない: 各テナントのエンジニア・案件・取引先の件数が配分表と一致する', async () => {
    const engineers = await admin.engineer.groupBy({ by: ['tenantId'], where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, _count: { _all: true } });
    const projects = await admin.project.groupBy({ by: ['tenantId'], where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, _count: { _all: true } });
    const partners = await admin.partnerCompany.groupBy({ by: ['tenantId'], where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, _count: { _all: true } });
    const countOf = (rows: readonly { tenantId: string; _count: { _all: number } }[], tenantId: string): number =>
      rows.find((row) => row.tenantId === tenantId)?._count._all ?? 0;
    for (const profile of PERF_SEED_PROFILES) {
      const { tenantId } = perfSeedIds(profile.tenantIndex);
      expect(countOf(engineers, tenantId), `tenant ${profile.tenantIndex} engineers`).toBe(profile.engineers);
      expect(countOf(projects, tenantId), `tenant ${profile.tenantIndex} projects`).toBe(profile.projects);
      expect(countOf(partners, tenantId), `tenant ${profile.tenantIndex} partners`).toBe(profile.partners);
    }
    // 他テナントには共有が無い（2,000 件は最大テナントに集中）。
    expect(await admin.engineerShare.count({ where: { tenantId: { in: PERF_SEED_TENANT_IDS.filter((id) => id !== LARGEST.tenantId) } } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ② 合成データのみ
// ---------------------------------------------------------------------------

describe('② 🔴 BR-47: 投入された全行が架空であることが語から分かる規則に従う', () => {
  it('テナント・取引先の商号は接頭辞規則に従い、投入時の式と一致する。送信ドメインは .example の VERIFIED 行だけ', async () => {
    const tenants = await admin.tenant.findMany({ where: { id: { in: [...PERF_SEED_TENANT_IDS] } }, select: { id: true, name: true, environment: true, lifecycleState: true, lifecycleChangedAt: true } });
    expect(tenants).toHaveLength(30);
    for (const profile of PERF_SEED_PROFILES) {
      const ids = perfSeedIds(profile.tenantIndex);
      const tenant = tenants.find((row) => row.id === ids.tenantId);
      expect(tenant?.name).toBe(perfSeedCompanyNames(profile.tenantIndex).host);
      expect(tenant?.name.startsWith(PERF_SEED_NAME_RULES.hostCompanyPrefix)).toBe(true);
      expect(tenant?.environment).toBe('demo');
      expect(tenant?.lifecycleState).toBe('ACTIVE');
      expect(tenant?.lifecycleChangedAt.getTime()).toBe(NOW.getTime());
    }
    const partners = await admin.partnerCompany.findMany({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, select: { name: true, contactName: true, contactEmail: true } });
    expect(partners).toHaveLength(PERF_SEED_PROFILES.reduce((sum, row) => sum + row.partners, 0));
    for (const partner of partners) {
      expect(partner.name.startsWith(PERF_SEED_NAME_RULES.partnerCompanyPrefix), partner.name).toBe(true);
      expect(isRulePersonName(partner.contactName ?? ''), partner.contactName ?? '').toBe(true);
      expect(partner.contactEmail?.endsWith('.example'), partner.contactEmail ?? '').toBe(true);
    }
    expect(new Set(partners.map((partner) => partner.name)).size).toBe(partners.length);
    const domains = await admin.tenantSendingDomain.findMany({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, select: { domain: true, state: true, mailFromDomain: true, verifiedAt: true } });
    expect(domains.map((row) => row.domain).sort()).toEqual(PERF_SEED_PROFILES.map((row) => perfSeedDomain(row.tenantIndex)).sort());
    for (const domain of domains) {
      expect(domain.domain.endsWith('.example')).toBe(true);
      expect(domain.state).toBe('VERIFIED');
      expect(domain.verifiedAt).not.toBeNull();
      expect(domain.mailFromDomain).toBe(`mail.${domain.domain}`);
    }
  });

  it('🔴 エンジニア 1 万件・利用者の氏名はすべて「規則の姓 + 空白 + 規則の名」で、現所属会社名は架空の商号、電話・生年月日は無い', async () => {
    const engineers = await admin.engineer.findMany({
      where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } },
      select: { displayName: true, affiliationLabel: true, contactEmail: true, contactPhone: true, birthDate: true, ownerPartnerCompanyId: true },
    });
    expect(engineers).toHaveLength(10_000);
    for (const engineer of engineers) {
      expect(isRulePersonName(engineer.displayName), engineer.displayName).toBe(true);
      if (engineer.ownerPartnerCompanyId === null) {
        expect(engineer.affiliationLabel).toBeNull();
      } else {
        expect(engineer.affiliationLabel?.startsWith(PERF_SEED_NAME_RULES.partnerCompanyPrefix), engineer.affiliationLabel ?? '').toBe(true);
      }
      expect(engineer.contactEmail?.endsWith('.example'), engineer.contactEmail ?? '').toBe(true);
      expect(engineer.contactPhone).toBeNull();
      expect(engineer.birthDate).toBeNull();
    }
    const users = await admin.user.findMany({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, select: { displayName: true, email: true } });
    expect(users).toHaveLength(PERF_SEED_PROFILES.reduce((sum, row) => sum + 4 + row.partners * 2, 0));
    for (const user of users) {
      expect(isRulePersonName(user.displayName), user.displayName).toBe(true);
      expect(user.email.endsWith('.example'), user.email).toBe(true);
    }
  });

  it('エンド企業名（projects.end_client_name / proposals.recipient_company_name）は「架空〜株式会社」だけで、提案先メールは .example', async () => {
    const projects = await admin.project.findMany({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, select: { endClientName: true } });
    expect(projects).toHaveLength(10_000);
    for (const project of projects) {
      expect(project.endClientName?.startsWith(DEMO_SEED_NAME_RULES.endClientPrefix), project.endClientName ?? '').toBe(true);
    }
    const proposals = await admin.proposal.findMany({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, select: { recipientCompanyName: true, recipientEmail: true } });
    expect(proposals).toHaveLength(30 * 4);
    for (const proposal of proposals) {
      expect(proposal.recipientCompanyName.startsWith(DEMO_SEED_NAME_RULES.endClientPrefix), proposal.recipientCompanyName).toBe(true);
      expect(proposal.recipientEmail.endsWith('.example'), proposal.recipientEmail).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 検索が当たる分布 / 状態機械を通した少量の提案・稼働
// ---------------------------------------------------------------------------

describe('③ 検索が当たる分布（F-009 / F-015）と、transition() を通した提案・稼働', () => {
  it('最大テナントで主要な条件がそれぞれ数百件当たり、都道府県は 47 通りすべてが現れる', async () => {
    const where = { tenantId: LARGEST.tenantId };
    const java = GLOBAL_SKILL_IDS.Java as string;
    expect(await admin.engineer.count({ where: { ...where, engineerSkills: { some: { skillId: java, yearsOfExperience: { gte: 3 } } } } })).toBeGreaterThan(300);
    const tokyo = await admin.engineer.count({ where: { ...where, prefecture: '13' } });
    expect(tokyo).toBeGreaterThan(500);
    expect(tokyo).toBeLessThan(2_500);
    expect(await admin.engineer.count({ where: { ...where, remoteMode: 'FULL_REMOTE' } })).toBeGreaterThan(500);
    expect(await admin.engineer.count({ where: { ...where, availability: 'STANDBY' } })).toBeGreaterThan(200);
    expect(await admin.engineer.count({ where: { ...where, unitPriceMin: { lte: 700_000 }, unitPriceMax: { gte: 700_000 } } })).toBeGreaterThan(300);
    // 🔴 フリーワード述語（`contains`）は `packages/db/src/search/**` の外に書かない（`tests/static/search-sql-single-path.test.ts`）。
    //    ここは分布の確認なので値を読んで JS 側で数える。
    const notes = await admin.engineer.findMany({ where, select: { preferenceNote: true } });
    expect(notes.filter((row) => row.preferenceNote?.includes('フルリモート')).length).toBeGreaterThan(200);
    const prefectures = await admin.engineer.groupBy({ by: ['prefecture'], where });
    expect(prefectures).toHaveLength(47);
    // 案件: 公開済み（経路 1 = `project_visibilities`）が半数程度、3 状態すべて、`start_date` と `prefecture` が散っている。
    const published = await admin.project.count({ where: { ...where, visibilities: { some: { revokedAt: null } } } });
    expect(published).toBeGreaterThan(1_000);
    expect(published).toBeLessThan(2_000);
    const statuses = await admin.project.groupBy({ by: ['status'], where });
    expect(statuses.map((row) => row.status).sort()).toEqual(['FILLED', 'OPEN', 'SUCCESSOR_WANTED']);
    expect(await admin.project.count({ where: { ...where, startDate: { gte: new Date(NOW.getTime()) } } })).toBeGreaterThan(1_000);
    const projectNames = await admin.project.findMany({ where, select: { name: true } });
    expect(projectNames.filter((row) => row.name.includes('受発注')).length).toBeGreaterThan(100);
    // 公開のゲート結果（PROJECT_PUBLISH の PASS）が公開範囲と対になっている。
    const visibilities = await admin.projectVisibility.findMany({ where, select: { reviewGate: { select: { targetType: true, piiVerdict: true, targetId: true } }, projectId: true } });
    expect(visibilities.length).toBeGreaterThan(published);
    for (const visibility of visibilities) {
      expect(visibility.reviewGate.targetType).toBe('PROJECT_PUBLISH');
      expect(visibility.reviewGate.piiVerdict).toBe('PASS');
      expect(visibility.reviewGate.targetId).toBe(visibility.projectId);
    }
  });

  it('各テナントに DRAFT / APPROVAL_PENDING / SUBMITTED（T-5）/ WON の提案と、WON から生まれた Assignment(ACTIVE, 満了 T+55) がある', async () => {
    for (const tenantIndex of [1, 15, 30]) {
      const ids = perfSeedIds(tenantIndex);
      const proposals = await admin.proposal.findMany({ where: { tenantId: ids.tenantId }, select: { id: true, state: true, submittedAt: true, contentHash: true }, orderBy: [{ id: 'asc' }] });
      expect(proposals.map((row) => [row.id, row.state])).toEqual([
        [ids.proposalId(1), 'DRAFT'],
        [ids.proposalId(2), 'APPROVAL_PENDING'],
        [ids.proposalId(3), 'SUBMITTED'],
        [ids.proposalId(4), 'WON'],
      ]);
      expect(proposals[2]?.submittedAt?.getTime()).toBe(NOW.getTime() - 5 * DAY_MS);
      // 承認・送信の CAS が要求する三つ巴（提案の content_hash = ゲートの content_hash）。
      const gate = await admin.reviewGate.findFirstOrThrow({ where: { targetType: 'PROPOSAL', targetId: ids.proposalId(2) }, select: { contentHash: true } });
      expect(proposals[1]?.contentHash).toBe(gate.contentHash);
      // 1 手ごとの `proposal_events`（飛び級していない）。
      const events = await admin.proposalEvent.findMany({ where: { proposalId: ids.proposalId(4) }, select: { fromState: true, toState: true }, orderBy: [{ occurredAt: 'asc' }] });
      expect(events.map((row) => row.toState)).toEqual([
        'DRAFT', 'GATE_RUNNING', 'APPROVAL_PENDING', 'APPROVED', 'SUBMITTING', 'SUBMITTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON',
      ]);
      const sendAttempts = await admin.sendAttempt.findMany({ where: { tenantId: ids.tenantId }, select: { entityId: true, status: true, attemptSeq: true } });
      expect(sendAttempts.map((row) => [row.entityId, row.status, row.attemptSeq]).sort()).toEqual(
        [[ids.proposalId(3), 'SUCCEEDED', 1], [ids.proposalId(4), 'SUCCEEDED', 1]].sort(),
      );
      const assignment = await admin.assignment.findUniqueOrThrow({ where: { id: ids.assignmentId }, select: { state: true, endDate: true, proposalId: true } });
      expect(assignment.state).toBe('ACTIVE');
      expect(assignment.proposalId).toBe(ids.proposalId(4));
      expect(assignment.endDate.toISOString().slice(0, 10)).toBe(new Date(NOW.getTime() + 55 * DAY_MS).toISOString().slice(0, 10));
    }
    expect(await admin.assignment.count({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } } })).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// ④ 冪等な再生成 / ⑤ 投入済みの判定
// ---------------------------------------------------------------------------

describe('④ 🔴 冪等な再生成（F-053 AC-2）と ⑤ 投入済みの判定（readSeedPresence の契約は demo と同じ）', () => {
  it('🔴 --reset 無しで投入済みなら何も書かず ALREADY_SEEDED（seededAt = 前回の T）', async () => {
    const before = await countTenantRows(admin, PERF_SEED_TENANT_IDS);
    const again = await runSeed(seedOptions(false));
    expect(again.outcome).toBe('ALREADY_SEEDED');
    expect(again.seededAt?.getTime()).toBe(NOW.getTime());
    expect(again.counts).toEqual(before);
    expect(await readSeedPresence(admin, getSeedPreset('perf'))).toEqual({ kind: 'PRESENT', seededAt: NOW });
  });

  it('🔴 reset → seed の再生成で行数が不変、ID・氏名・値が一致し、同居する isolation のテナントは 1 行も変わらない', async () => {
    const engineersBefore = await admin.engineer.findMany({
      where: { tenantId: LARGEST.tenantId },
      select: { id: true, displayName: true, prefecture: true, unitPriceMin: true, availableFrom: true, updatedAt: true, ownerPartnerCompanyId: true },
      orderBy: [{ id: 'asc' }],
    });
    const projectsBefore = await admin.project.findMany({ where: { tenantId: SMALLEST.tenantId }, select: { id: true, name: true, status: true, startDate: true }, orderBy: [{ id: 'asc' }] });
    const sharesBefore = await admin.engineerShare.findMany({ where: { tenantId: LARGEST.tenantId }, select: { id: true, engineerId: true, partnerCompanyId: true }, orderBy: [{ id: 'asc' }] });
    const proposalsBefore = await admin.proposal.findMany({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, select: { id: true, state: true, contentHash: true, submittedAt: true }, orderBy: [{ id: 'asc' }] });

    const startedAt = Date.now();
    const secondRun = await runSeed(seedOptions(true));
    console.info(`seed:perf 再生成（reset → seed） ${Date.now() - startedAt} ms`);
    expect(secondRun.outcome).toBe('SEEDED');
    expect(secondRun.tenantIds).toEqual(firstRun.tenantIds);
    expect(secondRun.counts).toEqual(firstRun.counts);

    const engineersAfter = await admin.engineer.findMany({
      where: { tenantId: LARGEST.tenantId },
      select: { id: true, displayName: true, prefecture: true, unitPriceMin: true, availableFrom: true, updatedAt: true, ownerPartnerCompanyId: true },
      orderBy: [{ id: 'asc' }],
    });
    expect(engineersAfter).toHaveLength(3_000);
    expect(engineersAfter).toEqual(engineersBefore);
    expect(await admin.project.findMany({ where: { tenantId: SMALLEST.tenantId }, select: { id: true, name: true, status: true, startDate: true }, orderBy: [{ id: 'asc' }] })).toEqual(projectsBefore);
    expect(await admin.engineerShare.findMany({ where: { tenantId: LARGEST.tenantId }, select: { id: true, engineerId: true, partnerCompanyId: true }, orderBy: [{ id: 'asc' }] })).toEqual(sharesBefore);
    expect(await admin.proposal.findMany({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } }, select: { id: true, state: true, contentHash: true, submittedAt: true }, orderBy: [{ id: 'asc' }] })).toEqual(proposalsBefore);

    // 🔴 `deleteTenantData` は `preset.tenantIds` に閉じる: `isolation` の行数は投入前と 1 行も変わらない。
    expect(isolationCountsBefore.tenants).toBe(2);
    expect(await countTenantRows(admin, ISOLATION_TENANT_IDS)).toEqual(isolationCountsBefore);
  }, RESEED_TIMEOUT_MS);

  it('🔴 テナントが一部だけ存在する状態では SeedIncompleteError（黙って上書きも追記もしない）。回復は reset', async () => {
    // 「前回の投入が途中で止まった」相当を作る: 最小テナントの `tenants` 行だけを消す（子の行は残る = 孤児。`seed-demo` と同じ手順）。
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM tenants WHERE id = ${SMALLEST.tenantId}::uuid`;
    });
    await expect(runSeed(seedOptions(false))).rejects.toBeInstanceOf(SeedIncompleteError);
    const presence = await readSeedPresence(admin, getSeedPreset('perf'));
    expect(presence.kind).toBe('INCOMPLETE');
    if (presence.kind === 'INCOMPLETE') expect(presence.presentTenantIds).toHaveLength(29);
    // 何も書いていない（孤児を含め、行数はそのまま）。
    expect(await admin.engineer.count({ where: { tenantId: { in: [...PERF_SEED_TENANT_IDS] } } })).toBe(10_000);
  });

  it('🔴 APP_ENV が sandbox / staging / production なら接続の前に拒否される（1 万件の合成データを実データの環境へ流す経路が無い）', async () => {
    for (const appEnv of ['sandbox', 'staging', 'production']) {
      // `SeedNotAllowedError`（`@ses/config`。テストの tsconfig からは直接参照しないので名前で見る）。
      await expect(runSeed({ ...seedOptions(true), appEnv })).rejects.toMatchObject({ name: 'SeedNotAllowedError' });
    }
    // 拒否は DB に触れる前で起きる（上のテストで消したテナントが復活していない）。
    expect(await admin.tenant.count({ where: { id: SMALLEST.tenantId } })).toBe(0);
  });
});
