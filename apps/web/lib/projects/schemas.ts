// apps/web/lib/projects/schemas.ts
// docs/05 §6.4 #26（`POST /api/projects` / `PATCH /api/projects/{id}`。`F-013` / `S-012`）の境界検証。
// T-06-01。
//
// 🔴 **`ProjectInput` に分離キーを持たない**（`CLAUDE.md` §3.1 / `BR-03`）。案件はホストの
//    持ち物であり、`tenant_id` は ctx からしか決まらない。担保は 4 枚（`engineers/schemas.ts` と同型）:
//      ①本ファイルのスキーマにキーが無い（`AssertNoIsolationKeys` が型で固定する）
//      ②`withApiRoute` の構築時検査（`assertBoundarySchema` → `assertNoIsolationKeys`）
//      ③Zod の既定（strip）により、紛れ込んだキーは**ハンドラに 1 バイトも届かない**
//      ④`projects` / `project_requirements` の RLS（C2。書込は
//        `tenant_id = app_tenant_id() AND app_is_host()`）
//
// 🔴 **`originAssignmentId` を入力に持たない**（docs/05 §6.4「#26 の実装の決着（T-06-01）」）。
//    この列は `F-045` の還流ジョブ（`assignment.end`。docs/05 §9.2 / SP-16）が書く**生成元の記録**
//    であり、人が案件フォームから指定する値ではない（`docs/04` §S-012 のセクション 1〜6 にも
//    入力欄が無い）。加えて Phase 1 には `assignments` の行が無く、`projects.origin_assignment_id`
//    には FK も無いため、**受け取っても照合できない**（docs/05 §6.4 #14 の条件②
//    「指定された ID を `withTenant` の内側で母集団に照合してから使う」を満たせない）。
//    「受け取って捨てるキーを書かない」（#19 / #15 と同じ判断）に従い、キー自体を置かない。
//    🔴 SP-16 が還流で書けるようにするために本タスクが担保するのは次の 2 点であり、
//    どちらも `service.ts` / 結合テストで固定してある:
//      ①`status` の値集合（✅ 2026-10-16 に `OPEN` / `CLOSED` の 2 値になった。Issue #98）
//      ②`PATCH` が `origin_assignment_id` を**書かない**こと（人手の編集で生成元が消えない）
//
// 🔴 `.refine()` をトップレベルに使わない（`withApiRoute` の `assertBoundarySchema` が `.shape` を
//    読むため。`engineers/schemas.ts` と同じ制約）。項目をまたぐ検証（単価レンジの大小、要件の
//    重複、要件の実体の有無）は `service.ts` 側で行う —— PATCH は既存値と合成しないと
//    判定できないため、そもそも境界では判定しきれない。
import { z } from 'zod';
import {
  PROJECT_CATEGORIES,
  PROJECT_SOURCE_KINDS,
  PROJECT_START_WINDOWS,
  PROJECT_STATUSES,
  REMOTE_MODES,
  REQUIREMENT_KINDS,
} from '@ses/db';
import { PROJECT_DEVELOPMENT_PHASES, PROJECT_DEVELOPMENT_METHODS, PROJECT_UTILIZATION_BANDS, parseProjectKeywordGroups } from '@ses/domain';
import { PREFECTURE_CODES } from '@ses/domain';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { idCursorPageQuerySchema } from '../api/pagination';
// 🔴 T-06-04: `optionalFilter` は `lib/api/query-filters.ts` に移した（`S-005` の検索フォームが
//    同じ前処理を必要とし、2 本になると片方だけが空文字を畳まなくなるため）。
// ✅ 2026-10-16: スキルの複数選択（`<select multiple>`）は `optionalListFilter` で均す
//    （人材一覧〔`#15`〕と同じ 1 本。`query-filters.ts` の 🔴）。
import { optionalFilter, optionalListFilter } from '../api/query-filters';

