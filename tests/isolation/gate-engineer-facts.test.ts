// tests/isolation/gate-engineer-facts.test.ts
// 🔴 T-09-13（docs/05 §11.14 ⑧ / §4.7 二重防御 #13 / #14）: ゲート実行文脈の限定経路 `app_gate_probe`
//    （SECURITY DEFINER 2 関数 `app_gate_proposal_engineer_pii` / `app_gate_proposal_engineer_skills`。
//    migration 20260918000000）が、**「その提案の対象エンジニア 1 人分」より広く返さない**こと、
//    **fail-closed** であることを実 DB + RLS で実証する。
//
// 🔴 #12（パートナー所属エンジニアの提案でも 3 層の判定が下る）は `tests/isolation/gate-run.test.ts` に置く
//    （`gate.run` ハンドラを本番と同じ 1 本の経路で通す）。本ファイルは**関数そのもの**と
//    `loadGateInput` の入口の挙動を見る。
//
// 🔴 関数の呼び出しは `app_tenant` ロールの素の接続（`runUnextended`）で行う。superuser は RLS も
//    列 GRANT も素通りするため、検証のクエリには使わない（母集団の用意と突合だけに使う）。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  GateFactsUnavailableError,
  loadGateInput,
  systemTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, runUnextended, type UnextendedClient } from '@ses/db/testing';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P2,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-15T09:00:00.000Z');

/** 🔴 台帳の値。ホスト文脈（C3）からは 1 行も読めない値であり、本経路でだけ「その 1 人分」が返る。 */
const P1_NAME = '佐藤 花子';
const P1_EMAIL = 'hanako@partner-a1.example';
const P1_PHONE = '090-1234-5678';
const P1_AFFILIATION = 'Partner A1 Engineering';
/** 別パートナー（`PARTNER_A2`）のエンジニア。**1 文字も現れてはならない**。 */
const P2_NAME = '鈴木 次郎';
const P2_EMAIL = 'jiro@partner-a2.example';
/** ホスト所属のエンジニア。 */
const HOST_NAME = '山田 太郎';
const HOST_EMAIL = 'taro@host-a.example';

const SKILL_KOTLIN = '01930000-0000-7000-8000-0000000009d1';
const SKILL_RUST = '01930000-0000-7000-8000-0000000009d2';

/** `SET LOCAL` に渡す分離キー 3 つ（`runUnextended` の第 2 引数と同形）。 */
type Scope = { readonly tenantId: string; readonly partnerCompanyId: string | null; readonly actorUserId: string };
const SCOPE_HOST_A: Scope = { tenantId: TENANT_A, partnerCompanyId: null, actorUserId: USER_A_HOST };
const SCOPE_PARTNER_A1: Scope = { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, actorUserId: USER_A_PARTNER };
const SCOPE_HOST_B: Scope = { tenantId: TENANT_B, partnerCompanyId: null, actorUserId: USER_B_HOST };

type PiiRow = {
  display_name: string;
  birth_date: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  affiliation_label: string | null;
};
type SkillRow = { skill_id: string; years_of_experience: string; level: number | null };

let database: IsolationDatabase;
/** superuser。母集団の用意と突合だけに使う。 */
let admin: UnextendedClient;
/** `app_tenant` の素の接続。関数を直接呼ぶ側。 */
let tenant: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  tenant = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxA = systemTenantCtx(TENANT_A, { queue: 'gate.run', jobId: 'gate.run:facts' });
  ctxB = systemTenantCtx(TENANT_B, { queue: 'gate.run', jobId: 'gate.run:facts' });

  await admin.skill.createMany({
    data: [
      { id: SKILL_KOTLIN, name: 'Kotlin(gate-facts)', category: 'LANGUAGE', sortKey: 911 },
      { id: SKILL_RUST, name: 'Rust(gate-facts)', category: 'LANGUAGE', sortKey: 912 },
    ],
    skipDuplicates: true,
  });
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER },
    data: {
      displayName: P1_NAME,
      contactEmail: P1_EMAIL,
      contactPhone: P1_PHONE,
      affiliationLabel: P1_AFFILIATION,
      birthDate: new Date('1992-03-15T00:00:00.000Z'),
    },
  });
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER2 },
    data: { displayName: P2_NAME, contactEmail: P2_EMAIL, contactPhone: '080-0000-0000' },
  });
  await admin.engineer.update({
    where: { id: ENGINEER_A_HOST },
    data: { displayName: HOST_NAME, contactEmail: HOST_EMAIL },
  });
  await admin.engineerSkill.createMany({
    data: [
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_KOTLIN, yearsOfExperience: 6.5, level: 4, source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_RUST, yearsOfExperience: 2, level: null, source: 'MANUAL' },
      // 🔴 対照: 別パートナーのエンジニアにも同じ辞書のスキルを登録する（混ざれば行数で分かる）。
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER2, skillId: SKILL_KOTLIN, yearsOfExperience: 1, level: 1, source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, skillId: SKILL_RUST, yearsOfExperience: 9, level: 5, source: 'MANUAL' },
    ],
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.$disconnect();
  await tenant?.$disconnect();
  await disconnectTenantDb();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

