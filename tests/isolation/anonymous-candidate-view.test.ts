// tests/isolation/anonymous-candidate-view.test.ts
// 🔴 T-08-04（`docs/sprints/SP-08-anonymous-share.md` §5）: 案件スコープの参照子と
//    `AnonymousCandidateView` を **実 DB の応答で** 証明する。
//    `F-017 AC-1` / `AC-2` / `AC-3` / `BR-54` / `BR-55` / `BR-06` / `docs/05` §4.6。
//
// ---------------------------------------------------------------------------
// 🔴 なぜ型テストだけでは足りないか（T-08-03 のコードレビューで実 DB の漏洩が再現された）
// ---------------------------------------------------------------------------
//   - **RLS は行は守れても列は守れない**
//   - **Prisma 拡張の `$allOperations` はネストしたリレーション読み取りで走らない**
//   - **型テストは構造上リレーション経由を捕まえられない**（`db.engineer` は確かに無いので緑）
// したがって本ファイルは 🔴 **組み立てた応答そのものを深さ 6 で走査し、禁止された値・キーが
// 1 つも現れないことを実測**する。**空振り防止の対照テスト**（禁止値が DB に実在すること /
// 出てよい値は確かに出ること）を必ず対にする。
//
// 🔴 モックを使わない。共有スコープ（`app.shared_scope` + `app_engineer_is_shared()` の
//    `SECURITY DEFINER`）は実 DB でしか意味を持たない（`shared-candidate-scope.test.ts` と同じ方針）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withSharedCandidateScope,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ANONYMOUS_CANDIDATE_VIEW_KEYS,
  buildAnonymousCandidateViews,
  type AnonymousCandidateView,
} from '../../apps/web/lib/anonymize/candidate-view';
import { createCandidateReference } from '../../apps/web/lib/anonymize/reference';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  SHARE_A_P1,
  TENANT_A,
  USER_A_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/**
 * 🔴 テスト専用の HMAC 鍵。
 *
 * ⚠️ `apps/web/lib/db/bootstrap.ts` の `candidateReference()` は
 *    `initializeRuntimeConfig`（= 完全な env）を要求するため、ここでは
 *    **`createCandidateReference` を直接組み立てる**。鍵が `packages/config` の
 *    `ANON_REFERENCE_HMAC_SECRET`（起動時に Zod 検証）から来ることは
 *    `tests/startup/startup-di.test.ts` と `packages/config/src/startup.test.ts` が固定している。
 */
const TEST_SECRET = 'A'.repeat(43) + '=';
const candidateRef = createCandidateReference(TEST_SECRET);

/** 🔴 テストが足す辞書スキル（`skills` は射程外 4 表であり `tenant_id` を持たない）。 */
const SKILL_TS = '01930000-0000-7000-8000-0000000009b1';
const SKILL_GO = '01930000-0000-7000-8000-0000000009b2';

/** 丸めの基準日。🔴 現在時刻を使わない（決定的なテストにする）。 */
const REFERENCE_DATE = '2026-09-11';
/**
 * 🔴 JST の 2026-09-08 00:15（UTC では **前日** の 2026-09-07 15:15）。
 *    `toJstIsoDay` なら `2026-09-08`、UTC 切り出しなら `2026-09-07` になる時刻を選ぶ
 *    —— 「`updatedOn` が JST 基準であること」の対照になる（`docs/05` §4.6.3 の申し送り）。
 */
const UPDATED_AT = new Date('2026-09-07T15:15:00.000Z');

