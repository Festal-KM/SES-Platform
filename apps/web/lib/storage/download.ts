// apps/web/lib/storage/download.ts
// 🔴 **ダウンロード用の署名付き URL を発行できる唯一の関数**（docs/05 §14.2 / §16.1）。T-05-07。
//
// ============================================================================
// 🔴 K-7（`CLAUDE.md` §7「スキルシートの閲覧・DL で監査ログが欠落した件数 = 0 件」）
// ============================================================================
// docs/05 §14.2 は「デスクトップ・モバイル・共有 URL のいずれの経路でも**同じ関数**
// （`issueDownloadUrl`）を通るため、記録が漏れる経路が存在しない」と定めている。
// したがって本モジュールが守るのは次の 2 つである:
//
//   ① 🔴 **`AuditLog` の書き込みが commit されてからでなければ署名しない**（`F-012 AC-2`）。
//      記録は業務トランザクションの内側（`writeAuditLog`）で書き、**トランザクションを抜けた後**に
//      `presignGet` を呼ぶ。記録が失敗すればトランザクションごと巻き戻り、`presignGet` には
//      到達しない ＝ **記録なしの閲覧が成立しない**。
//      🔴 逆順（署名 → 記録）にしてはならない。署名付き URL は**発行した時点で有効**であり、
//         後から記録に失敗しても取り消せない（＝ 記録の無いダウンロードが 1 件生まれる）。
//      🔴 `withApiRoute` の `audit` オプションでも書かない —— あちらはハンドラの**前**に別の
//         トランザクションで書くため、**404（境界外・不存在）でも「ダウンロードした」記録が残る**
//         （§16.1 / T-05-02 の `engineer.view` と同じ判断）。
//
//   ② 🔴 **`scanStatus === 'CLEAN'` でなければ発行しない**（`BR-26` / `F-011 AC-1` /
//      `F-011 AC-3`「感染を検出したファイルは以後どのロールからもダウンロードできない」）。
//      判定は 1 箇所（本関数）にあり、呼び出し側に「CLEAN を確かめてから呼ぶ」責務を渡さない
//      —— 渡すと、新しい DL 経路が増えるたびに条件式が写され、どれかが緩む。
//
// 🔴 `VIEWER` の拒否（`F-012 AC-3` / `BR-31`）は**ルートの `requireNotViewer`** が持つ。
//    ここに置かないのは、ガードの宣言を `tests/static/execute-guard.test.ts` と
//    `withApiRoute` の構築時検査が走査できる形（＝ ルート定義）に保つためである。
//
// ⚠️ docs/05 §14.2 の前提条件④「代理閲覧中でない」（`F-060 AC-3`）は**まだ実装できない**
//    （`ImpersonationSession` と `withImpersonation` は Phase 2。`AuthenticatedTenantCtx` に
//    代理閲覧中を表す値が無い）。**動かせない分岐を先回りで書かない**（`piiPurgedAt` と同じ規律）。
//    🔴 実装が入るときの追加箇所は**本関数の 1 箇所**である（発行経路がここしかないため）。
import {
  withTenant,
  writeAuditLog,
  type AuditSummary,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import type { ObjectStore } from '@ses/connectors';
import { isShareableScanStatus, type ScanStatus } from '@ses/domain';
import { FileNotCleanError, NotFoundError } from '../api/errors';

/**
 * 🔴 ダウンロード用の署名の有効期限（秒）。docs/05 §14.2 の表で **300 秒**に固定されている。
 *
 * アップロード（`S3_PRESIGNED_URL_TTL_SECONDS`）や返却データ（3600 秒）と**別の値**であり、
 * 同じ設定値に畳まない —— 用途ごとに「URL が漏れたときに有効な時間」の許容が違う。
 */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/** `withTenant` が `fn` に渡すクライアント（`skill-sheets/service.ts` と同じ受け方）。 */
type TenantDbArg = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * ダウンロードの対象。**呼び出し側がトランザクションの内側で組み立てる**
 * （＝ 見えている行からしか作れない。RLS が母集団を決める）。
 */
export type DownloadSubject = {
  readonly objectKey: string;
  /** 🔴 `CLEAN` 以外なら本関数が発行を拒否する（`BR-26`）。 */
  readonly scanStatus: ScanStatus;
  /**
   * 🔴 ダウンロード名。**原本のファイル名を渡さない**（docs/05 §14.1 の決着。T-05-07）。
   *    値は `@ses/domain` の `buildSkillSheetDownloadFileName`（版番号だけで組み立てる）が作る。
   *    `undefined` なら S3 のキー（`{uuid}.{ext}`）がそのまま名前になる。
   */
  readonly downloadFileName?: string;
  /** docs/05 §16.1 の `action`（`skill_sheet.download` / `contract_document.download`）。 */
  readonly audit: {
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    /** 🔴 PII を載せない（氏名・ファイル名・オブジェクトキー。§16.2 / §5.5）。 */
    readonly summary: AuditSummary;
  };
};

export type IssueDownloadUrlDeps = {
  /** 起動時 DI で選ばれた実装（`lib/db/bootstrap.ts` の `objectStore()`）。 */
  readonly objectStore: ObjectStore;
  /** 監査ログに残す実行環境（`deviceKind` は ctx が持つ。`CLAUDE.md` §13.3）。 */
  readonly ipAddress: string | null;
};

/** #20 / #82 / #78 の応答（docs/05 §6.4 / §6.6）。 */
export type DownloadTicket = {
  readonly url: string;
  /**
   * 有効期限（秒）。🔴 **`DOWNLOAD_URL_TTL_SECONDS` をそのまま返す。**
   *
   * `PresignedUrl.expiresAt` との差分から求め直さない —— どの実装も「署名した時刻 + 渡した
   * `ttlSec`」を返すので、差分は同じ値を**呼び出し側の時計で計算し直す**だけであり、
   * 時計のずれの分だけ嘘になる。要求した TTL が唯一の権威である。
   */
  readonly expiresIn: number;
};

/**
 * 🔴 署名付きダウンロード URL を発行する（docs/05 §14.2 の `issueDownloadUrl`）。
 *
 * @param loadSubject トランザクションの内側で対象を読む。**見えなければ `null`**（→ 404）。
 *        ここに `where` でテナント・パートナーを足さない —— 母集団を決めるのは RLS である
 *        （境界外の ID は 0 件 ＝ 404。docs/05 §4.8）。
 */
export async function issueDownloadUrl(
  ctx: AuthenticatedTenantCtx,
  loadSubject: (db: TenantDbArg) => Promise<DownloadSubject | null>,
  deps: IssueDownloadUrlDeps,
): Promise<DownloadTicket> {
  // ① 対象の確定 → ② 前提条件 → ③ 監査（すべて 1 トランザクション）。
  const subject = await withTenant(ctx, async (db) => {
    const found = await loadSubject(db);
    // 🔴 境界外・不存在はどちらも 404（存在を教えない）。記録も残さない ——
    //    見ていないダウンロードを「した」ことにしない。
    if (found === null) throw new NotFoundError();
    // 🔴 `CLEAN` 以外は発行しない（`BR-26`）。**記録より前**に弾く ——
    //    発行されなかった操作を `skill_sheet.download` として残すと、
    //    `S-041` の「誰が経歴をダウンロードしたか」に、実際には渡っていない行が混ざる。
    if (!isShareableScanStatus(found.scanStatus)) throw new FileNotCleanError();

    await writeAuditLog(db, {
      action: found.audit.action,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: found.audit.targetType,
      targetId: found.audit.targetId,
      summary: found.audit.summary,
      ipAddress: deps.ipAddress,
      // 🔴 デバイス種別を必ず残す（`CLAUDE.md` §13.3「モバイルだけ記録が漏れる実装にしない」）。
      //    値は `resolveTenantCtx` が User-Agent から決めており、経路ごとに組み立てない。
      deviceKind: ctx.deviceKind,
    });
    return found;
  });

  // ④ 🔴 **ここから先は「記録が commit された後」である。** 上のトランザクションが例外で
  //    巻き戻った場合、この行には到達しない（＝ 記録の無い署名が存在しない）。
  const presigned = await deps.objectStore.presignGet(
    subject.objectKey,
    DOWNLOAD_URL_TTL_SECONDS,
    subject.downloadFileName === undefined
      ? {}
      : { downloadFileName: subject.downloadFileName },
  );

  return { url: presigned.url, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
}
