// packages/db/src/file-scan.ts
// 🔴 ウイルススキャン結果の記録と適用（docs/05 §3.4 / §8.5 / §9.6 / docs/03 §3.4.3 / `BR-26`）。T-05-05。
//
// ============================================================================
// 🔴 冪等性は 3 段（すべて DB 側にある）
// ============================================================================
//   ① `WebhookDelivery.dedupeKey`（`gd:{objectKey}:{versionId}`）の `UNIQUE`
//      … 同じオブジェクト版の再配信は 1 行に収束する（受信側。`apps/web/lib/webhooks/guardduty.ts`）
//   ② `FileScanResult` の **`UNIQUE(object_key, object_version_id)`**
//      … ①をすり抜けた並行実行でも判定の記録は 1 行（docs/03 §3.4.3-2）
//   ③ `skill_sheets.scan_status` の **CAS**（`scan_status = ANY(replaceable)`）
//      … 🔴 **`CLEAN` へ戻す遷移が存在しない**（domain の単調性 + SQL の条件付き UPDATE）
//
// 🔴 ②と③は独立している。②が「既にある」でも③は動かす —— 受信の記録に成功した直後に
//    プロセスが落ちると、記録はあるのに状態が未適用のまま残るからである
//    （`webhook.process` が `duplicate && !processed` を再 enqueue するのと同じ理由）。
//    実装上は③を先に置く（`applyFileScanResult` 内の順序の理由を参照）。
//
// ============================================================================
// 🔴 なぜ `app_apply_scan_status` / `app_list_stalled_scan_targets` を経由するのか
// ============================================================================
// `skill_sheets` は C3 OWNER_SCOPED であり、ジョブのホスト文脈（`systemTenantCtx`）からは
// **パートナー所属エンジニアの行が 1 行も見えない**（docs/05 §4.4）。スキャンは所有者と無関係に
// 起きるため、素の `withTenant` で書くと「パートナーが上げたファイルだけ永久に `SCANNING`」に
// なる。migration 20260908000000 の判断事項に詳細を書いた（§4.4.1 の
// `assignments ← engineers` と同型の問題であり、同型の解を採っている）。
//
// 🔴 生 SQL を使うのはこの 2 つの関数呼び出しだけであり、テナントキーの述語は関数の中で
//    `app_tenant_id()` として課される（`storage-usage.ts` と同じ規律）。

import { Prisma } from '@prisma/client';
import { scanStatusesReplaceableBy, type ScanStatus } from '@ses/domain';
import type { SystemTenantCtx } from './context.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * スキャン結果の適用結果。
 *
 * - `APPLIED` … `skill_sheets.scan_status` が実際に動いた
 * - 🔴 `KEPT` … **重複配信 / 順序逆転の正常系**（既により重い判定が入っている）。エラーではない
 * - 🔴 `NOT_FOUND` … そのオブジェクトキーの `SkillSheet` がテナント内に無い。
 *   呼び出し側が `A-005` に出す（**0 件更新を成功に畳まない**）
 */
export type ScanApplyOutcome = {
  readonly target: 'APPLIED' | 'KEPT' | 'NOT_FOUND';
  /** 適用前の状態（`NOT_FOUND` のときは `null`）。 */
  readonly previousStatus: ScanStatus | null;
  /** 🔴 `FileScanResult` に新規 INSERT できたか（`false` = 同じ版の判定が既にある）。 */
  readonly recorded: boolean;
};

export type FileScanResultInput = {
  readonly objectKey: string;
  readonly objectVersionId: string;
  readonly status: ScanStatus;
  /** プロバイダの生値（`file_scan_results.raw_status`）。正規化前の値をそのまま残す。 */
  readonly rawStatus: string;
  /**
   * 🔴 **プロバイダが示す判定の発生時刻**（`skill_sheets.scan_updated_at` に入る）。
   *    受信時刻ではない —— 遅れて届いた判定に「いま判定された」時刻を書くと、
   *    滞留の分析（`A-005`）で「さっき確定したばかり」に見えてしまう。
   */
  readonly occurredAt: Date;
  /** こちらが受け取った時刻（`file_scan_results.received_at`）。 */
  readonly receivedAt: Date;
};

type ApplyRow = { readonly outcome: string; readonly previous_status: string | null };

function isScanApplyTarget(value: string): value is ScanApplyOutcome['target'] {
  return value === 'APPLIED' || value === 'KEPT' || value === 'NOT_FOUND';
}

/**
 * 🔴 スキャン結果を記録し、対象ファイルの状態へ適用する（docs/05 §9.6 `scan.apply-result`）。
 *
 * 呼び出せるのはジョブ（`apps/worker`）だけである（`ctx` が `SystemTenantCtx`）。
 * 🔴 `ctx.tenantId` はオブジェクトキーの `t/{tenantId}` から導く（`tenantIdFromObjectKey`）。
 *    これは「リクエスト入力からテナントを決める」ことではない —— 受信は HMAC 検証済みであり、
 *    キー自体もこちらが組み立てたものである（`packages/domain/src/storage/object-key.ts` の 🔴）。
 *    さらに実際の更新は「そのテナントにキーが一致する行があること」を条件にするため、
 *    存在しないテナントを名乗っても 1 行も動かない（`NOT_FOUND`）。
 */