/** 案件名。DB は TEXT。過大な入力を境界で止める。 */
const NAME_MAX_LENGTH = 200;
/** 🔴 内部限定（`endClientName`）。公開範囲の相手には出さない（`F-013 AC-2`）。 */
const END_CLIENT_NAME_MAX_LENGTH = 200;
/** 外部公開用の記載（`publicSummary`）。公開時に使うのはこの列だけである。 */
const PUBLIC_SUMMARY_MAX_LENGTH = 4000;
/** 要件のフリーテキスト（`docs/02` `F-013` 入力の「その他」）。 */
const REQUIREMENT_FREE_TEXT_MAX_LENGTH = 500;
/** 単価（月額・円）。`Decimal(12,2)` の範囲に収める。 */
const UNIT_PRICE_MAX = 99_999_999;
/** 経験年数（`Decimal(4,1)`）。 */
const YEARS_MAX = 99;
/** 募集人数。`headcount` は 1 以上（0 人の募集は案件ではない）。 */
const HEADCOUNT_MIN = 1;
const HEADCOUNT_MAX = 999;
/** 1 案件あたりの要件数の上限（1 リクエストの大きさを境界で抑える）。 */
const REQUIREMENTS_MAX = 100;
/**
 * ✅✅ **2026-10-16: 案件サマリの「基本情報」に足した項目の境界**（migration 20261016040000）。
 *
 * 🔴 **`upperCompanyName` は内部限定**（商流の一部）。長さは `endClientName` と揃える ——
 *    同じ性質の値に違う上限を作らない。
 * 🔴 **精算幅の上限は 744**（31 日 × 24h）= 1 か月の物理的な上限。DB の CHECK と同じ値である。
 * 🔴 **支払いサイトの上限は 365 日。** 「サイト」は日数であり、年を跨ぐ条件は業務上存在しない。
 */
const UPPER_COMPANY_NAME_MAX_LENGTH = END_CLIENT_NAME_MAX_LENGTH;
const SETTLEMENT_HOURS_MAX = 744;
const PAYMENT_SITE_DAYS_MAX = 365;
/** 商流 / 商流制限のフリーテキスト（`エンド → 元請 → 当社` / `2 次請けまで`）。 */
const DISTRIBUTION_MAX_LENGTH = 200;
/**
 * コピペ用サマリの本文（人が書き換えたときだけ入る）。
 * 🔴 **`publicSummary` と同じ上限**にする —— どちらも「人が書く案件の説明文」であり、
 *    片方だけ短いと貼り付けた文面が途中で切れる。
 */
const COPY_SUMMARY_MAX_LENGTH = PUBLIC_SUMMARY_MAX_LENGTH;

/**
 * 要件 1 件（`ProjectRequirement`）。
 *
 * 🔴 **`kind` が `F-013 AC-1` の中核**である。`MUST` は `F-029` の足切りと `F-020` 整合層の
 *    照合対象であり、`NICE` は加点のみに使われる。**両者を 1 つのフラグや順序で表さない**
 *    （区分が失われると、後続がどちらの意味で読めばよいか決められなくなる）。
 * 🔴 `skillId` は**グローバル辞書（`Skill`）の ID** である（`F-010`）。辞書に無い語を
 *    ここから作れる経路は持たない（`F-010 AC-2`）。辞書で表せない要件は `freeText` で書く。
 */
export const projectRequirementInputSchema = z.object({
  kind: z.enum(REQUIREMENT_KINDS),
  skillId: z.uuid().nullable(),
  freeText: z.string().trim().min(1).max(REQUIREMENT_FREE_TEXT_MAX_LENGTH).nullable(),
  requiredYears: z.number().min(0).max(YEARS_MAX).nullable(),
});

export type ProjectRequirementInput = z.infer<typeof projectRequirementInputSchema>;

/**
 * 🔴 項目の定義は 1 か所にまとめ、POST（既定値あり）と PATCH（すべて任意）で**同じ制約**を使う。
 *    2 つのスキーマに同じ制約を書き写すと、片方だけが緩む。
 */
