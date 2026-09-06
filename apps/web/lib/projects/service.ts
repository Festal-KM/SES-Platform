// apps/web/lib/projects/service.ts
// 案件の登録・編集（docs/05 §6.4 #26。`F-013` / `S-012`）。T-06-01。
//
// 🔴 **`F-013 AC-1` の中核は「必須（`MUST`）と尚可（`NICE`）が別区分として保持されること」**である。
//    区分は `project_requirements.kind`（CHECK 付き）で持ち、`F-020` の整合層と `F-029` の足切りが
//    **区分だけを見て**照合できる形にする。順序・フラグ・命名規約で代用しない。
//
// 🔴 **商流情報（`endClientName` / `internalUnitPrice`）はここでは「保持するだけ」である**
//    （`F-013` 処理②）。公開範囲の相手に出さない担保は**取得時の射影**（T-06-02 の
//    `PartnerProjectDetailView`。docs/05 §6.4 #27）であり、本モジュールは書き込み経路として
//    列を持つ。🔴 **監査ログの `summary` には値を載せない**（docs/05 §16.2「単価・エンド企業名を
//    入れない」）—— 載せると運営者の横断検索（`F-058`）から商流情報が読めてしまう。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストがサーバを
//    立てずに同じ経路を実行できるようにするため（`engineers/service.ts` と同じ方針）。
import {
  requireHost,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type ProjectStatus,
  type RemoteMode,
  type RequirementKind,
} from '@ses/db';
import type { PrefectureCode } from '@ses/domain';
import { NotFoundError, ValidationError } from '../api/errors';
import { decimalToNumber, toDateOnly, toDateOnlyString } from '../format/db-values';
import type {
  CreateProjectBody,
  ProjectRequirementInput,
  UpdateProjectBody,
} from './schemas';

/**
 * docs/05 §16.1 の `*.create` / `*.update` と `project.view`（`BR-27` の 11 種）。
 * 🔴 独自の action 名を作らない（`S-041` の操作種別フィルタは接尾辞一致であり、
 *    `project.register` のような名前を作ると**記録されているのに検索で出てこない**）。
 */
export const PROJECT_AUDIT_ACTIONS = {
  create: 'project.create',
  update: 'project.update',
  /**
   * 🔴 `BR-27`「案件詳細の閲覧」/ `F-013 AC-3`。docs/05 §16.1 はフック箇所を `#27`
   *    （`GET /api/projects/{id}`。T-06-02）としているが、**`S-012`（編集フォーム）の
   *    初期値読み取りも同じ action で記録する**（T-06-01）。
   *    `engineer.view` の `EDIT_FORM` と同じ判断であり、理由も同じ:
   *      ①編集フォームは詳細と同じ内容（要件・条件・**商流情報**）を画面に出す
   *      ②`project.detail_view` のような別 action を作ると `S-041` の操作種別フィルタ
   *        （接尾辞一致）から漏れ、**記録されているのに検索で出てこない**
   *    経路の違いは `summary.via` にだけ残す。
   */
  view: 'project.view',
} as const;

/**
 * `project.view` の `summary.via`。
 * 🔴 T-06-01 の時点で存在する経路は編集フォームだけである。**`DETAIL`（`S-011` / `#27`）は
 *    T-06-02 が足す** —— 動かせない値を先回りで宣言しない（`ENGINEER_VIEW_VIA` と同じ規律）。
 */
export const PROJECT_VIEW_VIA = {
  /** `S-012` 編集フォームの初期値読み取り。 */
  editForm: 'EDIT_FORM',
} as const;

export type ProjectViewVia = (typeof PROJECT_VIEW_VIA)[keyof typeof PROJECT_VIEW_VIA];

/** 監査ログに残す実行環境（`withApiRoute` の `audit` と同じ値。画面経路は自前で渡す）。 */
export type ProjectViewMeta = {
  readonly ipAddress: string | null;
};

