// apps/web/lib/engineers/service.ts
// エンジニア台帳の登録・編集（docs/05 §6.4 #16。`F-008` / `S-007`）。T-05-01。
//
// 🔴 **所有パートナー（`owner_partner_company_id`）は `ctx.partnerCompanyId` からしか決まらない**
//    （`F-008 AC-2` / `CLAUDE.md` §3.1）。リクエスト入力に現れる余地が無いことは
//    `schemas.ts` の 4 枚の担保が固定し、ここは ctx の値をそのまま渡すだけである。
//    🔴 **`update` の `data` にはこの列を 1 度も載せない** —— 載せなくても DB 側の
//    `engineers_freeze_owner`（BEFORE UPDATE で不変。migration 20260903070000）が
//    変更を拒否するが、アプリ側でも「そもそも書かない」形にしておく。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストがサーバを
//    立てずに同じ経路を実行できるようにするため（`partner-companies/service.ts` と同じ方針）。
//
// 🔴 スキルは **`F-010` の辞書（`Skill`）から選ぶ**。辞書に無い表記は `SkillAlias` の
//    新語候補（`PROPOSED`）として起票するだけで、**辞書には 1 行も足さない**（`F-010 AC-1` /
//    `AC-2`）。辞書表そのものへの書き込み権限は `app_tenant` に無い
//    （migration 20260906000000 は `GRANT SELECT` のみ）。
import {
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type EngineerAvailability,
  type RemoteMode,
} from '@ses/db';
import type { PrefectureCode } from '@ses/domain';
import { NotFoundError, ValidationError } from '../api/errors';
import type { CreateEngineerBody, EngineerSkillInput, UpdateEngineerBody } from './schemas';

/**
 * docs/05 §16.1 の `*.create` / `*.update` と `engineer.view`（`BR-27` の 11 種）。
 * 🔴 独自の action 名を作らない（`S-041` の操作種別フィルタは接尾辞一致であり、
 *    `engineer.register` のような名前を作ると**記録されているのに検索で出てこない**）。
 */
export const ENGINEER_AUDIT_ACTIONS = {
  create: 'engineer.create',
  update: 'engineer.update',
  /** 🔴 `BR-27` / `F-008 AC-4`。API 版（#17）は T-05-02。ここは `S-007` の編集フォームの読み取り。 */
  view: 'engineer.view',
} as const;

/** 台帳の所属区分（`S-007` セクション 1 の読み取り専用表示）。 */
export type EngineerOwnership = 'HOST' | 'PARTNER';

export type EngineerSkillView = {
  readonly skillId: string;
  readonly name: string;
  readonly yearsOfExperience: number;
  readonly level: number | null;
};

/**
 * `S-007`（編集）が必要とする項目だけ。
 * 🔴 `docs/05` §3.4 の列をすべて出さない —— `birthDate` / `affiliationLabel` は
 *    本画面の入力項目ではない（`BR-52` / `F-008 AC-1`）ため読み出しもしない。
 */
export type EngineerEditView = {
  readonly id: string;
  readonly displayName: string;
  /** 🔴 読み取り専用（入力欄を持たない。`F-008 AC-2`）。 */
  readonly ownership: EngineerOwnership;
  readonly availability: EngineerAvailability;
  /** `YYYY-MM-DD` または `null`。 */
  readonly availableFrom: string | null;
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly prefecture: PrefectureCode | null;
  readonly remoteMode: RemoteMode | null;
  readonly preferenceNote: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly skills: readonly EngineerSkillView[];
};

/** 監査ログに残す実行環境（`withApiRoute` の `audit` と同じ値。画面経路は自前で渡す）。 */
export type EngineerViewMeta = {
  readonly ipAddress: string | null;
};

/**
 * Prisma の `Decimal` を数値にする。
 * 🔴 `@prisma/client` を import しない（ESLint が禁じる。`CLAUDE.md` §3.1）ため、
 *    `toString()` だけを要求する構造的な型で受ける。
 */