const projectFields = {
  locationDetail: z.string().trim().min(1).max(500).nullable(),
  publicMemo: z.string().trim().min(1).max(PUBLIC_SUMMARY_MAX_LENGTH).nullable(),
  remarks: z.string().trim().min(1).max(PUBLIC_SUMMARY_MAX_LENGTH).nullable(),
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  /**
   * ✅✅ **募集中 / 終了の 2 値**（2026-10-16。[Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98)
   * の回答「募集中と終了の二つだけでよい」）。
   * 🔴 **`F-045` の還流で起こした案件は `OPEN` で生まれる**（旧 `SUCCESSOR_WANTED`）。
   *    後任募集であるという事実は `originAssignmentId` に残る（`@ses/db` の `PROJECT_STATUSES` の 🔴）。
   */
  status: z.enum(PROJECT_STATUSES),
  headcount: z.number().int().min(HEADCOUNT_MIN).max(HEADCOUNT_MAX),
  /** 稼働開始日（`@db.Date`）。`YYYY-MM-DD`。 */
  startDate: z.iso.date().nullable(),
  unitPriceMin: z.number().int().min(0).max(UNIT_PRICE_MAX).nullable(),
  unitPriceMax: z.number().int().min(0).max(UNIT_PRICE_MAX).nullable(),
  prefecture: z.enum(PREFECTURE_CODES).nullable(),
  remoteMode: z.enum(REMOTE_MODES).nullable(),
  /**
   * ✅✅ **2026-10-16（受領モック + [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)）:
   *    カテゴリ / 案件区分 / 並行可否。**
   *
   * 🔴 **絞り込みを足したら、同じ項目を書ける経路も足す。** 検索条件にだけ現れて登録・編集で
   *    設定できない列は、**画面からは永久に空のまま**であり、絞り込みが飾りになる
   *    （実際 2026-10-16 に絞り込みだけ先に入れて、この穴に気づいた）。
   * 🔴 `category` / `parallelOk` は `null` を許す（未設定）。`sourceKind` は必ずどちらかに決まる。
   */
  category: z.enum(PROJECT_CATEGORIES).nullable(),
  sourceKind: z.enum(PROJECT_SOURCE_KINDS),
  parallelOk: z.boolean().nullable(),
  /**
   * ✅✅ **2026-10-16（人間の明示指示の「基本情報 19 項目」。migration 20261016040000）:
   *    案件サマリに描くために足した 9 項目。**
   *
   * 🔴 **すべて `nullable`**（既存の案件には値が無い。既定値を入れない）。
   * 🔴 **`copySummary` はここに無い**（下の 🔴 を参照）。人が書き換えて保存する経路は
   *    `#26` の本体とは別の操作であり、同じ body に混ぜると「案件を直したら
   *    サマリの手直しが消えた」が起きる。
   * 🔴 **項目をまたぐ検証（終了日 < 開始日、精算幅の逆転）は `service.ts` が行う**
   *    —— `PATCH` は既存値と合成しないと判定できない（本ファイル冒頭の 🔴）。
   */
  upperCompanyName: z.string().trim().min(1).max(UPPER_COMPANY_NAME_MAX_LENGTH).nullable(),
  endDate: z.iso.date().nullable(),
  settlementMinHours: z.number().int().min(0).max(SETTLEMENT_HOURS_MAX).nullable(),
  settlementMaxHours: z.number().int().min(0).max(SETTLEMENT_HOURS_MAX).nullable(),
  paymentSiteDays: z.number().int().min(0).max(PAYMENT_SITE_DAYS_MAX).nullable(),
  distribution: z.string().trim().min(1).max(DISTRIBUTION_MAX_LENGTH).nullable(),
  distributionLimit: z.string().trim().min(1).max(DISTRIBUTION_MAX_LENGTH).nullable(),
  /**
   * 担当者（自社の営業）。
   * 🔴 **`uuid` としてだけ検証する。** 「そのテナントに実在する利用者か」は境界では分からない
   *    （母集団は RLS が決める）。`service.ts` が `withTenant` の内側で照合する
   *    （docs/05 §6.4 #14 の条件②）。
   */
  assigneeUserId: z.uuid().nullable(),
  /** 🔴 内部限定（`F-013` 処理② / `AC-2`）。公開範囲の相手の画面・エクスポート・通知に出さない。 */
  endClientName: z.string().trim().min(1).max(END_CLIENT_NAME_MAX_LENGTH).nullable(),
  /** 🔴 内部限定（同上）。`unitPriceMin` / `unitPriceMax`（公開用のレンジ）とは別の列である。 */
  internalUnitPrice: z.number().int().min(0).max(UNIT_PRICE_MAX).nullable(),
  /** 外部公開用の記載。🔴 公開時に外へ出るのはこの列だけである（`docs/05` §3.5）。 */
  publicSummary: z.string().trim().min(1).max(PUBLIC_SUMMARY_MAX_LENGTH).nullable(),
  requirements: z.array(projectRequirementInputSchema).max(REQUIREMENTS_MAX),
} as const;

