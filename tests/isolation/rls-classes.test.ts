// tests/isolation/rls-classes.test.ts
// T-02-06（docs/sprints/SP-02-schema-isolation.md）: RLS ポリシークラス C0〜C8 の**成立**を、
// クラスごとに「正の経路（見えるべきものが見える）」と「負の経路（見えてはならないものが 0 件）」で
// 確かめる（docs/05 §4.4）。
//
// 🔴 なぜ正の経路も要るか: 負の経路だけを書くと、GRANT やポリシーの式を間違えて
//    「何も見えない」状態にしても全部 green になる（空振り）。クラスごとに 1 件は
//    「見えるべきものが見える」ことを対にして固定する。
//
// 🔴 本ファイルは主に**第 1 防御（RLS）単体**を検証するため、Prisma 拡張を適用しない
//    素のクライアント（`runUnextended`）で問い合わせる。二重防御そのもの（拡張を外す /
//    RLS を落とす）の検証は double-defense.test.ts、カタログ走査は T-02-09 の範囲。
//
// 🔴 パートナーは 2 社（PARTNER_A1 / PARTNER_A2）を置いている。1 社だけでは
//    「パートナー同士が相互に参照できない」（CLAUDE.md §3.1 の 🔴 / §7 の KPI）を検証できない。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SystemOnlyModelAccessError,
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withAuthLookup,
  withInvitationAccept,
  withInvitationToken,
  withPasswordResetConfirm,
  withPasswordResetIssue,
  withSystemScope,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  createUnextendedClient,
  hasTablePrivilege,
  readPolicies,
  readPublicBaseTables,
  runUnextended,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  ANNOUNCEMENT_A,
  ANNOUNCEMENT_ALL,
  ANNOUNCEMENT_B,
  CONTRACT_A_P1,
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  INVITATION_A_HOST,
  INVITATION_A_P1,
  INVITATION_A_P1_TOKEN_HASH,
  MATCH_A_P1,
  MEMBERSHIP_A_HOST,
  MEMBERSHIP_A_P1,
  MESSAGE_A_P1,
  MESSAGE_A_P2,
  NOTIFICATION_A_HOST,
  NOTIFICATION_A_PARTNER,
  PARTNER_A1,
  PARTNER_A2,
  PASSWORD_RESET_TOKEN_HASH_B,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P2,
  REQUIREMENT_A_PRIVATE,
  REQUIREMENT_A_PUBLISHED,
  SCHEDULER_RUN_SEED,
  SHARE_A_P1,
  SKILL_ALIAS_A,
  SKILL_ALIAS_B,
  SKILL_ALIAS_GLOBAL,
  TASK_A_HOST,
  TASK_A_P1,
  TENANT_A,
  TENANT_B,
  THREAD_A_P1,
  THREAD_A_P2,
  TWO_FACTOR_A_HOST,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
  VISIBILITY_A_P1,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const HOST_A = { tenantId: TENANT_A, partnerCompanyId: null, actorUserId: USER_A_HOST };
const P1_A = { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, actorUserId: USER_A_PARTNER };
const P2_A = { tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, actorUserId: USER_A_PARTNER2 };
const HOST_B = { tenantId: TENANT_B, partnerCompanyId: null, actorUserId: USER_B_HOST };

let database: IsolationDatabase;
let db: UnextendedClient;
let ctxAHost: AuthenticatedTenantCtx;
let ctxAPartner1: AuthenticatedTenantCtx;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  db = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxAHost = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
  ctxAPartner1 = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A1,
      userId: USER_A_PARTNER,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await db?.$disconnect();
  await disconnectTenantDb();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('C0 SYSTEM_ONLY（docs/05 §4.4 / §4.4.2）', () => {
  it('正: withSystemScope からは scheduler_runs が見える', async () => {
    const rows = await withSystemScope((system) => system.schedulerRun.findMany());
    expect(rows.map((row) => row.id)).toEqual([SCHEDULER_RUN_SEED]);
  });

  it('🔴 負: テナント文脈（app.tenant_id あり）では 0 件になる', async () => {
    const rows = await runUnextended(db, HOST_A, (tx) => tx.schedulerRun.findMany());
    expect(rows).toHaveLength(0);
  });

  it('🔴 負: Prisma 拡張（第 2 防御）も C0 モデルへのテナント文脈からのアクセスを拒否する', async () => {
    await expect(withTenant(ctxAHost, (scoped) => scoped.schedulerRun.findMany())).rejects.toThrow(
      SystemOnlyModelAccessError,
    );
  });

  it('🔴 負: withSystemScope でも業務テーブル（engineers）は 0 件（C0 以外のポリシーが真にならない）', async () => {
    const rows = await runUnextended(db, null, (tx) => tx.engineer.findMany());
    expect(rows).toHaveLength(0);
  });
});