async function setState(proposalId: string, state: string): Promise<void> {
  await admin.proposal.update({ where: { id: proposalId }, data: { state } });
}

afterEach(async () => {
  // 🔴 各テストが動かした状態を戻す（他のテストの前提を壊さない）。
  await setState(PROPOSAL_A_HOST, 'DRAFT');
  await setState(PROPOSAL_A_P1, 'DRAFT');
  await setState(PROPOSAL_A_P2, 'DRAFT');
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: [PROPOSAL_A_HOST, PROPOSAL_A_P1, PROPOSAL_A_P2] } } });
});

const PII_SQL = (proposalId: string) =>
  `SELECT display_name, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, contact_email, contact_phone, affiliation_label
     FROM app_gate_proposal_engineer_pii('${proposalId}'::uuid)`;
const SKILLS_SQL = (proposalId: string) =>
  `SELECT skill_id::text AS skill_id, years_of_experience::text AS years_of_experience, level
     FROM app_gate_proposal_engineer_skills('${proposalId}'::uuid)`;

async function callPii(scope: Scope | null, proposalId: string): Promise<PiiRow[]> {
  return runUnextended(tenant, scope, (tx) => tx.$queryRawUnsafe<PiiRow[]>(PII_SQL(proposalId)));
}
async function callSkills(scope: Scope | null, proposalId: string): Promise<SkillRow[]> {
  return runUnextended(tenant, scope, (tx) => tx.$queryRawUnsafe<SkillRow[]>(SKILLS_SQL(proposalId)));
}

describe('前提: 母集団（空振り防止）', () => {
  it('PROPOSAL_A_P1 は PARTNER_A1 所有・ENGINEER_A_PARTNER 対象で、ホスト文脈の素のクエリからは台帳が 0 件', async () => {
    const proposal = await admin.proposal.findUniqueOrThrow({
      where: { id: PROPOSAL_A_P1 },
      select: { ownerPartnerCompanyId: true, engineerId: true, tenantId: true },
    });
    expect(proposal).toEqual({ ownerPartnerCompanyId: PARTNER_A1, engineerId: ENGINEER_A_PARTNER, tenantId: TENANT_A });
    // 🔴 C3: app_tenant のホスト文脈では engineers / engineer_skills のパートナー所有行が見えない。
    const visible = await runUnextended(tenant, SCOPE_HOST_A, async (tx) => ({
      engineer: await tx.engineer.count({ where: { id: ENGINEER_A_PARTNER } }),
      skills: await tx.engineerSkill.count({ where: { engineerId: ENGINEER_A_PARTNER } }),
    }));
    expect(visible).toEqual({ engineer: 0, skills: 0 });
  });
});