/** 🔴 応答に 1 文字も現れてはならない値（実 DB に実在させ、対照テストで確かめる）。 */
const PARTNER_DISPLAY_NAME = 'Engineer A-Partner';
const PARTNER_CONTACT_EMAIL = 'anon-view-pii@example.test';
const PARTNER_CONTACT_PHONE = '090-0000-0001';
const PARTNER_AFFILIATION = '匿名ビュー検証株式会社';
const PARTNER_CITY = '渋谷区';
const PARTNER_PREFERENCE_NOTE = '週 3 リモート希望（営業メモ）';
const PARTNER_COMPANY_NAME = 'Partner A1';

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
let hostA: AuthenticatedTenantCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  hostA = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'SALES',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'NOT_ENROLLED',
    },
    { deviceKind: 'api' },
  );

  await admin.skill.createMany({
    data: [
      { id: SKILL_TS, name: 'TypeScript(anon-view)', category: 'LANGUAGE', sortKey: 1 },
      { id: SKILL_GO, name: 'Go(anon-view)', category: 'LANGUAGE', sortKey: 2 },
    ],
    skipDuplicates: true,
  });

  // 🔴 共有元のパートナー所属エンジニアに **PII と商流情報を全部入れる**。
  //    出ないことを示すには、まず「DB には在る」ことが要る（対照テストが確かめる）。
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER },
    data: {
      displayName: PARTNER_DISPLAY_NAME,
      contactEmail: PARTNER_CONTACT_EMAIL,
      contactPhone: PARTNER_CONTACT_PHONE,
      affiliationLabel: PARTNER_AFFILIATION,
      birthDate: new Date('1990-04-01T00:00:00.000Z'),
      unitPriceMin: 650000,
      unitPriceMax: 650000,
      availableFrom: new Date('2026-10-01T00:00:00.000Z'),
      prefecture: '13',
      city: PARTNER_CITY,
      preferenceNote: PARTNER_PREFERENCE_NOTE,
      remoteMode: 'PARTIAL_REMOTE',
      updatedAt: UPDATED_AT,
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
        engineerId: ENGINEER_A_PARTNER,
        skillId: SKILL_GO,
        yearsOfExperience: 3,
        source: 'MANUAL',
      },
      {
        tenantId: TENANT_A,
        engineerId: ENGINEER_A_PARTNER2,
        skillId: SKILL_GO,
        yearsOfExperience: 2,
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
    skipDuplicates: true,
  });
  await admin.partnerCompany.update({
    where: { id: PARTNER_A1 },
    data: { name: PARTNER_COMPANY_NAME },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: null } });
  // 🔴 `updated_at` は `@updatedAt` なので、前のテストの更新で動いていないことを保証する
  //    （明示した値が優先されることは `tests/isolation/projects.test.ts` で既に使っている形）。
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER },
    data: { updatedAt: UPDATED_AT },
  });
});

afterEach(async () => {
  await admin.matchCandidate.deleteMany({ where: { projectId: PROJECT_A_PRIVATE } });
});

/**
 * 🔴 **本番の経路そのもの**で匿名候補の応答を作る。
 *
 * `withSharedCandidateScope`（`packages/db`。T-08-03）→ `buildAnonymousCandidateViews`
 * （`apps/web/lib/anonymize`。T-08-04）の 2 段であり、テスト専用の組み立ては挟まない。
 * ⚠️ `withSharedCandidateScope` の import は ESLint が全ゾーンで禁止し、`tests/isolation/**`
 *    だけを許可している（`docs/05` §4.5 改訂 9）。**API 経路（`#15` / `#30`）は T-08-05 の範囲**
 *    であり、本タスクでは実装しない（詳細エンドポイントも作らない。`docs/05` §6.8）。
 */
async function viewsFor(projectId: string): Promise<readonly AnonymousCandidateView[]> {
  const rows = await withSharedCandidateScope(hostA, projectId, (db) => db.listSharedEngineers());
  return buildAnonymousCandidateViews({
    projectId,
    rows,
    referenceDate: REFERENCE_DATE,
    candidateRef,
  });
}

// ---------------------------------------------------------------------------
// 🔴 深さ走査（T-08-03 の shared-candidate-scope.test.ts と同じ手口）
// ---------------------------------------------------------------------------

const MAX_DEPTH = 6;

type Collected = { readonly keys: string[]; readonly values: string[] };

/**
 * 応答を深さ `MAX_DEPTH` まで辿り、**すべてのキー名とスカラー値**を集める。
 *
 * 🔴 `JSON.stringify` 1 本に頼らないのは、`toJSON()` を持つ値（`Decimal` / `Date`）が
 *    文字列に畳まれて**キー名が消える**ためである。キーと値の両方を別々に見る。
 */
function collect(value: unknown, depth = 0, acc: Collected = { keys: [], values: [] }): Collected {
  if (depth > MAX_DEPTH) return acc;
  if (value === null || value === undefined) return acc;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    acc.values.push(String(value));
    return acc;
  }
  if (value instanceof Date) {
    acc.values.push(value.toISOString(), String(value.getTime()));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, depth + 1, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      acc.keys.push(key);
      collect(entry, depth + 1, acc);
    }
    return acc;
  }
  return acc;
}