export type ProjectRequirementView = {
  readonly kind: RequirementKind;
  readonly skillId: string | null;
  /** 辞書名（`skillId` が `null` のときは `null`）。 */
  readonly skillName: string | null;
  readonly freeText: string | null;
  readonly requiredYears: number | null;
};

/**
 * `S-012`（登録・編集）が必要とする項目。
 *
 * 🔴 **これはホスト専用の view である**（`docs/04` §S-012 権限差分「取引先・`VIEWER` は
 *    到達できない」）。商流情報（`endClientName` / `internalUnitPrice`）を含むため、
 *    **パートナー向けの応答型として流用してはならない**。パートナー向けの
 *    `PartnerProjectDetailView`（商流フィールドを**型として持たない**）は T-06-02 が定義する
 *    （docs/05 §6.4 #27 / `docs/sprints/SP-06` T-06-02）。
 */
export type ProjectEditView = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly headcount: number;
  /** `YYYY-MM-DD` または `null`。 */
  readonly startDate: string | null;
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly prefecture: PrefectureCode | null;
  readonly remoteMode: RemoteMode | null;
  /** 🔴 内部限定（`F-013 AC-2`）。 */
  readonly endClientName: string | null;
  /** 🔴 内部限定（同上）。 */
  readonly internalUnitPrice: number | null;
  readonly publicSummary: string | null;
  readonly requirements: readonly ProjectRequirementView[];
};

/**
 * 🔴 単価レンジの大小関係（`docs/04` §S-012 セクション 4 の 2 値入力）。
 *    境界の Zod ではなくここで見る理由は `engineers/service.ts` と同じ 2 点:
 *    ①`.refine()` をトップレベルに使えない ②PATCH は既存値と合成しないと判定できない。
 */
function assertUnitPriceRange(min: number | null, max: number | null): void {
  if (min !== null && max !== null && min > max) {
    throw new ValidationError(['body.unitPriceMax']);
  }
}

/**
 * 入力の要件集合を検証して返す。
 *
 * 🔴 **実体の無い要件を保存しない**: `skillId` も `freeText` も無い行は、画面上は空行だが
 *    DB では「区分だけを持つ要件」になる。`F-029` の足切りは `MUST` を数えるため、
 *    空行が 1 件でも混ざると**満たしようのない案件**ができあがる。400 で弾く。
 * 🔴 **同じスキルを 2 回置かせない**（区分をまたいでも同じ）。`MUST` と `NICE` の両方に
 *    同じ `skillId` があると、`F-020` の整合層と `F-029` の足切りが**同じスキルについて
 *    別々の結論**を出しうる（必須なのか加点なのかが決まらない）。区分の意味そのものが壊れるため、
 *    黙って後勝ちで畳まずに 400 にする（`normalizeSkills` と同じ判断）。
 *    ⚠️ `freeText` の重複は弾かない（自由記述は言い換えが正常であり、機械的な照合対象でもない）。
 */
function normalizeRequirements(
  requirements: readonly ProjectRequirementInput[],
): readonly ProjectRequirementInput[] {
  const seenSkillIds = new Set<string>();
  for (const requirement of requirements) {
    if (requirement.skillId === null && requirement.freeText === null) {
      throw new ValidationError(['body.requirements']);
    }
    if (requirement.skillId !== null) {
      if (seenSkillIds.has(requirement.skillId)) {
        throw new ValidationError(['body.requirements']);
      }
      seenSkillIds.add(requirement.skillId);
    }
  }
  return requirements;
}

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使うデリゲートだけ。 */
type ProjectDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * 🔴 指定された `skillId` が**グローバル辞書に実在すること**を確かめる（`F-010`）。
 *    実在しない ID を許すと、FK 違反（`project_requirements_skill_id_fkey`）が 500 になって
 *    「入力の誤り」が障害に見える（`assertSkillsExist`（エンジニア側）と同じ扱い）。
 */
