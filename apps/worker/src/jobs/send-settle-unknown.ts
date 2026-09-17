// apps/worker/src/jobs/send-settle-unknown.ts
// 🔴 `send.settle-unknown`（毎 10 分。docs/05 §10.6「T-09-07 の実装の決着」/ `F-022 AC-2` / `CLAUDE.md` §4.2
//    「`SUBMITTING` は片道。入ったら必ず `SUBMITTED` か `SUBMIT_FAILED` に確定させる」）。T-09-07。
//
// ============================================================================
// 🔴 このジョブがやることは 1 つだけである —— 「確定させる」。送らない・戻さない
// ============================================================================
//   送信ジョブ（`send.proposal`）は ③ で `SUBMITTING` に入れ、⑤ で外部を呼び、⑥ で確定する。⑤ の後・⑥ の前に
//   プロセスが消える / DB 例外で落ちると、提案は `SUBMITTING`、予約は `RESERVED` のまま誰も確定しない（滞留）。
//   利用者の `S-022` は `SUBMIT_FAILED` 専用で `SUBMITTING` は出ず、運営者の `A-005` 項目 2 は read-only で状態を
//   書き換えられない（`CLAUDE.md` §10.5）。したがって片道を完結させる機構がこのジョブである:
//     `SUBMITTING` かつ `updated_at <= now − SUBMITTING_STALL_ALERT_MINUTES` の提案を、
//     `SendAttempt.UNKNOWN` + `SUBMIT_FAILED(UNKNOWN:SETTLE_TIMEOUT)` に**確定させる**。
//
// 🔴 これは自動リトライではない（`CLAUDE.md` §3.4 / docs/05 §10.6 / `F-023 AC-1`）:
//   - **外部 API を呼ばない**（deps に `EmailSender` が無い。型で担保）
//   - **`APPROVED` に戻さない**（`SUBMIT_FAILED → APPROVED` は #44 の人間の専有。`tests/static/proposal-resend-human-only.test.ts`）
//   - **新しい試行を作らない**（`attempt_seq` を採番しない。`send_attempts` には `RESERVED → UNKNOWN` の CAS だけ）
//   確定した行は `S-022` に「応答不明（届いた可能性があります）」として現れ、人間が到達を確認したうえで #44 を選ぶ。
//
// 🔴 本体は `packages/db` の `settleStalledProposalSubmissions`（CAS + 履歴 + 監査）。**ワーカーは起動と配線だけ**を持つ
//    （`CLAUDE.md` §2.1「worker: 業務ロジックを持たない」）。テナント横断のクエリを書かない —— `runScheduled` →
//    `fanOutToTenants`（`runtime.ts`）がテナントを列挙し、本ハンドラは payload の `tenantId` で **1 テナント分**を処理する。
// 🔴 冪等: 母集団が未処理条件（`SUBMITTING` × 閾値超過）で決まり、CAS が `state = 'SUBMITTING'` / `status = 'RESERVED'` を
//    条件に含むため、再実行しても 2 度目は 0 件である（`attempts: 3` を許せる根拠）。
import type { InternalJobName } from '@ses/connectors';
import {
  settleStalledProposalSubmissions,
  systemTenantCtx,
  type SettleStalledProposalSubmissionsOutcome,
} from '@ses/db';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const SEND_SETTLE_UNKNOWN_JOB = 'send.settle-unknown' satisfies InternalJobName;

/** 🔴 毎 10 分（`send.hold-release` と同じ周期。閾値 30 分 + 最大 10 分の遅れで確定する）。時刻の出所はここ 1 箇所。 */
export const SEND_SETTLE_UNKNOWN_SCHEDULE = { cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' } as const;

export type SendSettleUnknownPayload = { readonly tenantId: string };

export function parseSendSettleUnknownPayload(raw: unknown): SendSettleUnknownPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(SEND_SETTLE_UNKNOWN_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  // 🔴 分離キーは payload から来るが、それはスケジュール側（テナントのファンアウト）が確定させた値である
  //    （docs/05 §9.1「payload に tenantId を必ず含める」）。
  return { tenantId: requireUuid(SEND_SETTLE_UNKNOWN_JOB, 'tenantId', record.tenantId) };
}

export type SendSettleUnknownDeps = {
  /** 🔴 現在時刻の取得も注入する（閾値の判定をテストで固定できるようにするため）。 */
  readonly now: () => Date;
  /**
   * 🔴 `SUBMITTING_STALL_ALERT_MINUTES`（`packages/config`。既定 30）。`A-005` 項目 2 が「滞留」と数える閾値と**同じ値**を
   *    使う —— 運営者が見た滞留は、次の実行（最大 10 分後）で必ず確定される。
   */
  readonly submittingStallMinutes: number;
  /** 1 回の実行で読む上限（省略時は `packages/db` の既定）。 */
  readonly settleStallScanLimit?: number;
};

export type SendSettleUnknownOutcome = SettleStalledProposalSubmissionsOutcome;

export type SendSettleUnknownHandler = (payload: unknown, jobId: string) => Promise<SendSettleUnknownOutcome>;

export function createSendSettleUnknownHandler(deps: SendSettleUnknownDeps): SendSettleUnknownHandler {
  return async (payload, jobId) => {
    const job = parseSendSettleUnknownPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: SEND_SETTLE_UNKNOWN_JOB, jobId });
    return settleStalledProposalSubmissions(ctx, {
      stallThresholdMinutes: deps.submittingStallMinutes,
      now: deps.now(),
      ...(deps.settleStallScanLimit === undefined ? {} : { limit: deps.settleStallScanLimit }),
    });
  };
}
