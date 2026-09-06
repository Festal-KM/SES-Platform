// apps/web/lib/skill-sheets/service.ts
// 🔴 アップロード用の署名付き URL の発行（docs/05 §6.4 #18 / §14.1 / §14.2 / `F-011`）。T-05-04。
//
// ============================================================================
// 🔴 なぜブラウザ → S3 の直接アップロードなのか
// ============================================================================
// Vercel の Route Handler にはボディ 4.5 MB の上限があり（`docs/03` `program-design` 申し送り 23）、
// スキルシート（`UPLOAD_MAX_BYTES` 既定 20 MB）はサーバを**経由できない**。したがってサーバが
// 出すのは「置いてよい場所と条件」だけであり、本体は S3 へ直接送られる。
//
// ============================================================================
// 🔴 発行の前提条件（docs/05 §14.2 の 4 つ）
// ============================================================================
//   ① `requireExecutable`   … ルートのガード（`SUSPENDED` / `CLOSING` では発行しない）
//   ② `VIEWER` でない        … ルートのガード（`BR-31`）
//   ③ **ストレージ上限に達していない** … 本モジュール（`decideStorageUpload`）
//   ④ `Content-Length` の制限 … 本モジュール（`UPLOAD_MAX_BYTES`）+ 署名（`presignPut`）
//
// 🔴 ③は「発行してから失敗させる」ではなく「**発行しない**」（`docs/03` §4.5）。発行すると
//    S3 側には書けてしまい、`UsageCounter`（正）と実体がずれる。ずれたカウンタは
//    アップロードの停止判定と月末原価の両方の根拠を失う。
//
// 🔴 **ここでは `UsageCounter` を 1 バイトも動かさない**（docs/05 §14.2）。署名を出しても
//    アップロードされないまま終わることがある。加算はアップロード確定（#19。T-05-06）が
//    `head()` の実サイズで行う（`accountSkillSheetStorage`）。
//
// 🔴 `AuditLog` も書かない。ここでは何も作られず、外部にも何も渡らない（§16.1 に本 API の
//    行が無いのはそのためである）。記録が要るのは確定（`skill_sheet.upload` = `*.create`）と
//    ダウンロード（`skill_sheet.download`。T-05-07）である。
import { readStorageBytesUsed, withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import type { ObjectStore } from '@ses/connectors';
import { buildSkillSheetObjectKey, decideStorageUpload, objectKeyExtensionOf } from '@ses/domain';
import {
  NotFoundError,
  StorageLimitExceededError,
  UploadTooLargeError,
  ValidationError,
} from '../api/errors';
import type { SkillSheetUploadUrlBody } from './schemas';

/**
 * `#18` の応答。
 *
 * ⚠️ docs/05 §6.4 #18 は `{ objectKey, uploadUrl, expiresIn }` と書いているが、実装では
 *    **`requiredHeaders` を足した**（docs 側も追従済み）。SigV4 の署名には `Content-Type` /
 *    `Content-Length`（と SSE-KMS を使う環境ではその 2 ヘッダ）が含まれ、**クライアントが
 *    同じ値を送らないと S3 が 403 を返す**。返さないと、画面はヘッダを推測するしかない。
 */
export type SkillSheetUploadTicket = {
  readonly objectKey: string;
  readonly uploadUrl: string;
  /** 有効期限（秒）。`S3_PRESIGNED_URL_TTL_SECONDS`（既定 300）。 */
  readonly expiresIn: number;
  /** 🔴 クライアントが **そのまま** 付けるヘッダ（1 つでも欠けると署名が一致しない）。 */
  readonly requiredHeaders: Readonly<Record<string, string>>;
};

export type SkillSheetUploadDeps = {
  /** 起動時 DI で選ばれた実装（`apps/web/lib/db/bootstrap.ts` の `objectStore()`）。 */
  readonly objectStore: ObjectStore;
  /** `UPLOAD_MAX_BYTES`（既定 20 MB）。 */
  readonly uploadMaxBytes: number;
  /** テナントのストレージ上限（`Plan.storageLimitBytes` / `STORAGE_LIMIT_BYTES_PER_TENANT`）。 */
  readonly storageLimitBytes: bigint;
  /** 🔴 現在時刻は引数で受け取る（計測の期間キーと有効期限の算出に使う）。 */
  readonly now: () => Date;
};

/** `withTenant` が `fn` に渡すクライアント（`engineers/service.ts` と同じ受け方）。 */
type SkillSheetDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * 次の版番号（`SkillSheet.version`）。
 *
 * ⚠️ ここで決まるのは**キーに載せる版**であり、確定（#19）が採番する版そのものではない
 *    （`@@unique([tenantId, engineerId, version])` が最終的な権威である）。同じエンジニアに
 *    2 人が同時に署名を要求すると、両者とも同じ版を載せたキー（`{uuid}` は別）を受け取り、
 *    確定は先着 1 件だけが成立する。**キーの一意性は `{uuid}` が担保する**ため、
 *    オブジェクトが上書きされることはない。
 */
async function nextVersionOf(db: SkillSheetDb, engineerId: string): Promise<number> {
  const latest = await db.skillSheet.findFirst({
    where: { engineerId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

/**
 * `POST /api/engineers/{id}/skill-sheets/upload-url`（docs/05 §6.4 #18）。
 *
 * 🔴 対象エンジニアの母集団は `engineers` の RLS（C3 OWNER_SCOPED）が決める。パートナー所属の
 *    利用者は自社のエンジニアにしか署名を出せず、境界外の ID は **404**（§4.8）である。
 *    ここに `where` を足さない。
 */
export async function issueSkillSheetUploadUrl(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  input: SkillSheetUploadUrlBody,
  deps: SkillSheetUploadDeps,
): Promise<SkillSheetUploadTicket> {
  // ④ `Content-Length` の制限（docs/05 §14.2）。🔴 画面の `accept` / 事前チェックは迂回できるので
  //    サーバで判定する。署名にも同じ値を焼き込むため、申告より大きいものは S3 でも通らない。
  if (input.byteSize > deps.uploadMaxBytes) throw new UploadTooLargeError(deps.uploadMaxBytes);

  const extension = objectKeyExtensionOf(input.fileName);
  if (extension === null) throw new ValidationError(['body.fileName']);

  const version = await withTenant(ctx, async (db) => {
    const engineer = await db.engineer.findFirst({ where: { id: engineerId }, select: { id: true } });
    if (engineer === null) throw new NotFoundError();
    return nextVersionOf(db, engineerId);
  });

  // ③ 🔴 ストレージ上限（docs/03 §4.5）。**超過していたら署名を発行しない。**
  //    使用量の正は `UsageCounter(STORAGE_BYTES)` であり、S3 を数えに行かない（間に合わない）。
  const now = deps.now();
  const usedBytes = await readStorageBytesUsed(ctx, now);
  const decision = decideStorageUpload({
    limitBytes: deps.storageLimitBytes,
    usedBytes,
    requestedBytes: BigInt(input.byteSize),
  });
  if (decision.kind === 'BLOCK') throw new StorageLimitExceededError();

  const objectKey = buildSkillSheetObjectKey({
    tenantId: ctx.tenantId,
    engineerId,
    version,
    // 🔴 ファイル名をキーに含めない（氏名が入りうる。docs/05 §14.1）。推測不能な UUID にする。
    objectId: crypto.randomUUID(),
    extension,
  });

  const presigned = await deps.objectStore.presignPut(
    objectKey,
    input.contentType,
    // 🔴 「上限」ではなく「このサイズちょうど」として署名する（`S3PresignPutRequest.ContentLength`）。
    input.byteSize,
  );

  return {
    objectKey,
    uploadUrl: presigned.url,
    expiresIn: Math.max(0, Math.round((presigned.expiresAt.getTime() - now.getTime()) / 1000)),
    requiredHeaders: presigned.headers,
  };
}
