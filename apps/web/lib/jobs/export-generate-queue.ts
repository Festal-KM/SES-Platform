// apps/web/lib/jobs/export-generate-queue.ts
// `export.generate`（docs/05 §9.6 / §6.7 #77）の **enqueue 側だけ**。T-10-09。
//
// 🔴 `lib/jobs/send-proposal-queue.ts` と同じ構造（`CLAUDE.md` §11.1 の「成功したように見えて実際には起きていない」を作らない）:
//    ① 実装が登録されていない状態で enqueue したら**例外**（黙って捨てない。202 を返しながら誰も生成しない応答を作らない）
//    ② 実装の選択は起動時の 1 箇所（`lib/db/bootstrap.ts`）だけで行う。**環境で分岐しない**（Redis は全環境で必須）
// 🔴 payload と `jobId` の契約は `@ses/connectors` の `ExportGenerateJob` / `exportGenerateJobId`（enqueue 側と実行側の契約）。
import type { ExportGenerateJobQueue } from '@ses/connectors';

export type { ExportGenerateJobQueue };

/** 🔴 キューが未登録のまま enqueue しようとした（起動時 DI の失敗）。**握り潰さない。** */
export class ExportGenerateJobQueueUnavailableError extends Error {
  constructor() {
    super(
      'export.generate キューが登録されていません（起動時 DI の失敗）。' +
        '返却データの生成を受け付けたことにはできません（CLAUDE.md §11.1 / docs/05 §9.6）。',
    );
    this.name = 'ExportGenerateJobQueueUnavailableError';
  }
}

let queue: ExportGenerateJobQueue | null = null;

/** 🔴 起動時に 1 回だけ呼ぶ（`lib/db/bootstrap.ts`）。リクエストごとに差し替えない。 */
export function configureExportGenerateJobQueue(implementation: ExportGenerateJobQueue): void {
  queue = implementation;
}

/** 🔴 テスト用の後始末（登録を解除する）。本番経路からは呼ばない。 */
export function resetExportGenerateJobQueue(): void {
  queue = null;
}

/** 登録済みのキューを取り出す。未登録なら例外（fail-closed）。 */
export function requireExportGenerateJobQueue(): ExportGenerateJobQueue {
  if (queue === null) throw new ExportGenerateJobQueueUnavailableError();
  return queue;
}
