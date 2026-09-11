// tests/isolation/shared-candidate-scope.test.ts
// 🔴 T-08-03（docs/sprints/SP-08-anonymous-share.md §5）: 共有スコープ読み取りの実証。
//    `CLAUDE.md` §3.1 経路 4 / `BR-56` / `docs/05` §4.5 / `P-A-14` / migration 20260916000000。
//
// 本ファイルが固定するのは次の 5 点である:
//   ①🔴 **ホストは `engineer_shares` の行を 1 行も読めない。** 得られるのは
//     `app_engineer_is_shared()` が返す**存在の真偽だけ**である（`BR-06`）
//   ②🔴 **共有スコープを開けるのは `withSharedCandidateScope` だけ**であり、その外では
//     `app.shared_scope` が常に `'off'` に上書きされる（docs/05 §4.7 二重防御 #6）
//   ③🔴 **共有スコープで読めるのは匿名 5 項目に対応する列だけ**である（型 + 実測）
//   ④🔴 **解除は即時に反映される**（`revoked_at` が入った瞬間にポリシーが外れる。`F-016 AC-2`）
//   ⑤🔴 **パートナー文脈からは開けない**（開けると他社の共有候補が読め、`CLAUDE.md` §3.1 の
//     🔴「パートナー同士が相互に参照できる経路を 1 つも作らない」に直結する）
//
// 🔴 モックを一切使わない。`app_engineer_is_shared()` は `app_share_probe` が所有する
//    `SECURITY DEFINER` 関数であり、**実 DB でしか意味を持たない**（scheduler-fanout.test.ts と同じ方針）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  HostOnlyContextError,
  resolveTenantCtx,
  SharedCandidateProjectNotFoundError,
  withSharedCandidateScope,
  withTenant,
  type AuthenticatedTenantCtx,
  type SharedCandidateSource,
} from '@ses/db';
import {
  createUnextendedClient,
  readScopeSettings,
  runUnextended,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  ENGINEER_B_HOST,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  SHARE_A_P1,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 テストが足す辞書スキル（`skills` は射程外 4 表であり `tenant_id` を持たない）。 */
const SKILL_TS = '01930000-0000-7000-8000-0000000009a1';
const SKILL_GO = '01930000-0000-7000-8000-0000000009a2';

/** `MatchCandidate.computedAt`。🔴 現在時刻を使わない（決定的なテストにするため）。 */
const COMPUTED_AT = new Date('2026-09-11T00:00:00.000Z');

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない（RLS を素通りするため）。 */
let admin: UnextendedClient;
/** 🔴 第 1 防御（RLS）単体を見るための素のクライアント（`app_tenant` ロール）。 */
let unextended: UnextendedClient;

let hostA: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

function sessionOf(
  tenantId: string,
  partnerCompanyId: string | null,
  userId: string,
): Parameters<typeof resolveTenantCtx>[0] {
  return {
    tenantId,
    partnerCompanyId,
    userId,
    role: partnerCompanyId === null ? 'SALES' : 'PARTNER_SALES',
    lifecycleState: 'ACTIVE',
    partnerSuspendedAt: null,
    twoFactor: 'NOT_ENROLLED',
  };
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  unextended = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  hostA = await resolveTenantCtx(sessionOf(TENANT_A, null, USER_A_HOST), { deviceKind: 'api' });
  partnerA1 = await resolveTenantCtx(sessionOf(TENANT_A, PARTNER_A1, USER_A_PARTNER), {
    deviceKind: 'api',
  });
  partnerA2 = await resolveTenantCtx(sessionOf(TENANT_A, PARTNER_A2, USER_A_PARTNER2), {
    deviceKind: 'api',
  });
  hostB = await resolveTenantCtx(sessionOf(TENANT_B, null, USER_B_HOST), { deviceKind: 'api' });

  // --- 匿名 5 項目の素データを持たせる（fixtures の engineers は氏名だけを持つ）-------
  await admin.skill.createMany({
    data: [
      { id: SKILL_TS, name: 'TypeScript(test)', category: 'LANGUAGE', sortKey: 1 },
      { id: SKILL_GO, name: 'Go(test)', category: 'LANGUAGE', sortKey: 2 },
    ],
    skipDuplicates: true,
  });
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER },
    data: {
      unitPriceMin: 650000,
      unitPriceMax: 700000,
      availableFrom: new Date('2026-10-01T00:00:00.000Z'),
      prefecture: '13',
      // 🔴 市区町村を入れておく（共有スコープで**読めない**ことの対照になる）。
      city: '渋谷区',
      remoteMode: 'PARTIAL_REMOTE',
      contactEmail: 'shared-candidate-pii@example.test',
    },
  });
  await admin.engineerSkill.createMany({
    data: [
      {
        tenantId: TENANT_A,
        engineerId: ENGINEER_A_PARTNER,
        skillId: SKILL_TS,
        yearsOfExperience: 7,
        source: 'MANUAL',
      },
      {
        tenantId: TENANT_A,
        engineerId: ENGINEER_A_PARTNER2,
        skillId: SKILL_GO,
        yearsOfExperience: 3,
        source: 'MANUAL',
      },
      {
        tenantId: TENANT_A,
        engineerId: ENGINEER_A_HOST,
        skillId: SKILL_TS,
        yearsOfExperience: 5,
        source: 'MANUAL',
      },
    ],
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await unextended?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

/** 🔴 各テストの前に「PARTNER_A1 が共有中 / PARTNER_A2 は共有していない」へ戻す。 */
beforeEach(async () => {
  await admin.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: null } });
  await admin.engineerShare.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER2 } });
});