/** 🔴 応答に 1 文字も現れてはならない値（`F-017 AC-1` / `AC-2` / `BR-06`）。 */
const FORBIDDEN_VALUES: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'engineers.display_name（実名）', value: PARTNER_DISPLAY_NAME },
  { label: 'engineers.contact_email', value: PARTNER_CONTACT_EMAIL },
  { label: 'engineers.contact_phone', value: PARTNER_CONTACT_PHONE },
  { label: 'engineers.affiliation_label（現所属会社名）', value: PARTNER_AFFILIATION },
  { label: 'engineers.city（市区町村）', value: PARTNER_CITY },
  { label: 'engineers.preference_note（営業メモ）', value: PARTNER_PREFERENCE_NOTE },
  { label: 'engineers.birth_date', value: '1990-04-01' },
  { label: 'engineers.id（社内 ID。案件をまたいだ突合の材料）', value: ENGINEER_A_PARTNER },
  { label: 'engineers.owner_partner_company_id（共有元）', value: PARTNER_A1 },
  { label: 'partner_companies.name（共有元の社名）', value: PARTNER_COMPANY_NAME },
  { label: 'skills.id（辞書 ID。案件をまたいだ突合の材料）', value: SKILL_TS },
  { label: 'skills.id（同上）', value: SKILL_GO },
  { label: 'engineers.unit_price_min（丸める前の単価）', value: '650000' },
  { label: 'engineers.available_from（具体的な稼働開始日）', value: '2026-10-01' },
  { label: 'engineers.updated_at（丸めていない更新日時）', value: UPDATED_AT.toISOString() },
  { label: 'engineers.updated_at（epoch）', value: String(UPDATED_AT.getTime()) },
];

/** 🔴 応答のどの深さにも現れてはならないキー名。 */
const FORBIDDEN_KEYS: readonly string[] = [
  'displayName',
  'contactEmail',
  'contactPhone',
  'affiliationLabel',
  'birthDate',
  'city',
  'preferenceNote',
  'ownerPartnerCompanyId',
  'partnerCompanyId',
  'engineerId',
  'skillId',
  'sortKey',
  'yearsOfExperience',
  'updatedAt',
  'availableFrom',
  'unitPrice',
  'unitPriceMin',
  'unitPriceMax',
  'careers',
  'careerCount',
  'hasCareers',
  'skillSheet',
  'skillSheetId',
  'score',
  'rank',
  'index',
  'id',
];

describe('🔴 F-017 AC-1: 応答に開示 5 項目以外が 1 つも現れない（実 DB）', () => {
  it('🔴 全項目の値を深さ 6 まで走査して、禁止された値が 0 件である', async () => {
    const views = await viewsFor(PROJECT_A_PUBLISHED);
    expect(views).toHaveLength(1); // 空振り防止（共有中の 1 件が確かに出ている）

    const collected = collect(views);
    // 🔴 区切りを挟んで連結する（値の境界をまたいだ偶然の一致で紛らわしく落ちないように）。
    //    区切りを入れても**見逃しは増えない** —— 禁止値はいずれも 1 つのスカラー値に収まる。
    const haystack = collected.values.join('|');
    for (const forbidden of FORBIDDEN_VALUES) {
      expect(haystack, `禁止された値が応答に含まれている: ${forbidden.label}`).not.toContain(
        forbidden.value,
      );
    }
  });

  it('🔴 対照: 禁止した値は DB に実在する（照合が空振りしていない）', async () => {
    const engineer = await admin.engineer.findUniqueOrThrow({
      where: { id: ENGINEER_A_PARTNER },
      select: {
        displayName: true,
        contactEmail: true,
        contactPhone: true,
        affiliationLabel: true,
        city: true,
        preferenceNote: true,
        ownerPartnerCompanyId: true,
        unitPriceMin: true,
        updatedAt: true,
      },
    });
    expect(engineer.displayName).toBe(PARTNER_DISPLAY_NAME);
    expect(engineer.contactEmail).toBe(PARTNER_CONTACT_EMAIL);
    expect(engineer.contactPhone).toBe(PARTNER_CONTACT_PHONE);
    expect(engineer.affiliationLabel).toBe(PARTNER_AFFILIATION);
    expect(engineer.city).toBe(PARTNER_CITY);
    expect(engineer.preferenceNote).toBe(PARTNER_PREFERENCE_NOTE);
    expect(engineer.ownerPartnerCompanyId).toBe(PARTNER_A1);
    expect(Number(engineer.unitPriceMin?.toString())).toBe(650000);
    expect(engineer.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString());
    const partner = await admin.partnerCompany.findUniqueOrThrow({
      where: { id: PARTNER_A1 },
      select: { name: true },
    });
    expect(partner.name).toBe(PARTNER_COMPANY_NAME);
  });

  it('🔴 対照: 出してよい値は確かに出ている（走査が「空の応答」を見ていない）', async () => {
    const collected = collect(await viewsFor(PROJECT_A_PUBLISHED));
    expect(collected.values).toContain('TypeScript(anon-view)');
    expect(collected.values).toContain('Y5_10'); // 経験年数 7 年 → 5〜10 年（F-017 AC-3）
    expect(collected.values).toContain('13'); // 都道府県コード（東京都）
    expect(collected.values).toContain('PARTIAL_REMOTE');
    expect(collected.values).toContain('2026-09-08'); // 🔴 JST 暦日（UTC 切り出しなら 09-07）
  });

  it('🔴 どの深さにも禁止されたキー名が現れない（キー集合ごと固定する）', async () => {
    const collected = collect(await viewsFor(PROJECT_A_PUBLISHED));
    const uniqueKeys = [...new Set(collected.keys)].sort();
    // 🔴 トップレベルの 8 個に加えて現れてよいのは、**2 つの値オブジェクトの内側だけ**である:
    //    - `skills[].name`   … 辞書の正規化済み名称（`skillId` / `sortKey` は載せない）
    //    - `priceBand.{kind,fromManYen,toManYen}` … 判別可能な合併（`docs/05` §4.6.2。
    //      整形済み文字列にせず構造体にしてあるのは i18n 側で組み立て直すため）
    //    🔴 **これは開示項目の追加ではなく、1 項目内の表現である。**
    const NESTED_VALUE_OBJECT_KEYS = ['name', 'kind', 'fromManYen', 'toManYen'];
    expect(uniqueKeys).toEqual(
      [...ANONYMOUS_CANDIDATE_VIEW_KEYS, ...NESTED_VALUE_OBJECT_KEYS].sort(),
    );
    for (const key of FORBIDDEN_KEYS) {
      expect(uniqueKeys, `禁止されたキーが応答に含まれている: ${key}`).not.toContain(key);
    }
  });

  it('🔴 単価は 10 万円刻みの区分でのみ出る（丸める前の値も「万円 → 円」も出ない）', async () => {
    const [view] = await viewsFor(PROJECT_A_PUBLISHED);
    expect(view?.priceBand).toEqual({ kind: 'RANGE', fromManYen: 60, toManYen: 70 });
  });

  it('🔴 稼働可能時期は 5 段階のみ（具体的な稼働開始日が出ない）', async () => {
    const [view] = await viewsFor(PROJECT_A_PUBLISHED);
    expect(view?.availabilityBand).toBe('NEXT_MONTH');
  });
});

