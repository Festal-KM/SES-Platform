// apps/web/lib/engineers/schemas.ts
// docs/05 §6.4 #16（`POST /api/engineers` / `PATCH /api/engineers/{id}`。`F-008` / `S-007`）の境界検証。
// T-05-01。
//
// 🔴 **`EngineerInput` に `ownerPartnerCompanyId` を含めない**（docs/05 §6.4 #16 / `F-008 AC-2`）。
//    所有パートナーは**登録者の所属**（`ctx.partnerCompanyId`）からだけ決まる。担保は 4 枚:
//      ①本ファイルのスキーマにキーが無い（`AssertNoIsolationKeys` が型で固定する）
//      ②`withApiRoute` の構築時検査（`assertBoundarySchema` → `assertNoIsolationKeys`）が
//        ルート読み込み時に落とす
//      ③Zod の既定（strip）により、body に紛れ込んだ `ownerPartnerCompanyId` は
//        **ハンドラに 1 バイトも届かない**
//      ④RLS の C3（`engineers` の INSERT/UPDATE の `WITH CHECK` が
//        `owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()`）と、
//        `engineers_freeze_owner` トリガ（BEFORE UPDATE で不変）
//    🔴 ③を「400 で弾く」にしない: `.strict()` にすると、未知キーの有無で応答が変わり
//    「このキーには意味がある」ことを外から探れるようになる。必要なのは
//    **値が DB に届かないこと**であり、strip はそれを構造的に満たす。
//
// 🔴 **入力項目は `BR-52` の範囲に限る**（`F-008 AC-1`）。本籍・家族構成・健康情報・信条に
//    あたるキーを 1 つも持たない。`birthDate` / `affiliationLabel`（現所属会社名）も
//    **本タスクの入力には含めない** —— `docs/04` §S-007 のセクション 1 / 6 に入力欄が無く、
//    「集めていない情報は漏れない」（`BR-52`）を守るため、列があることを理由に入力欄を作らない。
//    （`affiliationLabel` は `F-032` のスキルシート抽出が埋める列である。docs/05 §3.4）
//
// 🔴 `.refine()` をトップレベルに使わない（`withApiRoute` の `assertBoundarySchema` が
//    `.shape` を読むため。`partner-companies/schemas.ts` と同じ理由）。単価レンジの大小関係や
//    スキルの重複といった**項目をまたぐ検証は `service.ts` 側**で行う（PATCH では既存値と
//    合成しないと判定できないため、そもそも境界では判定しきれない）。
import { z } from 'zod';
import { ENGINEER_AVAILABILITIES, REMOTE_MODES } from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { idCursorPageQuerySchema } from '../api/pagination';
import { checkboxFilter, optionalFilter, optionalListFilter } from '../api/query-filters';

/** 氏名（社内表示用）。DB は TEXT。過大な入力を境界で止める。 */
const DISPLAY_NAME_MAX_LENGTH = 100;
const PREFERENCE_NOTE_MAX_LENGTH = 1000;
const CONTACT_EMAIL_MAX_LENGTH = 254;
const CONTACT_PHONE_MAX_LENGTH = 30;
/** 単価（月額・円）。`Decimal(12,2)` の範囲に収める。 */
const UNIT_PRICE_MAX = 99_999_999;
/** 経験年数（`Decimal(4,1)`）。 */
const YEARS_MAX = 99;
/** 1 人あたりのスキル数・新語候補数の上限（1 リクエストの大きさを境界で抑える）。 */
const SKILLS_MAX = 100;
const NEW_SKILL_LABELS_MAX = 20;
const NEW_SKILL_LABEL_MAX_LENGTH = 80;

/** 電話番号。国内外の表記ゆれを許し、記号だけに制限する（形式の正規化は行わない）。 */
const CONTACT_PHONE_PATTERN = /^[0-9+\-()\s]+$/;

/**
 * 1 件のスキル（`EngineerSkill`）。
 * 🔴 **`skillId` はグローバル辞書（`Skill`）の ID である**（`F-008` 処理② / `F-010`）。
 *    名前（自由入力）でスキルを作れる経路をここに持たない —— 持つと辞書が実質的に
 *    アプリから増やせることになり `F-010 AC-2` に反する。辞書に無い語は
 *    `newSkillLabels`（新語候補の起票）で受ける。
 */