function decimalToNumber(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

/** `@db.Date` の値を `YYYY-MM-DD` にする（UTC で切り出す。時刻を持たない列であるため）。 */
function toDateOnlyString(value: Date | null): string | null {
  return value === null ? null : (value.toISOString().slice(0, 10) as string);
}

/** `YYYY-MM-DD` を `@db.Date` に渡す値にする。 */
function toDateOnly(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

/**
 * 🔴 単価レンジの大小関係（`docs/04` §S-007 の 2 値入力）。
 *    境界の Zod ではなくここで見る理由は 2 つ: ①`.refine()` をトップレベルに使えない
 *    （`withApiRoute` の構築時検査が `.shape` を読む）②PATCH は**既存値と合成**しないと
 *    判定できない（片方だけ更新できるため）。
 */
function assertUnitPriceRange(min: number | null, max: number | null): void {
  if (min !== null && max !== null && min > max) {
    throw new ValidationError(['body.unitPriceMax']);
  }
}

/**
 * 入力のスキル集合を検証して返す。
 * 🔴 同じ `skillId` が 2 回現れたら**黙って畳まずに 400 にする**（後勝ちで畳むと、
 *    利用者が入力した経験年数の片方が理由なく消える。`EngineerSkill` の
 *    `@@unique([tenantId, engineerId, skillId])` にも当たる）。
 */
function normalizeSkills(skills: readonly EngineerSkillInput[]): readonly EngineerSkillInput[] {
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.skillId)) throw new ValidationError(['body.skills']);
    seen.add(skill.skillId);
  }
  return skills;
}

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使うデリゲートだけ。 */
type EngineerDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * 🔴 指定された `skillId` が**グローバル辞書に実在すること**を確かめる（`F-008` 処理②）。
 *    実在しない ID を許すと、FK 違反が 500 になって「入力の誤り」が障害に見える。
 *    `Skill` は射程外の 4 表であり第 2 防御の注入対象外だが、`GRANT` は `SELECT` だけである。
 */
async function assertSkillsExist(
  db: EngineerDb,
  skills: readonly EngineerSkillInput[],
): Promise<void> {
  if (skills.length === 0) return;
  const ids = skills.map((skill) => skill.skillId);
  const found = await db.skill.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new ValidationError(['body.skills']);
}

function skillRows(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  skills: readonly EngineerSkillInput[],
) {
  return skills.map((skill) => ({
    // 🔴 テナントキーは第 2 防御が確定させるが、Prisma の型が必須列として要求するため明示する。
    tenantId: ctx.tenantId,
    // 🔴 `ownerPartnerCompanyId` を**渡さない**。`engineer_skills_inherit_owner` トリガが
    //    親（`engineers`）の値で必ず上書きする（docs/05 §4.4.1）。ここで計算しない。
    engineerId,
    skillId: skill.skillId,
    yearsOfExperience: skill.yearsOfExperience,
    level: skill.level,
    source: 'MANUAL' as const,
  }));
}

/**
 * 🔴 辞書に無い表記を**新語候補として起票する**（`F-010 AC-1`）。
 *
 * - `status='PROPOSED'` / `skillId=null` で書く。**辞書（`Skill`）には 1 行も足さない。**
 * - すでに同じ表記の `SkillAlias` があれば起票しない。既存にはグローバル別名
 *   （`tenant_id IS NULL`）も含む —— 第 2 防御の `COLUMN_WITH_GLOBAL_ROWS` により
 *   読み取りはグローバル行も返す（`F-010 AC-2`）。グローバル行と `@@unique([tenantId, alias])`
 *   は衝突しない（NULL は一意制約で重複扱いにならない）ため、この事前照合が無いと
 *   「すでに正規化できる表記」を候補として二重に積むことになる。
 * - パートナー所属の利用者も起票できる（`F-010 AC-1`「パートナーは起票のみ」）。
 *   採否（`ACCEPT` / `REJECT`）は T-05-03 の `#24` が扱う。
 */
async function proposeSkillAliases(
  db: EngineerDb,
  ctx: AuthenticatedTenantCtx,
  labels: readonly string[],
): Promise<number> {
  const unique = [...new Set(labels)];
  if (unique.length === 0) return 0;

  const existing = await db.skillAlias.findMany({
    where: { alias: { in: unique } },
    select: { alias: true },
  });
  const known = new Set(existing.map((row) => row.alias));
  const rows = unique
    .filter((alias) => !known.has(alias))
    .map((alias) => ({
      tenantId: ctx.tenantId,
      alias,
      skillId: null,
      status: 'PROPOSED' as const,
      origin: 'HUMAN' as const,
      proposedBy: ctx.userId,
    }));
  if (rows.length === 0) return 0;

  // 🔴 `createMany`（`RETURNING` を伴わない）。同時実行で同じ表記が入っても
  //    `@@unique([tenantId, alias])` により 1 行に収束させる（起票の重複を失敗にしない）。
  const created = await db.skillAlias.createMany({ data: rows, skipDuplicates: true });
  return created.count;
}

