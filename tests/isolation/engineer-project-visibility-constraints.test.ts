// tests/isolation/engineer-project-visibility-constraints.test.ts
// T-02-02（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.4「① 集める」/ §3.5「案件・公開範囲・
// マッチング・匿名共有」で追加した 10 表（skill_aliases / engineer_skills / skill_sheets /
// skill_sheet_extractions / file_scan_results / projects / project_requirements /
// project_visibilities / engineer_shares / match_candidates）+ engineers の拡張について、
//   ① ENABLE + FORCE ROW LEVEL SECURITY が既定でポリシー 0 件のまま入っていること
//      （fail-closed。C0〜C8 のポリシー本体は T-02-06。`skills` は射程外のため対象外）
//   ② migration.sql に手で追加した CHECK 制約 / FK / 部分 UNIQUE が実際に機能すること
// を検証する（tests/isolation/tenant-boundary-constraints.test.ts と同じ方針）。
//
// 🔴 ②は RLS を一時的に DISABLE してテーブル所有者（app_migrator）接続で直接 INSERT を試みる
//    （engineers は T-01-04 から C3 ポリシーが有効なため、これも対象に含めて DISABLE する）。
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createUnextendedClient,
  readTableRlsStatus,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import { ENGINEER_A_HOST, PARTNER_A1, TENANT_A } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

// 🔴 `skills` は含めない（CLAUDE.md §3.1 射程外の 4 表の 1 つ。RLS を一切適用しない）。
const NEW_TABLES = [
  'skill_aliases',
  'engineer_skills',
  'skill_sheets',
  'skill_sheet_extractions',
  'file_scan_results',
  'projects',
  'project_requirements',
  'project_visibilities',
  'engineer_shares',
  'match_candidates',
] as const;