/** `POST /api/projects`（#26）の body。 */
export const createProjectBodySchema = z.object({
  locationDetail: projectFields.locationDetail.default(null),
  publicMemo: projectFields.publicMemo.default(null),
  remarks: projectFields.remarks.default(null),
  name: projectFields.name,
  // 🔴 既定は「募集中」（DB の `@default("OPEN")` と一致させる）。
  status: projectFields.status.default('OPEN'),
  headcount: projectFields.headcount.default(1),
  startDate: projectFields.startDate.default(null),
  unitPriceMin: projectFields.unitPriceMin.default(null),
  unitPriceMax: projectFields.unitPriceMax.default(null),
  prefecture: projectFields.prefecture.default(null),
  developmentPhases: z.array(z.enum(PROJECT_DEVELOPMENT_PHASES)).max(7).optional(),
  developmentMethod: z.enum(PROJECT_DEVELOPMENT_METHODS).nullable().optional(),
  utilizationRate: z.number().int().min(1).max(100).nullable().optional(),
  remoteMode: projectFields.remoteMode.default(null),
  // ✅ 2026-10-16: 既定は「未設定」/「自社案件」（DB の既定と一致させる）。
  category: projectFields.category.default(null),
  sourceKind: projectFields.sourceKind.default('OWN'),
  parallelOk: projectFields.parallelOk.default(null),
  // ✅✅ 2026-10-16: 基本情報の 9 項目。🔴 既定はすべて「未設定」（DB の既定と一致させる）。
  upperCompanyName: projectFields.upperCompanyName.default(null),
  endDate: projectFields.endDate.default(null),
  settlementMinHours: projectFields.settlementMinHours.default(null),
  settlementMaxHours: projectFields.settlementMaxHours.default(null),
  paymentSiteDays: projectFields.paymentSiteDays.default(null),
  distribution: projectFields.distribution.default(null),
  distributionLimit: projectFields.distributionLimit.default(null),
  assigneeUserId: projectFields.assigneeUserId.default(null),
  endClientName: projectFields.endClientName.default(null),
  internalUnitPrice: projectFields.internalUnitPrice.default(null),
  publicSummary: projectFields.publicSummary.default(null),
  // 🔴 既定は空（`docs/04` §S-012「新規は空フォーム」）。要件 0 件でも保存は許す
  //    （画面は「必須要件がないと候補の足切りが効きません」を警告として出す）。
  requirements: projectFields.requirements.default([]),
});

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export type CreateProjectBodyIsolationGuard = AssertNoIsolationKeys<CreateProjectBody>;

assertNoIsolationKeys(Object.keys(createProjectBodySchema.shape), 'createProjectBodySchema');

/**
 * `PATCH /api/projects/{id}`（#26）の body。
 * 🔴 **未指定 = 変更しない**（`null` 指定 = 値を消す、と区別する）。`updateMany` の `data` に
 *    載せる列を「指定された項目だけ」に絞るため、両者を混同させない。
 */
export const updateProjectBodySchema = z.object({
  locationDetail: projectFields.locationDetail.optional(),
  publicMemo: projectFields.publicMemo.optional(),
  remarks: projectFields.remarks.optional(),
  name: projectFields.name.optional(),
  status: projectFields.status.optional(),
  headcount: projectFields.headcount.optional(),
  startDate: projectFields.startDate.optional(),
  unitPriceMin: projectFields.unitPriceMin.optional(),
  unitPriceMax: projectFields.unitPriceMax.optional(),
  prefecture: projectFields.prefecture.optional(),
  developmentPhases: z.array(z.enum(PROJECT_DEVELOPMENT_PHASES)).max(7).optional(),
  developmentMethod: z.enum(PROJECT_DEVELOPMENT_METHODS).nullable().optional(),
  utilizationRate: z.number().int().min(1).max(100).nullable().optional(),
  remoteMode: projectFields.remoteMode.optional(),
  // ✅ 2026-10-16: 未指定 = 変更しない（`null` 指定 = 値を消す、と区別する）。
  category: projectFields.category.optional(),
  sourceKind: projectFields.sourceKind.optional(),
  parallelOk: projectFields.parallelOk.optional(),
  // ✅✅ 2026-10-16: 基本情報の 9 項目。🔴 未指定 = 変更しない（`null` 指定 = 値を消す）。
  upperCompanyName: projectFields.upperCompanyName.optional(),
  endDate: projectFields.endDate.optional(),
  settlementMinHours: projectFields.settlementMinHours.optional(),
  settlementMaxHours: projectFields.settlementMaxHours.optional(),
  paymentSiteDays: projectFields.paymentSiteDays.optional(),
  distribution: projectFields.distribution.optional(),
  distributionLimit: projectFields.distributionLimit.optional(),
  assigneeUserId: projectFields.assigneeUserId.optional(),
  endClientName: projectFields.endClientName.optional(),
  internalUnitPrice: projectFields.internalUnitPrice.optional(),
  publicSummary: projectFields.publicSummary.optional(),
  /** 🔴 指定されたら**その集合で置き換える**（差分ではない。`service.ts` の注記を参照）。 */
  requirements: projectFields.requirements.optional(),
});

