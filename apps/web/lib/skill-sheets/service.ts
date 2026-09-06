// apps/web/lib/skill-sheets/service.ts
// スキルシートの保管に関する**唯一のサービス層**（`F-011` / `S-008`）:
//   - 署名付き URL の発行（#18。docs/05 §6.4 / §14.1 / §14.2）… T-05-04
//   - アップロードの確定 / 版の一覧 / 版の切替 / 削除（#19 / #19b / #19c）… T-05-06
//
// 🔴 `UsageCounter(STORAGE_BYTES)` を読む・動かす経路はこのファイルだけである
//    （`tests/static/auth-db-callers.test.ts` がファイル単位で固定する）。
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
//    行が無いのはそのためである）。記録が要るのは確定（`skill_sheet.create`）・版の切替
//    （`skill_sheet.update`）・削除（`skill_sheet.delete`）と、ダウンロード
//    （`skill_sheet.download`。T-05-07）である。
import {
  accountSkillSheetStorage,
  readStorageBytesUsed,
  releaseSkillSheetStorage,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import type { ObjectStore } from '@ses/connectors';
import {
  buildSkillSheetDownloadFileName,
  buildSkillSheetObjectKey,
  decideStorageUpload,
  objectKeyExtensionOf,
  parseSkillSheetObjectKey,
  QUARANTINED_SCAN_STATUSES,
  type QuarantinedScanStatus,
  type ScanStatus,
} from '@ses/domain';
import {
  ConcurrentUpdateError,
  InternalError,
  NotFoundError,
  SkillSheetNotCleanError,
  SkillSheetObjectMissingError,
  SkillSheetReferencedError,
  SkillSheetScanInProgressError,
  StorageLimitExceededError,
  UploadTooLargeError,
  ValidationError,
} from '../api/errors';
// 🔴 エンジニアの氏名を出す読み取りの記録（`engineer.view`）は **1 実装**である
//    （`engineers/service.ts`）。ここで別の書き込みを起こさない（`BR-27` / `F-008 AC-4`）。
import {
  ENGINEER_VIEW_VIA,
  recordEngineerView,
  type EngineerViewMeta,
} from '../engineers/service';
// 🔴 T-05-07: 署名付き DL URL を発行できる唯一の経路（docs/05 §14.2 / §16.1）。
//    ここで `presignGet` を直接呼ばない —— 呼ぶと「監査の後に署名する」順序が 2 実装になる。
import {
  issueDownloadUrl,
  type DownloadTicket,
  type IssueDownloadUrlDeps,
} from '../storage/download';
import { canBecomeLatestSkillSheet, isScanSettled } from './policy';
import type { SkillSheetConfirmBody, SkillSheetUploadUrlBody } from './schemas';

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

// ===========================================================================
// T-05-06 版管理（確定 #19 / 一覧 / 最新版の切替 / 削除）。`F-011` / `S-008`。
// ===========================================================================
//
// 🔴 **`CLEAN` でない版は共有できない**（`F-011 AC-1` / `BR-26`）を、次の 4 段で成立させる:
//   ① DB … `skill_sheets_latest_clean_check`（`is_latest = false OR scan_status = 'CLEAN'`）
//   ② サービス … 本ファイル（最新版の切替は `canBecomeLatestSkillSheet` を通す）
//   ③ 画面 … `S-008` が同じ `policy.ts` を見て**導線そのものを描かない**
//   ④ ダウンロード … `issueDownloadUrl`（T-05-07。#20）が `isSkillSheetShareable` を通す
// 🔴 「無視して共有」の導線は①〜④のどこにも無い。直せるのは元データ（＝ 別の版を上げ直す）
//    だけである（`CLAUDE.md` §3.3）。

/**
 * docs/05 §16.1 の `*.create` / `*.update` / `*.delete`（`F-011 AC-4`）。
 *
 * 🔴 **`skill_sheet.upload` / `skill_sheet.switch_latest` のような独自 action を作らない。**
 *    `S-041` の操作種別フィルタ（`CREATE_UPDATE_DELETE` = `.create` / `.update` / `.delete` の
 *    接尾辞一致。`lib/audit-logs/categories.ts`）から漏れ、**記録されているのに検索で
 *    出てこない**状態になる（`partner_company.suspend` / `skill_alias.decide` を作らなかったのと
 *    同じ理由。docs/05 §16.1）。版の切替は `summary.operation='SET_LATEST'` で区別する。
 * ⚠️ docs/05 §6.4 #18 の記述「記録は #19（`skill_sheet.upload` = `*.create`）」のうち
 *    **`*.create` の側**を採った（docs 追従済み）。
 */
export const SKILL_SHEET_AUDIT_ACTIONS = {
  create: 'skill_sheet.create',
  update: 'skill_sheet.update',
  delete: 'skill_sheet.delete',
  /**
   * 🔴 T-05-07: 版の**中身**を開いた（#21）。docs/05 §16.1 の `skill_sheet.view`。
   *    ⚠️ 版一覧（`readSkillSheetVersions`）は `engineer.view`（`via='SKILL_SHEETS'`）であり、
   *       こちらとは別物である —— 一覧はメタデータ、こちらは「この人のこの版を開いた」である。
   */
  view: 'skill_sheet.view',
  /** 🔴 T-05-07: 署名付き URL の発行（#20）。docs/05 §16.1 の `skill_sheet.download`。 */
  download: 'skill_sheet.download',
} as const;

/** `skill_sheet.update` の `summary.operation`（版の切替以外が増えたらここに足す）。 */
export const SKILL_SHEET_UPDATE_OPERATIONS = { setLatest: 'SET_LATEST' } as const;

/** 監査ログに残す実行環境（`engineers/service.ts` の `EngineerViewMeta` と同じ形）。 */
export type SkillSheetActionMeta = EngineerViewMeta;

/**
 * `S-008` の版一覧の 1 行（docs/04 §S-008「版の一覧」）。
 *
 * 🔴 **導出値（共有可否・最新版にできるか・操作できるか）をここに持たせない。** 画面は
 *    `policy.ts` の関数を `scanStatus` に適用して判断する —— 行に `shareable: true` のような
 *    フラグを載せると、判定が「行の作り方」に依存し、`F-011 AC-1` の担保が 2 箇所に割れる。
 * 🔴 `objectKey` を返さない（運営者にも見せない値であり、画面にも要らない。docs/05 §5.5）。
 */
export type SkillSheetVersionView = {
  readonly id: string;
  readonly version: number;
  /** ISO 8601（表示の整形は画面側。`lib/format/datetime.ts`）。 */
  readonly uploadedAt: string;
  /** アップロードした利用者の表示名。🔴 見えない（境界外）なら `null`（推測で埋めない）。 */
  readonly uploadedByName: string | null;
  readonly scanStatus: ScanStatus;
  readonly isLatest: boolean;
  /** 版のメモ（`F-011` の入力）。 */
  readonly note: string | null;
  readonly contentType: string;
  readonly byteSize: number;
};

/** `S-008` がサーバから受け取るもの（画面 = `readSkillSheetVersions` の戻り値）。 */
export type SkillSheetPageView = {
  readonly engineer: { readonly id: string; readonly displayName: string };
  readonly versions: readonly SkillSheetVersionView[];
};

/** `#19` の応答（docs/05 §6.4）。 */
export type SkillSheetConfirmResult = {
  readonly id: string;
  readonly version: number;
  /**
   * 🔴 確定の直後は必ず `'SCANNING'` である（docs/05 §6.4 #19）。**再確定（同じ `objectKey` の
   *    二重送信）では既に進んだ状態が返る**ため、型は `ScanStatus` にしてある ——
   *    `'SCANNING'` と書いて嘘の値を返すより、実際の状態を返すほうが画面が正しく描ける。
   */
  readonly scanStatus: ScanStatus;
};

export type SkillSheetConfirmDeps = {
  readonly objectStore: ObjectStore;
  /** 🔴 現在時刻は引数で受け取る（計上の期間キーに使う）。 */
  readonly now: () => Date;
};

export type SkillSheetDeleteDeps = SkillSheetConfirmDeps;

/** 版一覧が読む列（🔴 `object_key` を含めない。docs/05 §5.5 と同じ規律を画面経路にも適用する）。 */
const SKILL_SHEET_VIEW_SELECT = {
  id: true,
  version: true,
  uploadedAt: true,
  uploadedBy: true,
  scanStatus: true,
  isLatest: true,
  note: true,
  contentType: true,
  byteSize: true,
} as const;

type SkillSheetRow = {
  readonly id: string;
  readonly version: number;
  readonly uploadedAt: Date;
  readonly uploadedBy: string;
  readonly scanStatus: string;
  readonly isLatest: boolean;
  readonly note: string | null;
  readonly contentType: string;
  readonly byteSize: bigint;
};

/**
 * アップロードした利用者の表示名（`users` は C8 DIRECTORY。docs/05 §4.4）。
 *
 * 🔴 ここに他社の利用者名が出ることはない。`skill_sheets` は C3 OWNER_SCOPED であり、
 *    見えている版は「自社（ホスト）または自パートナー」が上げたものだけだからである。
 *    それでも**見えなかったときは `null`** にする（推測で埋めない / 例外にもしない ——
 *    利用者が消えていても版一覧は読めなければならない）。
 */
async function readUploaderNames(
  db: SkillSheetDb,
  rows: readonly SkillSheetRow[],
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(rows.map((row) => row.uploadedBy))];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((user) => [user.id, user.displayName]));
}