describe('T-02-02: docs/05 §3.4 / §3.5 の新 10 表 + engineers 拡張', () => {
  let database: IsolationDatabase;
  let owner: UnextendedClient;

  beforeAll(async () => {
    database = await startIsolationDatabase();
    owner = createUnextendedClient(database.migratorUrl);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.$disconnect();
    await database?.stop();
  }, SETUP_TIMEOUT_MS);

  it('① 全 10 表で RLS が有効かつ FORCE されている（docs/05 §4.1 第 1 防御。既定は fail-closed）', async () => {
    const status = await readTableRlsStatus(owner, [...NEW_TABLES]);
    expect(status).toHaveLength(NEW_TABLES.length); // 空振り防止（対照）
    for (const table of status) {
      expect(table.rlsEnabled, `${table.table}: RLS が有効でない`).toBe(true);
      expect(table.rlsForced, `${table.table}: RLS が FORCE されていない`).toBe(true);
    }
  });

  it('🔴 対照: skills は RLS を適用しない（射程外の 4 表。docs/05 §4.4「射程外の 4 表」）', async () => {
    const status = await readTableRlsStatus(owner, ['skills']);
    expect(status).toHaveLength(1);
    expect(status[0]?.rlsEnabled).toBe(false);
  });

  it('① ポリシーが 0 件のため、所有者（app_migrator）接続でも SELECT は 0 件（T-02-06 前の既定 = fail-closed）', async () => {
    const rows = await owner.project.findMany();
    expect(rows).toEqual([]);
  });

  it('① ポリシーが 0 件のため、所有者（app_migrator）接続でも INSERT は拒否される', async () => {
    await expect(
      owner.project.create({ data: { tenantId: TENANT_A, name: 'RLS 越境未検証案件' } }),
    ).rejects.toThrow(/row-level security/i);
  });

  describe('② CHECK 制約 / FK / 部分 UNIQUE（RLS を一時 DISABLE して直接検証。T-02-06 前提の暫定手段）', () => {
    // 🔴 engineers は T-01-04 から C3 ポリシーが有効（fail-closed の対象外）だが、
    //    今回追加した CHECK（availability / remote_mode）と FK（owner_partner_company_id）を
    //    ポリシーの影響なく検証するため、一時 DISABLE の対象に含める。
    const TABLES_TO_DISABLE = [...NEW_TABLES, 'engineers'] as const;

    let skillId: string;
    let projectId: string;
    let skillSheetId: string;

    beforeAll(async () => {
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [...TABLES_TO_DISABLE],
        enabled: false,
      });

      // 🔴 skills はグローバルで RLS 自体を持たないため DISABLE 不要（常に owner から書ける）。
      const skill = await owner.skill.create({
        data: { name: `Skill-${randomUUID()}`, category: 'language', sortKey: 1 },
      });
      skillId = skill.id;

      const project = await owner.project.create({
        data: { tenantId: TENANT_A, name: 'CHECK 制約検証用案件' },
      });
      projectId = project.id;

      const skillSheet = await owner.skillSheet.create({
        data: {
          tenantId: TENANT_A,
          engineerId: ENGINEER_A_HOST,
          version: 1,
          objectKey: `skill-sheets/${randomUUID()}.pdf`,
          contentType: 'application/pdf',
          byteSize: 1024n,
          scanStatus: 'CLEAN',
          isLatest: true, // 🔴 部分 UNIQUE テストの前提（このテスト内で唯一の is_latest=true 行）
          uploadedBy: randomUUID(),
        },
      });
      skillSheetId = skillSheet.id;
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [...TABLES_TO_DISABLE],
        enabled: true,
      });
    }, SETUP_TIMEOUT_MS);

    it('対照: RLS が確かに落ちている（所有者接続で Project を作成できる）', async () => {
      const project = await owner.project.create({
        data: { tenantId: TENANT_A, name: '対照用案件' },
      });
      expect(project.id).toBeTruthy();
    });

    describe('engineers_availability_check / engineers_remote_mode_check（docs/05 §3.4）', () => {
      it('不正な availability は拒否される', async () => {
        await expect(
          owner.engineer.create({
            data: { tenantId: TENANT_A, displayName: 'X', availability: 'BOGUS' },
          }),
        ).rejects.toThrow(/engineers_availability_check/);
      });

      it('不正な remote_mode は拒否される', async () => {
        await expect(
          owner.engineer.create({
            data: { tenantId: TENANT_A, displayName: 'X', remoteMode: 'BOGUS' },
          }),
        ).rejects.toThrow(/engineers_remote_mode_check/);
      });

      it('対照: 許容値の組み合わせは成立する', async () => {
        const engineer = await owner.engineer.create({
          data: {
            tenantId: TENANT_A,
            displayName: 'X',
            availability: 'STANDBY_SCHEDULED',
            remoteMode: 'FULL_REMOTE',
          },
        });
        expect(engineer.availability).toBe('STANDBY_SCHEDULED');
      });

      it('remote_mode 未指定（null）は CHECK を通る（nullable 列は NULL を許容する）', async () => {
        const engineer = await owner.engineer.create({
          data: { tenantId: TENANT_A, displayName: 'X' },
        });
        expect(engineer.remoteMode).toBeNull();
      });
    });

    describe('engineers_owner_partner_company_id_fkey（docs/05 §3.4。T-02-01 からの申し送り）', () => {
      it('存在しない partner_companies を指すと拒否される', async () => {
        await expect(
          owner.engineer.create({
            data: { tenantId: TENANT_A, displayName: 'X', ownerPartnerCompanyId: randomUUID() },
          }),
        ).rejects.toThrow(/foreign key constraint/i);
      });

      it('対照: 実在する partner_companies を指すと成立する', async () => {
        const engineer = await owner.engineer.create({
          data: { tenantId: TENANT_A, displayName: 'X', ownerPartnerCompanyId: PARTNER_A1 },
        });
        expect(engineer.ownerPartnerCompanyId).toBe(PARTNER_A1);
      });
    });

    describe('skill_aliases_status_check / skill_aliases_origin_check（docs/05 §3.4）', () => {
      it('不正な status は拒否される', async () => {
        await expect(
          owner.skillAlias.create({
            data: { tenantId: TENANT_A, alias: 'Reactjs', status: 'BOGUS', origin: 'HUMAN' },
          }),
        ).rejects.toThrow(/skill_aliases_status_check/);
      });

      it('不正な origin は拒否される', async () => {
        await expect(
          owner.skillAlias.create({
            data: { tenantId: TENANT_A, alias: 'Reactjs', status: 'PROPOSED', origin: 'BOGUS' },
          }),
        ).rejects.toThrow(/skill_aliases_origin_check/);
      });

      it('対照: 許容値の組み合わせは成立する（グローバル別名 = tenantId null）', async () => {
        const alias = await owner.skillAlias.create({
          data: { alias: `React-${randomUUID()}`, status: 'ACCEPTED', origin: 'AI', skillId },
        });
        expect(alias.tenantId).toBeNull();
      });
    });

    describe('engineer_skills_source_check（docs/05 §3.4）', () => {
      it('不正な source は拒否される', async () => {
        await expect(
          owner.engineerSkill.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_HOST,
              skillId,
              yearsOfExperience: '3.0',
              source: 'BOGUS',
            },
          }),
        ).rejects.toThrow(/engineer_skills_source_check/);
      });

      it('対照: 許容値は成立する', async () => {
        const engineerSkill = await owner.engineerSkill.create({
          data: {
            tenantId: TENANT_A,
            engineerId: ENGINEER_A_HOST,
            skillId,
            yearsOfExperience: '3.0',
            source: 'MANUAL',
          },
        });
        expect(engineerSkill.source).toBe('MANUAL');
      });
    });

    describe('skill_sheets_scan_status_check / skill_sheets_latest_clean_check / 部分 UNIQUE（docs/05 §3.4。F-011 AC-1）', () => {
      it('不正な scan_status は拒否される', async () => {
        await expect(
          owner.skillSheet.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_HOST,
              version: 100,
              objectKey: `skill-sheets/${randomUUID()}.pdf`,
              contentType: 'application/pdf',
              byteSize: 1n,
              scanStatus: 'BOGUS',
              uploadedBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/skill_sheets_scan_status_check/);
      });

      it('🔴 CLEAN 以外は is_latest=true になれない（F-011 AC-1）', async () => {
        await expect(
          owner.skillSheet.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_HOST,
              version: 101,
              objectKey: `skill-sheets/${randomUUID()}.pdf`,
              contentType: 'application/pdf',
              byteSize: 1n,
              scanStatus: 'SCANNING',
              isLatest: true,
              uploadedBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/skill_sheets_latest_clean_check/);
      });

      it('🔴 部分 UNIQUE: 1 エンジニアにつき is_latest=true は高々 1 件', async () => {
        // beforeAll で作成済みの skillSheetId（version 1）が既に is_latest=true。
        await expect(
          owner.skillSheet.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_HOST,
              version: 102,
              objectKey: `skill-sheets/${randomUUID()}.pdf`,
              contentType: 'application/pdf',
              byteSize: 1n,
              scanStatus: 'CLEAN',
              isLatest: true,
              uploadedBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });

      it('対照: is_latest=false なら CLEAN 以外でも成立する', async () => {
        const skillSheet = await owner.skillSheet.create({
          data: {
            tenantId: TENANT_A,
            engineerId: ENGINEER_A_HOST,
            version: 103,
            objectKey: `skill-sheets/${randomUUID()}.pdf`,
            contentType: 'application/pdf',
            byteSize: 1n,
            scanStatus: 'INFECTED',
            isLatest: false,
            uploadedBy: randomUUID(),
          },
        });
        expect(skillSheet.isLatest).toBe(false);
      });
    });

    describe('file_scan_results_status_check / UNIQUE(object_key, object_version_id)（docs/05 §3.4。docs/03 §3.4.3-2）', () => {
      it('不正な status は拒否される', async () => {
        await expect(
          owner.fileScanResult.create({
            data: {
              tenantId: TENANT_A,
              objectKey: `skill-sheets/${randomUUID()}.pdf`,
              objectVersionId: 'v1',
              status: 'BOGUS',
              rawStatus: 'NO_THREATS_FOUND',
            },
          }),
        ).rejects.toThrow(/file_scan_results_status_check/);
      });

      it('🔴 at-least-once の重複結果は UNIQUE で弾かれる', async () => {
        const objectKey = `skill-sheets/${randomUUID()}.pdf`;
        await owner.fileScanResult.create({
          data: {
            tenantId: TENANT_A,
            objectKey,
            objectVersionId: 'v1',
            status: 'CLEAN',
            rawStatus: 'NO_THREATS_FOUND',
          },
        });
        await expect(
          owner.fileScanResult.create({
            data: {
              tenantId: TENANT_A,
              objectKey,
              objectVersionId: 'v1',
              status: 'CLEAN',
              rawStatus: 'NO_THREATS_FOUND',
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('skill_sheet_extractions_status_check（docs/05 §3.4）', () => {
      it('不正な status は拒否される', async () => {
        await expect(
          owner.skillSheetExtraction.create({
            data: {
              tenantId: TENANT_A,
              skillSheetId,
              payload: {},
              role: 'sheet-parser',
              promptVersion: 'v1',
              modelId: 'claude-sonnet-5',
              aiUsageId: randomUUID(),
              status: 'BOGUS',
            },
          }),
        ).rejects.toThrow(/skill_sheet_extractions_status_check/);
      });

      it('対照: 許容値は成立する', async () => {
        const extraction = await owner.skillSheetExtraction.create({
          data: {
            tenantId: TENANT_A,
            skillSheetId,
            payload: { careers: [], skills: [], unextracted: [] },
            role: 'sheet-parser',
            promptVersion: 'v1',
            modelId: 'claude-sonnet-5',
            aiUsageId: randomUUID(),
            status: 'PENDING_REVIEW',
          },
        });
        expect(extraction.status).toBe('PENDING_REVIEW');
      });
    });

    describe('projects_status_check / projects_remote_mode_check（docs/05 §3.5）', () => {
      it('不正な status は拒否される', async () => {
        await expect(
          owner.project.create({ data: { tenantId: TENANT_A, name: 'X', status: 'BOGUS' } }),
        ).rejects.toThrow(/projects_status_check/);
      });

      it('不正な remote_mode は拒否される', async () => {
        await expect(
          owner.project.create({ data: { tenantId: TENANT_A, name: 'X', remoteMode: 'BOGUS' } }),
        ).rejects.toThrow(/projects_remote_mode_check/);
      });

      it('対照: 許容値の組み合わせは成立する', async () => {
        const project = await owner.project.create({
          data: { tenantId: TENANT_A, name: 'X', status: 'SUCCESSOR_WANTED', remoteMode: 'ONSITE_ONLY' },
        });
        expect(project.status).toBe('SUCCESSOR_WANTED');
      });
    });

    describe('🔴 project_requirements_kind_check（docs/05 §3.5。F-013 AC-1 の完了判定 = MUST/NICE の 2 値）', () => {
      it('不正な kind は拒否される', async () => {
        await expect(
          owner.projectRequirement.create({
            data: { tenantId: TENANT_A, projectId, kind: 'REQUIRED' },
          }),
        ).rejects.toThrow(/project_requirements_kind_check/);
      });

      it('対照: MUST は成立する（必須要件。F-029 の足切り対象）', async () => {
        const requirement = await owner.projectRequirement.create({
          data: { tenantId: TENANT_A, projectId, kind: 'MUST', skillId, requiredYears: '3.0' },
        });
        expect(requirement.kind).toBe('MUST');
      });

      it('対照: NICE は成立する（尚可要件）', async () => {
        const requirement = await owner.projectRequirement.create({
          data: { tenantId: TENANT_A, projectId, kind: 'NICE', freeText: 'AWS 経験があれば尚可' },
        });
        expect(requirement.kind).toBe('NICE');
      });
    });

    describe('project_visibilities の UNIQUE(tenant, project, partner)（docs/05 §3.5。越境経路 1 の唯一の根拠）', () => {
      it('🔴 同一案件・同一パートナーへの重複公開は拒否される', async () => {
        await owner.projectVisibility.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            partnerCompanyId: PARTNER_A1,
            publishedAt: new Date(),
            publishedBy: randomUUID(),
            reviewGateId: randomUUID(),
          },
        });
        await expect(
          owner.projectVisibility.create({
            data: {
              tenantId: TENANT_A,
              projectId,
              partnerCompanyId: PARTNER_A1,
              publishedAt: new Date(),
              publishedBy: randomUUID(),
              reviewGateId: randomUUID(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('engineer_shares の UNIQUE(tenant, engineer)（docs/05 §3.5。越境経路 4 の唯一の根拠）', () => {
      it('🔴 同一エンジニアの重複共有は拒否される', async () => {
        await owner.engineerShare.create({
          data: {
            tenantId: TENANT_A,
            engineerId: ENGINEER_A_HOST,
            partnerCompanyId: PARTNER_A1,
            sharedAt: new Date(),
            sharedBy: randomUUID(),
          },
        });
        await expect(
          owner.engineerShare.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_HOST,
              partnerCompanyId: PARTNER_A1,
              sharedAt: new Date(),
              sharedBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('match_candidates の UNIQUE(tenant, project, engineer)（docs/05 §3.5）', () => {
      it('🔴 同一案件・同一エンジニアの重複候補行は拒否される', async () => {
        await owner.matchCandidate.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            isAnonymous: false,
            computedAt: new Date(),
          },
        });
        await expect(
          owner.matchCandidate.create({
            data: {
              tenantId: TENANT_A,
              projectId,
              engineerId: ENGINEER_A_HOST,
              isAnonymous: false,
              computedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });
  });
});