export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

export type UpdateProjectBodyIsolationGuard = AssertNoIsolationKeys<UpdateProjectBody>;

assertNoIsolationKeys(Object.keys(updateProjectBodySchema.shape), 'updateProjectBodySchema');

/**
 * ✅✅ **コピペ用サマリの本文の保存**（2026-10-16。人間の明示指示「人が書き換えて保存も可能」）。
 *
 * 🔴 **`#26` の body に混ぜない。** 混ぜると「案件を直したらサマリの手直しが消えた」/
 *    「サマリを直したら案件の編集フォームの古い値で上書きされた」が起きる ——
 *    どちらも**別の画面から別のタイミングで**行う操作である（案件の編集は `S-012`、
 *    サマリの手直しは `S-010` の副カラム）。
 * 🔴 **`null` を許す = 「人の手直しを取り消して、案件の値から組み直す」**である。
 *    空文字との区別がここでの意味そのものなので、`.min(1)` と `nullable()` を併せる。
 * 🔴 分離キーを持たない（`AssertNoIsolationKeys`）。`tenant_id` は ctx からしか決まらない。
 */
export const projectCopySummaryBodySchema = z.object({
  copySummary: z.string().trim().min(1).max(COPY_SUMMARY_MAX_LENGTH).nullable(),
});

export type ProjectCopySummaryBody = z.infer<typeof projectCopySummaryBodySchema>;

export type ProjectCopySummaryBodyIsolationGuard = AssertNoIsolationKeys<ProjectCopySummaryBody>;

assertNoIsolationKeys(
  Object.keys(projectCopySummaryBodySchema.shape),
  'projectCopySummaryBodySchema',
);

/**
 * 🔴 `#26` の応答の `recheck`（T-12-10。docs/05 §6.4 #26 / §11.11「T-12-10 の実装の決着」③。
 *    `F-014 AC-6`）—— 「**再検査を積んだか / 積まなかったならなぜか**」。
 *
 * 🔴 `S-012` が「保存しました」と「保存しました。公開中の内容を再検査しています」を書き分ける
 *    **唯一の材料**である（`docs/04` §S-012）。
 * 🔴 **`reason` の値はこの 2 つで閉じる。** `SKIPPED_BY_REQUEST` / `GATE_DISABLED` のような
 *    「積まないことを**選べた**」と読める値を作らない（迂回の入口を型として作らないのと同じ理由。
 *    docs/05 §11.11「T-12-10 の実装の決着」⑧ / `BR-18`）。
 * 🔴 **保存の成否と再検査の結果を 1 つの値にまとめない** —— 保存は同期で成功しており、
 *    再検査はこれからである（結果は `S-011` の公開の状態で読む）。
 */
export type ProjectRecheckOutcome =
  | { readonly queued: true; readonly reason?: never }
  | { readonly queued: false; readonly reason: 'NOT_PUBLISHED' | 'PUBLIC_FIELDS_UNCHANGED' };

/** `POST /api/projects` / `PATCH /api/projects/{id}`（#26）の応答（docs/05 §6.4 #26）。 */
export type ProjectMutationView = {
  readonly id: string;
  readonly recheck: ProjectRecheckOutcome;
};

/** フリーワード（`docs/04` §S-010 の検索条件）。過大な入力を境界で止める。 */
const FREE_WORD_MAX_LENGTH = 200;

