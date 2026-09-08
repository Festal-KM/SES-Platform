// apps/web/lib/jobs/gate-run-queue.ts
// `gate.run`（docs/05 §9.3 / §9.10）の **enqueue 側だけ**。T-07-08。
//
// 🔴 `lib/jobs/account-mail.ts` / `lib/jobs/domain-jobs.ts` と同じ構造にしてある
//    （`CLAUDE.md` §11.1 の「成功したように見えて実際には起きていない」を作らないため）:
//    ① 実装が登録されていない状態で enqueue したら**例外**（黙って捨てない）
//    ② 実装の選択は起動時の 1 箇所（`lib/db/bootstrap.ts`）だけで行う
//
// 🔴 **モックのゲートキューを作らない。** 送信系（`account.mail` 等）は「実装が入るまで
//    保留キューに積む」形にしてあるが、ゲートにその選択肢は無い —— ゲートはテナント外への
//    共有の前提条件であり（`F-020 AC-1`）、積んだだけで誰も実行しない状態は
//    「対象が `GATE_RUNNING` のまま永久に止まる」ことを意味する。実行できないなら
//    **レビュー依頼そのものを失敗させる**（利用者に見えるところで壊す）。
//
// 🔴 ジョブ本体は `apps/worker/src/jobs/gate-run.ts`、payload と `jobId` の型は
//    `@ses/connectors` の `GateRunJob` / `gateRunJobId`（enqueue 側と実行側の契約）。
import type { GateRunJobQueue } from '@ses/connectors';

export type { GateRunJobQueue };

/**
 * 🔴 キューが未登録のまま enqueue しようとした（起動時 DI の失敗）。
 *
 * **握り潰さない。** レビュー依頼（#39）ごと失敗させる —— 黙って捨てると
 * 「レビューを依頼したのに永久に結果が出ない」状態になり、利用者は
 * `GATE_RUNNING` の対象を承認も修正もできなくなる。
 */
export class GateRunJobQueueUnavailableError extends Error {
  constructor() {
    super(
      'gate.run キューが登録されていません（起動時 DI の失敗）。' +
        '品質ゲートの実行を成立したことにはできません（CLAUDE.md §11.1 / docs/05 §9.3）。',
    );
    this.name = 'GateRunJobQueueUnavailableError';
  }
}

let queue: GateRunJobQueue | null = null;

/** 🔴 起動時に 1 回だけ呼ぶ（`lib/db/bootstrap.ts`）。リクエストごとに差し替えない。 */
export function configureGateRunJobQueue(implementation: GateRunJobQueue): void {
  queue = implementation;
}

/** 🔴 テスト用の後始末（登録を解除する）。本番経路からは呼ばない。 */
export function resetGateRunJobQueue(): void {
  queue = null;
}

/** 登録済みのキューを取り出す。未登録なら例外（fail-closed）。 */
export function requireGateRunJobQueue(): GateRunJobQueue {
  if (queue === null) throw new GateRunJobQueueUnavailableError();
  return queue;
}