function toVersionView(
  row: SkillSheetRow,
  uploaderNames: ReadonlyMap<string, string>,
): SkillSheetVersionView {
  return {
    id: row.id,
    version: row.version,
    uploadedAt: row.uploadedAt.toISOString(),
    uploadedByName: uploaderNames.get(row.uploadedBy) ?? null,
    scanStatus: row.scanStatus as ScanStatus,
    isLatest: row.isLatest,
    note: row.note,
    contentType: row.contentType,
    // 🔴 `bigint` は JSON にできないので数値にする。ファイルサイズは 2^53 を超えない
    //    （`UPLOAD_MAX_BYTES` は既定 20 MB）。計上に使うのは DB の `byte_size` であり、この値ではない。
    byteSize: Number(row.byteSize),
  };
}

/**
 * `S-008` の読み取り（版の一覧 + 対象エンジニア）。T-05-06。
 *
 * 🔴 **氏名を出すので `engineer.view` を業務トランザクション内で記録する**（`BR-27` /
 *    `F-008 AC-4`）。記録できなければトランザクションごと巻き戻り、画面は表示されない
 *    （`readEngineerDetail` と同じ形。docs/05 §6.4「#17 の実装の決着」）。
 * 🔴 **境界外・不存在はどちらも 404**（docs/05 §4.8）。母集団を決めるのは `engineers` /
 *    `skill_sheets` の RLS（C3）であり、ここに `where` を足さない。
 * ⚠️ 版の**中身**の閲覧（`skill_sheet.view`。#21）は T-05-07 の範囲であり、ここでは記録しない
 *    —— 一覧が出しているのはメタデータ（版・日時・スキャン状態）だけである。
 */