/**
 * ✅ **2026-10-16: 1 回の検索で選べるスキルの上限**（人間の明示指示の複数選択）。
 *
 * 🔴 **値は人材一覧（`engineers/schemas.ts` の `SKILL_FILTER_MAX`）と同じ 20 である** ——
 *    同じ辞書から同じ形で選ぶ条件であり、片方だけ緩い上限にしない。
 * 🔴 **辞書の件数ではなく「1 リクエストの大きさ」の上限である** —— 述語は
 *    `skill_id IN (…)` の 1 本であり、辞書が増えてもここは増やさなくてよい。
 *    URL を手で編集して 1,000 件を並べられる経路を境界で止める（`REQUIREMENTS_MAX` と同じ趣旨）。
 */
const SKILL_FILTER_MAX = 20;

/**
 * `GET /api/projects`（#25。`F-015` / `S-010`）の query。T-06-03。
 *
 * 🔴 **docs/05 §6.4 #25 の query と 1 対 1 である**（キーを片方にだけ足さない）。
 *    `docs/04` §S-010 の検索条件のうち、**まだ受け取らないもの**は次の 2 つである
 *    （docs/05 §6.4「#25 の実装の決着」）:
 *      - スキル要件 … `project_requirements` への結合と AND / OR の評価が要り、
 *        検索の実装を `packages/db/src/search/**` に閉じる **T-06-05**（docs/05 TBD-8）の射程
 *      - リモート可否 … 単独で先に入れると、画面が「効く条件と効かない条件が混在する帯」になる
 *    ✅ **2026-10-15: 単価レンジは受け取るようになった**（下の `priceMin` / `priceMax`）。
 *    ~~単価レンジ … 案件は**レンジ列 2 本**であり、検索条件のレンジとの「重なり」の定義
 *    （NULL の扱いを含む）が必要になる。同じ定義を人材側（`#15`。**T-06-04**）でも決めるため、
 *    **2 か所で別々に決めない**~~ → 🔴 **先送りの理由がそのまま決着の手順になった** ——
 *    重なりの定義を**人材側と共有する 1 本の関数**（`packages/db/src/search/unit-price-range.ts`
 *    の `unitPriceOverlapConditions`）に切り出したうえで足しており、2 か所で決めていない。
 *    🔴 **受け取って捨てるキーを置かない**（`#19` / `#15` と同じ判断）。宣言だけしておくと、
 *    指定しても効かない条件が「効いているように見える」状態になり、利用者からは絞り込みの
 *    不具合と区別できない。画面（`S-010`）は残りを「後続のリリース」と明示する。
 * 🔴 `cursor` は**行の ID**（`uuid(7)`）である（`idCursorPageQuerySchema` の注記）。
 * 🔴 分離キーを持たない（`AssertNoIsolationKeys`）。母集団は RLS の C4 が決める。
 */