describe('C1 TENANT_ALL（docs/05 §4.4）', () => {
  it('正/負: tenants は自テナントの 1 行だけ', async () => {
    const rows = await runUnextended(db, HOST_A, (tx) => tx.tenant.findMany());
    expect(rows.map((row) => row.id)).toEqual([TENANT_A]);
  });

  it('🔴 skill_aliases: 自テナント + グローバル行が読める（F-010 AC-2）', async () => {
    const rows = await runUnextended(db, HOST_A, (tx) => tx.skillAlias.findMany());
    expect(sorted(rows.map((row) => row.id))).toEqual(sorted([SKILL_ALIAS_GLOBAL, SKILL_ALIAS_A]));
    expect(rows.map((row) => row.id)).not.toContain(SKILL_ALIAS_B);
  });

  it('🔴 skill_aliases: パートナー文脈でも同じ（C1 はパートナー境界で絞らない）', async () => {
    const rows = await runUnextended(db, P1_A, (tx) => tx.skillAlias.findMany());
    expect(sorted(rows.map((row) => row.id))).toEqual(sorted([SKILL_ALIAS_GLOBAL, SKILL_ALIAS_A]));
  });

  it('🔴 skill_aliases: グローバル行は更新・削除できない（0 件更新）', async () => {
    const updated = await runUnextended(db, HOST_A, (tx) =>
      tx.skillAlias.updateMany({ where: { id: SKILL_ALIAS_GLOBAL }, data: { status: 'REJECTED' } }),
    );
    expect(updated.count).toBe(0);
    const deleted = await runUnextended(db, HOST_A, (tx) =>
      tx.skillAlias.deleteMany({ where: { id: SKILL_ALIAS_GLOBAL } }),
    );
    expect(deleted.count).toBe(0);
  });

  it('🔴 第 2 防御（Prisma 拡張）越しでもグローバル行が読める（T-02-02 からの申し送りの解消）', async () => {
    // 🔴 T-02-05 まで、拡張が無条件に `AND tenantId = ctx` を注入していたため、
    //    RLS が許すグローバル行が withTenant 経由では 1 件も読めなかった。
    const rows = await withTenant(ctxAHost, (scoped) => scoped.skillAlias.findMany());
    expect(sorted(rows.map((row) => row.id))).toEqual(sorted([SKILL_ALIAS_GLOBAL, SKILL_ALIAS_A]));
  });

  it('🔴 第 2 防御越しでもグローバル行は書き換えられない（緩和は読みだけ）', async () => {
    const updated = await withTenant(ctxAHost, (scoped) =>
      scoped.skillAlias.updateMany({
        where: { id: SKILL_ALIAS_GLOBAL },
        data: { status: 'REJECTED' },
      }),
    );
    expect(updated.count).toBe(0);
  });

  it('announcements: 全テナント宛 + 自テナント宛だけが見える', async () => {
    const rows = await runUnextended(db, HOST_A, (tx) => tx.announcement.findMany());
    expect(sorted(rows.map((row) => row.id))).toEqual(sorted([ANNOUNCEMENT_ALL, ANNOUNCEMENT_A]));
    expect(rows.map((row) => row.id)).not.toContain(ANNOUNCEMENT_B);
  });

  it('announcements: 第 2 防御（配列メンバシップの注入）越しでも同じ', async () => {
    const rows = await withTenant(ctxAHost, (scoped) => scoped.announcement.findMany());
    expect(sorted(rows.map((row) => row.id))).toEqual(sorted([ANNOUNCEMENT_ALL, ANNOUNCEMENT_A]));
  });

  it('🔴 audit_logs: パートナー文脈でも INSERT できる（C1）が、読めるのはホストだけ（C2）', async () => {
    // 🔴 `create()` は INSERT ... RETURNING になり、PostgreSQL は RETURNING に SELECT ポリシーを
    //    適用する。audit_logs の SELECT は C2（ホストのみ）なので、パートナーの記録は
    //    **書けるが読み返せない**。したがって記録側は `createMany`（RETURNING 無し）を使う。
    //    これは仕様どおりの帰結であり、T-03-05（監査ログの記録）はこの制約の下で実装する。
    const inserted = await runUnextended(db, P1_A, (tx) =>
      tx.auditLog.createMany({
        data: [
          {
            tenantId: TENANT_A,
            actorKind: 'USER',
            actorId: USER_A_PARTNER,
            action: 'proposal.create',
            summary: {},
          },
        ],
      }),
    );
    expect(inserted.count).toBe(1);

    const asPartner = await runUnextended(db, P1_A, (tx) => tx.auditLog.findMany());
    expect(asPartner).toHaveLength(0);

    const asHost = await runUnextended(db, HOST_A, (tx) => tx.auditLog.findMany());
    expect(asHost.map((row) => row.action)).toEqual(['proposal.create']);

    const asOtherTenant = await runUnextended(db, HOST_B, (tx) => tx.auditLog.findMany());
    expect(asOtherTenant).toHaveLength(0);
  });

  it('🔴 audit_logs: create（RETURNING）はパートナー文脈では通らない（SELECT ポリシーが RETURNING に効く）', async () => {
    await expect(
      runUnextended(db, P1_A, (tx) =>
        tx.auditLog.create({
          data: { tenantId: TENANT_A, actorKind: 'SYSTEM', action: 'x', summary: {} },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('🔴 audit_logs: 他テナントの tenant_id では INSERT できない（WITH CHECK）', async () => {
    await expect(
      runUnextended(db, HOST_A, (tx) =>
        tx.auditLog.create({
          data: { tenantId: TENANT_B, actorKind: 'SYSTEM', action: 'x', summary: {} },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('C2 HOST_ONLY（docs/05 §4.4）', () => {
  it('正: ホストは match_candidates / contracts を読める', async () => {
    const [candidates, contracts] = await runUnextended(db, HOST_A, async (tx) => [
      await tx.matchCandidate.findMany(),
      await tx.contract.findMany(),
    ]);
    expect(candidates.map((row) => row.id)).toEqual([MATCH_A_P1]);
    expect(contracts.map((row) => row.id)).toEqual([CONTRACT_A_P1]);
  });

  it('🔴 負: パートナーは match_candidates を 1 件も読めない（匿名候補の生成物）', async () => {
    const rows = await runUnextended(db, P1_A, (tx) => tx.matchCandidate.findMany());
    expect(rows).toHaveLength(0);
  });

  it('🔴 負: パートナーは contracts を読めない（C9 は T-02-07。この時点では 0 件）', async () => {
    const rows = await runUnextended(db, P1_A, (tx) => tx.contract.findMany());
    expect(rows).toHaveLength(0);
  });

  it('🔴 負: パートナーは案件を作成できない（書込は C2）', async () => {
    await expect(
      runUnextended(db, P1_A, (tx) =>
        tx.project.create({ data: { tenantId: TENANT_A, name: 'パートナーが作った案件' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('正: ホストは案件を作成できる（対照。上が常に失敗なのではない）', async () => {
    const created = await runUnextended(db, HOST_A, (tx) =>
      tx.project.create({ data: { tenantId: TENANT_A, name: 'ホストが作った案件' }, select: { id: true } }),
    );
    await runUnextended(db, HOST_A, (tx) => tx.project.delete({ where: { id: created.id } }));
  });
});

describe('C3 OWNER_SCOPED（docs/05 §4.4）', () => {
  it('正/負: engineers は自分の所属分だけが見える（パートナー同士も相互に見えない）', async () => {
    const [asHost, asP1, asP2] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.engineer.findMany()),
      runUnextended(db, P1_A, (tx) => tx.engineer.findMany()),
      runUnextended(db, P2_A, (tx) => tx.engineer.findMany()),
    ]);
    expect(asHost.map((row) => row.id)).toEqual([ENGINEER_A_HOST]);
    expect(asP1.map((row) => row.id)).toEqual([ENGINEER_A_PARTNER]);
    expect(asP2.map((row) => row.id)).toEqual([ENGINEER_A_PARTNER2]);
  });

  it('🔴 負: パートナーはホスト所属としてエンジニアを作れない（WITH CHECK が C3 の式）', async () => {
    await expect(
      runUnextended(db, P1_A, (tx) =>
        tx.engineer.create({
          data: { tenantId: TENANT_A, ownerPartnerCompanyId: null, displayName: '偽装' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('🔴 engineer_shares: 共有元のパートナーだけが行を読める。**ホストからは読めない**（BR-56）', async () => {
    const asP1 = await runUnextended(db, P1_A, (tx) => tx.engineerShare.findMany());
    expect(asP1.map((row) => row.id)).toEqual([SHARE_A_P1]);

    const asHost = await runUnextended(db, HOST_A, (tx) => tx.engineerShare.findMany());
    expect(asHost).toHaveLength(0);

    const asP2 = await runUnextended(db, P2_A, (tx) => tx.engineerShare.findMany());
    expect(asP2).toHaveLength(0);
  });
});

describe('C4 VISIBILITY（越境経路 1。docs/05 §4.4）', () => {
  it('正: 公開されたパートナーだけが案件を読める', async () => {
    const [asHost, asP1, asP2] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.project.findMany()),
      runUnextended(db, P1_A, (tx) => tx.project.findMany()),
      runUnextended(db, P2_A, (tx) => tx.project.findMany()),
    ]);
    expect(sorted(asHost.map((row) => row.id))).toEqual(
      sorted([PROJECT_A_PUBLISHED, PROJECT_A_PRIVATE]),
    );
    expect(asP1.map((row) => row.id)).toEqual([PROJECT_A_PUBLISHED]);
    expect(asP2).toHaveLength(0);
  });

  it('正/負: project_requirements も同じ境界で絞られる', async () => {
    const [asHost, asP1] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.projectRequirement.findMany()),
      runUnextended(db, P1_A, (tx) => tx.projectRequirement.findMany()),
    ]);
    expect(sorted(asHost.map((row) => row.id))).toEqual(
      sorted([REQUIREMENT_A_PUBLISHED, REQUIREMENT_A_PRIVATE]),
    );
    expect(asP1.map((row) => row.id)).toEqual([REQUIREMENT_A_PUBLISHED]);
  });

  it('🔴 公開の取り消し（revoked_at）で即座に見えなくなる = 行の有無がそのまま境界である', async () => {
    await runUnextended(db, HOST_A, (tx) =>
      tx.projectVisibility.updateMany({ where: { id: VISIBILITY_A_P1 }, data: { revokedAt: new Date() } }),
    );
    try {
      const rows = await runUnextended(db, P1_A, (tx) => tx.project.findMany());
      expect(rows).toHaveLength(0);
    } finally {
      await runUnextended(db, HOST_A, (tx) =>
        tx.projectVisibility.updateMany({ where: { id: VISIBILITY_A_P1 }, data: { revokedAt: null } }),
      );
    }
  });
});

describe('C5 PARTY（越境経路 2 / 4。docs/05 §4.4）', () => {
  it('🔴 proposals: ホストは全社分、各パートナーは自社分だけ（他社の提案の存在も見えない）', async () => {
    const [asHost, asP1, asP2] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.proposal.findMany()),
      runUnextended(db, P1_A, (tx) => tx.proposal.findMany()),
      runUnextended(db, P2_A, (tx) => tx.proposal.findMany()),
    ]);
    expect(sorted(asHost.map((row) => row.id))).toEqual(
      sorted([PROPOSAL_A_HOST, PROPOSAL_A_P1, PROPOSAL_A_P2]),
    );
    expect(asP1.map((row) => row.id)).toEqual([PROPOSAL_A_P1]);
    expect(asP2.map((row) => row.id)).toEqual([PROPOSAL_A_P2]);
  });

  it('🔴 proposals: 二重防御（withTenant）越しでもパートナーは自社分だけ', async () => {
    const rows = await withTenant(ctxAPartner1, (scoped) => scoped.proposal.findMany());
    expect(rows.map((row) => row.id)).toEqual([PROPOSAL_A_P1]);
  });

  it('🔴 proposals: 件数も漏れない（COUNT が境界適用後の母集団だけを数える。docs/05 §4.8）', async () => {
    const [asHost, asP1] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.proposal.count()),
      runUnextended(db, P1_A, (tx) => tx.proposal.count()),
    ]);
    expect(asHost).toBe(3);
    expect(asP1).toBe(1);
  });

  it('partner_companies: パートナー文脈では自社 1 行のみ（F-004 AC-1）', async () => {
    const [asHost, asP1] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.partnerCompany.findMany()),
      runUnextended(db, P1_A, (tx) => tx.partnerCompany.findMany()),
    ]);
    expect(sorted(asHost.map((row) => row.id))).toEqual(sorted([PARTNER_A1, PARTNER_A2]));
    expect(asP1.map((row) => row.id)).toEqual([PARTNER_A1]);
  });

  it('project_visibilities: パートナーは自社宛の行だけを読める（C4 の EXISTS の前提）', async () => {
    const [asP1, asP2] = await Promise.all([
      runUnextended(db, P1_A, (tx) => tx.projectVisibility.findMany()),
      runUnextended(db, P2_A, (tx) => tx.projectVisibility.findMany()),
    ]);
    expect(asP1.map((row) => row.id)).toEqual([VISIBILITY_A_P1]);
    expect(asP2).toHaveLength(0);
  });

  it('memberships / invitations / tasks も自社分だけが見える', async () => {
    const [membershipsHost, membershipsP1, invitationsHost, invitationsP1, tasksHost, tasksP1] =
      await Promise.all([
        runUnextended(db, HOST_A, (tx) => tx.membership.findMany()),
        runUnextended(db, P1_A, (tx) => tx.membership.findMany()),
        runUnextended(db, HOST_A, (tx) => tx.invitation.findMany()),
        runUnextended(db, P1_A, (tx) => tx.invitation.findMany()),
        runUnextended(db, HOST_A, (tx) => tx.task.findMany()),
        runUnextended(db, P1_A, (tx) => tx.task.findMany()),
      ]);
    expect(membershipsHost).toHaveLength(3);
    expect(membershipsP1.map((row) => row.id)).toEqual([MEMBERSHIP_A_P1]);
    expect(membershipsHost.map((row) => row.id)).toContain(MEMBERSHIP_A_HOST);
    expect(sorted(invitationsHost.map((row) => row.id))).toEqual(
      sorted([INVITATION_A_HOST, INVITATION_A_P1]),
    );
    expect(invitationsP1.map((row) => row.id)).toEqual([INVITATION_A_P1]);
    expect(sorted(tasksHost.map((row) => row.id))).toEqual(sorted([TASK_A_HOST, TASK_A_P1]));
    expect(tasksP1.map((row) => row.id)).toEqual([TASK_A_P1]);
  });

  it('🔴 negative: memberships の WITH CHECK は C3 の式（ホストがパートナー所属の行を作れない）', async () => {
    await expect(
      runUnextended(db, HOST_A, (tx) =>
        tx.membership.create({
          data: {
            tenantId: TENANT_A,
            userId: USER_A_PARTNER2,
            role: 'PARTNER_ADMIN',
            partnerCompanyId: PARTNER_A2,
            joinedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('C6 THREAD（越境経路 3。docs/05 §4.4）', () => {
  it('正/負: 参加している会社のスレッドとメッセージだけが見える', async () => {
    const [threadsHost, threadsP1, threadsP2, messagesP1, messagesP2] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.chatThread.findMany()),
      runUnextended(db, P1_A, (tx) => tx.chatThread.findMany()),
      runUnextended(db, P2_A, (tx) => tx.chatThread.findMany()),
      runUnextended(db, P1_A, (tx) => tx.message.findMany()),
      runUnextended(db, P2_A, (tx) => tx.message.findMany()),
    ]);
    expect(sorted(threadsHost.map((row) => row.id))).toEqual(sorted([THREAD_A_P1, THREAD_A_P2]));
    expect(threadsP1.map((row) => row.id)).toEqual([THREAD_A_P1]);
    expect(threadsP2.map((row) => row.id)).toEqual([THREAD_A_P2]);
    expect(messagesP1.map((row) => row.id)).toEqual([MESSAGE_A_P1]);
    expect(messagesP2.map((row) => row.id)).toEqual([MESSAGE_A_P2]);
  });

  it('🔴 退出（left_at）で即座に読めなくなる = ThreadParticipant の行の有無がそのまま境界である', async () => {
    await runUnextended(db, HOST_A, (tx) =>
      tx.threadParticipant.updateMany({
        where: { threadId: THREAD_A_P1, partnerCompanyId: PARTNER_A1 },
        data: { leftAt: new Date() },
      }),
    );
    try {
      const [threads, messages] = await runUnextended(db, P1_A, async (tx) => [
        await tx.chatThread.findMany(),
        await tx.message.findMany(),
      ]);
      expect(threads).toHaveLength(0);
      expect(messages).toHaveLength(0);
    } finally {
      await runUnextended(db, HOST_A, (tx) =>
        tx.threadParticipant.updateMany({
          where: { threadId: THREAD_A_P1, partnerCompanyId: PARTNER_A1 },
          data: { leftAt: null },
        }),
      );
    }
  });
});

describe('C7 SELF（docs/05 §4.4）', () => {
  it('正/負: notifications は受信者本人だけが読む', async () => {
    const [asHost, asP1] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.notification.findMany()),
      runUnextended(db, P1_A, (tx) => tx.notification.findMany()),
    ]);
    expect(asHost.map((row) => row.id)).toEqual([NOTIFICATION_A_HOST]);
    expect(asP1.map((row) => row.id)).toEqual([NOTIFICATION_A_PARTNER]);
  });

  it('🔴 notifications: INSERT だけは他人宛に作れる（WITH CHECK が C1 式。ジョブ / チャット相手）', async () => {
    // 🔴 `create()` は INSERT ... RETURNING であり、RETURNING には SELECT ポリシー（C7 = 本人のみ）が
    //    効く。他人宛の通知は「書けるが書いた本人は読み返せない」ため `createMany` を使う。
    const inserted = await runUnextended(db, HOST_A, (tx) =>
      tx.notification.createMany({
        data: [
          {
            tenantId: TENANT_A,
            recipientUserId: USER_A_PARTNER,
            kind: 'MESSAGE_RECEIVED',
            title: '他人宛',
            bodyKey: 'notify.other',
            bodyParams: {},
          },
        ],
      }),
    );
    expect(inserted.count).toBe(1);

    // 作った本人（ホスト）には見えない = 読みは本人だけ。
    const asHost = await runUnextended(db, HOST_A, (tx) => tx.notification.findMany());
    expect(asHost.map((row) => row.bodyKey)).not.toContain('notify.other');

    const asRecipient = await runUnextended(db, P1_A, (tx) => tx.notification.findMany());
    expect(asRecipient.map((row) => row.bodyKey)).toContain('notify.other');

    await runUnextended(db, P1_A, (tx) =>
      tx.notification.deleteMany({ where: { bodyKey: 'notify.other' } }),
    );
  });

  it('🔴 notifications: create（RETURNING）は他人宛では通らない（SELECT ポリシーが RETURNING に効く）', async () => {
    // 🔴 docs/05:1419 の「両方向」主張（`createMany` は成功 / `create` は失敗）を、
    //    audit_logs（:244）と対にして notifications 側でも固定する。
    await expect(
      runUnextended(db, HOST_A, (tx) =>
        tx.notification.create({
          data: {
            tenantId: TENANT_A,
            recipientUserId: USER_A_PARTNER,
            kind: 'MESSAGE_RECEIVED',
            title: '他人宛',
            bodyKey: 'notify.other.create',
            bodyParams: {},
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('two_factor_credentials: 本人だけが読める', async () => {
    const [asHost, asP1] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.twoFactorCredential.findMany()),
      runUnextended(db, P1_A, (tx) => tx.twoFactorCredential.findMany()),
    ]);
    expect(asHost.map((row) => row.id)).toEqual([TWO_FACTOR_A_HOST]);
    expect(asP1).toHaveLength(0);
  });
});

describe('C8 DIRECTORY（docs/05 §4.4）', () => {
  it('🔴 正/負: ホスト所属の利用者は全員に見えるが、他パートナーの利用者は 1 行も見えない', async () => {
    const [asHost, asP1, asP2] = await Promise.all([
      runUnextended(db, HOST_A, (tx) => tx.user.findMany()),
      runUnextended(db, P1_A, (tx) => tx.user.findMany()),
      runUnextended(db, P2_A, (tx) => tx.user.findMany()),
    ]);
    expect(sorted(asHost.map((row) => row.id))).toEqual(
      sorted([USER_A_HOST, USER_A_PARTNER, USER_A_PARTNER2]),
    );
    expect(sorted(asP1.map((row) => row.id))).toEqual(sorted([USER_A_HOST, USER_A_PARTNER]));
    expect(sorted(asP2.map((row) => row.id))).toEqual(sorted([USER_A_HOST, USER_A_PARTNER2]));
  });

  it('🔴 負: 書込は C3 の式（パートナーがホスト所属の利用者を作れない）', async () => {
    await expect(
      runUnextended(db, P1_A, (tx) =>
        tx.user.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: null,
            email: `spoof-${Date.now()}@example.test`,
            displayName: '偽装',
            passwordHash: 'x',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

// 🔴 このブロックは最後に置く。withInvitationAccept が users / memberships に行を足すため、
//    先に走らせると上の C5 / C8 の件数が変わる（テストの実行順に依存させない）。
describe('テナント文脈を持たない経路（docs/05 §4.4.2）', () => {
  it('withAuthLookup: メールで該当 1 行だけを引ける', async () => {
    const found = await withAuthLookup('host-a@example.test');
    expect(found?.userId).toBe(USER_A_HOST);
    expect(found?.tenantId).toBe(TENANT_A);
    expect(found?.partnerCompanyId).toBeNull();
  });

  it('withAuthLookup: パートナー所属の利用者は所属が付いて返る', async () => {
    const found = await withAuthLookup('partner-a1@example.test');
    expect(found?.userId).toBe(USER_A_PARTNER);
    expect(found?.partnerCompanyId).toBe(PARTNER_A1);
  });

  it('🔴 withAuthLookup: 該当が無ければ null（存在の有無以外を漏らさない）', async () => {
    expect(await withAuthLookup('nobody@example.test')).toBeNull();
  });

  it('withInvitationToken: トークンハッシュで該当 1 行だけを引ける', async () => {
    const invitation = await withInvitationToken(INVITATION_A_P1_TOKEN_HASH);
    expect(invitation?.invitationId).toBe(INVITATION_A_P1);
    expect(invitation?.tenantId).toBe(TENANT_A);
    expect(invitation?.partnerCompanyId).toBe(PARTNER_A1);
    expect(invitation?.role).toBe('PARTNER_SALES');
  });

  it('🔴 withInvitationToken: 存在しないトークンは null', async () => {
    expect(await withInvitationToken('not-a-real-hash')).toBeNull();
  });

  it('🔴 withPasswordResetConfirm: トークンからテナントが決まり、1 行だけ更新される', async () => {
    const result = await withPasswordResetConfirm(PASSWORD_RESET_TOKEN_HASH_B, 'new-hash');
    expect(result?.userId).toBe(USER_B_HOST);

    // 使用済みトークンは 2 度目に通らない（消去済み）。
    expect(await withPasswordResetConfirm(PASSWORD_RESET_TOKEN_HASH_B, 'newer-hash')).toBeNull();

    const updated = await runUnextended(db, HOST_B, (tx) =>
      tx.user.findMany({ where: { id: USER_B_HOST } }),
    );
    expect(updated[0]?.passwordHash).toBe('new-hash');
    expect(updated[0]?.passwordResetTokenHash).toBeNull();
  });

  it('withPasswordResetIssue: 該当 1 行にトークンを書き込む', async () => {
    const issued = await withPasswordResetIssue('host-a@example.test', {
      tokenHash: 'issued-hash',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(issued).toEqual({ tenantId: TENANT_A, userId: USER_A_HOST });

    const rows = await runUnextended(db, HOST_A, (tx) =>
      tx.user.findMany({ where: { id: USER_A_HOST } }),
    );
    expect(rows[0]?.passwordResetTokenHash).toBe('issued-hash');
  });

  it('🔴 withPasswordResetIssue: 該当が無くても例外にせず null（アカウントの存在を漏らさない）', async () => {
    expect(
      await withPasswordResetIssue('nobody@example.test', {
        tokenHash: 'x',
        expiresAt: new Date(Date.now() + 1000),
      }),
    ).toBeNull();
  });

  it('🔴 withInvitationAccept: 所属は招待行から決まり、受諾は 1 回限り', async () => {
    const accepted = await withInvitationAccept(INVITATION_A_P1_TOKEN_HASH, {
      displayName: '受諾した人',
      passwordHash: 'accepted-hash',
    });
    expect(accepted).not.toBeNull();

    const userId = accepted?.userId as string;
    const [createdUser] = await runUnextended(db, P1_A, (tx) =>
      tx.user.findMany({ where: { id: userId } }),
    );
    // 🔴 引数で所属を渡していないのに、招待行の partner_company_id が入っている。
    expect(createdUser?.ownerPartnerCompanyId).toBe(PARTNER_A1);
    expect(createdUser?.tenantId).toBe(TENANT_A);

    const memberships = await runUnextended(db, P1_A, (tx) =>
      tx.membership.findMany({ where: { userId } }),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('PARTNER_SALES');
    expect(memberships[0]?.partnerCompanyId).toBe(PARTNER_A1);

    // 2 回目は受諾済みなので null（accepted_at の CAS）。
    expect(
      await withInvitationAccept(INVITATION_A_P1_TOKEN_HASH, {
        displayName: '二重受諾',
        passwordHash: 'x',
      }),
    ).toBeNull();
  });

  it('🔴 withInvitationAccept: 存在しないトークンでは何も作らない', async () => {
    const before = await runUnextended(db, HOST_A, (tx) => tx.user.count());
    expect(
      await withInvitationAccept('not-a-real-hash', { displayName: 'x', passwordHash: 'y' }),
    ).toBeNull();
    const after = await runUnextended(db, HOST_A, (tx) => tx.user.count());
    expect(after).toBe(before);
  });
});

// 🔴 T-02-06 の完了判定（docs/sprints/SP-02 T-02-06）。
//    docs/05 §4.7 の**カタログ走査 13 本は T-02-09 の範囲**であり、ここではその前提となる
//    #2（ポリシーが 0 件の表）と #3（app_tenant に権限がありながら app_tenant_id() を
//    参照しないポリシー）だけを先に固定する。T-02-09 で 13 本に拡張する際、この 2 本は
//    そちらへ移設してよい（同じ述語を二重に持たない）。
describe('🔴 T-02-06 の完了判定（T-02-09 のカタログ走査のうち #2 / #3 の先取り）', () => {
  // docs/05 §4.7 の除外リスト。🔴 「全部から 4 つを引く」向きで書き、ここを広げて通さない。
  const OUT_OF_SCOPE = ['platform_users', 'plans', 'subscriptions', 'skills', '_prisma_migrations'];

  it('ポリシーが 1 つも無い業務テーブルが 0 件である', async () => {
    const tables = (await readPublicBaseTables(db)).filter((t) => !OUT_OF_SCOPE.includes(t));
    expect(tables).toHaveLength(52); // 空振り防止（docs/05 §3.2 の 56 表 − 射程外 4 表）

    const policies = await readPolicies(db);
    const withPolicy = new Set(policies.map((policy) => policy.table));
    expect(tables.filter((table) => !withPolicy.has(table))).toEqual([]);
  });

  it('🔴 app_tenant に権限がある表の、app_tenant に適用される全ポリシーが app_tenant_id() を参照する', async () => {
    const tables = (await readPublicBaseTables(db)).filter((t) => !OUT_OF_SCOPE.includes(t));
    const policies = await readPolicies(db);

    const offenders: string[] = [];
    let checked = 0;
    for (const table of tables) {
      const privileges = await Promise.all(
        (['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const).map((privilege) =>
          hasTablePrivilege(db, 'app_tenant', table, privilege),
        ),
      );
      if (!privileges.some(Boolean)) continue;

      for (const policy of policies.filter((candidate) => candidate.table === table)) {
        // app_tenant に適用されるポリシー = TO app_tenant または TO PUBLIC。
        if (!policy.roles.includes('app_tenant') && !policy.roles.includes('public')) continue;
        checked += 1;
        const expression = `${policy.using ?? ''} ${policy.withCheck ?? ''}`;
        if (!expression.includes('app_tenant_id()')) {
          offenders.push(`${table}.${policy.policy}: ${expression.trim()}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0); // 空振り防止（対照）
    expect(offenders).toEqual([]);
  });

  it('🔴 USING (true) 相当のポリシーが 1 件も無い', async () => {
    const policies = await readPolicies(db);
    const suspicious = policies.filter(
      (policy) => policy.using === 'true' || policy.withCheck === 'true',
    );
    expect(suspicious).toEqual([]);
  });

  it('🔴 app_tenant に権限が無い業務テーブルは app_platform / app_platform_write が持つ（孤児表の検出）', async () => {
    const tables = (await readPublicBaseTables(db)).filter((t) => !OUT_OF_SCOPE.includes(t));
    const orphans: string[] = [];
    for (const table of tables) {
      const tenant = await Promise.all(
        (['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const).map((privilege) =>
          hasTablePrivilege(db, 'app_tenant', table, privilege),
        ),
      );
      if (tenant.some(Boolean)) continue;
      const platform = await Promise.all(
        (['app_platform', 'app_platform_write'] as const).flatMap((role) =>
          (['SELECT', 'INSERT', 'UPDATE'] as const).map((privilege) =>
            hasTablePrivilege(db, role, table, privilege),
          ),
        ),
      );
      if (!platform.some(Boolean)) orphans.push(table);
    }
    expect(orphans).toEqual([]);
  });
});