export async function readSkillSheetVersions(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  meta: SkillSheetActionMeta,
): Promise<SkillSheetPageView> {
  return withTenant(ctx, async (db) => {
    const engineer = await db.engineer.findFirst({
      where: { id: engineerId },
      select: { id: true, displayName: true },
    });
    if (engineer === null) throw new NotFoundError();

    await recordEngineerView(db, ctx, engineer.id, ENGINEER_VIEW_VIA.skillSheets, meta);

    const rows = await db.skillSheet.findMany({
      where: { engineerId },
      select: SKILL_SHEET_VIEW_SELECT,
      // 🔴 決定的な順序（新しい版が上。docs/05 §4.8）。
      orderBy: [{ version: 'desc' }],
    });
    const uploaderNames = await readUploaderNames(db, rows);
    return {
      engineer: { id: engineer.id, displayName: engineer.displayName },
      versions: rows.map((row) => toVersionView(row, uploaderNames)),
    };
  });
}

/**
 * 🔴 隔離された版（`S-003` / `S-004` の周知ブロック。`F-011` 処理④）。T-05-08。
 *
 * 🔴 **氏名を返さない。** 返すのは版の識別子・版番号・状態・検出時刻だけである ——
 *    ホームは 60 秒ごとに読み直される画面であり、氏名を出せば毎回 `engineer.view` を
 *    記録しなければならなくなる（`BR-27` / `F-008 AC-4`）。誰のものかは、行から辿った
 *    `S-008` が（そこで記録したうえで）示す。
 * 🔴 **母集団は `skill_sheets` の RLS（C3 OWNER_SCOPED）が決める。** ホストには自社所有の版が、
 *    パートナーには自社所有の版だけが出る。ここに `where` を足さない ——
 *    足すと「境界の担保がアプリ側の条件式に移った」ことになる。
 * 🔴 監査ログを書かない。ここが出すのはメタデータであり、原本にも氏名にも触れない
 *    （版一覧 `readSkillSheetVersions` が `engineer.view` を書くのは氏名を出すからである）。
 */
export type QuarantinedSkillSheetView = {
  readonly id: string;
  readonly engineerId: string;
  readonly version: number;
  readonly scanStatus: QuarantinedScanStatus;
  /** ISO 8601。スキャン結果が確定した時刻（未設定なら `null`）。 */
  readonly detectedAt: string | null;
};

/** ホームに出す件数の上限（🔴 ホームは一覧画面ではない。全件は `S-008` で見る）。 */
export const QUARANTINED_SKILL_SHEET_LIMIT = 20;

