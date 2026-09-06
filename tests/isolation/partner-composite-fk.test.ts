// tests/isolation/partner-composite-fk.test.ts
// Issue #33（既定 C） / docs/05 §3.3.1「パートナー FK 列の複合 FK 化」の**結合テスト**。
//
// 🔴 何を証明するか: **越境がアプリを一切通さずに DB 単独で落ちること。**
//    `tests/isolation/rls-enforced.test.ts` #14 はカタログを見て「複合 FK が張られている」ことを
//    固定するが、それは宣言の検査であって**実際に弾かれること**の証明ではない。ここでは
//    **superuser 接続**（RLS を素通りし、アプリの照合も Prisma 拡張も通らない、
//    考えうる最も特権的な経路）から越境行の書き込みを試み、FK だけで拒否されることを見る。
//    superuser で通らないなら、`app_tenant` でも `app_migrator` でも通らない。
//
// 🔴 対照（これが無いと「全部落ちているだけ」と区別できない）:
//    ① 同一テナントの取引先を指す行は書ける
//    ② パートナー列が NULL（= ホスト所有）の行は書ける —— docs/05 §3.3.1-4 の `MATCH SIMPLE`。
//       `MATCH FULL` で書いてしまうとこの対照が落ちる（ホスト所有行を 1 行も作れなくなる）。
//
// 🔴 アプリ経路の 404 は**変わらない**（docs/05 §3.3.1「アプリ層照合との関係」）。
//    その不変性は `tests/isolation/partner-companies.test.ts` の
//    「T-04-07: 招待先の選択（targetPartnerCompanyId）は母集団に照合される」が引き続き担保する
//    （FK 違反 `23503` が利用者応答へ到達しないこと = 500 と 404 で他テナントの実在を
//     探れないこと。ここでは重複実装しない）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  TASK_A_HOST,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_B_HOST,
} from './support/fixtures.js';
import { REPO_ROOT, startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** テナント B の取引先。逆向き（B の行が A の取引先を指す）の対照に使う。 */
const PARTNER_B1 = '01930000-0000-7000-8000-0000000000c9';

/** `tasks` の `@@unique([tenantId, kind, targetType, targetId])` を seed と衝突させないための ID。 */
const TASK_TARGET_CROSS = '01930000-0000-7000-8000-0000000000f9';
const TASK_TARGET_HOST_OWNED = '01930000-0000-7000-8000-0000000000fa';

const MIGRATION_SQL_PATH = path.join(
  REPO_ROOT,
  'packages',
  'db',
  'prisma',
  'migrations',
  '20260911000000_partner_composite_fk',
  'migration.sql',
);

/** docs/05 §3.3.1 の A 群 13 列。migration の事前チェックが網羅していることの対照に使う。 */
const A_GROUP_TABLES = [
  'users',
  'memberships',
  'invitations',
  'engineers',
  'project_visibilities',
  'engineer_shares',
  'proposal_requests',
  'proposals',
  'chat_threads',
  'thread_participants',
  'messages',
  'contracts',
  'tasks',
] as const;

let database: IsolationDatabase;
/** 🔴 superuser。RLS を素通りするため、残る防御は FK だけになる。 */
let superuser: UnextendedClient;

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  await superuser.$executeRawUnsafe(
    `INSERT INTO partner_companies (id, tenant_id, name, invited_at)
     VALUES ($1::uuid, $2::uuid, 'Partner B1', now())`,
    PARTNER_B1,
    TENANT_B,
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

function insertUser(options: {
  readonly tenantId: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly email: string;
}): Promise<number> {
  return superuser.$executeRawUnsafe(
    `INSERT INTO users (id, tenant_id, owner_partner_company_id, email, display_name, password_hash)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 'FK Probe', 'x')`,
    options.tenantId,
    options.ownerPartnerCompanyId,
    options.email,
  );
}

function insertTask(options: {
  readonly tenantId: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly targetId: string;
  readonly assigneeUserId: string;
}): Promise<number> {
  return superuser.$executeRawUnsafe(
    `INSERT INTO tasks (id, tenant_id, owner_partner_company_id, kind, target_type, target_id,
                        due_on, assignee_user_id)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'INTERVIEW', 'Proposal', $3::uuid,
             current_date, $4::uuid)`,
    options.tenantId,
    options.ownerPartnerCompanyId,
    options.targetId,
    options.assigneeUserId,
  );
}

describe('🔴 Issue #33: 越境した partner_company の参照が DB 単独で落ちる', () => {
  it('🔴 テナント B の users が テナント A の取引先を指すと FK 違反になる（superuser でも通らない）', async () => {
    await expect(
      insertUser({
        tenantId: TENANT_B,
        ownerPartnerCompanyId: PARTNER_A1,
        email: 'cross-b-to-a@fk.test',
      }),
    ).rejects.toThrow(/foreign key constraint "users_tenant_id_owner_partner_company_id_fkey"/);
  });

  it('🔴 逆向き（テナント A の users が テナント B の取引先を指す）も同じく落ちる', async () => {
    await expect(
      insertUser({
        tenantId: TENANT_A,
        ownerPartnerCompanyId: PARTNER_B1,
        email: 'cross-a-to-b@fk.test',
      }),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it('🔴 invitations（Issue #33 の発端）: 他テナントの取引先を指す招待は書けない', async () => {
    await expect(
      superuser.$executeRawUnsafe(
        `INSERT INTO invitations (id, tenant_id, email, role, partner_company_id, token_hash,
                                  expires_at, invited_by)
         VALUES (gen_random_uuid(), $1::uuid, 'cross@fk.test', 'PARTNER_ADMIN', $2::uuid,
                 'fk-probe-hash', now() + interval '7 days', $3::uuid)`,
        TENANT_B,
        PARTNER_A1,
        USER_B_HOST,
      ),
    ).rejects.toThrow(/foreign key constraint "invitations_tenant_id_partner_company_id_fkey"/);
  });

  it('🔴 tasks: 本移行で**新規に**張った FK が効く（従来は FK が 1 本も無く素通りだった）', async () => {
    await expect(
      insertTask({
        tenantId: TENANT_B,
        ownerPartnerCompanyId: PARTNER_A1,
        targetId: TASK_TARGET_CROSS,
        assigneeUserId: USER_B_HOST,
      }),
    ).rejects.toThrow(/foreign key constraint "tasks_tenant_id_owner_partner_company_id_fkey"/);
  });

  it('🔴 UPDATE でも落ちる（INSERT だけ塞いでも既存行の付け替えで越境できてはならない）', async () => {
    await expect(
      superuser.$executeRawUnsafe(
        `UPDATE invitations SET partner_company_id = $1::uuid WHERE tenant_id = $2::uuid
           AND partner_company_id IS NOT NULL`,
        PARTNER_B1,
        TENANT_A,
      ),
    ).rejects.toThrow(/foreign key constraint/i);
  });
});

describe('🔴 Issue #33: 対照（正当な行は書けること。全部落ちているだけではない）', () => {
  it('① 同一テナントの取引先を指す行は書ける', async () => {
    await expect(
      insertUser({
        tenantId: TENANT_A,
        ownerPartnerCompanyId: PARTNER_A1,
        email: 'same-tenant@fk.test',
      }),
    ).resolves.toBe(1);
  });

  it('🔴 ② パートナー列が NULL（ホスト所有）の行は書ける = MATCH SIMPLE である（docs/05 §3.3.1-4）', async () => {
    // MATCH FULL で書いてしまうと「tenant_id はあるがパートナー列は NULL」の行が拒否され、
    // ホスト所有行を 1 行も作れなくなる。この 2 件がその回帰を止める。
    await expect(
      insertUser({ tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host-owned@fk.test' }),
    ).resolves.toBe(1);
    await expect(
      insertTask({
        tenantId: TENANT_A,
        ownerPartnerCompanyId: null,
        targetId: TASK_TARGET_HOST_OWNED,
        assigneeUserId: USER_A_HOST,
      }),
    ).resolves.toBe(1);
  });

  it('ON DELETE RESTRICT が維持されている（参照されている取引先は消せない）', async () => {
    await expect(
      superuser.$executeRawUnsafe(`DELETE FROM partner_companies WHERE id = $1::uuid`, PARTNER_A1),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it('seed 済みの母集団（TASK_A_HOST / TASK_A_P1）が新 FK の下でもそのまま存在する', async () => {
    const rows = await superuser.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM tasks WHERE id = $1::uuid`,
      TASK_A_HOST,
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });
});

/**
 * 🔴 migration の再実行安全性（1 回きりの deploy だが、事前チェックだけは何度でも走れる）。
 *
 * 空 DB での成立は「このスイートが起動できたこと」自体が証明している
 * （`startIsolationDatabase` は毎回 `prisma migrate deploy` を空 DB に流す）。
 * ここでは **seed 済みの DB** に対して同じ DO ブロックを流し、既存の母集団に違反行が
 * 1 件も無いことを確かめる。
 *
 * 🔴 チェック本文を書き写さず、migration.sql から読み出す（写経すると本体と乖離する）。
 * 🔴 superuser で流す: migration 本体は FORCE ROW LEVEL SECURITY を一時解除してから流すが、
 *    ここでは解除せずに済むよう RLS を素通りする接続を使う（同じ「全行が見える」状態を作る）。
 *    ⚠️ `app_migrator` でそのまま流すと FORCE RLS により**常に 0 件**になり、
 *       検査したつもりで何も見ていない状態になる（migration.sql 冒頭の実測メモ参照）。
 */
describe('🔴 Issue #33: migration の事前チェックが seed 済み DB でも通る', () => {
  function readViolationCheckBlock(): string {
    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    const blocks = sql.match(/DO \$\$[\s\S]*?END \$\$;/g) ?? [];
    const block = blocks[0];
    expect(block, 'migration.sql から DO ブロックを取り出せませんでした').toBeDefined();
    return block as string;
  }

  it('取り出した DO ブロックが A 群 13 表をすべて走査している（抽出の空振り防止）', () => {
    const block = readViolationCheckBlock();
    expect(block).toContain('Issue #33');
    for (const table of A_GROUP_TABLES) {
      expect(block, `事前チェックが ${table} を走査していません`).toContain(`FROM ${table} t`);
    }
  });

  it('seed 済み DB で違反行が 0 件（RAISE されない）。2 回流しても同じ', async () => {
    const block = readViolationCheckBlock();
    await expect(superuser.$executeRawUnsafe(block)).resolves.toBeDefined();
    await expect(superuser.$executeRawUnsafe(block)).resolves.toBeDefined();
  });

  it('🔴 違反行を 1 件差し込むと、その DO ブロックが必ず RAISE する（チェックが空振りしていない対照）', async () => {
    // 🔴 複合 FK があるため「越境行」はもう作れない。そこで **FK を一時的に外した**状態で
    //    越境行を差し込み、事前チェックが検出することを確かめてから、必ず元へ戻す。
    //    これが無いと「DO ブロックが常に 0 件を返しているだけ」と区別できない
    //    （FORCE RLS 下の app_migrator で実際にそうなる。migration.sql 冒頭の実測メモ）。
    await superuser.$executeRawUnsafe(
      `ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_owner_partner_company_id_fkey"`,
    );
    try {
      await insertUser({
        tenantId: TENANT_B,
        ownerPartnerCompanyId: PARTNER_A1,
        email: 'planted-violation@fk.test',
      });
      await expect(superuser.$executeRawUnsafe(readViolationCheckBlock())).rejects.toThrow(
        /Issue #33: 別テナントの partner_company を指す行が 1 件あります/,
      );
    } finally {
      await superuser.$executeRawUnsafe(
        `DELETE FROM users WHERE email = 'planted-violation@fk.test'`,
      );
      await superuser.$executeRawUnsafe(
        `ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_owner_partner_company_id_fkey"
           FOREIGN KEY ("tenant_id", "owner_partner_company_id")
           REFERENCES "partner_companies"("tenant_id", "id")
           ON DELETE RESTRICT ON UPDATE CASCADE`,
      );
    }
  });
});