export async function applyFileScanResult(
  ctx: SystemTenantCtx,
  input: FileScanResultInput,
): Promise<ScanApplyOutcome> {
  // 🔴 遷移の判断は domain の純粋関数が持つ（SQL に重篤度の表を書き写さない）。
  //    `SCANNING` を渡そうとした場合はここで例外になる（確定 → 未確定の巻き戻しを作らない）。
  const replaceable = [...scanStatusesReplaceableBy(input.status)];

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      // ③ 状態の適用（CAS）を**先に**行う。
      //    🔴 順序の理由: `file_scan_results.tenant_id` は `tenants` への FK を持つ。
      //    記録を先に書くと、テナントが実在しないオブジェクトキー（本来ありえないが、
      //    バケットに直接置かれたもの等）で **FK 違反の例外**になり、`NOT_FOUND` として
      //    運用に見せるべきものが「ジョブの失敗」に化ける。適用を先に置けば、
      //    そのケースは `NOT_FOUND` に収束する。
      const rows = await tx.$queryRaw<ApplyRow[]>(Prisma.sql`
        SELECT outcome, previous_status
          FROM app_apply_scan_status(
                 ${input.objectKey},
                 ${input.status},
                 ${replaceable}::text[],
                 ${input.occurredAt}::timestamptz)`);

      const row = rows[0];
      if (row === undefined || !isScanApplyTarget(row.outcome)) {
        // 関数が結果を返さない = 前提が壊れている。握り潰さない。
        throw new Error('app_apply_scan_status が結果を返しませんでした（migration の不整合）。');
      }
      const previousStatus = (row.previous_status as ScanStatus | null) ?? null;

      // 🔴 対象が無いなら記録もしない（どのテナントの判定か確定できないため）。
      //    受信そのものは `WebhookDelivery`（正規化済み payload + `failureReason`）に残り、
      //    `A-005` から追える —— 監査の証跡は失われない。
      if (row.outcome === 'NOT_FOUND') {
        return { target: 'NOT_FOUND', previousStatus: null, recorded: false };
      }

      // ② `UNIQUE(object_key, object_version_id)` で 1 行に収束させる。
      //    🔴 例外で検出しない（一意制約違反はトランザクションを中断させる。
      //    `webhook-delivery.ts` の冒頭に書いた実測どおり）。
      //    🔴 適用が `KEPT`（重複配信 / 順序逆転）でも記録は試みる ——
      //    「何が届いたか」は状態が動いたかどうかと独立に残す。
      const inserted = await tx.fileScanResult.createMany({
        data: [
          {
            id: uuidV7(input.receivedAt),
            tenantId: ctx.tenantId,
            objectKey: input.objectKey,
            objectVersionId: input.objectVersionId,
            status: input.status,
            rawStatus: input.rawStatus,
            receivedAt: input.receivedAt,
          },
        ],
        skipDuplicates: true,
      });

      return { target: row.outcome, previousStatus, recorded: inserted.count === 1 };
    },
  );
}

export type StalledScanTarget = {
  readonly skillSheetId: string;
  readonly objectKey: string;
};

type StalledRow = { readonly skill_sheet_id: string; readonly object_key: string };

/**
 * 🔴 `SCANNING` のまま滞留しているファイル（docs/05 §8.5「Webhook が届かない場合の保険」）。
 *
 * @param before `now - SCAN_STALL_ALERT_MINUTES`。**この時刻以前にアップロードされたもの**だけ。
 * 🔴 返すのは `id` と `objectKey` だけである（氏名にもスキルにも触れない）。
 * 🔴 「滞留の閾値」を DB に埋め込まない —— `SCAN_STALL_ALERT_MINUTES` は `packages/config` の
 *    設定値であり、呼び出し側（`scan.poll`）が時刻に変換して渡す。
 */
export async function listStalledScanTargets(
  ctx: SystemTenantCtx,
  input: { readonly before: Date; readonly limit: number },
): Promise<readonly StalledScanTarget[]> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      // 🔴 `::integer` を明示する（Prisma は JS の number を `bigint`(int8) として送るため、
      //    キャストが無いと `function ...(timestamptz, bigint) does not exist` になる。実測）。
      const rows = await tx.$queryRaw<StalledRow[]>(Prisma.sql`
        SELECT skill_sheet_id, object_key
          FROM app_list_stalled_scan_targets(${input.before}::timestamptz, ${input.limit}::integer)`);
      return rows.map((row) => ({ skillSheetId: row.skill_sheet_id, objectKey: row.object_key }));
    },
  );
}
