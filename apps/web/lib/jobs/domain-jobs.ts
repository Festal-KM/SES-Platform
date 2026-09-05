// apps/web/lib/jobs/domain-jobs.ts
// `domain.provision` / `domain.verify` の **enqueue 側だけ**（docs/05 §8.3 / §9.9）。T-04-04。
//
// 🔴 `lib/jobs/account-mail.ts` と同じ構造にしてある（`CLAUDE.md` §11.1 の
//    「成功したように見えて実際には起きていない」を作らないため）:
//    ① 実装が登録されていない状態で enqueue したら**例外**（黙って捨てない）
//    ② 実装の選択は起動時の 1 箇所（`lib/db/bootstrap.ts`）だけで行う
//
// 🔴 ジョブ本体（SES の呼び出しと DB 反映）は `apps/worker/src/jobs/domain-*.ts` にある。
//    payload の型は `@ses/connectors` の `DomainJob`（enqueue 側と実行側の契約）。
import type { DomainJob, DomainJobQueue } from '@ses/connectors';

export type { DomainJob, DomainJobQueue };

/**
 * 🔴 キューが未登録のまま enqueue しようとした（起動時 DI の失敗）。
 *
 * **握り潰さない。** 送信ドメインの登録・再確認の操作ごと失敗させる ——
 * 黙って捨てると「登録したのに DNS レコードが永久に出てこない」状態になり、
 * `F-001 AC-4`（取引先へ届く送信の前提条件）が満たせない理由が利用者に分からない。
 */
export class DomainJobQueueUnavailableError extends Error {
  constructor() {
    super(
      'domain.* キューが登録されていません（起動時 DI の失敗）。' +
        '送信ドメインの登録・検証を成立したことにはできません（CLAUDE.md §11.1 / docs/05 §8.3）。',
    );
    this.name = 'DomainJobQueueUnavailableError';
  }
}

let queue: DomainJobQueue | null = null;

/** 🔴 起動時に 1 回だけ呼ぶ（`lib/db/bootstrap.ts`）。リクエストごとに差し替えない。 */
export function configureDomainJobQueue(implementation: DomainJobQueue): void {
  queue = implementation;
}

/** 🔴 テスト用の後始末（登録を解除する）。本番経路からは呼ばない。 */
export function resetDomainJobQueue(): void {
  queue = null;
}

/** 登録済みのキューを取り出す。未登録なら例外（fail-closed）。 */
export function requireDomainJobQueue(): DomainJobQueue {
  if (queue === null) throw new DomainJobQueueUnavailableError();
  return queue;
}

/**
 * `development` / `demo`（= メールコネクタがモック）で使う保留キュー。
 *
 * 🔴 これは「モックの SES」ではない。**ジョブが積まれた事実だけを保持する**入れ物であり、
 *    実際の identity 作成 / 検証は `apps/worker/src/jobs/domain-*.ts` が行う。
 *    BullMQ の配線は SP-07 である。
 */
export class PendingDomainJobQueue implements DomainJobQueue {
  private readonly provisions: DomainJob[] = [];
  private readonly verifications: DomainJob[] = [];

  async enqueueProvision(job: DomainJob): Promise<void> {
    this.provisions.push(job);
  }

  async enqueueVerify(job: DomainJob): Promise<void> {
    this.verifications.push(job);
  }

  /** 積まれた件数（docs/05 §13.2 の `callCount()` と同じ用途）。 */
  callCount(): number {
    return this.provisions.length + this.verifications.length;
  }

  jobsOf(kind: 'provision' | 'verify'): readonly DomainJob[] {
    return kind === 'provision' ? this.provisions : this.verifications;
  }
}
