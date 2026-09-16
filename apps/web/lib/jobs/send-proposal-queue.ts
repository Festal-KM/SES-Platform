// apps/web/lib/jobs/send-proposal-queue.ts
// `send.proposal`（docs/05 §9.4 / §10.2）の **enqueue 側だけ**。T-09-06。
//
// 🔴 `lib/jobs/gate-run-queue.ts` と同じ構造（`CLAUDE.md` §11.1 の「成功したように見えて実際には起きていない」を作らない）:
//    ① 実装が登録されていない状態で enqueue したら**例外**（黙って捨てない。202 を返しながら誰も送らない応答を作らない）
//    ② 実装の選択は起動時の 1 箇所（`lib/db/bootstrap.ts`）だけで行う
//
// 🔴 **モックの送信キューを作らない。** 送信は Redis（全環境で必須）に積み、消費するのは `apps/worker` の 1 入口
//    （`send-proposal.ts`）だけである。積めないなら #43 そのものを失敗させる（利用者に見えるところで壊す）。
// 🔴 payload と `jobId` の契約は `@ses/connectors` の `SendProposalJob` / `sendProposalJobId`（enqueue 側と実行側の契約）。
import type { SendProposalJobQueue } from '@ses/connectors';

export type { SendProposalJobQueue };

/** 🔴 キューが未登録のまま enqueue しようとした（起動時 DI の失敗）。**握り潰さない。** */
export class SendProposalJobQueueUnavailableError extends Error {
  constructor() {
    super(
      'send.proposal キューが登録されていません（起動時 DI の失敗）。' +
        '提案の送信を成立したことにはできません（CLAUDE.md §11.1 / docs/05 §9.4）。',
    );
    this.name = 'SendProposalJobQueueUnavailableError';
  }
}

let queue: SendProposalJobQueue | null = null;

/** 🔴 起動時に 1 回だけ呼ぶ（`lib/db/bootstrap.ts`）。リクエストごとに差し替えない。 */
export function configureSendProposalJobQueue(implementation: SendProposalJobQueue): void {
  queue = implementation;
}

/** 🔴 テスト用の後始末（登録を解除する）。本番経路からは呼ばない。 */
export function resetSendProposalJobQueue(): void {
  queue = null;
}

/** 登録済みのキューを取り出す。未登録なら例外（fail-closed）。 */
export function requireSendProposalJobQueue(): SendProposalJobQueue {
  if (queue === null) throw new SendProposalJobQueueUnavailableError();
  return queue;
}