async function assertRequirementSkillsExist(
  db: ProjectDb,
  requirements: readonly ProjectRequirementInput[],
): Promise<void> {
  const ids = [
    ...new Set(
      requirements
        .map((requirement) => requirement.skillId)
        .filter((skillId): skillId is string => skillId !== null),
    ),
  ];
  if (ids.length === 0) return;
  const found = await db.skill.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new ValidationError(['body.requirements']);
}

function requirementRows(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  requirements: readonly ProjectRequirementInput[],
) {
  return requirements.map((requirement) => ({
    // 🔴 テナントキーは第 2 防御が確定させるが、Prisma の型が必須列として要求するため明示する。
    tenantId: ctx.tenantId,
    projectId,
    kind: requirement.kind,
    skillId: requirement.skillId,
    freeText: requirement.freeText,
    requiredYears: requirement.requiredYears,
  }));
}

/**
 * `POST /api/projects`（#26）。
 *
 * 🔴 監査は `withApiRoute` の `audit` オプション（`project.create`）が**ハンドラの前に**書く
 *    （docs/05 §6.1 / §16.1）。記録に失敗したらこの関数は呼ばれない。
 * 🔴 **`originAssignmentId` を書かない。** 人手で作る案件に「生成元の稼働」は無い。
 *    後任募集の自動生成（`F-045` / SP-16）だけがこの列を書く（`schemas.ts` の注記）。
 */
export async function createProject(
  ctx: AuthenticatedTenantCtx,
  input: CreateProjectBody,
): Promise<{ readonly id: string }> {
  assertUnitPriceRange(input.unitPriceMin, input.unitPriceMax);
  const requirements = normalizeRequirements(input.requirements);

  return withTenant(ctx, async (db) => {
    await assertRequirementSkillsExist(db, requirements);

    const created = await db.project.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        status: input.status,
        headcount: input.headcount,
        startDate: toDateOnly(input.startDate),
        unitPriceMin: input.unitPriceMin,
        unitPriceMax: input.unitPriceMax,
        prefecture: input.prefecture,
        remoteMode: input.remoteMode,
        endClientName: input.endClientName,
        internalUnitPrice: input.internalUnitPrice,
        publicSummary: input.publicSummary,
      },
      select: { id: true },
    });

    if (requirements.length > 0) {
      await db.projectRequirement.createMany({
        data: requirementRows(ctx, created.id, requirements),
      });
    }

    // 🔴 公開範囲（`ProjectVisibility`）の行はここで 1 件も作らない（`F-014 AC-2`
    //    「既定は誰にも公開されない」）。公開は `PUT /api/projects/{id}/visibility`（#28。
    //    T-06-06）の明示的な操作だけが行う。**「作成時に既定で公開」を絶対に作らない。**
    return { id: created.id };
  });
}

/**
 * `PATCH /api/projects/{id}`（#26）。
 *
 * 🔴 `update` ではなく `updateMany` を使う（`updateEngineer` と同じ理由）。スコープは
 *    第 2 防御が注入した `where` と RLS（C2 の UPDATE）が決め、アプリは `id` 以外の条件を
 *    書かない。更新が 0 件なら 404（境界外と不存在を区別しない。docs/05 §4.8）。
 *
 * 🔴 **`data` に `originAssignmentId` を 1 度も載せない。** `F-045` の還流が作った後任募集を
 *    人が編集しても、生成元の記録が消えない（`schemas.ts` の注記の担保②）。
 *
 * 🔴 `requirements` を指定したときは**その集合で置き換える**（差分適用にしない）。`S-012` は
 *    必須 / 尚可の 2 ブロックを丸ごと編集する画面であり、差分にすると「画面から消した行が
 *    消えない」ずれが出る（`updateEngineer` の `skills` と同じ）。
 */