describe('🔴 F-017 AC-2 / BR-55: 案件をまたいで同一人物を突き合わせられない（実 DB）', () => {
  it('🔴 同一エンジニアでも案件が違えば参照子が違う（E2E #6 の DB 側の証明）', async () => {
    const [published] = await viewsFor(PROJECT_A_PUBLISHED);
    const [privateProject] = await viewsFor(PROJECT_A_PRIVATE);
    expect(published?.candidateRef).toBeDefined();
    expect(privateProject?.candidateRef).toBeDefined();
    expect(published?.candidateRef).not.toBe(privateProject?.candidateRef);
  });

  it('同一案件では参照子が安定である（提案依頼の逆引きが成立する前提。T-08-06）', async () => {
    const first = await viewsFor(PROJECT_A_PUBLISHED);
    const second = await viewsFor(PROJECT_A_PUBLISHED);
    expect(first.map((view) => view.candidateRef)).toEqual(second.map((view) => view.candidateRef));
  });

  it('🔴 2 案件の応答を突き合わせても、一致するスカラー値が「丸めた 5 項目」以外に無い', async () => {
    const publishedViews = await viewsFor(PROJECT_A_PUBLISHED);
    const privateViews = await viewsFor(PROJECT_A_PRIVATE);
    const privateValues = collect(privateViews).values;
    const shared = [...new Set(collect(publishedViews).values.filter((v) => privateValues.includes(v)))];

    // 🔴 一致するのは丸め後の 5 項目 + 更新日だけである（＝ `docs/05` §4.6 の線引き表の
    //    「⑥ 丸め後 5 項目の組み合わせ」= Phase 1 の残存リスクそのものであり、
    //    k-匿名性の閾値を入れない決定〔Issue #5〕の帰結である）。
    //    🔴 **識別子・安定したハッシュ・連番は 1 つも無い。**
    expect(shared.sort()).toEqual(
      [
        '13',
        '2026-09-08',
        '60',
        '70',
        'Go(anon-view)',
        'NEXT_MONTH',
        'PARTIAL_REMOTE',
        'RANGE',
        'TypeScript(anon-view)',
        'Y5_10',
      ].sort(),
    );
    // 参照子は一致しない（上の集合に入っていない）。
    expect(shared).not.toContain(publishedViews[0]?.candidateRef);
    expect(shared).not.toContain(privateViews[0]?.candidateRef);
  });

  it('🔴 共有を停止すると候補が消える（F-016 AC-2。参照子が残らない）', async () => {
    await admin.engineerShare.update({
      where: { id: SHARE_A_P1 },
      data: { revokedAt: new Date('2026-09-11T00:00:00.000Z') },
    });
    expect(await viewsFor(PROJECT_A_PUBLISHED)).toEqual([]);
  });
});