/**
 * `POST /api/engineers`（#16）。
 *
 * 🔴 監査は `withApiRoute` の `audit` オプション（`engineer.create`）が**ハンドラの前に**書く
 *    （docs/05 §6.1 / §16.1）。記録に失敗したらこの関数は呼ばれない。
 */
export async function createEngineer(
  ctx: AuthenticatedTenantCtx,
  input: CreateEngineerBody,
): Promise<{ readonly id: string }> {
  assertUnitPriceRange(input.unitPriceMin, input.unitPriceMax);
  const skills = normalizeSkills(input.skills);

  return withTenant(ctx, async (db) => {
    await assertSkillsExist(db, skills);

    const created = await db.engineer.create({
      data: {
        tenantId: ctx.tenantId,
        // 🔴 `F-008 AC-2` の中心。**ここが唯一の出所**である（リクエスト入力ではない）。
        //    ホスト所属なら `null`、パートナー所属なら自社 ID になる。
        //    RLS の C3（`WITH CHECK` が `IS NOT DISTINCT FROM app_partner_id()`）が
        //    別の値での INSERT を DB 側でも拒否する（二重防御）。
        ownerPartnerCompanyId: ctx.partnerCompanyId,
        displayName: input.displayName,
        availability: input.availability,
        availableFrom: toDateOnly(input.availableFrom),
        unitPriceMin: input.unitPriceMin,
        unitPriceMax: input.unitPriceMax,
        prefecture: input.prefecture,
        remoteMode: input.remoteMode,
        preferenceNote: input.preferenceNote,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
      },
      select: { id: true },
    });

    if (skills.length > 0) {
      await db.engineerSkill.createMany({ data: skillRows(ctx, created.id, skills) });
    }
    await proposeSkillAliases(db, ctx, input.newSkillLabels);

    return { id: created.id };
  });
}

/**
 * `PATCH /api/engineers/{id}`（#16）。
 *
 * 🔴 `update` ではなく `updateMany` を使う（`settings/organization.ts` / `partner-companies` と
 *    同じ理由）。スコープは第 2 防御が注入した `where` と RLS が決め、アプリは `id` 以外の
 *    条件を書かない。更新が 0 件なら 404（境界外と不存在を区別しない。docs/05 §4.8）。
 *
 * 🔴 `skills` を指定したときは**その集合で置き換える**（差分適用にしない）。`S-007` は
 *    スキル表を丸ごと編集する画面であり、差分にすると「画面から消した行が消えない」ずれが出る。
 */
export async function updateEngineer(
  ctx: AuthenticatedTenantCtx,
  id: string,
  patch: UpdateEngineerBody,
): Promise<{ readonly id: string }> {
  const skills = patch.skills === undefined ? undefined : normalizeSkills(patch.skills);

  return withTenant(ctx, async (db) => {
    const current = await db.engineer.findFirst({
      where: { id },
      select: { id: true, unitPriceMin: true, unitPriceMax: true },
    });
    if (current === null) throw new NotFoundError();

    // 🔴 単価レンジは**更新後の値**で判定する（片方だけ更新できるため、既存値と合成する）。
    assertUnitPriceRange(
      patch.unitPriceMin === undefined ? decimalToNumber(current.unitPriceMin) : patch.unitPriceMin,
      patch.unitPriceMax === undefined ? decimalToNumber(current.unitPriceMax) : patch.unitPriceMax,
    );
    if (skills !== undefined) await assertSkillsExist(db, skills);

    // 🔴 `data` に載せてよい列の**唯一の一覧**。`ownerPartnerCompanyId` / `tenantId` は
    //    ここに現れない（現れないことをレビューで数えられる形にしておく）。
    const data = {
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.availability === undefined ? {} : { availability: patch.availability }),
      ...(patch.availableFrom === undefined
        ? {}
        : { availableFrom: toDateOnly(patch.availableFrom) }),
      ...(patch.unitPriceMin === undefined ? {} : { unitPriceMin: patch.unitPriceMin }),
      ...(patch.unitPriceMax === undefined ? {} : { unitPriceMax: patch.unitPriceMax }),
      ...(patch.prefecture === undefined ? {} : { prefecture: patch.prefecture }),
      ...(patch.remoteMode === undefined ? {} : { remoteMode: patch.remoteMode }),
      ...(patch.preferenceNote === undefined ? {} : { preferenceNote: patch.preferenceNote }),
      ...(patch.contactEmail === undefined ? {} : { contactEmail: patch.contactEmail }),
      ...(patch.contactPhone === undefined ? {} : { contactPhone: patch.contactPhone }),
    };

    if (Object.keys(data).length > 0) {
      const updated = await db.engineer.updateMany({ where: { id }, data });
      // 🔴 直前に見えていた行が消えている（並行削除）。0 件を成功にしない。
      if (updated.count !== 1) throw new NotFoundError();
    }

    if (skills !== undefined) {
      await db.engineerSkill.deleteMany({ where: { engineerId: id } });
      if (skills.length > 0) {
        await db.engineerSkill.createMany({ data: skillRows(ctx, id, skills) });
      }
    }
    await proposeSkillAliases(db, ctx, patch.newSkillLabels ?? []);

    return { id };
  });
}