export const engineerSkillInputSchema = z.object({
  skillId: z.uuid(),
  yearsOfExperience: z.number().min(0).max(YEARS_MAX),
  /** 1..5。`null` = 未設定（`docs/04` §S-007 のレベル列は任意）。 */
  level: z.number().int().min(1).max(5).nullable(),
});

export type EngineerSkillInput = z.infer<typeof engineerSkillInputSchema>;

/**
 * 🔴 項目の定義は 1 か所にまとめ、POST（既定値あり）と PATCH（すべて任意）で**同じ制約**を使う。
 *    2 つのスキーマに同じ制約を書き写すと、片方だけが緩む。
 */
const engineerFields = {
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  availability: z.enum(ENGINEER_AVAILABILITIES),
  /** 稼働可能時期（`@db.Date`）。`YYYY-MM-DD`。 */
  availableFrom: z.iso.date().nullable(),
  unitPriceMin: z.number().int().min(0).max(UNIT_PRICE_MAX).nullable(),
  unitPriceMax: z.number().int().min(0).max(UNIT_PRICE_MAX).nullable(),
  prefecture: z.enum(PREFECTURE_CODES).nullable(),
  remoteMode: z.enum(REMOTE_MODES).nullable(),
  /** 🔴 `BR-52`: 希望条件の自由記述。**営業判断に不要な情報の置き場所にしない**（画面で明示する）。 */
  preferenceNote: z.string().trim().max(PREFERENCE_NOTE_MAX_LENGTH).nullable(),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(CONTACT_EMAIL_MAX_LENGTH)
    .email()
    .nullable(),
  contactPhone: z
    .string()
    .trim()
    .min(1)
    .max(CONTACT_PHONE_MAX_LENGTH)
    .regex(CONTACT_PHONE_PATTERN)
    .nullable(),
  skills: z.array(engineerSkillInputSchema).max(SKILLS_MAX),
  /** 🔴 辞書に無い表記。**辞書には追加せず** `SkillAlias`（`PROPOSED`）として起票する。 */
  newSkillLabels: z
    .array(z.string().trim().min(1).max(NEW_SKILL_LABEL_MAX_LENGTH))
    .max(NEW_SKILL_LABELS_MAX),
} as const;

/** `POST /api/engineers`（#16）の body。🔴 `ownerPartnerCompanyId` を持たない。 */
export const createEngineerBodySchema = z.object({
  displayName: engineerFields.displayName,
  // 🔴 既定は「稼働中」（DB の `@default("WORKING")` と一致させる）。
  availability: engineerFields.availability.default('WORKING'),
  availableFrom: engineerFields.availableFrom.default(null),
  unitPriceMin: engineerFields.unitPriceMin.default(null),
  unitPriceMax: engineerFields.unitPriceMax.default(null),
  prefecture: engineerFields.prefecture.default(null),
  remoteMode: engineerFields.remoteMode.default(null),
  preferenceNote: engineerFields.preferenceNote.default(null),
  contactEmail: engineerFields.contactEmail.default(null),
  contactPhone: engineerFields.contactPhone.default(null),
  skills: engineerFields.skills.default([]),
  newSkillLabels: engineerFields.newSkillLabels.default([]),
});

export type CreateEngineerBody = z.infer<typeof createEngineerBodySchema>;

export type CreateEngineerBodyIsolationGuard = AssertNoIsolationKeys<CreateEngineerBody>;

assertNoIsolationKeys(Object.keys(createEngineerBodySchema.shape), 'createEngineerBodySchema');

/**
 * `PATCH /api/engineers/{id}`（#16）の body。
 * 🔴 **未指定 = 変更しない**（`null` 指定 = 値を消す、と区別する）。`updateMany` の `data` に
 *    載せる列を「指定された項目だけ」に絞るため、両者を混同させない。
 */