afterEach(async () => {
  await admin.matchCandidate.deleteMany({ where: { projectId: PROJECT_A_PRIVATE } });
});

// ---------------------------------------------------------------------------
// ① ホストは行を読めない（真偽値だけ）
// ---------------------------------------------------------------------------

describe('🔴 ① ホストが得るのは存在の真偽だけである（BR-06 / P-A-14）', () => {
  it('共有スコープの中でも `engineer_shares` の行は 1 行も見えない（ホスト文脈の素のクライアント）', async () => {
    const result = await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: null, actorUserId: USER_A_HOST },
      async (tx) => {
        // 🔴 `withSharedCandidateScope` と同じ GUC を立てたうえで直接読む。
        await tx.$executeRawUnsafe(`SELECT set_config('app.shared_scope', 'on', true)`);
        return {
          settings: await readScopeSettings(tx),
          rows: await tx.engineerShare.findMany(),
          total: await tx.engineerShare.count(),
          direct: await tx.engineerShare.findUnique({ where: { id: SHARE_A_P1 } }),
          // 🔴 得られるのはこれだけである。
          probe: await tx.$queryRawUnsafe<Array<{ shared: boolean }>>(
            `SELECT app_engineer_is_shared('${ENGINEER_A_PARTNER}'::uuid, '${TENANT_A}'::uuid) AS shared`,
          ),
        };
      },
    );
    expect(result.settings.sharedScope).toBe('on'); // 空振り防止
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.direct).toBeNull();
    // 🔴 0 件なのは「行が無いから」ではない（真偽値は true を返す）。
    expect(result.probe[0]?.shared).toBe(true);
  });

  it('対照: 共有元のパートナーからは自社の行が見える（①が空振りでない）', async () => {
    const rows = await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, actorUserId: USER_A_PARTNER },
      (tx) => tx.engineerShare.findMany({ select: { id: true } }),
    );
    expect(rows.map((row) => row.id)).toEqual([SHARE_A_P1]);
  });

  it('🔴 `SharedCandidateDb` に素のデリゲートが無い（参照するとコンパイルエラーになる）', async () => {
    // 🔴 `@ts-expect-error` は「その行にエラーが**出ること**」を要求する。したがってこのテストは、
    //    デリゲートが `SharedCandidateDb` に生えた瞬間に `tsc` が落ちる装置である
    //    （docs/05 §4.5「5 項目に対応する列だけを select できる形に絞る」）。RLS は**列を絞れない**
    //    ため、素のデリゲートを渡した時点で `select: { displayName: true }` が書けてしまう。
    await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, async (db) => {
      // @ts-expect-error docs/05 §4.5: engineerShare デリゲートは SharedCandidateDb に存在しない
      const engineerShare: unknown = db.engineerShare;
      // @ts-expect-error docs/05 §4.5 / F-008 AC-7: engineerCareer デリゲートは存在しない
      const engineerCareer: unknown = db.engineerCareer;
      // @ts-expect-error docs/05 §4.5: engineer デリゲート（全列を select できる）は存在しない
      const engineer: unknown = db.engineer;
      // @ts-expect-error docs/05 §4.5: engineerSkill デリゲートは存在しない
      const engineerSkill: unknown = db.engineerSkill;
      // @ts-expect-error docs/05 §4.5: skillSheet デリゲートは存在しない
      const skillSheet: unknown = db.skillSheet;
      return [engineerShare, engineerCareer, engineer, engineerSkill, skillSheet];
    });
  });
});