export const projectListQuerySchema = idCursorPageQuerySchema.extend({
  developmentPhases: optionalListFilter(z.array(z.enum(PROJECT_DEVELOPMENT_PHASES)).max(7)),
  developmentMethod: optionalFilter(z.enum(PROJECT_DEVELOPMENT_METHODS)),
  utilizationBand: optionalFilter(z.enum(PROJECT_UTILIZATION_BANDS)),
  utilizationMin: optionalFilter(z.coerce.number().int().min(1).max(100)),
  utilizationMax: optionalFilter(z.coerce.number().int().min(1).max(100)),
  keywordGroups: optionalFilter(z.string().max(4000).refine(value => {
    try { return parseProjectKeywordGroups(JSON.parse(value)) !== null; } catch { return false; }
  }).transform(value => JSON.stringify(parseProjectKeywordGroups(JSON.parse(value))?.filter(group => group.terms.length)))),
  /** フリーワード（案件名・外部公開用の記載を対象にする。`lib/projects/list.ts`）。 */
  q: optionalFilter(z.string().trim().min(1).max(FREE_WORD_MAX_LENGTH)),
  /** 案件の状態（募集中 / 充足 / 後任募集）。未指定は「すべて」。 */
  status: optionalFilter(z.enum(PROJECT_STATUSES)),
  /** 開始日が**この日以降**の案件に絞る（`YYYY-MM-DD`）。 */
  startFrom: optionalFilter(z.iso.date()),
  prefecture: optionalFilter(z.enum(PREFECTURE_CODES)),
  /**
   * ✅ **2026-10-15: 単価レンジ（月額・円）。** `docs/04` §S-010 の検索条件にあり、
   * 定義書（`docs/design-system-projects.md` §1.6）が Filter Panel の 1 行として挙げている。
   *
   * 🔴 **名前・型・上限は人材一覧（`#15` の `engineerListQuerySchema`）と同じである** ——
   *    重なりの述語そのものを共有しており（`packages/db/src/search/unit-price-range.ts` の
   *    `unitPriceOverlapConditions`。人材側の `engineerPriceConditions` もこれを呼ぶ）、
   *    **2 画面で単価の意味を別々に決めない**（T-06-03 の申し送りの決着）。
   * 🔴 **大小関係を検証しない**（片方だけの指定が正当な検索である。同関数の 🔴）。
   */
  priceMin: optionalFilter(z.coerce.number().int().min(0).max(UNIT_PRICE_MAX)),
  priceMax: optionalFilter(z.coerce.number().int().min(0).max(UNIT_PRICE_MAX)),
  /**
   * ✅ **2026-10-16（人間の明示指示「稼働形態」）。**
   * 🔴 **値集合は `REMOTE_MODES`（3 値）を再利用する** —— 指示は 4 値だったが、列の値集合は
   *    3 値であり、4 値に割るのは DB の値集合の変更（[Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)）。
   *    **画面に無い選択肢を query だけ受け取る形にしない。**
   */
  remoteMode: optionalFilter(z.enum(REMOTE_MODES)),
  /**
   * ✅✅ **2026-10-16（人間の明示指示「スキル（リストから複数選択できる、or 検索）」）。**
   *
   * 🔴 **キー・前処理・上限は人材一覧（`#15` の `engineerListQuerySchema.skills`）と同じである。**
   *    あちらも `<select multiple name="skills">` + `optionalListFilter` +
   *    `z.array(z.uuid()).min(1).max(20)` であり、**2 画面でスキル条件の形を別々に決めない**
   *    （単価レンジで `unitPriceOverlapConditions` を共有したのと同じ判断）。
   * 🔴 **`optionalFilter` ではなく `optionalListFilter`** —— `searchParamsToObject` は
   *    **1 個なら文字列・2 個以上なら配列**を返すので、ここで必ず配列に均す。均さないと
   *    「1 件だけ選んだ検索」と「2 件以上選んだ検索」でスキーマが変わる。
   * 🔴 **空は `undefined` に畳む**（`optionalListFilter` が行う）。`[]` を通すと述語が
   *    `{ in: [] }` になり、**常に偽 = 全件 0 件**になる（`ProjectSearchCriteria.skills` の 🔴）。
   * 🔴 **`skillMode`（AND / OR）を持たない。** 人間の明示指示が「or 検索」の 1 通りだからであり、
   *    **選べない選択肢を query に作らない**（人材一覧は `docs/02` `F-009` が AND / OR の
   *    両方を要求しているので `skillMode` を持つ —— 要求が違うので形も違う）。
   */
  skills: optionalListFilter(z.array(z.uuid()).min(1).max(SKILL_FILTER_MAX)),
  /**
   * ✅✅ **2026-10-16（受領モックの絞り込み。[Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)
   *    「設計から改訂して」が列を足す承認である）: カテゴリ / 案件区分 / 並行可否 / 開始時期。**
   */
  category: optionalFilter(z.enum(PROJECT_CATEGORIES)),
  sourceKind: optionalFilter(z.enum(PROJECT_SOURCE_KINDS)),
  /**
   * 🔴 **`'1'` / `'0'` で受ける**（`z.coerce.boolean()` は空文字以外をすべて true にするので、
   *    「不可」を選んだのに「可」で絞られる）。`recruitingOnly` と同じ判断である。
   */
  parallelOk: optionalFilter(z.enum(['1', '0']))
    .transform((value) => (value === undefined ? undefined : value === '1'))
    .optional(),
  /**
   * 🔴 **開始時期は「区分」である**（即日 / 今月 / 来月 / 再来月以降）。日付の範囲への変換は
   *    `@ses/db` の `resolveStartWindow`（現在時刻は引数で受け取る純粋関数）が 1 本で行う。
   * ⚠️ 旧 `startFrom`（`<input type="date">`）は**キーを残す** —— URL を共有した人が居る可能性が
   *    あり、受け取れなくなると「共有したリンクが開かない」になる（画面には出さない）。
   */
  startWithin: optionalFilter(z.enum(PROJECT_START_WINDOWS)),
  /**
   * ✅ **2026-10-16（人間の明示指示「チェックボックス『募集中のみ』」）。**
   *
   * 🔴 **チェックボックスは「チェックされたときだけ」送られる**（HTML の仕様）。したがって
   *    値は 1 種類でよく、`'1'` の等値で受ける —— `z.coerce.boolean()` は**空文字以外を
   *    すべて true にする**ので（`'0'` も `'false'` も true）、URL を手で編集したときに
   *    意図と逆の結果になる。
   * 🔴 **`optionalFilter` に載せる**（未指定・空文字を `undefined` に畳む。他の条件と同じ）。
   *    `ProjectSearchCriteria.recruitingOnly` は `boolean` なので、`transform` で変換する。
   */
  recruitingOnly: optionalFilter(z.literal('1'))
    .transform((value) => (value === undefined ? undefined : true))
    // 🔴 **最後に `.optional()` を付ける。** `transform` の出力は `true | undefined` だが、
    //    付けないと**キー自体が必須**になり（`recruitingOnly: true | undefined`）、
    //    `ProjectSearchCriteria`（`readonly recruitingOnly?: boolean`）への構造的な適合が崩れる
    //    （`ProjectListQueryIsolationGuard` と同じく、この契約は型で固定している）。
    .optional(),
});

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export type ProjectListQueryIsolationGuard = AssertNoIsolationKeys<ProjectListQuery>;