export const updateEngineerBodySchema = z.object({
  displayName: engineerFields.displayName.optional(),
  availability: engineerFields.availability.optional(),
  availableFrom: engineerFields.availableFrom.optional(),
  unitPriceMin: engineerFields.unitPriceMin.optional(),
  unitPriceMax: engineerFields.unitPriceMax.optional(),
  prefecture: engineerFields.prefecture.optional(),
  remoteMode: engineerFields.remoteMode.optional(),
  preferenceNote: engineerFields.preferenceNote.optional(),
  contactEmail: engineerFields.contactEmail.optional(),
  contactPhone: engineerFields.contactPhone.optional(),
  /** 🔴 指定されたら**その集合で置き換える**（差分ではない。`service.ts` の注記を参照）。 */
  skills: engineerFields.skills.optional(),
  newSkillLabels: engineerFields.newSkillLabels.optional(),
});

export type UpdateEngineerBody = z.infer<typeof updateEngineerBodySchema>;

export type UpdateEngineerBodyIsolationGuard = AssertNoIsolationKeys<UpdateEngineerBody>;

assertNoIsolationKeys(Object.keys(updateEngineerBodySchema.shape), 'updateEngineerBodySchema');

/** フリーワード（`docs/04` §S-005 の検索条件）。過大な入力を境界で止める。 */
const FREE_WORD_MAX_LENGTH = 200;
/** 1 回の検索で指定できるスキルの数（AND のときスキル数だけ副問い合わせが増えるため上限を置く）。 */
const SKILL_FILTER_MAX = 20;

/**
 * スキル条件の組み合わせ（`docs/02` `F-009` 入力「スキル（複数・AND / OR）」）。
 * 🔴 **既定は `AND`**（`docs/02` / `docs/04` のいずれも `AND` を先に挙げている）。案件の必須要件から
 *    候補を探す業務では「指定したスキルをすべて持つ人」が既定の期待である。1 件しか指定しなければ
 *    `AND` と `OR` は同じ結果になるので、既定値が候補を隠す向きに働くのは複数指定時だけであり、
 *    そのときは画面の選択肢（`S-005`）で切り替えられる。
 */
export const ENGINEER_SKILL_MODES = ['AND', 'OR'] as const;

export type EngineerSkillMode = (typeof ENGINEER_SKILL_MODES)[number];

export const ENGINEER_SKILL_MODE_DEFAULT: EngineerSkillMode = 'AND';

/**
 * `GET /api/engineers`（#15。`F-009` / `S-005`）の query。T-06-04（検索条件）。
 *
 * 🔴 **docs/05 §6.4 #15 の列挙と 1 対 1 である**（T-05-09 の骨格は `cursor` / `limit` だけだった）。
 *    差分は 2 つあり、どちらも docs/05 §6.4「#15 の実装の決着（T-06-04）」に記録した:
 *      - **`ownership` を置かない** …… `engineers` の RLS（C3 OWNER_SCOPED）により、母集団の
 *        所属区分は**実行者の文脈と必ず一致する**（ホスト文脈は `owner_partner_company_id IS NULL`
 *        の行だけ、パートナー文脈は自社の行だけ）。したがってこの条件は「全件」か「0 件」しか
 *        返さず、**絞り込みとして意味を持たない**。🔴 意味を持たせようとすると `where` に
 *        `owner_partner_company_id` を書くことになり、「境界の判断がアプリの条件式に移る」
 *        （`CLAUDE.md` §3.1）。所属区分が条件として意味を持つのは、匿名候補
 *        （`AnonymousCandidateView`）が混ざる **SP-08** からである。
 *      - **`skillMode` を足した** …… `docs/02` `F-009` 入力の「スキル（複数・**AND / OR**）」を
 *        表す手段が #15 の列挙に無かった（キーが無いと AND / OR を選べない）。
 * 🔴 ここに**受け取って捨てるキーを書かない**（`skill_sheets.note` / `originAssignmentId` と
 *    同じ判断。docs/05 §6.4 #19 / #26）。宣言だけしておくと、指定しても効かない条件が
 *    「効いているように見える」状態になり、利用者からは絞り込みの不具合と区別できない。
 * 🔴 **`onlyInTime` / `onlyCommutable` は既定オフ**（`F-009 AC-5` / `docs/02` A-03）。
 *    オフのとき、稼働可能時期が遅い候補・勤務地が合わない候補は**一覧から消えず**、
 *    並びで後ろに回る（`lib/engineers/search.ts` の「適合」）。
 * 🔴 `cursor` は**行の ID**（`uuid(7)`）である。`idCursorPageQuerySchema` を使うのは、
 *    UUID でない値を Prisma の `cursor: { id }` に渡すと 500 になるため（`pagination.ts` の注記）。
 * 🔴 分離キーを持たない（`AssertNoIsolationKeys`）。母集団は RLS の C3 が決める。
 */