export async function readQuarantinedSkillSheets(
  ctx: AuthenticatedTenantCtx,
): Promise<readonly QuarantinedSkillSheetView[]> {
  return withTenant(ctx, async (db) => {
    const rows = await db.skillSheet.findMany({
      // 🔴 値集合は `@ses/domain` から導く（`['INFECTED', ...]` と書き写さない。
      //    状態が増えたときに、ここだけが古くなって「隔離なのに出ない」版が生まれる）。
      where: { scanStatus: { in: [...QUARANTINED_SCAN_STATUSES] } },
      select: {
        id: true,
        engineerId: true,
        version: true,
        scanStatus: true,
        scanUpdatedAt: true,
        uploadedAt: true,
      },
      // 🔴 決定的な順序（新しいものが上。docs/05 §4.8）。
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      take: QUARANTINED_SKILL_SHEET_LIMIT,
    });
    return rows.map((row) => ({
      id: row.id,
      engineerId: row.engineerId,
      version: row.version,
      scanStatus: row.scanStatus as QuarantinedScanStatus,
      detectedAt: row.scanUpdatedAt?.toISOString() ?? null,
    }));
  });
}

/**
 * `POST /api/engineers/{id}/skill-sheets`（docs/05 §6.4 #19）。アップロードの**確定**。T-05-06。
 *
 * ============================================================================
 * 🔴 申告された `objectKey` を信じない（`CLAUDE.md` §3.1）
 * ============================================================================
 * #18 と違い、この API は body でキーを受け取る（「どこに置いたか」を伝える操作だから）。
 * したがって次の 3 つを確かめてからでなければ 1 行も作らない:
 *   ① 形（`parseSkillSheetObjectKey`）… `t/{tenantId}/skill-sheets/{engineerId}/{version}/{uuid}.{ext}`
 *   ② 帰属 … `tenantId` が **ctx と一致**し、`engineerId` が**経路の ID と一致**する（不一致は 404）
 *   ③ 実体 … `head()` がオブジェクトを返す（無ければ 409。「置いた」という申告が事実でない）
 * ②が無いと、他テナント・他エンジニアのプレフィックスのオブジェクトを自分の版として
 * 登録できる。①③が無いと、実体の無い版が台帳に並ぶ。
 *
 * ============================================================================
 * 🔴 二重送信（docs/05 §14.3）
 * ============================================================================
 * 同じ `objectKey` の確定は **1 行に収束する**（`skill_sheets(object_key)` の `UNIQUE`。
 * migration 20260908000000）。2 回目は既存の行をそのまま返し、**版を採番し直さない**。
 * 🔴 計上（`accountSkillSheetStorage`）は**再確定の経路でも呼ぶ** —— 前回の確定が
 * 「行の作成には成功したが計上の前に落ちた」場合、ここで回収されるためである。CAS
 * （`storage_counted_at`）があるので、2 回目以降は `ALREADY_SETTLED` でカウンタは動かない。
 *
 * 🔴 **ストレージ上限をここで再判定しない。** 判定は署名の発行（#18）で終わっており、実体は
 *    すでに S3 に置かれている。ここで 429 にして行を作らないと、**S3 には在るのに計上されない
 *    オブジェクト**（孤児）が残り、`UsageCounter`（正）と実体が恒久的にずれる。上限を越える
 *    アップロードは #18 の側で止める（`decideStorageUpload`）のが設計であり、確定は
 *    「置かれてしまったものを必ず数える」側に倒す。
 *
 * 🔴 **スキャンをここから起動しない。** GuardDuty は S3 の Put イベントで動く
 *    （`MalwareScanner.enqueue` は実装によっては no-op。docs/05 §8.5）。行は `SCANNING` で
 *    生まれ、結果の適用は `scan.apply-result` / `scan.poll`（T-05-05）だけが行う。
 * 🔴 **`is_latest` を立てない。** 生まれたばかりの版は `SCANNING` であり、`CLEAN` になった版だけが
 *    最新版になれる（`F-011` 処理③ / DB の `skill_sheets_latest_clean_check`）。切替は
 *    `setLatestSkillSheet`（利用者の明示操作）である。
 */