export async function updateProject(
  ctx: AuthenticatedTenantCtx,
  id: string,
  patch: UpdateProjectBody,
): Promise<{ readonly id: string }> {
  const requirements =
    patch.requirements === undefined ? undefined : normalizeRequirements(patch.requirements);

  return withTenant(ctx, async (db) => {
    const current = await db.project.findFirst({
      where: { id },
      select: { id: true, unitPriceMin: true, unitPriceMax: true },
    });
    if (current === null) throw new NotFoundError();

    // 🔴 単価レンジは**更新後の値**で判定する（片方だけ更新できるため、既存値と合成する）。
    assertUnitPriceRange(
      patch.unitPriceMin === undefined ? decimalToNumber(current.unitPriceMin) : patch.unitPriceMin,
      patch.unitPriceMax === undefined ? decimalToNumber(current.unitPriceMax) : patch.unitPriceMax,
    );
    if (requirements !== undefined) await assertRequirementSkillsExist(db, requirements);

    // 🔴 `data` に載せてよい列の**唯一の一覧**。`tenantId` / `originAssignmentId` は
    //    ここに現れない（現れないことをレビューで数えられる形にしておく）。
    const data = {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.headcount === undefined ? {} : { headcount: patch.headcount }),
      ...(patch.startDate === undefined ? {} : { startDate: toDateOnly(patch.startDate) }),
      ...(patch.unitPriceMin === undefined ? {} : { unitPriceMin: patch.unitPriceMin }),
      ...(patch.unitPriceMax === undefined ? {} : { unitPriceMax: patch.unitPriceMax }),
      ...(patch.prefecture === undefined ? {} : { prefecture: patch.prefecture }),
      ...(patch.remoteMode === undefined ? {} : { remoteMode: patch.remoteMode }),
      ...(patch.endClientName === undefined ? {} : { endClientName: patch.endClientName }),
      ...(patch.internalUnitPrice === undefined
        ? {}
        : { internalUnitPrice: patch.internalUnitPrice }),
      ...(patch.publicSummary === undefined ? {} : { publicSummary: patch.publicSummary }),
    };

    if (Object.keys(data).length > 0) {
      const updated = await db.project.updateMany({ where: { id }, data });
      // 🔴 直前に見えていた行が消えている（並行削除）。0 件を成功にしない。
      if (updated.count !== 1) throw new NotFoundError();
    }

    if (requirements !== undefined) {
      await db.projectRequirement.deleteMany({ where: { projectId: id } });
      if (requirements.length > 0) {
        await db.projectRequirement.createMany({ data: requirementRows(ctx, id, requirements) });
      }
    }

    return { id };
  });
}

/**
 * 要件を**決定的な順序**で読む（docs/05 §4.8）。
 * 🔴 並びは `kind`（`MUST` → `NICE`）→ `skillId`（NULL 最後）→ `id`。同じ入力なら同じ並びになる。
 *    画面の 2 ブロック（必須 / 尚可）は `kind` で分けるため、ここでの `kind` 昇順は
 *    「必須が先」を保つためではなく、**取得の順序を 1 つに決める**ためである。
 */