// ---------------------------------------------------------------------------
// ② スコープの外では常に 'off'
// ---------------------------------------------------------------------------

describe('🔴 ② 共有スコープを開けるのは withSharedCandidateScope だけである（二重防御 #6）', () => {
  it('`withTenant`（ホスト文脈）では他パートナーのエンジニアが 0 件のままである（C3）', async () => {
    const engineers = await withTenant(hostA, (db) =>
      db.engineer.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    );
    expect(engineers.map((row) => row.id)).toEqual([ENGINEER_A_HOST]);
  });

  it('🔴 `withSharedCandidateScope` の直後の `withTenant` に `on` が残らない（同じ接続プール）', async () => {
    const shared = await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers(),
    );
    expect(shared).toHaveLength(1); // 空振り防止（確かにスコープが開いていた）

    // 🔴 `withTenant` は `tenantScopeSettingsSql`（毎回 `'off'`）を発行する。前のトランザクションの
    //    `'on'` が物理接続に残っていたら、ここで他パートナーのエンジニアが混ざる。
    const engineers = await withTenant(hostA, (db) => db.engineer.findMany({ select: { id: true } }));
    expect(engineers.map((row) => row.id)).toEqual([ENGINEER_A_HOST]);
  });
});

// ---------------------------------------------------------------------------
// ③ 読めるのは匿名 5 項目に対応する列だけ
// ---------------------------------------------------------------------------

