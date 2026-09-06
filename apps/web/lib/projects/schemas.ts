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
//      ①`status` の値集合に `SUCCESSOR_WANTED`（後任募集）が含まれること
//      ②`PATCH` が `origin_assignment_id` を**書かない**こと（人手の編集で生成元が消えない）
//
// 🔴 `.refine()` をトップレベルに使わない（`withApiRoute` の `assertBoundarySchema` が `.shape` を
//    読むため。`engineers/schemas.ts` と同じ制約）。項目をまたぐ検証（単価レンジの大小、要件の
//    重複、要件の実体の有無）は `service.ts` 側で行う —— PATCH は既存値と合成しないと
//    判定できないため、そもそも境界では判定しきれない。
import { z } from 'zod';
import { PROJECT_STATUSES, REMOTE_MODES, REQUIREMENT_KINDS } from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

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
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  /** 募集中 / 充足 / **後任募集**（`SUCCESSOR_WANTED` は `F-045` の還流でも設定される）。 */
  status: z.enum(PROJECT_STATUSES),
  headcount: z.number().int().min(HEADCOUNT_MIN).max(HEADCOUNT_MAX),
  /** 稼働開始日（`@db.Date`）。`YYYY-MM-DD`。 */
  startDate: z.iso.date().nullable(),
  unitPriceMin: z.number().int().min(0).max(UNIT_PRICE_MAX).nullable(),
  unitPriceMax: z.number().int().min(0).max(UNIT_PRICE_MAX).nullable(),
  prefecture: z.enum(PREFECTURE_CODES).nullable(),
  remoteMode: z.enum(REMOTE_MODES).nullable(),
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
  name: projectFields.name,
  // 🔴 既定は「募集中」（DB の `@default("OPEN")` と一致させる）。
  status: projectFields.status.default('OPEN'),
  headcount: projectFields.headcount.default(1),
  startDate: projectFields.startDate.default(null),
  unitPriceMin: projectFields.unitPriceMin.default(null),
  unitPriceMax: projectFields.unitPriceMax.default(null),
  prefecture: projectFields.prefecture.default(null),
  remoteMode: projectFields.remoteMode.default(null),
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
  name: projectFields.name.optional(),
  status: projectFields.status.optional(),
  headcount: projectFields.headcount.optional(),
  startDate: projectFields.startDate.optional(),
  unitPriceMin: projectFields.unitPriceMin.optional(),
  unitPriceMax: projectFields.unitPriceMax.optional(),
  prefecture: projectFields.prefecture.optional(),
  remoteMode: projectFields.remoteMode.optional(),
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
 * `PATCH /api/projects/{id}` の path params。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS（C4 の SELECT /
 *    C2 の UPDATE）が決め、境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
 */
export const projectParamsSchema = z.object({ id: z.uuid() });

export type ProjectParams = z.infer<typeof projectParamsSchema>;

export type ProjectParamsIsolationGuard = AssertNoIsolationKeys<ProjectParams>;

assertNoIsolationKeys(Object.keys(projectParamsSchema.shape), 'projectParamsSchema');
