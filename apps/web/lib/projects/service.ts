// apps/web/lib/projects/service.ts
// 案件の登録・編集（docs/05 §6.4 #26。`F-013` / `S-012`）。T-06-01。
//
// 🔴 **`F-013 AC-1` の中核は「必須（`MUST`）と尚可（`NICE`）が別区分として保持されること」**である。
//    区分は `project_requirements.kind`（CHECK 付き）で持ち、`F-020` の整合層と `F-029` の足切りが
//    **区分だけを見て**照合できる形にする。順序・フラグ・命名規約で代用しない。
//
// 🔴 **商流情報（`endClientName` / `internalUnitPrice`）を公開範囲の相手に出さない担保は
//    「取得時の射影」である**（`F-013 AC-2`。T-06-02 で `readProjectDetail` が実装した）:
//    パートナー文脈の `select`（`PARTNER_PROJECT_DETAIL_SELECT`）に 2 列が現れないため、
//    SQL としても取得しておらず、応答型（`PartnerProjectDetailView`）にもフィールドが無い。
//    **取得してから隠す経路を 1 つも作らない。**
//    🔴 **監査ログの `summary` には値を載せない**（docs/05 §16.2「単価・エンド企業名を
//    入れない」）—— 載せると運営者の横断検索（`F-058`）から商流情報が読めてしまう。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストがサーバを
//    立てずに同じ経路を実行できるようにするため（`engineers/service.ts` と同じ方針）。
import {
  // 🔴 T-12-10: 未消費の `RECHECK` 要求の有無（`#26` の積み直し。docs/05 §11.11 ③ 5-②）。
  hasPendingProjectRecheck,
  projectPublicContent,
  // 🔴 T-12-10: 要件のフリーテキストの**唯一の読み取り順序**（ハッシュ側と同じ 1 実装）。
  readProjectRequirementTexts,
  requireHost,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type ProjectStatus,
  type RemoteMode,
  type RequirementKind,
  type ProjectCategory,
  type ProjectSourceKind,
} from '@ses/db';
import {
  projectPublicFieldsChanged,
  type PrefectureCode,
  type ProjectPublicFieldValues,
  type ProjectPublishStateView,
} from '@ses/domain';
import { NotFoundError, ProjectNotSharedError, ValidationError } from '../api/errors';
import { toJstIsoDay } from '../format/datetime';
import { decimalToNumber, toDateOnly, toDateOnlyString } from '../format/db-values';
import type { ProjectPublishGate } from './publish-gate';
// 🔴 T-12-10: 公開の状態（4 値）の materialize。**ホストの枝でだけ**呼ぶ。
import { readProjectPublishState } from './publish-state';
import type {
  CreateProjectBody,
  ProjectMutationView,
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
 * 🔴 経路の違いは**ここにだけ**残す（action 名を分けない。`S-041` の操作種別フィルタは
 *    接尾辞一致であり、`project.detail_view` のような名前は検索から漏れる）。
 */
export const PROJECT_VIEW_VIA = {
  /** `S-012` 編集フォームの初期値読み取り（T-06-01）。 */
  editForm: 'EDIT_FORM',
  /** `S-011` 案件詳細 / `GET /api/projects/{id}`（#27。T-06-02）。 */
  detail: 'DETAIL',
  /**
   * 🔴 `S-013` 公開範囲の設定（T-06-06）。**同じ内容を出すので同じ action で記録する。**
   *    `S-013` は公開時の見え方をプレビューするために、案件の要件・条件・外部公開用の記載に加えて
   *    **商流情報**（混入の警告を出すため。`lib/projects/publish-preview.ts`）まで読む。
   *    `S-012` の編集フォームを `EDIT_FORM` として記録したのと**同じ理由**であり、
   *    ここだけ記録しないと「誰が案件の中身を見たか」に穴があく（`BR-27` / `F-013 AC-3`）。
   */
  visibility: 'VISIBILITY',
  /**
   * 🔴 `S-016` 候補一覧 / `GET /api/projects/{id}/candidates`（#30。T-08-05）。
   *    `docs/03` §4.13.2-5「ホストによる匿名候補一覧の閲覧を `AuditLog` に記録する」の実装であり、
   *    同時に案件の要件サマリ（セクション 1）を読む記録でもある。**独自 action を作らない**
   *    （`S-041` の `PROJECT_VIEW` から漏れる）。🔴 `summary` は `via` だけ ——
   *    匿名候補の件数・`engineer_id`・参照子を載せない（運営者が横断検索する。`CLAUDE.md` §10.5）。
   */
  candidates: 'CANDIDATES',
  /**
   * 🔴 `S-018` 提案依頼の詳細（取引先。T-08-07）と `#33`（応諾）。取引先が依頼の案件の要件・条件を読む記録
   *    （`readProjectCandidateContext` で共通部分だけを読む。商流情報は `select` に無い）。**独自 action を
   *    作らない**（`S-041` の `PROJECT_VIEW` から漏れる）。自社に公開されていない案件は読めないので記録も無い。
   */
  proposalRequest: 'PROPOSAL_REQUEST',
} as const;

export type ProjectViewVia = (typeof PROJECT_VIEW_VIA)[keyof typeof PROJECT_VIEW_VIA];

/** 監査ログに残す実行環境（`withApiRoute` の `audit` と同じ値。画面経路は自前で渡す）。 */
export type ProjectViewMeta = {
  readonly ipAddress: string | null;
};

/**
 * `#27` / `S-011` / `S-013` が渡す実行環境。
 * 🔴 T-12-10: 公開の状態（`publishState`）は保留の再開時刻（`GateHeldView.resetAt` = 暦の計算）を
 *    含むため、**現在時刻を呼び出し側から受け取る**（`packages/domain` と同じ規律。既定値を持たない）。
 */
export type ProjectDetailMeta = ProjectViewMeta & {
  readonly now: Date;
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
 *    **パートナー向けの応答型として流用してはならない**。パートナーが読むのは
 *    `PartnerProjectDetailView`（商流フィールドを**型として持たない**。本ファイル下部）だけである。
 */
export type ProjectEditView = {
  readonly upperCompanyName: string | null;
  readonly endDate: string | null;
  readonly distributionLimit: string | null;
  readonly assigneeUserId: string | null;
  readonly developmentPhases?: readonly string[];
  readonly developmentMethod?: string | null;
  readonly utilizationRate?: number | null;
  readonly locationDetail: string | null;
  readonly publicMemo: string | null;
  readonly remarks: string | null;
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
  /**
   * ✅✅ **2026-10-16（受領モック + [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)）:
   *    カテゴリ / 案件区分 / 並行可否。**
   * 🔴 **絞り込みを足したら、同じ項目を書ける経路も足す**（`schemas.ts` の 🔴）。
   * 🔴 **内部限定ではない**（`endClientName` / `internalUnitPrice` と違い、公開しても商流は漏れない）。
   */
  readonly category: ProjectCategory | null;
  readonly sourceKind: ProjectSourceKind;
  readonly parallelOk: boolean | null;
  /** 🔴 内部限定（`F-013 AC-2`）。 */
  readonly endClientName: string | null;
  /** 🔴 内部限定（同上）。 */
  readonly internalUnitPrice: number | null;
  readonly publicSummary: string | null;
  readonly requirements: readonly ProjectRequirementView[];
  /**
   * 🔴 T-12-10（`F-014 AC-6` / `docs/04` 改訂 14 §S-012）: **現在公開中の取引先の社数**。
   *    `S-012` の事前表示（「この案件は N 社に公開中です。3 欄を変更して保存すると再検査が
   *    実行されます」）の材料であり、**0 なら帯を出さない**（再検査が走らない画面に出すと
   *    「何も起きない警告」に慣れてしまう）。
   * 🔴 **ホスト専用の view にだけある**（`S-012` はホスト専用。`F-014 AC-4` / `BR-07`）。
   */
  readonly publishedToCount: number;
};

// ============================================================================
// 🔴 `GET /api/projects/{id}`（#27）/ `S-011` の応答型 —— **ホストと取引先で型が違う**
// ============================================================================
// `F-013 AC-2` / `F-014 AC-3` / `docs/sprints/SP-06` T-06-02:
//   「エンド企業名と内部単価は、公開範囲に含まれる相手の画面・エクスポート・通知のいずれにも
//    表示されない」。担保は **`undefined` を返すこと**ではなく **型が違うこと**である
//   （docs/05 §4.8 の `PartnerProposalView` / `HostProposalView` と同じ思想）。
// 🔴 さらに `F-014 AC-4` / `BR-07`:「公開先パートナーは、同じ案件に公開されている他のパートナーの
//    社名・件数を知る手段を持たない」。したがって `PartnerProjectDetailView` は
//    `visibilities` / `visibleToCount` に相当するフィールドも**型として**持たない。

/** ホスト・取引先の双方に出す項目（`docs/04` §S-011 のセクション 1〜3）。 */
export type ProjectDetailShared = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly headcount: number;
  /** `YYYY-MM-DD` または `null`。 */
  readonly startDate: string | null;
  /**
   * 🔴 **外部公開用の単価レンジ**（`docs/04` §S-011 取引先セクション 3「外部公開用の単価レンジのみ」）。
   *    内部限定の `internalUnitPrice`（自社単価）とは**別の列**である（`docs/05` §3.5）。
   */
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly prefecture: PrefectureCode | null;
  readonly remoteMode: RemoteMode | null;
  /**
   * ⚠️ **2026-10-16: カテゴリ / 案件区分 / 並行可否はこの型に入れていない。**
   *    受領モックの**案件詳細パネル**には出ているが、今回の指示は「検索部分」であり、
   *    **画面が描かないものを型に持たせない**（詳細への追加は別タスク。
   *    [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)）。
   *    編集フォーム（`ProjectEditView`）には入っている —— 絞り込みに使う列を**書ける経路**が
   *    1 本も無いと、画面からは永久に空のままになるためである。
   */
  /** 🔴 公開時に外へ出るのはこの列だけである（`docs/05` §3.5）。 */
  readonly publicSummary: string | null;
  readonly requirements: readonly ProjectRequirementView[];
};

/** `S-011` セクション 5（ホストのみ）の公開先 1 件。 */
export type ProjectVisibilityView = {
  readonly partnerCompanyId: string;
  readonly partnerCompanyName: string;
  /** 公開日（`YYYY-MM-DD`。JST の暦日）。 */
  readonly publishedOn: string;
};

/**
 * ホスト向けの案件詳細（`docs/04` §S-011 のセクション 1〜6）。
 * 🔴 商流情報（`endClientName` / `internalUnitPrice`）と公開範囲を**ここにだけ**置く。
 */
export type HostProjectDetailView = ProjectDetailShared & {
  readonly audience: 'HOST';
  /** 🔴 内部限定（`F-013 AC-2`）。 */
  readonly endClientName: string | null;
  /** 🔴 内部限定（同上）。 */
  readonly internalUnitPrice: number | null;
  /** 現在の公開先（解除済みは含まない）。`docs/04` §S-011 セクション 5。 */
  readonly visibilities: readonly ProjectVisibilityView[];
  /**
   * 🔴 T-12-10: 公開の状態（**4 値の判別可能な合併**。`docs/04` §S-011 / `F-014 AC-9` / `AC-12`）。
   *
   * 🔴 **`revocation`（自動解除）と `held`（再検査の保留）は別の枝の別フィールドである** ——
   *    画面は前者で「公開を解除しました（今すぐ直す）」、後者で「公開は維持されています（待つ）」と
   *    **逆のこと**を書く。型としてどちらか一方しか読めない。
   * 🔴 **指摘の本文をここに載せない**（原因の欄は 3 値の閉集合のコードだけ。本文は `S-013`
   *    セクション 4 でのみ読む）。
   */
  readonly publishState: ProjectPublishStateView;
};

/**
 * 取引先向けの案件詳細（`docs/04` §S-011 の取引先セクション 1〜3・5）。
 *
 * 🔴 **商流情報のフィールドが「存在しない」。** `?: never` を置くのは、うっかり値を入れた実装が
 *    **コンパイルで落ちる**ようにするためである（docs/05 §6.4 #14 の `ProductionInvitationView`
 *    の `inviteUrl?: never` と同じ手法）。単に omit すると、判別可能な合併の枝を取り違えたときに
 *    「余剰プロパティ検査をすり抜ける経路」が残る。
 * 🔴 **他社の存在を示すフィールドも同じ扱い**（`F-014 AC-4` / `BR-07` / `docs/04` §3.2
 *    「`S-011` の案件詳細に『公開先: 3 社』を出さない」）。件数・社名・「他 N 件」のいずれも無い。
 */
export type PartnerProjectDetailView = ProjectDetailShared & {
  readonly audience: 'PARTNER';
  readonly endClientName?: never;
  readonly internalUnitPrice?: never;
  readonly visibilities?: never;
  readonly visibleToCount?: never;
  /**
   * 🔴 T-12-10（`F-014 AC-10`）: **取引先向けの応答は 1 バイトも変わらない。**
   *    自動解除の事実・理由・原因の欄・ゲート結果・再検査の保留を**型として持たない**。
   *    公開が落ちた案件は既存の「公開解除された案件を開いたとき」の扱い（`ProjectNotSharedError`。
   *    HTTP は 404 のまま）に合流し、**はじめから公開されていない案件と区別がつかない**。
   */
  readonly publishState?: never;
  readonly revokedReason?: never;
  readonly revokedAt?: never;
  readonly gateResult?: never;
};

/** `#27` の応答（🔴 判別子は `audience`）。 */
export type ProjectDetailView = HostProjectDetailView | PartnerProjectDetailView;

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

// ============================================================================
// ✅✅ 2026-10-16: 案件サマリの「基本情報」に足した項目の、項目をまたぐ検証
//     （migration 20261016040000。人間の明示指示の 19 項目）
// ============================================================================
/**
 * 🔴 **精算幅の大小関係**（`140〜180h` の 2 値入力）。
 *    理由は `assertUnitPriceRange` と同じ 2 点（`.refine()` をトップレベルに使えない /
 *    PATCH は既存値と合成しないと判定できない）。
 */
function assertSettlementRange(min: number | null, max: number | null): void {
  if (min !== null && max !== null && min > max) {
    throw new ValidationError(['body.settlementMaxHours']);
  }
}

/**
 * 🔴 **終了時期は開始時期より前にできない。**
 *    ⚠️ **同じ日は許す**（1 日だけの稼働は業務上ありうる）。
 *    🔴 どちらかが未設定なら判定しない（「開始は決まっているが終わりは未定」が正常である）。
 */
function assertProjectPeriod(startDate: string | null, endDate: string | null): void {
  if (startDate !== null && endDate !== null && endDate < startDate) {
    throw new ValidationError(['body.endDate']);
  }
}

/**
 * 🔴 **担当者はそのテナントに実在する利用者でなければならない**（docs/05 §6.4 #14 の条件②
 *    「指定された ID を `withTenant` の内側で母集団に照合してから使う」）。
 *
 * 🔴 **母集団は `users` の RLS が決める** —— ここに `tenantId` の条件を書かない。
 *    他テナントの利用者 ID を指定しても、この `findFirst` が 0 件になって 400 になる
 *    （FK 違反の 500 にしない。`assertRequirementSkillsExist` と同じ形）。
 * 🔴 **パートナー所属の利用者も弾く。** 担当者は「自社（ホスト）の営業」であり、
 *    取引先の担当者を自社案件の担当にはできない（`owner_partner_company_id IS NULL`）。
 */
async function assertAssigneeExists(
  db: Parameters<Parameters<typeof withTenant<void>>[1]>[0],
  assigneeUserId: string | null,
): Promise<void> {
  if (assigneeUserId === null) return;
  const found = await db.user.findFirst({
    where: { id: assigneeUserId, ownerPartnerCompanyId: null, disabledAt: null },
    select: { id: true },
  });
  if (found === null) throw new ValidationError(['body.assigneeUserId']);
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
): Promise<ProjectMutationView> {
  assertUnitPriceRange(input.unitPriceMin, input.unitPriceMax);
  // ✅✅ 2026-10-16: 足した項目の、項目をまたぐ検証（精算幅の逆転 / 終了 < 開始）。
  assertSettlementRange(input.settlementMinHours, input.settlementMaxHours);
  assertProjectPeriod(input.startDate, input.endDate);
  const requirements = normalizeRequirements(input.requirements);

  return withTenant(ctx, async (db) => {
    await assertRequirementSkillsExist(db, requirements);
    // 🔴 担当者は母集団（`users` の RLS）に照合してから使う（他テナント・取引先所属は 400）。
    await assertAssigneeExists(db, input.assigneeUserId);

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
        // ✅ 2026-10-16（受領モック + Issue #113）。
        category: input.category,
        sourceKind: input.sourceKind,
        parallelOk: input.parallelOk,
        // ✅✅ 2026-10-16: 案件サマリの「基本情報」の 9 項目（migration 20261016040000）。
        // 🔴 **`copySummary` を書かない。** 人間の指示は「案件登録時に生成される」だが、
        //    **生成した文面を行に焼き付けない** —— 焼き付けると、案件を直してもサマリだけ
        //    古いまま残り、どちらが正しいか誰も判断できなくなる。画面は値から毎回組み、
        //    **人が書き換えたときだけ**この列に入る（`copy-summary.ts` の 🔴 / migration ⑦）。
        upperCompanyName: input.upperCompanyName,
        endDate: toDateOnly(input.endDate),
        settlementMinHours: input.settlementMinHours,
        settlementMaxHours: input.settlementMaxHours,
        paymentSiteDays: input.paymentSiteDays,
        distribution: input.distribution,
        distributionLimit: input.distributionLimit,
        assigneeUserId: input.assigneeUserId,
        endClientName: input.endClientName,
        internalUnitPrice: input.internalUnitPrice,
        publicSummary: input.publicSummary,
        developmentPhases: input.developmentPhases, developmentMethod: input.developmentMethod, utilizationRate: input.utilizationRate,
        locationDetail: input.locationDetail,
        publicMemo: input.publicMemo,
        remarks: input.remarks,
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
    // 🔴 T-12-10: したがって**新規作成が再検査の契機になることはない**（`NOT_PUBLISHED` 固定。
    //    docs/05 §6.4「#26 の実装の決着」）。`S-012` の新規登録では帯も出ない（`docs/04` §S-012）。
    return { id: created.id, recheck: { queued: false, reason: 'NOT_PUBLISHED' } };
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
 *
 * ============================================================================
 * 🔴 T-12-10: **公開中の案件で公開欄 3 欄が実際に変わった保存は、再検査の契機になる**
 * ============================================================================
 * （`F-014 AC-6`。[Issue #42](https://github.com/Festal-KM/SES-Platform/issues/42) = 回答②。
 *  docs/05 §11.11「T-12-10 の実装の決着」①③）
 *
 * 手順（業務トランザクションの内側 1〜5、コミット後に 6）:
 *   1. 更新の**前**に 3 欄の値を読む
 *   2. 更新を適用する（既存のとおり）
 *   3. 更新の**後**に同じ 3 欄を**読み直して**比較する（🔴 「保存した値」ではない ——
 *      要件は置き換えで `id` が振り直されるため、並び（`kind` → `id`）は書き込み後にしか
 *      確定しない。**ハッシュが覆う値と変更検知が見る値を同じ関数から取る**ことで、
 *      「検知は変わったと言うがハッシュは同じ」「その逆」を構造的に起こせなくする）
 *   4. 生きている公開範囲の行を数える。0 件なら `NOT_PUBLISHED`
 *   5. 3 欄が変わった **または** 未消費の `RECHECK` 要求が残っているなら、要求を置く
 *   6. コミット後に `gate.run` を積む（`enqueue` を**関数として返して順序を型で強制する**）
 *
 * 🔴 **`PROJECT_PUBLISH` の `contentHash` を契機にしない**（`projectPublicFieldsChanged`）。
 *    ハッシュは公開先の集合と取引先の社名まで含むので、**公開先を 1 社増やしただけで動く** ——
 *    それを契機にすると `AC-6`（3 欄が実際に変わったときに限る）に反し、AI 原価が無用に増える。
 * 🔴 **公開範囲の行はここで 1 行も動かさない。** 落とすのは `settleProjectPublish` だけである
 *    （`AC-13`。2 か所目を作ると、どちらか一方がゲート結果を見ない経路になる）。
 * 🔴 **`force` / `skipGate` / `keepPublished` に類する引数を持たない**（`BR-18` / `F-020 AC-2`。
 *    FAIL を「了解のうえ公開」できる操作・API・設定が存在しない）。
 */
export async function updateProject(
  ctx: AuthenticatedTenantCtx,
  id: string,
  patch: UpdateProjectBody,
  // 🔴 既定値を持たない（`updateProjectVisibility` と同じ）。「実装が入るまで保留するスタブ」を
  //    既定にすると、配線を忘れた経路が**静かに再検査を行わないまま成功を返す**
  //    （`CLAUDE.md` §11.1 の壊れ方 ＝ T-12-10 が塞ごうとしている穴そのもの）。
  deps: { readonly gate: ProjectPublishGate },
): Promise<ProjectMutationView> {
  const requirements =
    patch.requirements === undefined ? undefined : normalizeRequirements(patch.requirements);

  const { view, enqueue } = await withTenant(ctx, async (db) => {
    const current = await db.project.findFirst({
      where: { id },
      // 🔴 T-12-10: 3 欄のうち 2 欄（`name` / `publicSummary`）をここで読む（手順 1）。
      select: {
        id: true,
        unitPriceMin: true,
        unitPriceMax: true,
        name: true,
        publicSummary: true,
        publicMemo: true,
        developmentPhases: true, developmentMethod: true, utilizationRate: true,
        locationDetail: true,
        // ✅✅ 2026-10-16: 項目をまたぐ検証のために既存値を読む
        //    （精算幅の逆転 / 終了 < 開始。片方だけ更新できるため合成する）。
        startDate: true,
        endDate: true,
        settlementMinHours: true,
        settlementMaxHours: true,
      },
    });
    if (current === null) throw new NotFoundError();

    // 🔴 手順 1 の残り。ハッシュ側（`readProjectPublishGateHashInput`）と**同じ 1 実装・同じ順序**。
    const before: ProjectPublicFieldValues = {
      name: current.name,
      publicSummary: projectPublicContent(current),
      requirementFreeTexts: await readProjectRequirementTexts(db, id),
    };

    // 🔴 単価レンジは**更新後の値**で判定する（片方だけ更新できるため、既存値と合成する）。
    assertUnitPriceRange(
      patch.unitPriceMin === undefined ? decimalToNumber(current.unitPriceMin) : patch.unitPriceMin,
      patch.unitPriceMax === undefined ? decimalToNumber(current.unitPriceMax) : patch.unitPriceMax,
    );
    // ✅✅ 2026-10-16: 精算幅と期間も**更新後の値**で判定する（単価レンジと同じ形）。
    assertSettlementRange(
      patch.settlementMinHours === undefined
        ? current.settlementMinHours
        : patch.settlementMinHours,
      patch.settlementMaxHours === undefined
        ? current.settlementMaxHours
        : patch.settlementMaxHours,
    );
    assertProjectPeriod(
      patch.startDate === undefined ? toDateOnlyString(current.startDate) : patch.startDate,
      patch.endDate === undefined ? toDateOnlyString(current.endDate) : patch.endDate,
    );
    if (requirements !== undefined) await assertRequirementSkillsExist(db, requirements);
    // 🔴 担当者は母集団（`users` の RLS）に照合してから使う。
    if (patch.assigneeUserId !== undefined) {
      await assertAssigneeExists(db, patch.assigneeUserId);
    }

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
      // ✅ 2026-10-16: 未指定 = 変更しない（`null` 指定 = 値を消す、と区別する）。
      ...(patch.category === undefined ? {} : { category: patch.category }),
      ...(patch.sourceKind === undefined ? {} : { sourceKind: patch.sourceKind }),
      ...(patch.parallelOk === undefined ? {} : { parallelOk: patch.parallelOk }),
      // ✅✅ 2026-10-16: 案件サマリの「基本情報」の 9 項目。
      // 🔴 **`copySummary` はここに無い**（`#26` の body に混ぜない。
      //    混ぜると「案件を直したらサマリの手直しが消えた」が起きる。
      //    保存は `updateProjectCopySummary` が行う）。
      ...(patch.upperCompanyName === undefined
        ? {}
        : { upperCompanyName: patch.upperCompanyName }),
      ...(patch.endDate === undefined ? {} : { endDate: toDateOnly(patch.endDate) }),
      ...(patch.settlementMinHours === undefined
        ? {}
        : { settlementMinHours: patch.settlementMinHours }),
      ...(patch.settlementMaxHours === undefined
        ? {}
        : { settlementMaxHours: patch.settlementMaxHours }),
      ...(patch.paymentSiteDays === undefined ? {} : { paymentSiteDays: patch.paymentSiteDays }),
      ...(patch.distribution === undefined ? {} : { distribution: patch.distribution }),
      ...(patch.distributionLimit === undefined
        ? {}
        : { distributionLimit: patch.distributionLimit }),
      ...(patch.assigneeUserId === undefined ? {} : { assigneeUserId: patch.assigneeUserId }),
      ...(patch.endClientName === undefined ? {} : { endClientName: patch.endClientName }),
      ...(patch.internalUnitPrice === undefined
        ? {}
        : { internalUnitPrice: patch.internalUnitPrice }),
      ...(patch.publicSummary === undefined ? {} : { publicSummary: patch.publicSummary }),
      ...(patch.developmentPhases === undefined ? {} : { developmentPhases: patch.developmentPhases }),
      ...(patch.developmentMethod === undefined ? {} : { developmentMethod: patch.developmentMethod }),
      ...(patch.utilizationRate === undefined ? {} : { utilizationRate: patch.utilizationRate }),
      ...(patch.locationDetail === undefined ? {} : { locationDetail: patch.locationDetail }),
      ...(patch.publicMemo === undefined ? {} : { publicMemo: patch.publicMemo }),
      ...(patch.remarks === undefined ? {} : { remarks: patch.remarks }),
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

    // ------------------------------------------------------------------
    // 🔴 T-12-10: 手順 3〜5（`F-014 AC-6`）。
    // ------------------------------------------------------------------
    const saved = await db.project.findFirst({
      where: { id },
      select: { name: true, publicSummary: true, publicMemo: true, locationDetail: true },
    });
    // 直前に更新した行が消えている（並行削除）＝ 不変条件違反。0 件を成功にしない。
    if (saved === null) throw new NotFoundError();
    const after: ProjectPublicFieldValues = {
      name: saved.name,
      publicSummary: projectPublicContent(saved),
      requirementFreeTexts: await readProjectRequirementTexts(db, id),
    };

    // 🔴 手順 4。`revoked_at IS NULL` が「現在の公開先」の定義である（C4 の述語と鏡写し）。
    const liveVisibilityCount = await db.projectVisibility.count({
      where: { projectId: id, revokedAt: null },
    });
    if (liveVisibilityCount === 0) {
      return { view: notPublishedRecheckView(id), enqueue: null };
    }

    // 🔴 手順 5-②「未消費の `RECHECK` 要求が残っている」を条件に入れる理由（docs/05 §11.11
    //    「T-12-10 の実装の決着」③）: 手順 6 は commit の後なので、`BLOCKED_BY_FAILED_JOB` や
    //    プロセス断で「**要求だけが残ってジョブが積まれない**」窓がある。そのとき再検査は
    //    owed のまま公開が続く（＝ T-12-10 が塞ごうとしている穴が開いたまま）。この条件があれば、
    //    利用者が**同じ内容でもう一度保存する**だけで積み直せる（`jobId` は同じなので二重実行に
    //    ならず、内容が同じなら `DONE` 行のキャッシュを引くので `F-026` も増えない）。
    const changed = projectPublicFieldsChanged(before, after);
    if (!changed && !(await hasPendingProjectRecheck(db, id))) {
      return {
        view: { id, recheck: { queued: false, reason: 'PUBLIC_FIELDS_UNCHANGED' } } as const,
        enqueue: null,
      };
    }

    // 🔴 `RECHECK` の `audience` は**現在の公開先そのもの**である（追加する相手は 0 件）。
    const gate = await deps.gate(db, ctx, { projectId: id, kind: 'RECHECK', partnerCompanyIds: [] });
    return { view: { id, recheck: { queued: true } } as const, enqueue: gate.enqueue };
  });

  // 🔴 手順 6。トランザクションを**抜けてから**積む（`#28` と同じ規律。docs/05 §11.11 ①）。
  // 🔴 積めなかったら握り潰さず `InternalError`（500）にする（`createProjectPublishGate` が投げる）。
  //    保存自体は commit 済みで失われず、復帰は手順 5-② である。
  if (enqueue !== null) await enqueue();
  return view;
}

/** 🔴 公開中でない案件の `recheck`（`#26` の `POST` と、公開先 0 社の `PATCH`）。 */
function notPublishedRecheckView(id: string): ProjectMutationView {
  return { id, recheck: { queued: false, reason: 'NOT_PUBLISHED' } };
}

/**
 * 要件を**決定的な順序**で読む（docs/05 §4.8）。
 * 🔴 並びは `kind`（`MUST` → `NICE`）→ `skillId`（NULL 最後）→ `id`。同じ入力なら同じ並びになる。
 *    画面の 2 ブロック（必須 / 尚可）は `kind` で分けるため、ここでの `kind` 昇順は
 *    「必須が先」を保つためではなく、**取得の順序を 1 つに決める**ためである。
 */
async function readProjectRequirements(
  db: Pick<ProjectDb, 'projectRequirement'>,
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
export async function recordProjectView(
  db: Pick<ProjectDb, 'auditLog'>,
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
 *    ⚠️ パートナーの読み取りは `readProjectDetail`（本ファイル下部）だけである。
 *    **この関数を流用しない。**
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
        // ✅ 2026-10-16（受領モック + Issue #113）。
        category: true,
        sourceKind: true,
        parallelOk: true,
        endClientName: true,
        internalUnitPrice: true,
        publicSummary: true,
        upperCompanyName: true,
        endDate: true,
        distributionLimit: true,
        assigneeUserId: true,
        developmentPhases: true, developmentMethod: true, utilizationRate: true,
        locationDetail: true,
        publicMemo: true,
        remarks: true,
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
      // ✅ 2026-10-16（受領モック + Issue #113）: 編集フォームが初期値として受け取る。
      category: row.category as ProjectCategory | null,
      sourceKind: row.sourceKind as ProjectSourceKind,
      parallelOk: row.parallelOk,
      endClientName: row.endClientName,
      internalUnitPrice: decimalToNumber(row.internalUnitPrice),
      publicSummary: row.publicSummary,
      requirements: await readProjectRequirements(db, row.id),
      upperCompanyName: row.upperCompanyName,
      endDate: toDateOnlyString(row.endDate),
      distributionLimit: row.distributionLimit,
      assigneeUserId: row.assigneeUserId,
      developmentPhases: row.developmentPhases, developmentMethod: row.developmentMethod, utilizationRate: row.utilizationRate,
      locationDetail: row.locationDetail,
      publicMemo: row.publicMemo,
      remarks: row.remarks,
      // 🔴 T-12-10: `revoked_at IS NULL` が「現在の公開先」の定義である（C4 の述語と鏡写し）。
      publishedToCount: await db.projectVisibility.count({
        where: { projectId: row.id, revokedAt: null },
      }),
    };
  });
}

/** 担当者の選択肢。ホスト社員だけを同じテナントのRLS内で読む。 */
export async function projectAssigneeOptions(ctx: AuthenticatedTenantCtx) {
  requireHost(ctx);
  return withTenant(ctx, async (db) => {
    const users = await db.user.findMany({
      where: { ownerPartnerCompanyId: null, disabledAt: null },
      select: { id: true, displayName: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
    return users.map((user) => ({ value: user.id, label: user.displayName }));
  });
}

// ============================================================================
// 🔴 `GET /api/projects/{id}`（#27）/ `S-011` —— **取得時の射影で分ける**
// ============================================================================
// 🔴 「取得後に隠す」実装にしない（`docs/02` 申し送り 13-④ / `docs/05` §4.9 の選択と同じ理由）:
//    取得してからシリアライザで落とす形は、API 応答・ログ・エクスポート・将来の別経路の
//    どこか 1 つで必ず漏れる。**読まない列は `select` に書かない。**
// 🔴 したがって `select` の定数を 2 本に分け、パートナー側の定数には
//    `endClientName` / `internalUnitPrice` という**識別子が 1 度も現れない**
//    （T-05-03 の `SKILL_ALIAS_SELECT` が `proposedBy` / `decidedBy` を書かないのと同じ形）。
//    実行時の担保は `tests/isolation/projects.test.ts`、型の担保は
//    `apps/web/lib/projects/detail-view.types.test.ts` である。

/** ホスト・取引先の双方が読む列（`ProjectDetailShared` と 1 対 1）。 */
const PROJECT_DETAIL_SHARED_SELECT = {
  id: true,
  name: true,
  status: true,
  headcount: true,
  startDate: true,
  unitPriceMin: true,
  unitPriceMax: true,
  prefecture: true,
  remoteMode: true,
  publicSummary: true,
  // ✅✅ **2026-10-16: 案件サマリの「基本情報」のうち、**取引先にも出す 5 列**。
    // 🔴🔴 **ここに列を足すことは、公開範囲の相手へ出す項目を増やすことと同義である**
    //    （`CLAUDE.md` §3.1 経路 1 / `F-013 AC-2` / `BR-07`）。
    // 🔴 この 5 つを選んだ理由: いずれも**取引先が「提案してよいか」を
    //    判断するための条件そのもの**であり、隠すと判断できない。
    //    （終了時期 / 精算幅 / 支払いサイト / 商流制限）
    // 🔴 **商流そのもの（`distribution`）・上位会社・担当者・コピペ用サマリはここに無い。**
  endDate: true,
  settlementMinHours: true,
  settlementMaxHours: true,
  paymentSiteDays: true,
  distributionLimit: true,
} as const;

/**
 * 🔴 **パートナー文脈が読む列の全部**。商流情報の 2 列がここに無いことが `F-013 AC-2` の担保である。
 *    ⚠️ この定数に列を足すことは、公開範囲の相手へ出す項目を増やすことと同義である。
 */
const PARTNER_PROJECT_DETAIL_SELECT = PROJECT_DETAIL_SHARED_SELECT;

/** ホスト文脈が読む列（共通 + 商流情報の 2 列）。 */
const HOST_PROJECT_DETAIL_SELECT = {
  ...PROJECT_DETAIL_SHARED_SELECT,
  endClientName: true,
  internalUnitPrice: true,
  // ✅✅ **2026-10-16: ホスト限定の 4 項目**（migration 20261016040000）。
  // 🔴 `upperCompanyName` / `distribution` は**商流そのもの**であり、
  //    出すと上流の構造が割れる（§3.1 経路 5 の 🔴 と同じ理由）。
  // 🔴 `assignee` は**ホスト社員の氏名**に繋がる。
  // 🔴 `copySummary` は**ホストの作文**であり、商流情報を含みうる。
  upperCompanyName: true,
  distribution: true,
  assigneeUserId: true,
  copySummary: true,
  // 🔴 表示のための氏名だけをネストで読む（`users` にも RLS が効く）。
  assignee: { select: { id: true, displayName: true } },
} as const;

/** 🔴 レビューが「増えていないこと」を数えられるように、両定数の列を export する。 */
export const PROJECT_DETAIL_SELECT_KEYS = {
  host: Object.keys(HOST_PROJECT_DETAIL_SELECT),
  partner: Object.keys(PARTNER_PROJECT_DETAIL_SELECT),
} as const;

/** `PROJECT_DETAIL_SHARED_SELECT` で読んだ行 → 共通部分の view。 */
function toSharedDetail(
  row: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly headcount: number;
    readonly startDate: Date | null;
    readonly unitPriceMin: { toString(): string } | null;
    readonly unitPriceMax: { toString(): string } | null;
    readonly prefecture: string | null;
    readonly remoteMode: string | null;
    readonly publicSummary: string | null;
  },
  requirements: readonly ProjectRequirementView[],
): ProjectDetailShared {
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
    publicSummary: row.publicSummary,
    requirements,
  };
}

/**
 * 現在の公開先（`docs/04` §S-011 セクション 5。**ホストだけが呼ぶ**）。
 *
 * 🔴 `revokedAt: null` に絞る。解除済みは「現在の公開先」ではない（`F-014` 処理④ の
 *    「公開解除時、対象パートナーの一覧からその案件が消える」と同じ述語であり、
 *    RLS の C4 が `revoked_at IS NULL` を見るのと鏡写しである）。
 * ⚠️ `docs/04` §S-011 の公開先テーブルは「会社名 / 公開日 / **提案数**」だが、**提案数は
 *    出していない**（`proposals` は SP-09 で入る。0 が並ぶ列を先に置くと「提案が無い」と
 *    「まだ数えられない」が区別できない）。
 */
async function readProjectVisibilities(
  db: ProjectDb,
  projectId: string,
): Promise<readonly ProjectVisibilityView[]> {
  const rows = await db.projectVisibility.findMany({
    where: { projectId, revokedAt: null },
    select: {
      partnerCompanyId: true,
      publishedAt: true,
      // 🔴 `partner_companies` は同じ ctx の RLS（ホストは C2 / C5 で自テナント全社）で絞られる。
      partnerCompany: { select: { name: true } },
    },
    // 🔴 決定的な順序（docs/05 §4.8）。会社名 → ID でタイブレークする。
    orderBy: [{ partnerCompany: { name: 'asc' } }, { partnerCompanyId: 'asc' }],
  });
  return rows.map((row) => ({
    partnerCompanyId: row.partnerCompanyId,
    partnerCompanyName: row.partnerCompany.name,
    publishedOn: toJstIsoDay(row.publishedAt),
  }));
}

/**
 * 🔴 **パートナー文脈で案件が読めなかったときに、404 と「公開解除された」を分ける唯一の判定。**
 *
 * `docs/04` §S-011 / §10.1: 取引先が公開解除された案件を開いた場合は「この案件は現在御社に
 * 公開されていません」を出す（**汎用の 404 ページにしない**）。理由は「存在は既に知っているため、
 * 404 は不正確」であり、その「既に知っている」の根拠が**自社宛の `ProjectVisibility` の行**である。
 *
 * 🔴 したがってこの判定は**自社の行の有無だけ**を見る。他社の行は RLS の C5
 * （`partner_company_id = app_partner_id()`）で 1 行も見えず、加えてアプリ側でも
 * `partnerCompanyId`（🔴 **ctx から取る。リクエスト入力ではない**）を `where` に入れて
 * **第 2 防御**にする（docs/05 §4.1 / §4.9 と同じ二重防御。C5 が静かに無効化されても、
 * 他社の公開状況からこの分岐が動くことはない）。
 * 🔴 「越境の判断をアプリの `if` に書かない」（`CLAUDE.md` §3.1）に反しない —— 案件が**見える／
 * 見えない**を決めているのは最後まで RLS の C4 であり、ここで決めているのは
 * **すでに見えなかったものの断り方**（文言）だけである。
 */
async function projectWasSharedWithPartner(
  db: Pick<ProjectDb, 'projectVisibility'>,
  projectId: string,
  partnerCompanyId: string,
): Promise<boolean> {
  const row = await db.projectVisibility.findFirst({
    where: { projectId, partnerCompanyId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * `GET /api/projects/{id}`（#27）と `S-011` の唯一の読み取り経路。T-06-02。
 *
 * 🔴 **応答の型はホストと取引先で違う**（`HostProjectDetailView` / `PartnerProjectDetailView`）。
 *    分岐は `ctx.partnerCompanyId`（🔴 認証コンテキスト）だけで決まり、リクエスト入力は見ない。
 * 🔴 **境界外の ID は 404**（docs/05 §4.8）。母集団を絞るのは `projects` の RLS（C4。
 *    ホストは全件、パートナーは**自社に公開中の案件のみ**）であり、ここに `where` を足さない。
 *    公開が解除されると C4 の `revoked_at IS NULL` が偽になり、行はその時点で消える。
 * 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-013 AC-3`）。記録は業務トランザクションの
 *    内側にあり、書けなければ内容は返らない。**見えなかった案件の「閲覧」は記録しない。**
 * 🔴 画面（サーバコンポーネント）と Route Handler が**同じこの関数**を通る。経路によって
 *    記録が漏れない（`CLAUDE.md` §13.3「モバイルだけ記録が漏れる実装にしない」）。
 */
export async function readProjectDetail(
  ctx: AuthenticatedTenantCtx,
  id: string,
  meta: ProjectDetailMeta,
  /**
   * 🔴 記録に残す経路（`summary.via`）。**action は分けない**（`S-041` の操作種別フィルタは
   *    接尾辞一致であり、`project.detail_view` のような名前は検索から漏れる）。
   *    既定は `S-011` / `#27`（T-06-02）。`S-013`（T-06-06）だけが `VISIBILITY` を渡す。
   */
  via: ProjectViewVia = PROJECT_VIEW_VIA.detail,
): Promise<ProjectDetailView> {
  const { partnerCompanyId } = ctx;

  if (partnerCompanyId === null) {
    return withTenant(ctx, async (db) => {
      const row = await db.project.findFirst({ where: { id }, select: HOST_PROJECT_DETAIL_SELECT });
      if (row === null) throw new NotFoundError();

      const requirements = await readProjectRequirements(db, row.id);
      const visibilities = await readProjectVisibilities(db, row.id);
      // 🔴 T-12-10: 公開の状態は**ホストの枝でだけ**、同じトランザクションから読む
      //    （docs/05 §11.11「T-12-10 の実装の決着」⑤）。取引先の枝はこの関数を 1 回も呼ばない
      //    ＝ 取引先の経路では `project_publish_requests` / `review_gates` を 1 回も読まない。
      const publishState = await readProjectPublishState(db, row.id, meta.now);
      await recordProjectView(db, ctx, row.id, via, meta);

      return {
        ...toSharedDetail(row, requirements),
        audience: 'HOST',
        endClientName: row.endClientName,
        internalUnitPrice: decimalToNumber(row.internalUnitPrice),
        visibilities,
        publishState,
      };
    });
  }

  return withTenant(ctx, async (db) => {
    // 🔴 商流情報の 2 列は `select` に無い ＝ SQL としても取得していない。
    const row = await db.project.findFirst({ where: { id }, select: PARTNER_PROJECT_DETAIL_SELECT });
    if (row === null) {
      throw (await projectWasSharedWithPartner(db, id, partnerCompanyId))
        ? new ProjectNotSharedError()
        : new NotFoundError();
    }

    const requirements = await readProjectRequirements(db, row.id);
    // 🔴 取引先の経路は `via` を受け取らない（`S-013` はホスト専用であり、ここには来ない）。
    await recordProjectView(db, ctx, row.id, PROJECT_VIEW_VIA.detail, meta);

    return { ...toSharedDetail(row, requirements), audience: 'PARTNER' };
  });
}

/**
 * `S-016` / `#30`（T-08-05）が候補一覧と**同じトランザクション**で読む案件の共通部分
 * （`docs/04` §S-016 セクション 1 の要件サマリと、検索条件の初期値の出所）。
 *
 * 🔴 **ホスト・取引先とも `PARTNER_PROJECT_DETAIL_SELECT`（商流情報の 2 列を持たない）で読む。**
 *    候補一覧に商流情報は要らず、`ProjectDetailShared` は取引先にも出してよい列だけで
 *    できている（`F-013 AC-2`）。ホスト向けに列を足したくなっても、ここではなく `#27` で読む。
 * 🔴 **監査は書かない。** 呼び出し側が同じトランザクションの中で `recordProjectView` を 1 行書く
 *    （読んだのに記録しない経路を作らない）。呼び出し元は 2 つ: `listProjectCandidates`
 *    （`via='CANDIDATES'`）と、T-08-07 の `S-018` / `#33`（`lib/proposal-requests/service.ts`。
 *    `via='PROPOSAL_REQUEST'`）。静的テストによる呼び出し元の固定は無く、記録の有無は
 *    `tests/isolation/project-candidates.test.ts` / `proposal-request-respond.test.ts` が実 DB で見る。
 * 🔴 母集団は `projects` の RLS（C4）だけが決める。見えなければ `null`（呼び出し側が 404 に畳む。
 *    取引先の「公開解除」の断り方は `projectNotFoundError`）。
 */
export async function readProjectCandidateContext(
  db: Pick<ProjectDb, 'project' | 'projectRequirement'>,
  id: string,
): Promise<ProjectDetailShared | null> {
  const row = await db.project.findFirst({ where: { id }, select: PARTNER_PROJECT_DETAIL_SELECT });
  if (row === null) return null;
  return toSharedDetail(row, await readProjectRequirements(db, row.id));
}

/**
 * 案件が読めなかったときに投げる例外を決める（`readProjectDetail` の断り方と同じ 1 本）。
 * 取引先で、かつ自社宛の `ProjectVisibility` の行がある（＝ 公開が解除された）ときだけ
 * `ProjectNotSharedError`、それ以外は素の `NotFoundError`（docs/05 §4.8）。
 */
export async function projectNotFoundError(
  db: Pick<ProjectDb, 'projectVisibility'>,
  ctx: AuthenticatedTenantCtx,
  id: string,
): Promise<NotFoundError> {
  if (ctx.partnerCompanyId !== null && (await projectWasSharedWithPartner(db, id, ctx.partnerCompanyId))) {
    return new ProjectNotSharedError();
  }
  return new NotFoundError();
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