describe('🔴 ③ 共有スコープで読めるのは匿名 5 項目に対応する列だけである（BR-54 / F-017 AC-1）', () => {
  it('共有中のパートナー所属エンジニアだけが返る（自社分・未共有分・他社分は混ざらない）', async () => {
    const rows = await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers(),
    );
    expect(rows.map((row) => row.engineerId)).toEqual([ENGINEER_A_PARTNER]);
  });

  it('🔴 応答のキーが 8 個ちょうどであり、PII / 共有元の列が 1 つも含まれない', async () => {
    const [row] = await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers(),
    );
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'availableFrom',
      'engineerId',
      'prefecture',
      'remoteMode',
      'skills',
      'unitPriceMax',
      'unitPriceMin',
      'updatedAt',
    ]);
    // 🔴 JSON 化しても PII・市区町村・共有元が 1 文字も現れない（`F-017 AC-1` / A-04 ⑤）。
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('Engineer A-Partner');
    expect(serialized).not.toContain('渋谷区');
    expect(serialized).not.toContain('shared-candidate-pii@example.test');
    expect(serialized).not.toContain(PARTNER_A1);
  });

  it('🔴 型にも PII / 共有元 / 経歴のフィールドが無い（`undefined` ではなく型が違う）', () => {
    const row = {} as SharedCandidateSource;
    // @ts-expect-error F-017 AC-1: displayName は SharedCandidateSource に存在しない
    const displayName: unknown = row.displayName;
    // @ts-expect-error F-017 AC-1: contactEmail は存在しない
    const contactEmail: unknown = row.contactEmail;
    // @ts-expect-error F-017 AC-1: contactPhone は存在しない
    const contactPhone: unknown = row.contactPhone;
    // @ts-expect-error F-017 AC-1: affiliationLabel（現所属会社名）は存在しない
    const affiliationLabel: unknown = row.affiliationLabel;
    // @ts-expect-error F-017 AC-1: birthDate は存在しない
    const birthDate: unknown = row.birthDate;
    // @ts-expect-error A-04 ⑤: city（市区町村）は存在しない
    const city: unknown = row.city;
    // @ts-expect-error BR-55: preferenceNote（フリーテキスト）は存在しない
    const preferenceNote: unknown = row.preferenceNote;
    // @ts-expect-error BR-06: ownerPartnerCompanyId（共有元）は存在しない
    const ownerPartnerCompanyId: unknown = row.ownerPartnerCompanyId;
    // @ts-expect-error F-008 AC-7: 経歴は存在しない
    const careers: unknown = row.careers;
    expect([
      displayName,
      contactEmail,
      contactPhone,
      affiliationLabel,
      birthDate,
      city,
      preferenceNote,
      ownerPartnerCompanyId,
      careers,
    ]).toHaveLength(9);
  });

  it('スキルは辞書の行だけを返す（共有中のエンジニアの分のみ）', async () => {
    const [row] = await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers(),
    );
    expect(row?.skills.map((skill) => skill.name)).toEqual(['TypeScript(test)']);
    expect(Object.keys(row?.skills[0] ?? {}).sort()).toEqual([
      'name',
      'skillId',
      'sortKey',
      'yearsOfExperience',
    ]);
    expect(Number(row?.skills[0]?.yearsOfExperience.toString())).toBe(7);
  });

  it('🔴 未共有のパートナー（A2）のスキルは 1 件も読めない（engineer_skills にも同じ述語が効く）', async () => {
    const rows = await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: null, actorUserId: USER_A_HOST },
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.shared_scope', 'on', true)`);
        return tx.engineerSkill.findMany({
          where: { engineerId: ENGINEER_A_PARTNER2 },
          select: { id: true },
        });
      },
    );
    expect(rows).toHaveLength(0);
  });

  it('🔴 テナント境界は共有スコープでも外れない（テナント B のホストからは 0 件）', async () => {
    const rows = await withSharedCandidateScope(hostB, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers(),
    ).catch((error: unknown) => error);
    // 🔴 テナント B から見るとテナント A の案件は**存在しない**（404 相当。docs/05 §4.8）。
    expect(rows).toBeInstanceOf(SharedCandidateProjectNotFoundError);

    // 案件を指定できないので、ついでにテナント B の側に案件が無いことも確かめておく
    // （`ENGINEER_B_HOST` がテナント A の候補として現れる余地が無いことの対照）。
    const engineers = await withTenant(hostB, (db) => db.engineer.findMany({ select: { id: true } }));
    expect(engineers.map((row) => row.id)).toEqual([ENGINEER_B_HOST]);
  });
});

// ---------------------------------------------------------------------------
// ④ 解除は即時に反映される
// ---------------------------------------------------------------------------

describe('🔴 ④ 共有の解除がホストの読み取りへ即座に反映される（F-016 AC-2）', () => {
  it('`revoked_at` が入った瞬間に候補から消える（キャッシュを挟まない）', async () => {
    const before = await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers(),
    );
    expect(before.map((row) => row.engineerId)).toEqual([ENGINEER_A_PARTNER]);

    await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, actorUserId: USER_A_PARTNER },
      (tx) =>
        tx.engineerShare.update({
          where: { id: SHARE_A_P1 },
          data: { revokedAt: COMPUTED_AT },
        }),
    );

    const after = await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers(),
    );
    expect(after).toEqual([]);
  });

  it('🔴 既存の `MatchCandidate` の再確認に使える（解除済みの候補は返らない）', async () => {
    await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, actorUserId: USER_A_PARTNER },
      (tx) =>
        tx.engineerShare.update({
          where: { id: SHARE_A_P1 },
          data: { revokedAt: COMPUTED_AT },
        }),
    );

    const stillShared = await withSharedCandidateScope(hostA, PROJECT_A_PUBLISHED, (db) =>
      db.listSharedEngineers({ engineerIds: [ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2] }),
    );
    expect(stillShared).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ パートナー文脈からは開けない / 案件は fail-closed