describe('#13 その経路でホストの台帳・他社のエンジニアが読めない（docs/05 §4.7 #13 / §11.14 ⑤-1）', () => {
  it('① app_gate_proposal_engineer_pii(PROPOSAL_A_P1) はその提案の対象エンジニアの値だけ。別パートナーの値は 1 文字も無い', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    const rows = await callPii(SCOPE_HOST_A, PROPOSAL_A_P1);
    expect(rows).toEqual([
      {
        display_name: P1_NAME,
        birth_date: '1992-03-15',
        contact_email: P1_EMAIL,
        contact_phone: P1_PHONE,
        affiliation_label: P1_AFFILIATION,
      },
    ]);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(P2_NAME);
    expect(serialized).not.toContain(P2_EMAIL);
    expect(serialized).not.toContain(HOST_NAME);
    expect(serialized).not.toContain(HOST_EMAIL);
    // 🔴 ID が 1 つも返らない（固定形の DTO。§11.14 ⑤-3）。
    expect(Object.keys(rows[0]!).sort()).toEqual(['affiliation_label', 'birth_date', 'contact_email', 'contact_phone', 'display_name']);
  });

  it('① スキルも対象エンジニアの行だけ（別パートナー・ホストの同じ辞書のスキルは混ざらない）。skill_id 昇順', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    const rows = await callSkills(SCOPE_HOST_A, PROPOSAL_A_P1);
    expect(rows).toEqual([
      { skill_id: SKILL_KOTLIN, years_of_experience: '6.5', level: 4 },
      { skill_id: SKILL_RUST, years_of_experience: '2.0', level: null },
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['level', 'skill_id', 'years_of_experience']);
  });

  it('🔴 ② シード上の全提案を GATE_RUNNING にしても、PII 関数は各提案でちょうど 1 行、display_name はその提案の engineer_id の行と一致する', async () => {
    const proposals = await admin.proposal.findMany({
      select: { id: true, tenantId: true, engineerId: true, state: true },
      orderBy: { id: 'asc' },
    });
    expect(proposals.length).toBeGreaterThanOrEqual(4); // 空振り防止（ホスト 1 + パートナー 2 + WON 1）
    const original = new Map(proposals.map((row) => [row.id, row.state]));
    try {
      await admin.proposal.updateMany({ data: { state: 'GATE_RUNNING' } });
      for (const proposal of proposals) {
        const engineer = await admin.engineer.findUniqueOrThrow({
          where: { id: proposal.engineerId },
          select: { displayName: true, contactEmail: true },
        });
        const scope: Scope = { tenantId: proposal.tenantId, partnerCompanyId: null, actorUserId: USER_A_HOST };
        const rows = await callPii(scope, proposal.id);
        // 🔴 鍵が proposal_id である以上、1 人分より広く返す形が存在しない（一覧にならない）。
        expect(rows, `proposal ${proposal.id}: 行数が 1 ではない`).toHaveLength(1);
        expect(rows[0]?.display_name).toBe(engineer.displayName);
        expect(rows[0]?.contact_email ?? null).toBe(engineer.contactEmail);
      }
    } finally {
      for (const [id, state] of original) await setState(id, state);
    }
  });

  it('③ ホスト所有の提案（PROPOSAL_A_HOST）を渡してもホストの台帳は「その 1 人分」だけ（一覧にならない）', async () => {
    await setState(PROPOSAL_A_HOST, 'GATE_RUNNING');
    const pii = await callPii(SCOPE_HOST_A, PROPOSAL_A_HOST);
    expect(pii).toHaveLength(1);
    expect(pii[0]?.display_name).toBe(HOST_NAME);
    expect(JSON.stringify(pii)).not.toContain(P1_NAME);
    const skills = await callSkills(SCOPE_HOST_A, PROPOSAL_A_HOST);
    expect(skills).toEqual([{ skill_id: SKILL_RUST, years_of_experience: '9.0', level: 5 }]);
  });

  it('🔴 同じテナントの別の提案（PROPOSAL_A_P2 = PARTNER_A2）を GATE_RUNNING にしていても、PROPOSAL_A_P1 の結果に混ざらない', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    await setState(PROPOSAL_A_P2, 'GATE_RUNNING');
    const p1 = await callPii(SCOPE_HOST_A, PROPOSAL_A_P1);
    const p2 = await callPii(SCOPE_HOST_A, PROPOSAL_A_P2);
    expect(p1.map((row) => row.display_name)).toEqual([P1_NAME]);
    expect(p2.map((row) => row.display_name)).toEqual([P2_NAME]);
  });
});

