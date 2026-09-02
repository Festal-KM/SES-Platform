// tests/isolation/tenant-boundary-constraints.test.ts
// T-02-01（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.3 の 6 新表
// （users / memberships / partner_companies / invitations / two_factor_credentials /
// tenant_sending_domains）について、
//   ① ENABLE + FORCE ROW LEVEL SECURITY が既定でポリシー 0 件のまま入っていること
//      （fail-closed。C0〜C8 のポリシー本体は T-02-06）
//   ② migration.sql に手で追加した CHECK 制約 / トリガが実際に機能すること
// を検証する。
//
// 🔴 ②は RLS を一時的に DISABLE してテーブル所有者（app_migrator）接続で直接 INSERT を試みる
//    （tests/isolation/double-defense.test.ts #3 と同じ手法。setRowLevelSecurity は
//    その二重防御テスト用に作られたヘルパをそのまま再利用する）。
//    app_tenant には本タスクの時点で新 6 表への GRANT が 1 つも無いため、
//    migratorUrl（テーブル所有者。GRANT 不要で全操作できる）以外の接続では検証できない。
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createUnextendedClient,
  readTableRlsStatus,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import { TENANT_A } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const NEW_TABLES = [
  'users',
  'memberships',
  'partner_companies',
  'invitations',
  'two_factor_credentials',
  'tenant_sending_domains',
] as const;

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.test`;
}

describe('T-02-01: docs/05 §3.3 の新 6 表', () => {
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

  it('① 全 6 表で RLS が有効かつ FORCE されている（docs/05 §4.1 第 1 防御。既定は fail-closed）', async () => {
    const status = await readTableRlsStatus(owner, [...NEW_TABLES]);
    expect(status).toHaveLength(NEW_TABLES.length); // 空振り防止（対照）
    for (const table of status) {
      expect(table.rlsEnabled, `${table.table}: RLS が有効でない`).toBe(true);
      expect(table.rlsForced, `${table.table}: RLS が FORCE されていない`).toBe(true);
    }
  });

  it('① ポリシーが 0 件のため、所有者（app_migrator）接続でも SELECT は 0 件（T-02-06 前の既定 = fail-closed）', async () => {
    const rows = await owner.user.findMany();
    expect(rows).toEqual([]);
  });

  it('① ポリシーが 0 件のため、所有者（app_migrator）接続でも INSERT は拒否される', async () => {
    await expect(
      owner.partnerCompany.create({
        data: { tenantId: TENANT_A, name: 'RLS 越境未検証', invitedAt: new Date() },
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  describe('② CHECK 制約 / トリガ（RLS を一時 DISABLE して直接検証。T-02-06 前提の暫定手段）', () => {
    beforeAll(async () => {
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [...NEW_TABLES],
        enabled: false,
      });
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [...NEW_TABLES],
        enabled: true,
      });
    }, SETUP_TIMEOUT_MS);

    it('対照: RLS が確かに落ちている（所有者接続で PartnerCompany を作成できる）', async () => {
      const partner = await owner.partnerCompany.create({
        data: { tenantId: TENANT_A, name: '対照用パートナー', invitedAt: new Date() },
      });
      expect(partner.id).toBeTruthy();
    });

    describe('memberships_partner_role_check（docs/05 §3.3 / F-002 AC-1）', () => {
      it('パートナーロールなのに partner_company_id が無い行は拒否される', async () => {
        const user = await owner.user.create({
          data: { tenantId: TENANT_A, email: uniqueEmail(), displayName: 'X', passwordHash: 'h' },
        });
        await expect(
          owner.membership.create({
            data: {
              tenantId: TENANT_A,
              userId: user.id,
              role: 'PARTNER_SALES',
              partnerCompanyId: null,
              joinedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/memberships_partner_role_check/);
      });

      it('ホストロールなのに partner_company_id がある行は拒否される', async () => {
        const partner = await owner.partnerCompany.create({
          data: { tenantId: TENANT_A, name: 'P-role-check', invitedAt: new Date() },
        });
        const user = await owner.user.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: partner.id,
            email: uniqueEmail(),
            displayName: 'X',
            passwordHash: 'h',
          },
        });
        await expect(
          owner.membership.create({
            data: {
              tenantId: TENANT_A,
              userId: user.id,
              role: 'SALES',
              partnerCompanyId: partner.id,
              joinedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/memberships_partner_role_check/);
      });

      it('対照: ホストロール + partner_company_id 無しは成立する', async () => {
        const user = await owner.user.create({
          data: { tenantId: TENANT_A, email: uniqueEmail(), displayName: 'X', passwordHash: 'h' },
        });
        const membership = await owner.membership.create({
          data: { tenantId: TENANT_A, userId: user.id, role: 'SALES', joinedAt: new Date() },
        });
        expect(membership.partnerCompanyId).toBeNull();
      });
    });

    describe('assert_user_owner_matches_membership（docs/05 §3.3。users との整合トリガ）', () => {
      it('users.owner_partner_company_id と異なる partner_company_id の membership は拒否される', async () => {
        const partnerA = await owner.partnerCompany.create({
          data: { tenantId: TENANT_A, name: 'Owner-Trigger-A', invitedAt: new Date() },
        });
        const partnerB = await owner.partnerCompany.create({
          data: { tenantId: TENANT_A, name: 'Owner-Trigger-B', invitedAt: new Date() },
        });
        const user = await owner.user.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: partnerA.id,
            email: uniqueEmail(),
            displayName: 'X',
            passwordHash: 'h',
          },
        });
        await expect(
          owner.membership.create({
            data: {
              tenantId: TENANT_A,
              userId: user.id,
              role: 'PARTNER_SALES',
              partnerCompanyId: partnerB.id,
              joinedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/一致しません/);
      });

      it('対照: users.owner_partner_company_id と一致する partner_company_id の membership は成立する', async () => {
        const partner = await owner.partnerCompany.create({
          data: { tenantId: TENANT_A, name: 'Owner-Trigger-Match', invitedAt: new Date() },
        });
        const user = await owner.user.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: partner.id,
            email: uniqueEmail(),
            displayName: 'X',
            passwordHash: 'h',
          },
        });
        const membership = await owner.membership.create({
          data: {
            tenantId: TENANT_A,
            userId: user.id,
            role: 'PARTNER_SALES',
            partnerCompanyId: partner.id,
            joinedAt: new Date(),
          },
        });
        expect(membership.partnerCompanyId).toBe(partner.id);
      });
    });

    describe('invitations_inviter_check（docs/05 §3.3。招待者は必ずどちらか一方）', () => {
      const base = {
        tenantId: TENANT_A,
        email: 'invitee@example.test',
        role: 'SALES' as const,
        tokenHash: () => randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      };

      it('invitedBy / invitedByPlatformUserId が両方 null なら拒否される', async () => {
        await expect(
          owner.invitation.create({
            data: {
              tenantId: base.tenantId,
              email: base.email,
              role: base.role,
              tokenHash: base.tokenHash(),
              expiresAt: base.expiresAt,
            },
          }),
        ).rejects.toThrow(/invitations_inviter_check/);
      });

      it('invitedBy / invitedByPlatformUserId が両方非 null なら拒否される', async () => {
        await expect(
          owner.invitation.create({
            data: {
              tenantId: base.tenantId,
              email: base.email,
              role: base.role,
              tokenHash: base.tokenHash(),
              expiresAt: base.expiresAt,
              invitedBy: randomUUID(),
              invitedByPlatformUserId: randomUUID(),
            },
          }),
        ).rejects.toThrow(/invitations_inviter_check/);
      });

      it('対照: どちらか一方だけなら成立する', async () => {
        const invitation = await owner.invitation.create({
          data: {
            tenantId: base.tenantId,
            email: base.email,
            role: base.role,
            tokenHash: base.tokenHash(),
            expiresAt: base.expiresAt,
            invitedBy: randomUUID(),
          },
        });
        expect(invitation.id).toBeTruthy();
      });
    });

    describe('tenant_sending_domains の CHECK / 部分 UNIQUE（docs/05 §3.3）', () => {
      it('state=VERIFIED なのに verified_at が null なら拒否される', async () => {
        await expect(
          owner.tenantSendingDomain.create({
            data: { tenantId: TENANT_A, domain: `verified-${randomUUID()}.example.test`, state: 'VERIFIED' },
          }),
        ).rejects.toThrow(/tenant_sending_domains_verified_check/);
      });

      it('verified_at が非 null なのに state が VERIFIED でないなら拒否される', async () => {
        await expect(
          owner.tenantSendingDomain.create({
            data: {
              tenantId: TENANT_A,
              domain: `pending-${randomUUID()}.example.test`,
              state: 'PENDING',
              verifiedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/tenant_sending_domains_verified_check/);
      });

      it('不正な state 値は拒否される', async () => {
        await expect(
          owner.tenantSendingDomain.create({
            data: {
              tenantId: TENANT_A,
              domain: `bogus-${randomUUID()}.example.test`,
              state: 'BOGUS',
            },
          }),
        ).rejects.toThrow(/tenant_sending_domains_state_check/);
      });

      it('🔴 1 テナントにつき検証済みドメインは 1 つまで（部分 UNIQUE）', async () => {
        const tenantId = TENANT_A;
        await owner.tenantSendingDomain.create({
          data: {
            tenantId,
            domain: `first-verified-${randomUUID()}.example.test`,
            state: 'VERIFIED',
            verifiedAt: new Date(),
          },
        });
        // 🔴 Prisma は一意制約違反（部分 UNIQUE を含む）を P2002 として認識し、
        //    生の制約名ではなく「対象列」で要約したメッセージに変換する
        //    （CHECK 制約違反は未知のエラーとして生の SQLSTATE メッセージがそのまま出るため
        //    制約名で照合できるが、UNIQUE 違反はこの汎用メッセージになる）。
        await expect(
          owner.tenantSendingDomain.create({
            data: {
              tenantId,
              domain: `second-verified-${randomUUID()}.example.test`,
              state: 'VERIFIED',
              verifiedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed.*tenant_id/s);
      });
    });

    describe('two_factor_credentials_subject_type_check（docs/05 §3.3）', () => {
      it('subject_type が USER / PLATFORM_USER 以外なら拒否される', async () => {
        await expect(
          owner.twoFactorCredential.create({
            data: {
              subjectType: 'BOGUS',
              subjectId: randomUUID(),
              secretEncrypted: 'v1:key:iv:ct:tag',
              recoveryCodeHashes: [],
            },
          }),
        ).rejects.toThrow(/two_factor_credentials_subject_type_check/);
      });

      it('対照: subject_type=USER は成立する', async () => {
        const credential = await owner.twoFactorCredential.create({
          data: {
            subjectType: 'USER',
            subjectId: randomUUID(),
            tenantId: TENANT_A,
            secretEncrypted: 'v1:key:iv:ct:tag',
            recoveryCodeHashes: [],
          },
        });
        expect(credential.id).toBeTruthy();
      });
    });
  });
});