export const engineerListQuerySchema = idCursorPageQuerySchema.extend({
  /** スキル（グローバル辞書の ID。複数可）。 */
  skills: optionalListFilter(z.array(z.uuid()).min(1).max(SKILL_FILTER_MAX)),
  /** 🔴 既定は `AND`（上記）。`skills` が 1 件以下のときは結果に影響しない。 */
  skillMode: optionalFilter(z.enum(ENGINEER_SKILL_MODES)).default(ENGINEER_SKILL_MODE_DEFAULT),
  /**
   * 経験年数の下限。
   * 🔴 **1 人あたりの集約値の定義は「登録されたスキルの経験年数の最大値」**である
   *    （docs/05 §6.4「#15 の実装の決着（T-06-04）」で決着。`S-006` の基本情報が保留していた
   *    集約の定義もこれに揃える）。`skills` を指定した場合は**そのスキルの経験年数**を見る
   *    （評価の詳細は `lib/engineers/search.ts`）。
   */
  yearsMin: optionalFilter(z.coerce.number().min(0).max(YEARS_MAX)),
  /** 単価レンジ（月額・円）。🔴 台帳のレンジとの**重なり**で判定する（`search.ts`）。 */
  priceMin: optionalFilter(z.coerce.number().int().min(0).max(UNIT_PRICE_MAX)),
  priceMax: optionalFilter(z.coerce.number().int().min(0).max(UNIT_PRICE_MAX)),
  /** 稼働可能時期（`YYYY-MM-DD`）。「この日までに稼働できる」。🔴 ソフト条件（`onlyInTime`）。 */
  availableBy: optionalFilter(z.iso.date()),
  /** 勤務地（都道府県）。🔴 ソフト条件（`onlyCommutable`）。 */
  prefecture: optionalFilter(z.enum(PREFECTURE_CODES)),
  /** リモート可否。🔴 こちらは**ハード条件**である（`search.ts` の注記）。 */
  remote: optionalFilter(z.enum(REMOTE_MODES)),
  availability: optionalFilter(z.enum(ENGINEER_AVAILABILITIES)),
  /** フリーワード（氏名・希望条件を対象にする。`lib/engineers/search.ts`）。 */
  q: optionalFilter(z.string().trim().min(1).max(FREE_WORD_MAX_LENGTH)),
  /** 🔴 既定オフ（`F-009 AC-5`）。「開始日に間に合う人だけ」。 */
  onlyInTime: checkboxFilter(),
  /** 🔴 既定オフ（`F-009 AC-5`）。「通勤可能な人だけ」。 */
  onlyCommutable: checkboxFilter(),
});

export type EngineerListQuery = z.infer<typeof engineerListQuerySchema>;

export type EngineerListQueryIsolationGuard = AssertNoIsolationKeys<EngineerListQuery>;

assertNoIsolationKeys(Object.keys(engineerListQuerySchema.shape), 'engineerListQuerySchema');

/**
 * `PATCH /api/engineers/{id}` の path params。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS の C3 が決め、
 *    境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
 */
export const engineerParamsSchema = z.object({ id: z.uuid() });

export type EngineerParams = z.infer<typeof engineerParamsSchema>;

export type EngineerParamsIsolationGuard = AssertNoIsolationKeys<EngineerParams>;

assertNoIsolationKeys(Object.keys(engineerParamsSchema.shape), 'engineerParamsSchema');