describe('#14 fail-closed（docs/05 §4.7 #14 / §11.14 ④）', () => {
  it('① 別テナント（TENANT_B のホスト文脈）から TENANT_A の GATE_RUNNING の提案 ID を渡すと 0 行', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    expect(await callPii(SCOPE_HOST_B, PROPOSAL_A_P1)).toEqual([]);
    expect(await callSkills(SCOPE_HOST_B, PROPOSAL_A_P1)).toEqual([]);
  });

  // 🔴 APPROVED は CHECK（approved_at / content_hash 必須）があるため superuser でも素の状態更新では入れられない。
  //    承認後の提案が 0 行になることは、同じ述語（state = 'GATE_RUNNING'）が APPROVAL_PENDING / WON で 0 行になることで足りる。
  it.each(['DRAFT', 'APPROVAL_PENDING', 'GATE_FAILED', 'SUBMITTED', 'WON'])('② state=%s の提案 ID では 0 行（GATE_RUNNING の間だけ）', async (state) => {
    await setState(PROPOSAL_A_P1, state);
    expect(await callPii(SCOPE_HOST_A, PROPOSAL_A_P1)).toEqual([]);
    expect(await callSkills(SCOPE_HOST_A, PROPOSAL_A_P1)).toEqual([]);
  });

  it('② 存在しない提案 ID でも 0 行（理由は区別できない。§4.8 と同じ向き）', async () => {
    expect(await callPii(SCOPE_HOST_A, '01930000-0000-7000-8000-0000000fffff')).toEqual([]);
  });

  it('🔴 ③ テナント文脈の無い接続（app.tenant_id 未設定）からの呼び出しは例外（0 行にしない）', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    await expect(callPii(null, PROPOSAL_A_P1)).rejects.toThrow(/テナント文脈がありません/);
    await expect(callSkills(null, PROPOSAL_A_P1)).rejects.toThrow(/テナント文脈がありません/);
  });

  it('🔴 ③ パートナー文脈（app.partner_company_id <> \'\'）からの呼び出しは例外。自社のエンジニアの提案でも呼べない', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    // 🔴 PARTNER_A1 は PROPOSAL_A_P1 の所有者であり、C3 で自社の台帳は読める。それでも本関数は呼べない
    //    （関数の用途はゲート実行文脈だけであり、パートナー文脈のセッションが提案 ID を推測して
    //    他社の値を引く経路を DB で塞ぐ。§11.14 ⑤-4）。
    await expect(callPii(SCOPE_PARTNER_A1, PROPOSAL_A_P1)).rejects.toThrow(/ホスト文脈以外からは呼べません/);
    await expect(callSkills(SCOPE_PARTNER_A1, PROPOSAL_A_P1)).rejects.toThrow(/ホスト文脈以外からは呼べません/);
  });

  /**
   * 🔴 T-09-13 レビュー指摘（code-reviewer が実 DB で再現）: `SECURITY DEFINER` の `SET search_path = public` に
   *    `pg_temp` が無いと、PostgreSQL はリレーション名の解決で**一時スキーマを最初に**探す。呼び出し側
   *    （`app_tenant`）が一時表 `proposals` を作って `app_gate_probe` に SELECT を与え、任意の uuid /
   *    別パートナーの `engineer_id` / `'GATE_RUNNING'` を仕込むと、関数本体の `FROM proposals p` が
   *    その一時表を読み、**⑤-1（鍵が proposal_id）と ⑤-2（GATE_RUNNING の間だけ）の両方が迂回される**
   *    （テナント境界だけは `engineers` のポリシーが守る）。修正は `SET search_path = public, pg_temp`
   *    （公式「Writing SECURITY DEFINER Functions Safely」）。
   *
   * 🔴 攻撃は**新しい接続**で行う。plpgsql のプラン再利用で「同じセッションで既に本体の表で計画済み」だと
   *    再現が揺れるため、関数を一度も呼んでいないセッションで一時表を先に作ってから呼ぶ。
   *    一時表は `ON COMMIT DROP`（トランザクションの外へ残さない）。
   */
  async function attackWithTempProposals(input: {
    readonly sql: (proposalId: string) => string;
    readonly engineerId: string;
  }): Promise<unknown[]> {
    const fresh = createUnextendedClient(database.tenantUrl);
    try {
      return await runUnextended(fresh, SCOPE_HOST_A, async (tx) => {
        const forged = '01930000-0000-7000-8000-00000000f0f0';
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE proposals (id uuid, tenant_id uuid, engineer_id uuid, state text) ON COMMIT DROP',
        );
        await tx.$executeRawUnsafe('GRANT SELECT ON pg_temp.proposals TO app_gate_probe');
        await tx.$executeRawUnsafe(
          `INSERT INTO pg_temp.proposals VALUES ('${forged}'::uuid, '${TENANT_A}'::uuid, '${input.engineerId}'::uuid, 'GATE_RUNNING')`,
        );
        // 対照: 一時表そのものは呼び出し側から読める（仕込みが空振りしていない）。
        const planted = await tx.$queryRawUnsafe<Array<{ n: bigint }>>('SELECT count(*)::bigint AS n FROM pg_temp.proposals');
        expect(Number(planted[0]?.n ?? 0)).toBe(1);
        return tx.$queryRawUnsafe<unknown[]>(input.sql(forged));
      });
    } finally {
      await fresh.$disconnect();
    }
  }

  it('🔴 ④ 呼び出し側の一時表 proposals で本体を隠しても、PII 関数は 0 行（search_path = public, pg_temp。⑤-1 / ⑤-2 を迂回できない）', async () => {
    // ENGINEER_A_PARTNER2 には GATE_RUNNING の提案が無く、C3 直読みも 0 行。ここで 1 行返れば他社の PII が漏れている。
    const rows = await attackWithTempProposals({ sql: PII_SQL, engineerId: ENGINEER_A_PARTNER2 });
    expect(rows).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain(P2_NAME);
    expect(JSON.stringify(rows)).not.toContain(P2_EMAIL);
  });

  it('🔴 ④ 同じ攻撃でスキル関数も 0 行（ENGINEER_A_PARTNER の 2 行が漏れない）', async () => {
    const rows = await attackWithTempProposals({ sql: SKILLS_SQL, engineerId: ENGINEER_A_PARTNER });
    expect(rows).toEqual([]);
  });

  it('④ の対照: 同じ状態で正規の呼び出し（本体の proposals が GATE_RUNNING）は 1 行 / 2 行返る（0 行が「関数が壊れた」せいではない）', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    expect((await callPii(SCOPE_HOST_A, PROPOSAL_A_P1)).map((row) => row.display_name)).toEqual([P1_NAME]);
    expect(await callSkills(SCOPE_HOST_A, PROPOSAL_A_P1)).toHaveLength(2);
  });

  it('🔴 対照: app_tenant はテナント文脈で engineers を直接 SELECT しても、パートナー所有行は C3 のまま見えない（関数だけが 1 人分を返す）', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    const direct = await runUnextended(tenant, SCOPE_HOST_A, (tx) =>
      tx.$queryRawUnsafe<Array<{ display_name: string }>>(
        `SELECT display_name FROM engineers WHERE id = '${ENGINEER_A_PARTNER}'::uuid`,
      ),
    );
    expect(direct).toEqual([]);
    const viaFunction = await callPii(SCOPE_HOST_A, PROPOSAL_A_P1);
    expect(viaFunction.map((row) => row.display_name)).toEqual([P1_NAME]);
  });
});