// ---------------------------------------------------------------------------

describe('🔴 ⑤ 入口の fail-closed（CLAUDE.md §3.1 / docs/05 §4.8）', () => {
  it('🔴 パートナー文脈では `HostOnlyContextError`（他社の共有候補へ到達させない）', async () => {
    await expect(
      withSharedCandidateScope(partnerA1, PROJECT_A_PUBLISHED, (db) => db.listSharedEngineers()),
    ).rejects.toBeInstanceOf(HostOnlyContextError);
    await expect(
      withSharedCandidateScope(partnerA2, PROJECT_A_PUBLISHED, (db) => db.listSharedEngineers()),
    ).rejects.toBeInstanceOf(HostOnlyContextError);
  });

  it('🔴 パートナー文脈で GUC を立てても `app_engineer_is_shared()` は false（app_is_host() が偽）', async () => {
    const rows = await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, actorUserId: USER_A_PARTNER2 },
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.shared_scope', 'on', true)`);
        return tx.$queryRawUnsafe<Array<{ shared: boolean }>>(
          `SELECT app_engineer_is_shared('${ENGINEER_A_PARTNER}'::uuid, '${TENANT_A}'::uuid) AS shared`,
        );
      },
    );
    expect(rows[0]?.shared).toBe(false);
  });

  it('🔴 GUC が `off` なら `app_engineer_is_shared()` は false（ホスト文脈でも）', async () => {
    const rows = await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: null, actorUserId: USER_A_HOST },
      (tx) =>
        tx.$queryRawUnsafe<Array<{ shared: boolean }>>(
          `SELECT app_engineer_is_shared('${ENGINEER_A_PARTNER}'::uuid, '${TENANT_A}'::uuid) AS shared`,
        ),
    );
    expect(rows[0]?.shared).toBe(false);
  });

  it('存在しない案件では `SharedCandidateProjectNotFoundError`（0 件で畳まない）', async () => {
    await expect(
      withSharedCandidateScope(
        hostA,
        '01930000-0000-7000-8000-00000000dead',
        (db) => db.listSharedEngineers(),
      ),
    ).rejects.toBeInstanceOf(SharedCandidateProjectNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// MatchCandidate の生成（ホストが匿名候補を得る唯一の経路。C2）
// ---------------------------------------------------------------------------

describe('🔴 匿名候補の行は共有スコープの中で作る（docs/05 §4.4 / §4.5）', () => {
  it('読み取りと同一トランザクションで `MatchCandidate` を作れる（C2 なのでホストが書ける）', async () => {
    const created = await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, async (db) => {
      const shared = await db.listSharedEngineers();
      return db.replaceAnonymousCandidates(
        shared.map((row) => ({ engineerId: row.engineerId, computedAt: COMPUTED_AT })),
      );
    });
    expect(created).toBe(1);

    // 🔴 生成された行はホストの通常文脈（C2）から読める。ここが匿名候補の唯一の入口である。
    const rows = await withTenant(hostA, (db) =>
      db.matchCandidate.findMany({
        where: { projectId: PROJECT_A_PRIVATE },
        select: { engineerId: true, isAnonymous: true },
      }),
    );
    expect(rows).toEqual([{ engineerId: ENGINEER_A_PARTNER, isAnonymous: true }]);
  });

  it('🔴 生成された `MatchCandidate` はパートナーからは 1 件も見えない（C2）', async () => {
    await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, async (db) => {
      const shared = await db.listSharedEngineers();
      return db.replaceAnonymousCandidates(
        shared.map((row) => ({ engineerId: row.engineerId, computedAt: COMPUTED_AT })),
      );
    });

    const partnerView = await withTenant(partnerA1, (db) =>
      db.matchCandidate.findMany({ where: { projectId: PROJECT_A_PRIVATE } }),
    );
    expect(partnerView).toEqual([]);
  });

  it('🔴 `replaceAnonymousCandidates` は置き換えである（解除された候補が残らない。F-016 AC-2）', async () => {
    await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, async (db) =>
      db.replaceAnonymousCandidates([
        { engineerId: ENGINEER_A_PARTNER, computedAt: COMPUTED_AT },
      ]),
    );
    expect(
      await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, (db) =>
        db.listAnonymousCandidateEngineerIds(),
      ),
    ).toEqual([ENGINEER_A_PARTNER]);

    // 共有が解除された → 次の生成では 0 件で置き換わる（消し忘れが残らない）。
    await runUnextended(
      unextended,
      { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, actorUserId: USER_A_PARTNER },
      (tx) =>
        tx.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: COMPUTED_AT } }),
    );
    const remaining = await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, async (db) => {
      const shared = await db.listSharedEngineers();
      await db.replaceAnonymousCandidates(
        shared.map((row) => ({ engineerId: row.engineerId, computedAt: COMPUTED_AT })),
      );
      return db.countAnonymousCandidates();
    });
    expect(remaining).toBe(0);
  });

  it('🔴 自社候補（isAnonymous = false）には触れない', async () => {
    await admin.matchCandidate.create({
      data: {
        tenantId: TENANT_A,
        projectId: PROJECT_A_PRIVATE,
        engineerId: ENGINEER_A_HOST,
        isAnonymous: false,
        computedAt: COMPUTED_AT,
      },
    });

    await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, (db) =>
      db.replaceAnonymousCandidates([
        { engineerId: ENGINEER_A_PARTNER, computedAt: COMPUTED_AT },
      ]),
    );

    const rows = await admin.matchCandidate.findMany({
      where: { projectId: PROJECT_A_PRIVATE },
      select: { engineerId: true, isAnonymous: true },
      orderBy: [{ isAnonymous: 'asc' }],
    });
    expect(rows).toEqual([
      { engineerId: ENGINEER_A_HOST, isAnonymous: false },
      { engineerId: ENGINEER_A_PARTNER, isAnonymous: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 🔴 列の軸（T-08-03 のコードレビューで実 DB の漏洩が再現された箇所）
// ---------------------------------------------------------------------------

/**
 * 🔴 **`SharedCandidateDb` の「全メンバー」について、列の軸を実 DB で固定する。**
 *
 * 🔴 **型テストでは捕まらない**（実際に素通りした）。破れていたのは
 *    `matchCandidate` の素のデリゲートで、`select: { engineer: { select: { displayName: true,
 *    ownerPartnerCompanyId: true, ownerPartnerCompany: { select: { name: true } } } } }` により
 *    **共有エンジニアの実名と共有元パートナー会社の ID・社名が取得できた**（`BR-06` /
 *    `CLAUDE.md` §7「匿名候補の身元露出 0 件」「パートナー間の相互参照 0 件」）。
 *    理由は 3 つ重なっている: **RLS は列を絞れない** / **Prisma 拡張の `$allOperations` は
 *    ネストしたリレーション読み取りで走らない** / **`@ts-expect-error db.engineer` は
 *    リレーション経由を構造上捕まえられない**。したがって**実測で固定する**。
 */
const FORBIDDEN_IN_RESPONSE = [
  'Engineer A-Partner', // engineers.display_name（実名）
  'shared-candidate-pii@example.test', // engineers.contact_email
  '渋谷区', // engineers.city
  PARTNER_A1, // engineers.owner_partner_company_id（共有元の ID）
  'Partner A1', // partner_companies.name（共有元の社名）
];

/** `db` の全メンバーを呼び、返り値を 1 つの JSON に畳む。 */
async function callEverySharedCandidateMember(projectId: string): Promise<string> {
  return withSharedCandidateScope(hostA, projectId, async (db) => {
    const shared = await db.listSharedEngineers();
    const filtered = await db.listSharedEngineers({
      engineerIds: [ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2, ENGINEER_A_HOST],
      take: 50,
    });
    const created = await db.replaceAnonymousCandidates(
      shared.map((row) => ({ engineerId: row.engineerId, computedAt: COMPUTED_AT })),
    );
    const engineerIds = await db.listAnonymousCandidateEngineerIds();
    const total = await db.countAnonymousCandidates();
    return JSON.stringify({
      projectId: db.projectId,
      shared,
      filtered,
      created,
      engineerIds,
      total,
    });
  });
}

describe('🔴 列の軸: SharedCandidateDb のどのメンバーからも PII / 共有元が返らない（BR-06 / BR-54）', () => {
  it('🔴 全メンバーの戻り値に、実名・連絡先・市区町村・共有元 ID・共有元社名が 1 文字も無い', async () => {
    const serialized = await callEverySharedCandidateMember(PROJECT_A_PRIVATE);
    for (const forbidden of FORBIDDEN_IN_RESPONSE) {
      expect(serialized, `禁止された値が応答に含まれている: ${forbidden}`).not.toContain(forbidden);
    }
    // 空振り防止（対照）: 出てよい値は確かに出ている。
    expect(serialized).toContain(ENGINEER_A_PARTNER);
    expect(serialized).toContain('"total":1');
  });

  it('🔴 対照: 禁止リストの値は DB に実在する（照合が空振りしていない）', async () => {
    const engineer = await admin.engineer.findUniqueOrThrow({
      where: { id: ENGINEER_A_PARTNER },
      select: { displayName: true, contactEmail: true, city: true, ownerPartnerCompanyId: true },
    });
    expect(engineer.displayName).toBe('Engineer A-Partner');
    expect(engineer.contactEmail).toBe('shared-candidate-pii@example.test');
    expect(engineer.city).toBe('渋谷区');
    expect(engineer.ownerPartnerCompanyId).toBe(PARTNER_A1);
    const partner = await admin.partnerCompany.findUniqueOrThrow({
      where: { id: PARTNER_A1 },
      select: { name: true },
    });
    expect(partner.name).toBe('Partner A1');
  });

  it('🔴 `SharedCandidateDb` のキーが 5 個ちょうどであり、素の Prisma デリゲートが 1 つも無い', async () => {
    const keys = await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, async (db) =>
      Object.keys(db).sort(),
    );
    // 🔴 ここにモデル名（`matchCandidate` / `engineer` / …）が現れた時点で、
    //    リレーション経由の再漏洩の窓が開いている。**キー集合ごと固定する。**
    expect(keys).toEqual([
      'countAnonymousCandidates',
      'listAnonymousCandidateEngineerIds',
      'listSharedEngineers',
      'projectId',
      'replaceAnonymousCandidates',
    ]);
  });

  it('🔴 レビュアーの再現コード（matchCandidate.findMany の select 経由）が実行時にも成立しない', async () => {
    const outcome = await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, async (db) => {
      // 🔴 型では到達できない（次の型テストが固定する）。ここでは**型を迂回して**呼び、
      //    実行時にも `matchCandidate` が存在しないことを確かめる
      //    （「型だけの防御」に戻っていないことの確認）。
      const loose = db as unknown as Record<string, unknown>;
      return {
        matchCandidate: loose['matchCandidate'],
        engineer: loose['engineer'],
        engineerSkill: loose['engineerSkill'],
        engineerShare: loose['engineerShare'],
      };
    });
    expect(outcome.matchCandidate).toBeUndefined();
    expect(outcome.engineer).toBeUndefined();
    expect(outcome.engineerSkill).toBeUndefined();
    expect(outcome.engineerShare).toBeUndefined();
  });

  it('🔴 レビュアーの再現コードは型でも通らない（`matchCandidate` が SharedCandidateDb に無い）', async () => {
    await withSharedCandidateScope(hostA, PROJECT_A_PRIVATE, async (db) => {
      // @ts-expect-error docs/05 §4.5（改訂 9）: 素の Prisma デリゲートは SharedCandidateDb に存在しない
      const matchCandidate: unknown = db.matchCandidate;
      return matchCandidate;
    });
  });
});