assertNoIsolationKeys(Object.keys(projectListQuerySchema.shape), 'projectListQuerySchema');

/** 1 案件の公開先の上限（1 リクエストの大きさを境界で抑える。取引先の実数は 1 テナント数十社）。 */
const VISIBILITY_PARTNER_COMPANIES_MAX = 200;

/**
 * `PUT /api/projects/{id}/visibility`（#28。`F-014` / `S-013`）の body。T-06-06。
 *
 * 🔴 **入力は「公開先の集合」だけである。** 「全公開」に相当するフラグ・既定値・特別な値を
 *    1 つも持たない（`F-014 AC-2`）。空配列は「誰にも公開しない」であり、**省略も既定値も無い**
 *    （`.default([])` を置かない —— 置くと「公開先を書き忘れた要求」が
 *    **全解除**として静かに成立する。ここは境界を動かす経路であり、意図しない省略を通さない）。
 * 🔴 **`docs/05` §6.4 #28 の `publicSummary` を受け取らない**（下記「#28 の実装の決着」に記録）。
 *    ゲート（`gate.run`）は対象を `targetId` で受け取り、検査する内容を**DB から読む**
 *    （docs/05 §9.3 の payload に本文が無い）。ここで本文を受け取ると、
 *    ①`projects.public_summary` を書く経路が `#26` と 2 本になり
 *    ②公開範囲の変更（`project.visibility_change`）の下に**内容の編集**が隠れる。
 *    外部公開用の記載を直す画面は `S-012` である（`docs/04` §S-012 セクション 6）。
 * 🔴 分離キーを持たない（`AssertNoIsolationKeys`）。`tenant_id` は ctx からしか決まらない。
 */
export const projectVisibilityBodySchema = z.object({
  /** 🔴 公開先の**明示的な**集合。重複は `service` 側で畳む（同じ相手を 2 回選べても 1 回の公開）。 */
  partnerCompanyIds: z.array(z.uuid()).max(VISIBILITY_PARTNER_COMPANIES_MAX),
});

export type ProjectVisibilityBody = z.infer<typeof projectVisibilityBodySchema>;

export type ProjectVisibilityBodyIsolationGuard = AssertNoIsolationKeys<ProjectVisibilityBody>;

assertNoIsolationKeys(
  Object.keys(projectVisibilityBodySchema.shape),
  'projectVisibilityBodySchema',
);

/**
 * `PATCH /api/projects/{id}` の path params。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS（C4 の SELECT /
 *    C2 の UPDATE）が決め、境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
 */
export const projectParamsSchema = z.object({ id: z.uuid() });

export type ProjectParams = z.infer<typeof projectParamsSchema>;

export type ProjectParamsIsolationGuard = AssertNoIsolationKeys<ProjectParams>;

assertNoIsolationKeys(Object.keys(projectParamsSchema.shape), 'projectParamsSchema');