/**
 * 🔴 `loadGateInput` 経由（docs/05 §11.14 ⑥-2 / ⑥-3。§4.7 #14 の後段）。
 *    ①別テナント → 手前の `tx.proposal.findUnique`（C5）が `null` → `NOT_FOUND`
 *    ②`GATE_RUNNING` でない → 入口の `state` 検査で `NOT_FOUND`
 *    ③`state` を読んだ直後に状態が動いた窓 → `GateFactsUnavailableError('ENGINEER_FACTS_UNAVAILABLE')`
 *    いずれも `ReviewGate` は 0 行（`loadGateInput` は何も書かない）。
 */
describe('loadGateInput 経由の入口（docs/05 §11.14 ⑥-2 / ⑥-3）', () => {
  async function prepareSnapshot(proposalId: string): Promise<void> {
    await admin.engineerSnapshot.upsert({
      where: { proposalId },
      create: {
        id: '01930000-0000-7000-8000-00000000ff01',
        tenantId: TENANT_A,
        proposalId,
        displayName: P1_NAME,
        affiliationLabel: null,
        skills: [],
        careers: [],
        frozenAt: NOW,
      },
      update: { skills: [], careers: [] },
    });
    await admin.proposal.update({ where: { id: proposalId }, data: { subject: 'ご提案', body: '本文です。' } });
  }

  it('① 別テナントの文脈からは NOT_FOUND（C5 が手前で止める）', async () => {
    await prepareSnapshot(PROPOSAL_A_P1);
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    const lookup = await loadGateInput(ctxB, { targetType: 'PROPOSAL', targetId: PROPOSAL_A_P1, contentHash: 'h' });
    expect(lookup).toEqual({ kind: 'NOT_FOUND' });
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_P1 } })).toBe(0);
  });

  it.each(['DRAFT', 'APPROVAL_PENDING', 'WON'])('② state=%s の提案は入口で NOT_FOUND（例外ではない）', async (state) => {
    await prepareSnapshot(PROPOSAL_A_P1);
    await setState(PROPOSAL_A_P1, state);
    const lookup = await loadGateInput(ctxA, { targetType: 'PROPOSAL', targetId: PROPOSAL_A_P1, contentHash: 'h' });
    expect(lookup).toEqual({ kind: 'NOT_FOUND' });
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_P1 } })).toBe(0);
  });

  it('対照: GATE_RUNNING ならパートナー所属の提案でも FOUND で、knownPii に台帳の現在値が入っている（#12 の入口側）', async () => {
    await prepareSnapshot(PROPOSAL_A_P1);
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    const lookup = await loadGateInput(ctxA, { targetType: 'PROPOSAL', targetId: PROPOSAL_A_P1, contentHash: 'h' });
    expect(lookup.kind).toBe('FOUND');
    if (lookup.kind !== 'FOUND') return;
    expect(lookup.input.knownPii).toEqual({
      fullNames: [P1_NAME],
      birthDates: ['1992-03-15'],
      emails: [P1_EMAIL],
      phones: [P1_PHONE],
      // 台帳の現所属 + 提案元パートナーの社名（凍結コピーの affiliationLabel は null）。
      affiliations: [P1_AFFILIATION, 'Partner A1'],
    });
    expect(lookup.input.targetType).toBe('PROPOSAL');
    if (lookup.input.targetType !== 'PROPOSAL') return;
    expect(lookup.input.consistency.subject.registeredSkills).toEqual([
      { skillId: SKILL_KOTLIN, years: 6.5, level: 4 },
      { skillId: SKILL_RUST, years: 2, level: null },
    ]);
    // 🔴 別パートナーの値は 1 文字も無い。
    const serialized = JSON.stringify(lookup.input);
    expect(serialized).not.toContain(P2_NAME);
    expect(serialized).not.toContain(P2_EMAIL);
  });

  it('🔴 ③ state を読んだ直後に別トランザクションが状態を動かした窓は GateFactsUnavailableError(ENGINEER_FACTS_UNAVAILABLE)', async () => {
    // 🔴 再現の仕組み: superuser が `engineer_snapshots` を ACCESS EXCLUSIVE でロックして待つ。
    //    `loadProposalGateInput` は ①proposals（state=GATE_RUNNING を読む）→ ②engineer_snapshots（ロックで
    //    待つ）→ ③関数。②が待っている間に superuser が state を DRAFT にして COMMIT（= ロック解放）すると、
    //    Read Committed の③は新しい状態を見て 0 行 → fail-closed になる。
    await prepareSnapshot(PROPOSAL_A_P1);
    await setState(PROPOSAL_A_P1, 'GATE_RUNNING');
    const locker = createUnextendedClient(database.superuserUrl);
    try {
      let lookupPromise: Promise<unknown> | null = null;
      await locker.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('LOCK TABLE engineer_snapshots IN ACCESS EXCLUSIVE MODE');
          lookupPromise = loadGateInput(ctxA, { targetType: 'PROPOSAL', targetId: PROPOSAL_A_P1, contentHash: 'h' });
          // ②がロック待ちに入るまで待つ（pg_locks の「未許可の relation ロック」を見る。時間待ちに頼らない。
          //    🔴 pg_stat_activity はトランザクション内で最初の参照時の値に固定されるため使わない）。
          //    ⚠️ runInTenantTransaction の対話トランザクションは既定 5 秒で失効するので、検出は速く（50ms 間隔）。
          const deadline = Date.now() + 4_000;
          for (;;) {
            const waiting = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
              `SELECT count(*)::bigint AS n
                 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                WHERE c.relname = 'engineer_snapshots' AND NOT l.granted AND l.pid <> pg_backend_pid()`,
            );
            if (Number(waiting[0]?.n ?? 0) > 0) break;
            if (Date.now() > deadline) throw new Error('前提の破綻: loadGateInput がロック待ちに入らなかった。');
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          await tx.$executeRawUnsafe(`UPDATE proposals SET state = 'DRAFT' WHERE id = '${PROPOSAL_A_P1}'::uuid`);
        },
        { timeout: 30_000, maxWait: 5_000 },
      );
      await expect(lookupPromise).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof GateFactsUnavailableError && error.reason === 'ENGINEER_FACTS_UNAVAILABLE',
      );
    } finally {
      await locker.$disconnect();
    }
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_P1 } })).toBe(0);
  });
});