async function readProjectRequirements(
  db: ProjectDb,
  projectId: string,
): Promise<readonly ProjectRequirementView[]> {
  const rows = await db.projectRequirement.findMany({
    where: { projectId },
    select: {
      id: true,
      kind: true,
      skillId: true,
      freeText: true,
      requiredYears: true,
      skill: { select: { name: true } },
    },
    orderBy: [{ kind: 'asc' }, { skillId: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    kind: row.kind as RequirementKind,
    skillId: row.skillId,
    skillName: row.skill === null ? null : row.skill.name,
    freeText: row.freeText,
    requiredYears: row.requiredYears === null ? null : Number(row.requiredYears.toString()),
  }));
}

/**
 * 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-013 AC-3`）。
 *
 * 🔴 記録は**業務トランザクションの内側**（`writeAuditLog`）で書く。書けなければトランザクション
 *    ごと巻き戻り、**内容は返らない**（`recordEngineerView` と同じ規律）。`withApiRoute` の
 *    `audit` オプションを使わないのは ①画面（サーバコンポーネント）は Route Handler を通らない
 *    ため、ルート側に置くと**画面経路だけ記録が漏れる** ②`audit` はハンドラの前に別トランザクション
 *    で書くため、**404（境界外・不存在）でも「閲覧した」記録が残る** の 2 点による。
 * 🔴 `summary` に**案件名・エンド企業名・単価を載せない**（docs/05 §16.2）。残すのは経路だけである。
 */
async function recordProjectView(
  db: ProjectDb,
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  via: ProjectViewVia,
  meta: ProjectViewMeta,
): Promise<void> {
  await writeAuditLog(db, {
    action: PROJECT_AUDIT_ACTIONS.view,
    actorKind: 'USER',
    actorId: ctx.userId,
    targetType: 'Project',
    targetId: projectId,
    summary: { via },
    ipAddress: meta.ipAddress,
    deviceKind: ctx.deviceKind,
  });
}

/**
 * `S-012`（編集）が初期値を読む経路。T-06-01。
 *
 * 🔴 **境界外・不存在はどちらも 404**（docs/05 §4.8）。母集団を絞るのは `projects` の RLS
 *    （C4。ホストは全件、パートナーは公開された案件のみ）であり、ここに `where` を足さない。
 * 🔴 **`requireHost` でパートナー文脈を締め出す。** この view は商流情報
 *    （`endClientName` / `internalUnitPrice`）を含むホスト専用の型であり、`projects` の RLS は
 *    C4（**公開済みの案件はパートナーにも見える**）なので、**RLS だけではこの関数の安全性は
 *    保証されない**。呼び出し元（`S-012`）は `PROJECT_EDITOR_ROLES` で絞っているが、
 *    それは 1 層目に過ぎない。`HostOnlyContextError` は API 境界で **404** に写像される
 *    （`lib/api/errors.ts`）ので、誤った経路が生えても商流情報は 1 バイトも出ない。
 *    ⚠️ パートナー向けの `PartnerProjectDetailView`（商流フィールドを**型として持たない**）は
 *    T-06-02 が別に定義する（docs/05 §6.4 #27）。**この関数を流用しない。**
 * 🔴 見えない行の「閲覧」は無いので、404 のときは記録も残さない。
 */
export async function readProjectForEdit(
  ctx: AuthenticatedTenantCtx,
  id: string,
  meta: ProjectViewMeta,
): Promise<ProjectEditView> {
  requireHost(ctx);
  return withTenant(ctx, async (db) => {
    const row = await db.project.findFirst({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        headcount: true,
        startDate: true,
        unitPriceMin: true,
        unitPriceMax: true,
        prefecture: true,
        remoteMode: true,
        endClientName: true,
        internalUnitPrice: true,
        publicSummary: true,
      },
    });
    if (row === null) throw new NotFoundError();

    await recordProjectView(db, ctx, row.id, PROJECT_VIEW_VIA.editForm, meta);

    return {
      id: row.id,
      name: row.name,
      status: row.status as ProjectStatus,
      headcount: row.headcount,
      startDate: toDateOnlyString(row.startDate),
      unitPriceMin: decimalToNumber(row.unitPriceMin),
      unitPriceMax: decimalToNumber(row.unitPriceMax),
      prefecture: row.prefecture as PrefectureCode | null,
      remoteMode: row.remoteMode as RemoteMode | null,
      endClientName: row.endClientName,
      internalUnitPrice: decimalToNumber(row.internalUnitPrice),
      publicSummary: row.publicSummary,
      requirements: await readProjectRequirements(db, row.id),
    };
  });
}

/**
 * 監査ログに残す要件の件数（🔴 内容ではなく**区分ごとの件数**だけ。docs/05 §16.2）。
 * `F-013 AC-1` の区分が保存されたことを、記録の側からも後追いできるようにする。
 */
export function requirementCounts(
  requirements: readonly ProjectRequirementInput[] | undefined,
): { readonly mustCount: number | null; readonly niceCount: number | null } {
  if (requirements === undefined) return { mustCount: null, niceCount: null };
  return {
    mustCount: requirements.filter((requirement) => requirement.kind === 'MUST').length,
    niceCount: requirements.filter((requirement) => requirement.kind === 'NICE').length,
  };
}
