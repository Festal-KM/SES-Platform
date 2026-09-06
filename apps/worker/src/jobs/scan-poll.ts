// apps/worker/src/jobs/scan-poll.ts
// `scan.poll`（毎 5 分。docs/05 §8.5「Webhook が届かない場合の保険」/ §9.6 / docs/03 §3.4.3-5）。T-05-05。
//
// ============================================================================
// 🔴 このジョブが存在する理由（`SCAN_STALL_ALERT_MINUTES` に設計を寄せる）
// ============================================================================
// GuardDuty のスキャン所要時間は公式に SLA も目安も示されていない（docs/03 §3.4.1 の
// 「スキャン所要時間: 未確認」/ `U-7` / `docs/05` TBD-7）。したがって
// **「N 分で終わるはず」を前提にした設計を採らない。**
//   - `docs/02` 章 7.1 の「2 分以内」は**目標値**であり、システムの前提ではない
//   - 前提にするのは「`SCANNING` のまま `SCAN_STALL_ALERT_MINUTES`（既定 10 分）を超えたら
//     **照会し、それでも分からなければ運用に出す**」という 1 つの規則だけである
// 🔴 この形にしてあるので、E-13 の実測（AWS 環境の構築後）で所要時間が判明しても、
//    **変わるのは設定値 1 つ**であり、コードにも状態機械にも影響しない。
//
// ============================================================================
// 🔴 このジョブは状態を「戻さない」
// ============================================================================
// 照会で得た判定は `scan.apply-result` と**同じ経路**（`applyFileScanResult`）で適用する。
// したがって単調性（`CLEAN` へ戻さない）も `FileScanResult` の記録も自動的に共有される。
// 🔴 2 経路に書き分けない —— 書き分けると、片方だけ順序逆転に弱い実装になる。
//
// 🔴 判定が付いていない（`getResult` が `null`）ものは**何もしない**。`SCANNING` のまま残り、
//    次回（5 分後）も対象になり、`A-005` の「ウイルススキャン失敗 / `SCANNING` 滞留」
//    （docs/05 §16.5）にも出続ける。**推測で `CLEAN` にも `FAILED` にもしない。**
import type { MalwareScanner } from '@ses/connectors';
import { applyFileScanResult, listStalledScanTargets, systemTenantCtx } from '@ses/db';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const SCAN_POLL_JOB = 'scan.poll';

/** 🔴 毎 5 分（docs/05 §9.6）。時刻の出所はここ 1 箇所。 */
export const SCAN_POLL_SCHEDULE = { cron: '*/5 * * * *', timeZone: 'Asia/Tokyo' } as const;

/**
 * 1 回の実行で照会する件数の上限。
 * 🔴 「滞留の総数」ではない。**1 回のジョブが外部 API を叩き続けないため**のページサイズであり、
 *    残りは 5 分後の実行が古い順に拾う（`send.hold-release` の `HOLD_SCAN_LIMIT` と同じ考え方）。
 */
export const SCAN_POLL_LIMIT = 100;

export type ScanPollPayload = { readonly tenantId: string };

export function parseScanPollPayload(raw: unknown): ScanPollPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(SCAN_POLL_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(SCAN_POLL_JOB, 'tenantId', record.tenantId) };
}

export type ScanPollDeps = {
  /** 🔴 起動時 DI で選ばれた実装（`demo` はモック / `sandbox` 以上は GuardDuty）。 */
  readonly malwareScanner: MalwareScanner;
  /** `SCAN_STALL_ALERT_MINUTES`（`packages/config`。既定 10）。 */
  readonly stallAlertMinutes: number;
  readonly now: () => Date;
  readonly scanLimit?: number;
};

export type ScanPollOutcome = {
  /** 滞留として照会した件数。 */
  readonly scanned: number;
  /** 照会で判定が付き、状態を適用した件数。 */
  readonly resolved: number;
  /**
   * 🔴 判定が付いていない件数（`A-005` の根拠）。
   *    **これが 0 でないことは障害ではない**が、増え続けるなら EventBridge の経路か
   *    GuardDuty 側に問題がある。
   */
  readonly unresolved: number;
};

export type ScanPollHandler = (payload: unknown, jobId: string) => Promise<ScanPollOutcome>;

export function createScanPollHandler(deps: ScanPollDeps): ScanPollHandler {
  return async (payload, jobId) => {
    const job = parseScanPollPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: SCAN_POLL_JOB, jobId });
    const now = deps.now();
    // 🔴 閾値は設定値からその場で時刻に変換する（DB にも SQL にも分数を埋め込まない）。
    const before = new Date(now.getTime() - deps.stallAlertMinutes * 60_000);

    const targets = await listStalledScanTargets(ctx, {
      before,
      limit: deps.scanLimit ?? SCAN_POLL_LIMIT,
    });

    let resolved = 0;
    let unresolved = 0;
    for (const target of targets) {
      // 🔴 版を指定せず最新版を照会する（`skill_sheets` は版 ID を持たない。docs/05 §14.1 では
      //    キーの `{uuid}` が発行ごとに新しいため、キー = 1 オブジェクトである）。
      //    実際に判定が付いていた版は戻り値の `objectVersionId` が示し、それを
      //    `FileScanResult` の重複排除キーに使う。
      const reading = await deps.malwareScanner.getResult(target.objectKey, null);
      if (reading === null) {
        // 🔴 まだ判定が無い。**何もしない**（次回も対象になる。A-005 にも出続ける）。
        unresolved += 1;
        continue;
      }
      const applied = await applyFileScanResult(ctx, {
        objectKey: target.objectKey,
        objectVersionId: reading.objectVersionId,
        status: reading.status,
        rawStatus: reading.rawStatus,
        // 🔴 照会では「いつ判定が付いたか」を知りようがない（タグに時刻が無い）。
        //    照会した時刻を両方に使う（推測の時刻を作らない）。
        occurredAt: now,
        receivedAt: now,
      });
      // 🔴 `KEPT`（他の実行が先に適用した）も `NOT_FOUND`（照会中に消えた）も異常ではない。
      //    「照会して判定が取れた」ことを resolved として数える。
      if (applied.target !== 'NOT_FOUND') resolved += 1;
      else unresolved += 1;
    }

    return { scanned: targets.length, resolved, unresolved };
  };
}
