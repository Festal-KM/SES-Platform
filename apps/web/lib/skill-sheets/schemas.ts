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
 * `#18` の path params。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない（`engineers/schemas.ts` と同じ）。
 *    母集団は `engineers` の RLS（C3）が決め、境界外の ID は 404 になる（docs/05 §4.8）。
 */
export const skillSheetUploadUrlParamsSchema = z.object({ id: z.uuid() });

export type SkillSheetUploadUrlParams = z.infer<typeof skillSheetUploadUrlParamsSchema>;

export type SkillSheetUploadUrlParamsIsolationGuard =
  AssertNoIsolationKeys<SkillSheetUploadUrlParams>;

assertNoIsolationKeys(
  Object.keys(skillSheetUploadUrlParamsSchema.shape),
  'skillSheetUploadUrlParamsSchema',
);