export async function confirmSkillSheetUpload(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  input: SkillSheetConfirmBody,
  deps: SkillSheetConfirmDeps,
  meta: SkillSheetActionMeta,
): Promise<SkillSheetConfirmResult> {
  const parsed = parseSkillSheetObjectKey(input.objectKey);
  // 🔴 形が違う ＝ 我々が発行していないキー（400）。
  if (parsed === null) throw new ValidationError(['body.objectKey']);
  // 🔴 他テナント・他エンジニアのプレフィックスは **404**（存在を教えない。docs/05 §4.8）。
  if (parsed.tenantId !== ctx.tenantId || parsed.engineerId !== engineerId) {
    throw new NotFoundError();
  }

  const existing = await withTenant(ctx, async (db) => {
    const engineer = await db.engineer.findFirst({
      where: { id: engineerId },
      select: { id: true },
    });
    if (engineer === null) throw new NotFoundError();
    return db.skillSheet.findFirst({
      where: { objectKey: input.objectKey },
      select: { id: true, version: true, scanStatus: true },
    });
  });

  if (existing !== null) {
    // 🔴 二重送信。**新しい版を作らない。** 計上だけは（前回落ちていた場合のために）通す。
    await settleStorage(ctx, existing.id, deps.now());
    return {
      id: existing.id,
      version: existing.version,
      scanStatus: existing.scanStatus as ScanStatus,
    };
  }

  // 🔴 実体の確認は**トランザクションの外**で行う（ネットワーク I/O のあいだ DB の
  //    トランザクションを開いたままにしない）。
  const head = await deps.objectStore.head(input.objectKey);
  if (head === null) throw new SkillSheetObjectMissingError();

  const uploadedAt = deps.now();
  const created = await withTenant(ctx, async (db) => {
    const version = await nextVersionOf(db, engineerId);
    // 🔴 `createMany`（＝ `ON CONFLICT DO NOTHING`）を使う。`create` で一意制約違反を
    //    例外として受けると、その時点で**トランザクションが中断状態**になり、後続の照会が
    //    すべて失敗する（`packages/db/src/webhook-delivery.ts` の実測メモと同じ罠）。
    const inserted = await db.skillSheet.createMany({
      data: [
        {
          tenantId: ctx.tenantId,
          // 🔴 `ownerPartnerCompanyId` を**渡さない**。`skill_sheets` は `engineers` から
          //    継承する子表であり、`skill_sheets_inherit_owner` トリガが親の値で必ず上書きする
          //    （docs/05 §4.4.1）。ここで計算しない。
          engineerId,
          version,
          objectKey: input.objectKey,
          // 🔴 申告ではなく**実体**を保存する（docs/05 §14.2）。
          contentType: head.contentType,
          byteSize: BigInt(head.byteSize),
          scanStatus: 'SCANNING',
          isLatest: false,
          note: input.note === undefined || input.note === null || input.note === '' ? null : input.note,
          uploadedBy: ctx.userId,
          uploadedAt,
        },
      ],
      skipDuplicates: true,
    });

    const row = await db.skillSheet.findFirst({
      where: { objectKey: input.objectKey },
      select: { id: true, version: true, scanStatus: true },
    });

    if (inserted.count !== 1) {
      // 衝突には 2 つの意味があり、**混ぜない**:
      //   ① 同じ `objectKey` が既にある … 並行した二重送信。その行を返す（冪等）
      //   ② 版番号（`@@unique([tenantId, engineerId, version])`）の競合 … やり直せば通る
      if (row !== null) return row;
      // 🔴 サーバ側で採番し直して自動再実行しない（`CLAUDE.md` §3.4 と同じ規律。
      //    やり直すかどうかは利用者が決める）。
      throw new ConcurrentUpdateError();
    }
    if (row === null) {
      // 直前に 1 行入れた行が見えない ＝ 不変条件違反（RLS の設定ミス等）。握り潰さない。
      throw new InternalError();
    }

    // 🔴 監査は**業務トランザクションの内側**で書く（`F-011 AC-4`）。`withApiRoute` の
    //    `audit` オプションを使わないのは、あちらがハンドラの**前**に別トランザクションで
    //    書くため、**起きなかったアップロード**（404 / 409 / 競合）まで記録に残るからである
    //    （`skill_alias.update` と同じ判断。docs/05 §16.1）。
    // 🔴 `summary` に PII を載せない（版のメモ・ファイル名を入れない。§16.2）。
    await writeAuditLog(db, {
      action: SKILL_SHEET_AUDIT_ACTIONS.create,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'SkillSheet',
      targetId: row.id,
      summary: {
        engineerId,
        version: row.version,
        byteSize: head.byteSize,
        contentType: head.contentType,
        scanStatus: row.scanStatus,
      },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    return row;
  });

  // 🔴 計上は**確定の後**（docs/05 §14.2 / docs/03 §4.5）。CAS があるので二重に加算されない。
  await settleStorage(ctx, created.id, uploadedAt);

  return { id: created.id, version: created.version, scanStatus: created.scanStatus as ScanStatus };
}

/**
 * 🔴 `UsageCounter(STORAGE_BYTES)` への加算（`packages/db` の CAS を通す唯一の呼び出し）。
 *
 * - `ALREADY_SETTLED` … 冪等な再実行。**エラーではない**（docs/05 §14.3）。
 * - `NOT_FOUND` … 直前に見えていた行が見えない ＝ 不変条件違反。**0 バイトとして握り潰さない。**
 */
async function settleStorage(
  ctx: AuthenticatedTenantCtx,
  skillSheetId: string,
  observedAt: Date,
): Promise<void> {
  const outcome = await accountSkillSheetStorage(ctx, { skillSheetId, observedAt });
  if (outcome.kind === 'NOT_FOUND') throw new InternalError();
}

/**
 * 版の切替（最新版フラグの付け替え）。`F-011` 処理③ / `AC-4`。T-05-06。
 *
 * 🔴 **`CLEAN` の版だけが最新版になれる。** 判定は `policy.ts`（画面と同じ関数）→ CAS
 *    （`scan_status = 'CLEAN'` を `where` に含める）→ DB の CHECK
 *    （`skill_sheets_latest_clean_check`）の 3 段である。CAS を挟むのは、読み取りと書き込みの
 *    あいだにスキャン結果が `INFECTED` へ動きうるためで、そのとき 500（CHECK 違反）ではなく
 *    **409** を返したい（利用者にとっては「もう一度確認してほしい」である）。
 * 🔴 すでに最新版なら**何もしない**（冪等。`#13` の停止・再開と同じ規律）。監査も書かない ——
 *    起きなかった操作を記録に残さない。
 */
export async function setLatestSkillSheet(
  ctx: AuthenticatedTenantCtx,
  skillSheetId: string,
  meta: SkillSheetActionMeta,
): Promise<void> {
  await withTenant(ctx, async (db) => {
    const row = await db.skillSheet.findFirst({
      where: { id: skillSheetId },
      select: { id: true, engineerId: true, version: true, scanStatus: true, isLatest: true },
    });
    if (row === null) throw new NotFoundError();
    if (row.isLatest) return;
    if (!canBecomeLatestSkillSheet(row.scanStatus as ScanStatus)) {
      throw new SkillSheetNotCleanError();
    }

    // 🔴 部分 UNIQUE（`skill_sheets(tenant_id, engineer_id) WHERE is_latest`）があるため、
    //    先に落としてから立てる（同一トランザクション内で順序を守る）。
    await db.skillSheet.updateMany({
      where: { engineerId: row.engineerId, isLatest: true },
      data: { isLatest: false },
    });
    const updated = await db.skillSheet.updateMany({
      where: { id: skillSheetId, scanStatus: 'CLEAN' },
      data: { isLatest: true },
    });
    if (updated.count !== 1) throw new ConcurrentUpdateError();

    await writeAuditLog(db, {
      action: SKILL_SHEET_AUDIT_ACTIONS.update,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'SkillSheet',
      targetId: row.id,
      summary: {
        operation: SKILL_SHEET_UPDATE_OPERATIONS.setLatest,
        engineerId: row.engineerId,
        version: row.version,
      },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
  });
}

/**
 * 版の削除。`F-011 AC-4`。T-05-06。
 *
 * ============================================================================
 * 🔴 順序（docs/03 §4.12 / docs/05 §14.3）
 * ============================================================================
 *   ① S3 の実体を消す → ② `UsageCounter` を減らす（CAS）→ ③ 行を消す + 監査
 * **①より先に②③をやらない。** 実体が残っているのに枠だけ空くと、S3 の請求は増え続ける。
 * 途中で落ちても、もう一度削除すれば同じ手順が最後まで進む（S3 の `DeleteObject` は冪等、
 * ②は CAS、③は 0 件なら 404）。
 *
 * 🔴 **`SCANNING` の版は削除できない**（409）。検査中のオブジェクトを消すと、後から届く
 *    スキャン結果の適用が `SCAN_TARGET_NOT_FOUND` になり（docs/05 §9.6）、
 *    **本物の取りこぼしと区別できない雑音**が `A-005` に流れ込む。
 * 🔴 **最新版を消しても、別の版を自動で最新にしない。** どの版を見せるかは業務判断であり、
 *    推測で選ばない（利用者が `setLatestSkillSheet` で明示する）。
 *
 * ============================================================================
 * 🔴 提案に凍結添付された版は削除しない（**①より前**に止める）
 * ============================================================================
 * `engineer_snapshots.skill_sheet_id` の FK は `ON DELETE RESTRICT` だが、**FK が守るのは③の行
 * だけ**である。①が先に走る以上、FK が発火したときには**実体はすでに消えている**（行だけ残り、
 * 開けない添付になる）。`EngineerSnapshot` は越境経路 2 の証跡 —— 「誰に何を提案したか」を
 * 後から説明する材料 —— であり、復元できない形で失うのは不可逆な事故である（`CLAUDE.md` §7）。
 * したがって **①の前に参照の有無を確かめ、あれば 409（`SkillSheetReferencedError`）で止める**。
 *
 * 🔴 **事前チェックが防御の本体、FK は最終防衛線**（事前チェックと③の間に凍結が入る競合を
 *    カバーする）。どちらか一方にしない。
 * ⚠️ 参照の可視性は `engineer_snapshots` の RLS（C5 PARTY）が決める: ホスト文脈はテナント内の
 *    全行を、パートナー文脈は自社の行を見る。**自社が所有する版を凍結できるのは自社の提案だけ**
 *    （ホストはパートナー所有のスキルシートに `Proposal` 作成前は到達できない。`BR-59` /
 *    `F-012 AC-4`）なので、削除者から見えない参照は生じない。**SP-09 は snapshot を作る側との
 *    競合（凍結中の版をロックする等）を検討すること。**
 */
export async function deleteSkillSheet(
  ctx: AuthenticatedTenantCtx,
  skillSheetId: string,
  deps: SkillSheetDeleteDeps,
  meta: SkillSheetActionMeta,
): Promise<void> {
  const row = await withTenant(ctx, async (db) => {
    const found = await db.skillSheet.findFirst({
      where: { id: skillSheetId },
      select: {
        id: true,
        engineerId: true,
        version: true,
        scanStatus: true,
        objectKey: true,
        isLatest: true,
      },
    });
    if (found === null) return null;
    // 🔴 実体を消す前に参照を確かめる（上の 🔴）。**この照会を①の後ろへ移さない。**
    const referencedBy = await db.engineerSnapshot.count({ where: { skillSheetId } });
    return { ...found, referencedBy };
  });
  if (row === null) throw new NotFoundError();
  if (row.referencedBy > 0) throw new SkillSheetReferencedError();
  if (!isScanSettled(row.scanStatus as ScanStatus)) throw new SkillSheetScanInProgressError();

  // ① 実体（失敗したらここで止まる。DB は 1 行も動いていない）。
  await deps.objectStore.delete(row.objectKey);

  // ② 計上を戻す（CAS。未計上なら `ALREADY_SETTLED` で何も動かない）。
  const released = await releaseSkillSheetStorage(ctx, {
    skillSheetId,
    observedAt: deps.now(),
  });
  if (released.kind === 'NOT_FOUND') throw new NotFoundError();

  // ③ 行 + 監査（同一トランザクション。記録できなければ行も消えない）。
  await withTenant(ctx, async (db) => {
    const deleted = await db.skillSheet.deleteMany({ where: { id: skillSheetId } });
    // 並行削除に負けた（既に消えている）。0 件を成功にしない。
    if (deleted.count !== 1) throw new NotFoundError();
    await writeAuditLog(db, {
      action: SKILL_SHEET_AUDIT_ACTIONS.delete,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'SkillSheet',
      targetId: row.id,
      summary: {
        engineerId: row.engineerId,
        version: row.version,
        // 🔴 「何を消したか」は種別・状態だけで残す（メモ・ファイル名を載せない。§16.2）。
        scanStatus: row.scanStatus,
        wasLatest: row.isLatest,
      },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
  });
}

// ===========================================================================
// 🔴 T-05-07 閲覧（#21）とダウンロード（#20）。`F-012` / K-7（`CLAUDE.md` §7 の許容 0 指標）。
// ===========================================================================
//
// 🔴 **閲覧とダウンロードは別々に記録する**（`F-012 AC-1` / `BR-28`）。片方に畳むと
//    「見ただけの人」と「手元にファイルを持って行った人」が区別できなくなり、
//    取引先への説明（`CLAUDE.md` §1.1-5 / §3.5）が成り立たない。
// 🔴 **記録が成立してからでなければ結果を返さない**（`F-012 AC-2`）。閲覧はここ（業務
//    トランザクション内の `writeAuditLog`）、ダウンロードは `issueDownloadUrl` が守る。
// 🔴 **`VIEWER` は閲覧できるがダウンロードできない**（`F-012 AC-3` / `BR-31`）。拒否の本体は
//    ルートのガード（#20 は `requireNotViewer`、#21 は無し）であり、画面の導線は
//    `policy.ts` の `canDownloadSkillSheet` が決める（同じ規則を 2 度書かない）。

/**
 * `GET /api/skill-sheets/{id}/preview`（docs/05 §6.4 #21）の応答。
 *
 * 🔴 **本文（原本の中身）を返さない。** サーバがスキルシートの中身を握って配る経路を作らない
 *    —— 原本に到達できるのは #20 が出す短命の署名付き URL だけであり、そこは
 *    `CLEAN` + 監査 + `VIEWER` 拒否の 3 条件を通る。ここが本文を返すと、その 3 条件を
 *    迂回する 2 本目の経路になる。
 * 🔴 `objectKey` を返さない（画面に要らず、運営者にも見せない値。docs/05 §5.5）。
 */
export type SkillSheetPreviewView = SkillSheetVersionView & {
  /** 版がどのエンジニアのものか（画面の戻り導線に使う）。 */
  readonly engineerId: string;
};

/**
 * 版の**中身を開く**（#21）。T-05-07。
 *
 * 🔴 **`skill_sheet.view` を業務トランザクション内で記録し、書けなければ内容を返さない**
 *    （`F-012 AC-1` / `AC-2`）。`withApiRoute` の `audit` オプションを使わないのは、
 *    あちらがハンドラの**前**に別トランザクションで書くため **404（境界外・不存在）でも
 *    「閲覧した」記録が残る**からである（§16.1 / `engineer.view` と同じ判断）。
 *
 * 🔴 **`CLEAN` を要求しない。** ここが返すのはメタデータであって原本ではなく、隔離された版に
 *    ついても「いつ・どの版が・なぜ渡せないのか」を確かめられなければ利用者は次の行動
 *    （上げ直す / 削除する）を選べない。原本に触れる #20 だけが `CLEAN` を要求する。
 * 🔴 境界外・不存在はどちらも 404（docs/05 §4.8）。母集団は `skill_sheets` の RLS
 *    （C3 OWNER_SCOPED）が決めるので、**ホストはパートナー所有の版に `Proposal` 作成前は
 *    到達できない**（`F-012 AC-4` / `BR-59`）。ここに `where` を足さない。
 */
export async function readSkillSheetPreview(
  ctx: AuthenticatedTenantCtx,
  skillSheetId: string,
  meta: SkillSheetActionMeta,
): Promise<SkillSheetPreviewView> {
  return withTenant(ctx, async (db) => {
    const row = await db.skillSheet.findFirst({
      where: { id: skillSheetId },
      select: { ...SKILL_SHEET_VIEW_SELECT, engineerId: true },
    });
    if (row === null) throw new NotFoundError();

    await writeAuditLog(db, {
      action: SKILL_SHEET_AUDIT_ACTIONS.view,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'SkillSheet',
      targetId: row.id,
      // 🔴 PII を載せない（氏名・メモ・ファイル名・オブジェクトキー。§16.2 / §5.5）。
      summary: { engineerId: row.engineerId, version: row.version, scanStatus: row.scanStatus },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

    const uploaderNames = await readUploaderNames(db, [row]);
    return { ...toVersionView(row, uploaderNames), engineerId: row.engineerId };
  });
}

export type SkillSheetDownloadDeps = {
  readonly objectStore: ObjectStore;
};

/**
 * `GET /api/skill-sheets/{id}/download-url`（docs/05 §6.4 #20）。T-05-07。
 *
 * 🔴 発行の前提条件（`CLEAN` / 監査の先行）を**この関数が判定しない**。判定は
 *    `issueDownloadUrl`（docs/05 §14.2 が定める唯一の発行経路）にあり、ここは
 *    「どの行を対象にするか」と「何を記録するか」だけを渡す。条件式をここに写すと、
 *    契約書（#82）・返却データ（#78）が増えたときに判定が 3 実装になる。
 *
 * 🔴 **ダウンロード名は版番号から作る**（`buildSkillSheetDownloadFileName`）。原本の
 *    ファイル名は保存していない（docs/05 §14.1 の決着。氏名を含みうるため）。キーの形が
 *    壊れていて名前を作れない場合は名前を付けない（S3 のキー名で落ちる）—— **名前が作れない
 *    ことを理由にダウンロードを止めない**（利用者から見れば、開けるはずのファイルが
 *    開けなくなるだけである）。
 */
export async function issueSkillSheetDownloadUrl(
  ctx: AuthenticatedTenantCtx,
  skillSheetId: string,
  deps: SkillSheetDownloadDeps,
  meta: SkillSheetActionMeta,
): Promise<DownloadTicket> {
  const downloadDeps: IssueDownloadUrlDeps = {
    objectStore: deps.objectStore,
    ipAddress: meta.ipAddress,
  };
  return issueDownloadUrl(
    ctx,
    async (db) => {
      const row = await db.skillSheet.findFirst({
        where: { id: skillSheetId },
        select: {
          id: true,
          engineerId: true,
          version: true,
          scanStatus: true,
          objectKey: true,
        },
      });
      // 🔴 見えない版は `null`（→ 404）。`where` にテナント・パートナーを足さない（RLS が決める）。
      if (row === null) return null;
      const downloadFileName = buildSkillSheetDownloadFileName(row.objectKey);
      return {
        objectKey: row.objectKey,
        scanStatus: row.scanStatus as ScanStatus,
        ...(downloadFileName === null ? {} : { downloadFileName }),
        audit: {
          action: SKILL_SHEET_AUDIT_ACTIONS.download,
          targetType: 'SkillSheet',
          targetId: row.id,
          summary: {
            engineerId: row.engineerId,
            version: row.version,
            scanStatus: row.scanStatus,
          },
        },
      };
    },
    downloadDeps,
  );
}
