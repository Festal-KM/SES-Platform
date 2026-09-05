// tests/isolation/owner-counterparty-inheritance.test.ts
// T-02-08（docs/sprints/SP-02-schema-isolation.md）: オーナー列 / 当事者列の継承・freeze トリガ
// （docs/05 §4.4.1 / P-A-11）を実証する。
//
//   ① 偽装した値を INSERT しても、親の値で必ず上書きされる（呼び出し側の指定値を採用しない）
//   ② 根 4 表（オーナー）/ 根 1 表（当事者）は BEFORE UPDATE で不変（変更しようとすると RAISE）
//   ③ 親が見つからない（RLS で見えない）なら RAISE EXCEPTION
//   ④ 🔴 assignments ← engineers(engineer_id) は例外的にホストが「見えない」パートナー所属
//      エンジニアの owner も正しく継承できる（専用ロール app_assignment_owner_probe。
//      本ファイル冒頭コメント + migration.sql の「判断事項 2」参照）
//   ⑤ COMMENT 宣言の実在走査（T-02-09 の前哨。表を列挙せず「宣言した 15 列」だけを対照する）
//
// 🔴 これは T-02-08 の最小実証である。T-02-09 が「除外 4 表以外の全表」を対象にした
//    網羅的なカタログ走査を行う（本ファイルは表を列挙してよい。宣言と実体の全数チェックは
//    T-02-09 の責務）。
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  requireHost,
  resolveTenantCtx,
  withHostTenant,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  createUnextendedClient,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  ASSIGNMENT_A_P1_PUBLISHED,
  CONTRACT_A_P1,
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_P1,
  TENANT_A,
  THREAD_A_P1,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

// 🔴 継承・freeze トリガが触る表すべて（親の可視性を検証するテストのために RLS を一時 DISABLE する）。
const OWNER_TABLES = [
  'users',
  'engineers',
  'proposals',
  'tasks',
  'engineer_skills',
  'skill_sheets',
  'skill_sheet_extractions',
  'engineer_snapshots',
  'proposal_events',
  'chat_threads',
  'messages',
  'review_gates',
  // 🔴 skill_sheet_extractions.ai_usage_id の FK 先（fail-closed。T-02-05 から 0 ポリシー）。
  'ai_usage',
] as const;
const COUNTERPARTY_TABLES = ['contracts', 'assignments', 'contract_documents', 'orders'] as const;
const ALL_TABLES = [...OWNER_TABLES, ...COUNTERPARTY_TABLES] as const;

