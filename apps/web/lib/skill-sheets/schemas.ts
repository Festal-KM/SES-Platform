// apps/web/lib/skill-sheets/schemas.ts
// docs/05 §6.4 #18（`POST /api/engineers/{id}/skill-sheets/upload-url`。`F-011` / `S-008`）の境界検証。
// T-05-04。
//
// 🔴 body は `{ fileName, contentType, byteSize }` の 3 項目だけである（docs/05 §6.4 #18）。
//    **`objectKey` を受け取らない** —— キーはサーバが組み立てる（`@ses/domain` の
//    `buildSkillSheetObjectKey`）。受け取ると、他テナントのプレフィックスや別用途の領域へ
//    署名を出せてしまう（`CLAUDE.md` §3.1）。
//
// 🔴 分離キー（`tenantId` / `partnerCompanyId`）は当然含まない。`assertNoIsolationKeys` が
//    ルート構築時に固定する（`engineers/schemas.ts` と同じ 4 枚の担保のうちの 1 枚）。
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/**
 * 受け付けるファイル形式（`docs/04` §S-008「対応形式（xlsx / docx / pdf 等）」/ `docs/03` §3.5.1）。
 *
 * 🔴 **画像・画像 PDF も受け付ける**（`docs/03` `ui-design` 申し送り 8）。自動読み取り（`F-032`。
 *    Phase 2）に対応しないだけであり、**アップロード自体は拒否しない**。画面がその旨を明示する。
 * 🔴 一方で「何でも置ける」ようにはしない。スキルシートの保管領域に任意の実行ファイルを
 *    置ける経路を作らないため、許可する形式は列挙する（ウイルススキャン〔T-05-05〕は
 *    その後段の防御であって、前段を省いてよい理由にはならない）。
 */
export const SKILL_SHEET_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;

/** ファイル名の長さの上限（原本名は DB の列に持つ。キーには含めない。docs/05 §14.1）。 */
const FILE_NAME_MAX_LENGTH = 255;

/**
 * `POST /api/engineers/{id}/skill-sheets/upload-url`（#18）の body。
 *
 * 🔴 `byteSize` は**申告値**である。申告どおりのサイズが署名（`Content-Length`）に焼き込まれるため、
 *    「小さいと申告して大きいものを置く」ことはできない（S3 が 403 を返す）。確定（#19。T-05-06）は
 *    `head()` の実サイズを正として `UsageCounter` に加算する。
 */
export const skillSheetUploadUrlBodySchema = z.object({
  fileName: z.string().trim().min(1).max(FILE_NAME_MAX_LENGTH),
  contentType: z.enum(SKILL_SHEET_CONTENT_TYPES),
  /** 🔴 上限（`UPLOAD_MAX_BYTES`）との比較は**設定値を知っている層**（service）で行う。 */
  byteSize: z.number().int().positive(),
});

export type SkillSheetUploadUrlBody = z.infer<typeof skillSheetUploadUrlBodySchema>;

export type SkillSheetUploadUrlBodyIsolationGuard = AssertNoIsolationKeys<SkillSheetUploadUrlBody>;

assertNoIsolationKeys(
  Object.keys(skillSheetUploadUrlBodySchema.shape),
  'skillSheetUploadUrlBodySchema',
);

/**
 * `#18` / `#19` の path params（どちらも `{id}` は**エンジニア**の ID である）。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない（`engineers/schemas.ts` と同じ）。
 *    母集団は `engineers` の RLS（C3）が決め、境界外の ID は 404 になる（docs/05 §4.8）。
 * ⚠️ 版そのものを指す `{id}`（`#19b` / `#19c` / `#20` / `#21`）は
 *    `skillSheetParamsSchema`（下記）である。**同じ名前の変数で混ぜない。**
 */
export const skillSheetEngineerParamsSchema = z.object({ id: z.uuid() });

export type SkillSheetEngineerParams = z.infer<typeof skillSheetEngineerParamsSchema>;

export type SkillSheetEngineerParamsIsolationGuard =
  AssertNoIsolationKeys<SkillSheetEngineerParams>;

assertNoIsolationKeys(
  Object.keys(skillSheetEngineerParamsSchema.shape),
  'skillSheetEngineerParamsSchema',
);

// ---------------------------------------------------------------------------
// #19 `POST /api/engineers/{id}/skill-sheets`（アップロードの確定）。T-05-06。
// ---------------------------------------------------------------------------

/** 版のメモの上限（`skill_sheets.note`。migration 20260909000000）。 */
const NOTE_MAX_LENGTH = 500;

/**
 * `POST /api/engineers/{id}/skill-sheets`（#19）の body（docs/05 §6.4）。
 *
 * 🔴 **ここだけが `objectKey` を受け取る API である。** #18（署名の発行）は受け取らない ——
 *    キーはサーバが組み立てるからである。確定は「どこに置いたか」を伝える操作なので
 *    受け取らざるを得ないが、**申告値をそのまま信じない**:
 *      ① `parseSkillSheetObjectKey` で形を分解し（`@ses/domain`）
 *      ② `tenantId` が **ctx と一致**すること、`engineerId` が **経路の ID と一致**すること
 *      ③ `objectStore.head()` で**実体が存在すること**
 *    を `service.ts` が確かめる。①②が無いと、他テナント・他エンジニアのプレフィックスに
 *    置かれたオブジェクトを自分の版として登録できてしまう（`CLAUDE.md` §3.1）。
 * 🔴 `byteSize` を**受け取らない**（#18 は申告値を受け取るが、確定の正は `head()` の実サイズで
 *    ある。docs/05 §14.2）。申告できると `UsageCounter` を過少申告できる。
 */
export const skillSheetConfirmBodySchema = z.object({
  objectKey: z.string().min(1).max(1024),
  // 🔴 `null` を許す（「メモ無し」を明示できるようにする）。空文字は `null` に畳む（service 側）。
  note: z.string().max(NOTE_MAX_LENGTH).nullish(),
});

export type SkillSheetConfirmBody = z.infer<typeof skillSheetConfirmBodySchema>;

export type SkillSheetConfirmBodyIsolationGuard = AssertNoIsolationKeys<SkillSheetConfirmBody>;

assertNoIsolationKeys(Object.keys(skillSheetConfirmBodySchema.shape), 'skillSheetConfirmBodySchema');

/**
 * 版そのものを指す path params（版の切替 / 削除。T-05-06）。
 * 🔴 母集団は `skill_sheets` の RLS（C3 OWNER_SCOPED）が決め、境界外の ID は 404 になる。
 */
export const skillSheetParamsSchema = z.object({ id: z.uuid() });

export type SkillSheetParams = z.infer<typeof skillSheetParamsSchema>;

export type SkillSheetParamsIsolationGuard = AssertNoIsolationKeys<SkillSheetParams>;

assertNoIsolationKeys(Object.keys(skillSheetParamsSchema.shape), 'skillSheetParamsSchema');