/**
 * `S-007`（編集）が初期値を読む経路。
 *
 * 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-008 AC-4`）。氏名・連絡先という PII を
 *    画面に出す以上、詳細画面（`S-006`。T-05-02 の `#17`）と同じ扱いにする。
 * 🔴 記録は**業務トランザクションの内側**で書く（`writeAuditLog`）。書けなければ
 *    トランザクションごと巻き戻り、**内容は返らない**（`F-012 AC-2` と同じ規律）。
 * 🔴 境界外・不存在はどちらも 404（docs/05 §4.8）。記録も残さない（見えない行の閲覧は無い）。
 */
export async function readEngineerForEdit(
  ctx: AuthenticatedTenantCtx,
  id: string,
  meta: EngineerViewMeta,
): Promise<EngineerEditView> {
  return withTenant(ctx, async (db) => {
    const row = await db.engineer.findFirst({
      where: { id },
      select: {
        id: true,
        ownerPartnerCompanyId: true,
        displayName: true,
        availability: true,
        availableFrom: true,
        unitPriceMin: true,
        unitPriceMax: true,
        prefecture: true,
        remoteMode: true,
        preferenceNote: true,
        contactEmail: true,
        contactPhone: true,
      },
    });
    if (row === null) throw new NotFoundError();

    await writeAuditLog(db, {
      action: ENGINEER_AUDIT_ACTIONS.view,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'Engineer',
      targetId: row.id,
      // 🔴 PII を載せない（`AuditSummary` の規約）。経路の区別だけを残す。
      summary: { via: 'EDIT_FORM' },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

    const skills = await db.engineerSkill.findMany({
      where: { engineerId: row.id },
      select: {
        skillId: true,
        yearsOfExperience: true,
        level: true,
        skill: { select: { name: true } },
      },
      // 🔴 決定的な順序（同じ入力なら同じ並び。docs/05 §4.8）。
      orderBy: [{ skillId: 'asc' }],
    });

    return {
      id: row.id,
      displayName: row.displayName,
      ownership: row.ownerPartnerCompanyId === null ? 'HOST' : 'PARTNER',
      availability: row.availability as EngineerAvailability,
      availableFrom: toDateOnlyString(row.availableFrom),
      unitPriceMin: decimalToNumber(row.unitPriceMin),
      unitPriceMax: decimalToNumber(row.unitPriceMax),
      prefecture: row.prefecture as PrefectureCode | null,
      remoteMode: row.remoteMode as RemoteMode | null,
      preferenceNote: row.preferenceNote,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      skills: skills.map((entry) => ({
        skillId: entry.skillId,
        name: entry.skill.name,
        yearsOfExperience: Number(entry.yearsOfExperience.toString()),
        level: entry.level,
      })),
    };
  });
}

/** `S-007` のスキル選択に渡す辞書（`F-010`。読み取り専用）。 */
export type SkillDictionaryEntry = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
};

/**
 * グローバルなスキル辞書を読む（`F-008` 処理② / `F-010 AC-2`）。
 * 🔴 `GET /api/skills`（#23。T-05-03）はこの一覧を API として出すが、`S-007` は
 *    サーバコンポーネントから直接読む（自己 fetch しない。既存画面と同じ方針）。
 * 🔴 並びは `sortKey` 昇順（docs/05 §3.4 の「決定的なタイブレーク」）。
 */
export async function listSkillDictionary(
  ctx: AuthenticatedTenantCtx,
): Promise<readonly SkillDictionaryEntry[]> {
  return withTenant(ctx, (db) =>
    db.skill.findMany({
      select: { id: true, name: true, category: true },
      orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
    }),
  );
}