describe('T-02-08: オーナー列 / 当事者列の継承・freeze トリガ（docs/05 §4.4.1）', () => {
  let database: IsolationDatabase;
  let owner: UnextendedClient;
  let db: UnextendedClient;
  let ctxHost: AuthenticatedTenantCtx;
  let ctxPartner1: AuthenticatedTenantCtx;
  let ctxPartner2: AuthenticatedTenantCtx;

  beforeAll(async () => {
    database = await startIsolationDatabase();
    owner = createUnextendedClient(database.migratorUrl);
    db = createUnextendedClient(database.tenantUrl);
    configureTenantDb({ datasourceUrl: database.tenantUrl });

    ctxHost = await resolveTenantCtx(
      { tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES', lifecycleState: 'ACTIVE', partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' },
      { deviceKind: 'api' },
    );
    ctxPartner1 = await resolveTenantCtx(
      {
        tenantId: TENANT_A,
        partnerCompanyId: PARTNER_A1,
        userId: USER_A_PARTNER,
        role: 'PARTNER_SALES',
        lifecycleState: 'ACTIVE',
        partnerSuspendedAt: null,
        twoFactor: 'NOT_ENROLLED',
      },
      { deviceKind: 'api' },
    );
    ctxPartner2 = await resolveTenantCtx(
      {
        tenantId: TENANT_A,
        partnerCompanyId: PARTNER_A2,
        userId: USER_A_PARTNER2,
        role: 'PARTNER_SALES',
        lifecycleState: 'ACTIVE',
        partnerSuspendedAt: null,
        twoFactor: 'NOT_ENROLLED',
      },
      { deviceKind: 'api' },
    );
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await disconnectTenantDb();
    await db?.$disconnect();
    await owner?.$disconnect();
    await database?.stop();
  }, SETUP_TIMEOUT_MS);

  describe('① 偽装した値を INSERT しても親の値で上書きされる（RLS を一時 DISABLE して直接検証）', () => {
    let skillId: string;

    beforeAll(async () => {
      await setRowLevelSecurity({ ownerDatasourceUrl: database.migratorUrl, tables: [...ALL_TABLES], enabled: false });
      const skill = await owner.skill.create({
        data: { name: `Skill-${randomUUID()}`, category: 'language', sortKey: 1 },
      });
      skillId = skill.id;
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await setRowLevelSecurity({ ownerDatasourceUrl: database.migratorUrl, tables: [...ALL_TABLES], enabled: true });
    }, SETUP_TIMEOUT_MS);

    it('engineer_skills ← engineers(engineer_id): 偽装した owner が親の値（PARTNER_A1）で上書きされる', async () => {
      const row = await owner.engineerSkill.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A2, // 🔴 偽装値（実際の親は PARTNER_A1）
          engineerId: ENGINEER_A_PARTNER,
          skillId,
          yearsOfExperience: '3.0',
          source: 'MANUAL',
        },
      });
      expect(row.ownerPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('skill_sheets ← engineers(engineer_id): 偽装した owner が上書きされる（ホスト所有エンジニア = NULL）', async () => {
      const row = await owner.skillSheet.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A1, // 🔴 偽装値（実際の親は ENGINEER_A_HOST = NULL）
          engineerId: ENGINEER_A_HOST,
          version: 900,
          objectKey: `skill-sheets/${randomUUID()}.pdf`,
          contentType: 'application/pdf',
          byteSize: 1n,
          scanStatus: 'CLEAN',
          uploadedBy: randomUUID(),
        },
      });
      expect(row.ownerPartnerCompanyId).toBeNull();
    });

    it('skill_sheet_extractions ← skill_sheets(skill_sheet_id): 偽装した owner が上書きされる', async () => {
      const sheet = await owner.skillSheet.create({
        data: {
          tenantId: TENANT_A,
          engineerId: ENGINEER_A_PARTNER,
          version: 901,
          objectKey: `skill-sheets/${randomUUID()}.pdf`,
          contentType: 'application/pdf',
          byteSize: 1n,
          scanStatus: 'CLEAN',
          uploadedBy: randomUUID(),
        },
      });
      expect(sheet.ownerPartnerCompanyId).toBe(PARTNER_A1); // 対照（親から継承済み）

      const aiUsage = await owner.aiUsage.create({
        data: {
          tenantId: TENANT_A,
          role: 'sheet-parser',
          modelId: 'claude-sonnet-5',
          purpose: 'sheet_parse',
          promptVersion: 'v1',
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: '0.01',
          succeeded: true,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      const extraction = await owner.skillSheetExtraction.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A2, // 🔴 偽装値（実際の親は PARTNER_A1）
          skillSheetId: sheet.id,
          payload: {},
          role: 'sheet-parser',
          promptVersion: 'v1',
          modelId: 'claude-sonnet-5',
          aiUsageId: aiUsage.id,
          status: 'PENDING_REVIEW',
        },
      });
      expect(extraction.ownerPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('engineer_snapshots / proposal_events ← proposals(proposal_id): 偽装した owner が上書きされる', async () => {
      const snapshot = await owner.engineerSnapshot.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A2, // 🔴 偽装値（実際の親 PROPOSAL_A_P1 の owner は PARTNER_A1）
          proposalId: PROPOSAL_A_P1,
          displayName: 'スナップショット太郎',
          skills: [],
          careers: [],
          frozenAt: new Date(),
        },
      });
      expect(snapshot.ownerPartnerCompanyId).toBe(PARTNER_A1);

      const event = await owner.proposalEvent.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A2, // 🔴 偽装値
          proposalId: PROPOSAL_A_P1,
          kind: 'NOTE',
          note: 'x',
        },
      });
      expect(event.ownerPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('🔴 messages ← chat_threads(thread_id): 親の列名が partner_company_id でも owner に正しく写像される', async () => {
      const row = await owner.message.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A2, // 🔴 偽装値（THREAD_A_P1.partner_company_id = PARTNER_A1）
          threadId: THREAD_A_P1,
          senderUserId: randomUUID(),
          body: 'x',
        },
      });
      expect(row.ownerPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('🔴 review_gates ← CASE(target_type): PROPOSAL は proposals から継承し、偽装値が上書きされる', async () => {
      const row = await owner.reviewGate.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A2, // 🔴 偽装値
          targetType: 'PROPOSAL',
          targetId: PROPOSAL_A_P1,
          contentHash: `hash-${randomUUID()}`,
          piiVerdict: 'PASS',
          commerceVerdict: 'PASS',
          consistencyVerdict: 'PASS',
          findings: [],
          aiWarnings: [],
          executedAt: new Date(),
        },
      });
      expect(row.ownerPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('🔴 review_gates ← CASE(target_type): PROJECT_PUBLISH / CONTRACT_DOCUMENT は偽装値を無視して常に NULL', async () => {
      for (const targetType of ['PROJECT_PUBLISH', 'CONTRACT_DOCUMENT'] as const) {
        const row = await owner.reviewGate.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: PARTNER_A1, // 🔴 偽装値（このターゲット種別は常に NULL）
            targetType,
            targetId: randomUUID(),
            contentHash: `hash-${randomUUID()}`,
            piiVerdict: 'PASS',
            commerceVerdict: 'PASS',
            consistencyVerdict: 'PASS',
            findings: [],
            aiWarnings: [],
            executedAt: new Date(),
          },
        });
        expect(row.ownerPartnerCompanyId, `${targetType}: NULL に上書きされていない`).toBeNull();
      }
    });

    it('🔴 review_gates ← CASE(target_type): 未対応の target_type は RAISE する（境界の割り当てを取りこぼせない）', async () => {
      // 🔴 target_type_check（CHECK 制約）より先にこのトリガが働くため、CHECK 由来のメッセージ
      //    ではなく inherit_review_gate_owner の RAISE が観測される（BOGUS は CHECK にも違反する値）。
      await expect(
        owner.reviewGate.create({
          data: {
            tenantId: TENANT_A,
            targetType: 'BOGUS',
            targetId: randomUUID(),
            contentHash: `hash-${randomUUID()}`,
            piiVerdict: 'PASS',
            commerceVerdict: 'PASS',
            consistencyVerdict: 'PASS',
            findings: [],
            aiWarnings: [],
            executedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/inherit_review_gate_owner/);
    });

    it('🔴 当事者列: contract_documents ← contracts(contract_id) の偽装値が上書きされる', async () => {
      const row = await owner.contractDocument.create({
        data: {
          tenantId: TENANT_A,
          counterpartyPartnerCompanyId: PARTNER_A2, // 🔴 偽装値（CONTRACT_A_P1 の当事者は PARTNER_A1）
          contractId: CONTRACT_A_P1,
          version: 900,
          objectKey: `contracts/${randomUUID()}.pdf`,
        },
      });
      expect(row.counterpartyPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('🔴 当事者列: orders ← CASE。contract_id 優先で継承され、偽装値が上書きされる', async () => {
      const row = await owner.order.create({
        data: {
          tenantId: TENANT_A,
          counterpartyPartnerCompanyId: PARTNER_A2, // 🔴 偽装値
          contractId: CONTRACT_A_P1,
          amount: '100000',
          periodStart: new Date('2027-01-01'),
          periodEnd: new Date('2027-01-31'),
          paymentState: 'UNPAID',
        },
      });
      expect(row.counterpartyPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('🔴 当事者列: orders ← CASE。contract_id が無ければ assignment_id から継承される', async () => {
      const row = await owner.order.create({
        data: {
          tenantId: TENANT_A,
          counterpartyPartnerCompanyId: PARTNER_A2, // 🔴 偽装値
          assignmentId: ASSIGNMENT_A_P1_PUBLISHED, // counterparty = PARTNER_A1（fixtures）
          amount: '50000',
          periodStart: new Date('2027-01-01'),
          periodEnd: new Date('2027-01-31'),
          paymentState: 'UNPAID',
        },
      });
      expect(row.counterpartyPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('🔴 対照: orders は contract_id / assignment_id が両方 NULL でもこのトリガは RAISE せず、既存 CHECK に委ねる', async () => {
      await expect(
        owner.order.create({
          data: {
            tenantId: TENANT_A,
            amount: '1000',
            periodStart: new Date('2027-01-01'),
            periodEnd: new Date('2027-01-31'),
            paymentState: 'UNPAID',
          },
        }),
      ).rejects.toThrow(/orders_contract_or_assignment_check/);
    });

    it('🔴 当事者列: assignments ← engineers(engineer_id) の偽装値が上書きされる（RLS DISABLE 下）', async () => {
      const proposal = await owner.proposal.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A1,
          projectId: PROJECT_A_PUBLISHED,
          engineerId: ENGINEER_A_PARTNER,
          recipientCompanyName: 'Client Co',
          recipientEmail: 'client@example.test',
          createdBy: randomUUID(),
        },
      });
      const row = await owner.assignment.create({
        data: {
          tenantId: TENANT_A,
          counterpartyPartnerCompanyId: PARTNER_A2, // 🔴 偽装値（実際の親エンジニアの owner は PARTNER_A1）
          engineerId: ENGINEER_A_PARTNER,
          projectId: PROJECT_A_PUBLISHED,
          proposalId: proposal.id,
          startDate: new Date('2027-02-01'),
          endDate: new Date('2027-07-31'),
          ownerUserId: randomUUID(),
        },
      });
      expect(row.counterpartyPartnerCompanyId).toBe(PARTNER_A1);
    });
  });

  describe('② 根の表は BEFORE UPDATE で不変（freeze_owner_partner_company）', () => {
    beforeAll(async () => {
      await setRowLevelSecurity({ ownerDatasourceUrl: database.migratorUrl, tables: [...ALL_TABLES], enabled: false });
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await setRowLevelSecurity({ ownerDatasourceUrl: database.migratorUrl, tables: [...ALL_TABLES], enabled: true });
    }, SETUP_TIMEOUT_MS);

    it('users.owner_partner_company_id を書き換えようとすると RAISE する', async () => {
      const user = await owner.user.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A1,
          email: `freeze-${randomUUID()}@example.test`,
          displayName: 'Freeze Test',
          passwordHash: 'hash',
        },
      });
      await expect(
        owner.user.update({ where: { id: user.id }, data: { ownerPartnerCompanyId: PARTNER_A2 } }),
      ).rejects.toThrow(/freeze_owner_partner_company/);
    });

    it('engineers.owner_partner_company_id を書き換えようとすると RAISE する', async () => {
      const engineer = await owner.engineer.create({
        data: { tenantId: TENANT_A, ownerPartnerCompanyId: PARTNER_A1, displayName: 'Freeze Engineer' },
      });
      await expect(
        owner.engineer.update({ where: { id: engineer.id }, data: { ownerPartnerCompanyId: null } }),
      ).rejects.toThrow(/freeze_owner_partner_company/);
    });

    it('proposals.owner_partner_company_id を書き換えようとすると RAISE する', async () => {
      const proposal = await owner.proposal.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A1,
          projectId: PROJECT_A_PUBLISHED,
          engineerId: ENGINEER_A_PARTNER,
          recipientCompanyName: 'Client Co',
          recipientEmail: 'client@example.test',
          createdBy: randomUUID(),
        },
      });
      await expect(
        owner.proposal.update({ where: { id: proposal.id }, data: { ownerPartnerCompanyId: PARTNER_A2 } }),
      ).rejects.toThrow(/freeze_owner_partner_company/);
    });

    it('tasks.owner_partner_company_id を書き換えようとすると RAISE する', async () => {
      const task = await owner.task.create({
        data: {
          tenantId: TENANT_A,
          ownerPartnerCompanyId: PARTNER_A1,
          kind: 'INTERVIEW',
          targetType: 'Proposal',
          targetId: randomUUID(),
          dueOn: new Date(),
          assigneeUserId: randomUUID(),
        },
      });
      await expect(
        owner.task.update({ where: { id: task.id }, data: { ownerPartnerCompanyId: null } }),
      ).rejects.toThrow(/freeze_owner_partner_company/);
    });

    it('🔴 contracts.counterparty_partner_company_id を書き換えようとすると RAISE する（当事者列の根）', async () => {
      const contract = await owner.contract.create({
        data: {
          tenantId: TENANT_A,
          kind: 'INDIVIDUAL',
          counterpartyName: 'Freeze Contract',
          counterpartyPartnerCompanyId: PARTNER_A1,
        },
      });
      await expect(
        owner.contract.update({
          where: { id: contract.id },
          data: { counterpartyPartnerCompanyId: PARTNER_A2 },
        }),
      ).rejects.toThrow(/freeze_owner_partner_company/);
    });

    it('対照: freeze は他列の更新や同値への更新を妨げない', async () => {
      const engineer = await owner.engineer.create({
        data: { tenantId: TENANT_A, ownerPartnerCompanyId: PARTNER_A1, displayName: 'Freeze OK' },
      });
      const renamed = await owner.engineer.update({
        where: { id: engineer.id },
        data: { displayName: 'Freeze OK (renamed)' },
      });
      expect(renamed.displayName).toBe('Freeze OK (renamed)');

      const sameValue = await owner.engineer.update({
        where: { id: engineer.id },
        data: { ownerPartnerCompanyId: PARTNER_A1 }, // 同値への更新は変更ではない
      });
      expect(sameValue.ownerPartnerCompanyId).toBe(PARTNER_A1);
    });
  });

  describe('③ 親が見つからない（現在の分離文脈の RLS で見えない）なら RAISE する（実 RLS + app_tenant）', () => {
    it('engineer_skills ← engineers: PARTNER_A2 文脈から PARTNER_A1 所有エンジニアには書けない（親が見えない）', async () => {
      // 🔴 skills はグローバル（射程外の 4 表）のため、テーブル所有者接続で用意する
      //    （engineer-project-visibility-constraints.test.ts と同じ方針）。
      const skill = await owner.skill.create({
        data: { name: `Skill-${randomUUID()}`, category: 'language', sortKey: 1 },
      });
      await expect(
        withTenant(ctxPartner2, (partner) =>
          partner.engineerSkill.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_PARTNER,
              skillId: skill.id,
              yearsOfExperience: '1.0',
              source: 'MANUAL',
            },
          }),
        ),
      ).rejects.toThrow(/inherit_owner_partner_company/);
    });

    it('messages ← chat_threads: PARTNER_A2 文脈から PARTNER_A1 のスレッドは見えず親不可視で RAISE する', async () => {
      await expect(
        withTenant(ctxPartner2, (partner) =>
          partner.message.create({
            // 🔴 owner_partner_company_id は NOT NULL のため型上は必須だが、トリガが必ず
            //    上書きする（このテストでは親不可視で RAISE するため、この値自体は使われない）。
            data: {
              tenantId: TENANT_A,
              ownerPartnerCompanyId: PARTNER_A2,
              threadId: THREAD_A_P1,
              senderUserId: randomUUID(),
              body: 'x',
            },
          }),
        ),
      ).rejects.toThrow(/inherit_owner_partner_company/);
    });

    it('対照: PARTNER_A1 文脈なら自社エンジニアへの engineer_skills 作成は成立する（親が見える）', async () => {
      // 🔴 skills はグローバル（射程外の 4 表）のため、テーブル所有者接続で用意する
      //    （engineer-project-visibility-constraints.test.ts と同じ方針）。
      const skill = await owner.skill.create({
        data: { name: `Skill-${randomUUID()}`, category: 'language', sortKey: 1 },
      });
      const row = await withTenant(ctxPartner1, (partner) =>
        partner.engineerSkill.create({
          data: {
            tenantId: TENANT_A,
            engineerId: ENGINEER_A_PARTNER,
            skillId: skill.id,
            yearsOfExperience: '2.0',
            source: 'MANUAL',
          },
        }),
      );
      expect(row.ownerPartnerCompanyId).toBe(PARTNER_A1);
    });
  });

  describe('④ 🔴 assignments ← engineers(engineer_id) は専用ロールでホストの正当な操作を壊さない', () => {
    it('ホストがパートナー所属エンジニアを新規に稼働させても RAISE しない（regression: route5-counterparty.test.ts で実測した破壊の再発防止）', async () => {
      requireHost(ctxHost);
      const proposal = await withTenant(ctxHost, (host) =>
        host.proposal.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: PARTNER_A1, // PARTNER_A1 が提案した体（root なので INSERT 時は自由に書ける）
            projectId: PROJECT_A_PUBLISHED,
            engineerId: ENGINEER_A_PARTNER,
            recipientCompanyName: 'Client Co',
            recipientEmail: 'client@example.test',
            createdBy: USER_A_HOST,
          },
        }),
      );
      const assignment = await withHostTenant(ctxHost, (host) =>
        host.assignment.create({
          data: {
            tenantId: TENANT_A,
            engineerId: ENGINEER_A_PARTNER,
            projectId: PROJECT_A_PUBLISHED,
            proposalId: proposal.id,
            startDate: new Date('2027-03-01'),
            endDate: new Date('2027-08-31'),
            ownerUserId: USER_A_HOST,
          },
        }),
      );
      expect(assignment.counterpartyPartnerCompanyId).toBe(PARTNER_A1);
    });

    it('対照: 既存のパートナー所有エンジニアの稼働をホストが更新しても RAISE しない', async () => {
      requireHost(ctxHost);
      const updated = await withHostTenant(ctxHost, (host) =>
        host.assignment.update({
          where: { id: ASSIGNMENT_A_P1_PUBLISHED },
          data: { state: 'ACTIVE' },
        }),
      );
      expect(updated.counterpartyPartnerCompanyId).toBe(PARTNER_A1);
    });
  });

  describe('⑤ COMMENT 宣言の実在走査（T-02-09 の前哨。docs/05 §4.4.1）', () => {
    async function columnComment(table: string, column: string): Promise<string | null> {
      const rows = await db.$queryRaw<Array<{ description: string | null }>>`
        SELECT d.description
        FROM pg_description d
        JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ${table} AND a.attname = ${column}`;
      return rows[0]?.description ?? null;
    }

    const OWNER_DECLARATIONS: ReadonlyArray<readonly [string, string]> = [
      ['users', 'owner-column: root'],
      ['engineers', 'owner-column: root'],
      ['proposals', 'owner-column: root'],
      ['tasks', 'owner-column: root'],
      ['engineer_skills', 'owner-column: child of engineers(engineer_id)'],
      ['skill_sheets', 'owner-column: child of engineers(engineer_id)'],
      ['skill_sheet_extractions', 'owner-column: child of skill_sheets(skill_sheet_id)'],
      ['engineer_snapshots', 'owner-column: child of proposals(proposal_id)'],
      ['proposal_events', 'owner-column: child of proposals(proposal_id)'],
      ['messages', 'owner-column: child of chat_threads(thread_id)'],
      ['review_gates', 'owner-column: child of CASE(target_type)'],
    ];

    const COUNTERPARTY_DECLARATIONS: ReadonlyArray<readonly [string, string]> = [
      ['contracts', 'counterparty-column: root'],
      ['assignments', 'counterparty-column: child of engineers(engineer_id)'],
      ['contract_documents', 'counterparty-column: child of contracts(contract_id)'],
      ['orders', 'counterparty-column: child of CASE(contract_id, assignment_id)'],
    ];

    it.each(OWNER_DECLARATIONS)('%s.owner_partner_company_id の COMMENT が宣言と一致する', async (table, expected) => {
      const description = await columnComment(table, 'owner_partner_company_id');
      expect(description).toBe(expected);
    });

    it.each(COUNTERPARTY_DECLARATIONS)(
      '%s.counterparty_partner_company_id の COMMENT が宣言と一致する',
      async (table, expected) => {
        const description = await columnComment(table, 'counterparty_partner_company_id');
        expect(description).toBe(expected);
      },
    );

    it('根の宣言（owner-column: root）を持つ表には freeze_owner_partner_company の BEFORE UPDATE トリガがある', async () => {
      for (const [table] of OWNER_DECLARATIONS.filter(([, decl]) => decl === 'owner-column: root')) {
        const rows = await db.$queryRaw<Array<{ tgname: string }>>`
          SELECT t.tgname
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE c.relname = ${table} AND p.proname = 'freeze_owner_partner_company' AND NOT t.tgisinternal`;
        expect(rows.length, `${table}: freeze トリガが無い`).toBeGreaterThan(0);
      }
    });

    it('子の宣言（owner-column: child of ...）を持つ表には BEFORE INSERT OR UPDATE の継承トリガがある', async () => {
      const inheritFunctionNames = [
        'inherit_owner_partner_company',
        'inherit_review_gate_owner', // review_gates（CASE）専用
      ];
      for (const [table] of OWNER_DECLARATIONS.filter(([, decl]) => decl.startsWith('owner-column: child'))) {
        const rows = await db.$queryRaw<Array<{ proname: string }>>`
          SELECT p.proname
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE c.relname = ${table} AND NOT t.tgisinternal`;
        const matched = rows.some((r) => inheritFunctionNames.includes(r.proname));
        expect(matched, `${table}: 継承トリガが無い（実際の関数: ${rows.map((r) => r.proname).join(',')}）`).toBe(
          true,
        );
      }
    });

    it('当事者列も同じ述語で宣言とトリガが対応する（root=freeze / child=継承）', async () => {
      const rootRows = await db.$queryRaw<Array<{ tgname: string }>>`
        SELECT t.tgname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = 'contracts' AND p.proname = 'freeze_owner_partner_company' AND NOT t.tgisinternal`;
      expect(rootRows.length).toBeGreaterThan(0);

      const childFunctionNames = ['inherit_owner_partner_company', 'inherit_order_counterparty', 'inherit_assignment_counterparty'];
      for (const table of ['assignments', 'contract_documents', 'orders']) {
        const rows = await db.$queryRaw<Array<{ proname: string }>>`
          SELECT p.proname
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE c.relname = ${table} AND NOT t.tgisinternal`;
        const matched = rows.some((r) => childFunctionNames.includes(r.proname));
        expect(matched, `${table}: 当事者列の継承トリガが無い`).toBe(true);
      }
    });
  });
});
