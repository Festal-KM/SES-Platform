// apps/web/lib/jobs/account-mail.ts
// `account.mail` ジョブ（docs/05 §9.4）の **enqueue 側だけ**。
//
// 本タスク（T-03-03）の射程は enqueue までである。ジョブ本体（`EmailDispatch` の作成・
// `resolveRecipientClass` による宛先分類・実送信 / モックの選択）は **SP-04 の単一経路**が実装する。
// キュー定義そのものの置き場所は `packages/connectors/src/queues.ts`（docs/05 §9.1）であり、
// 🔴 **SP-04 でそこへ移す**。ここに BullMQ を持ち込まない（`apps/web` がキューの実装を知らない形を保つ）。
//
// 🔴 CLAUDE.md §11.1 の「成功したように見えて実際には送信されていない」を作らないための構造:
//    ① 実装が **1 つも登録されていない状態で enqueue したら例外**（黙って捨てない）
//    ② 実装の選択は起動時の 1 箇所（`lib/db/bootstrap.ts`）だけで行い、
//       その判断材料は `resolveConnectorSelection`（`packages/config`。APP_ENV 分岐の唯一の場所）である
//    ③ 「送られる予定」なのか「モックで終わる」のかを、呼び出し側が推測せず戻り値で受け取る
//       （#14 の `deliveryState`。docs/05 §6.4）

/** docs/05 §9.4 の `account.mail` payload の `kind`。 */
export const ACCOUNT_MAIL_KINDS = ['INVITATION', 'PASSWORD_RESET'] as const;

export type AccountMailKind = (typeof ACCOUNT_MAIL_KINDS)[number];

/**
 * `account.mail` の payload（docs/05 §9.4）。
 *
 * 🔴 `token` は**平文**である。payload（Redis）にだけ載り、ジョブの完了とともに消える。
 *    DB・ログ・監査ログには載せない（`packages/config` の redact denylist に `token` がある）。
 */
export type AccountMailJob = {
  readonly tenantId: string;
  readonly kind: AccountMailKind;
  /** `INVITATION` なら `Invitation.id`、`PASSWORD_RESET` なら `User.id`。 */
  readonly targetId: string;
  readonly token: string;
};

/**
 * enqueue の結果。#14 の `deliveryState`（docs/05 §6.4）にそのまま対応する。
 *
 * - `QUEUED`: 実送信の経路に載った
 * - `MOCKED`: モックのメールコネクタで終わる（`development` / `demo`）
 *
 * 🔴 `HELD_DOMAIN_UNVERIFIED`（取引先招待 × 独自ドメイン未検証。docs/05 §8.3）は
 *    **SP-04 が足す**。Phase 0 の #14 はホストロール宛だけなので発生しない
 *    （`F-001 AC-5`: 自社メンバー宛は送信ドメインの検証状態に依存しない）。
 */
export const ACCOUNT_MAIL_DELIVERY_STATES = ['QUEUED', 'MOCKED'] as const;

export type AccountMailDeliveryState = (typeof ACCOUNT_MAIL_DELIVERY_STATES)[number];

/** enqueue の実装（BullMQ / モック）が満たす契約。 */
export type AccountMailQueue = {
  enqueue(job: AccountMailJob): Promise<AccountMailDeliveryState>;
};

/**
 * 🔴 キューが未登録のまま enqueue しようとした（起動時 DI の失敗）。
 *    **握り潰さない。** 招待・再設定の操作ごと失敗させ、「作成されたのに永久に届かない」
 *    状態を作らない（CLAUDE.md §11.1）。
 */
export class AccountMailQueueUnavailableError extends Error {
  constructor() {
    super(
      'account.mail キューが登録されていません（起動時 DI の失敗）。' +
        'メールが送られないまま操作を成立させることはできません（CLAUDE.md §11.1 / docs/05 §9.4）。',
    );
    this.name = 'AccountMailQueueUnavailableError';
  }
}

let queue: AccountMailQueue | null = null;

/**
 * 🔴 起動時に 1 回だけ呼ぶ（`lib/db/bootstrap.ts`）。リクエストごとに差し替えない。
 *    結合テストは、記録用の実装を差し込んで enqueue 回数を検証する。
 */
export function configureAccountMailQueue(implementation: AccountMailQueue): void {
  queue = implementation;
}

/** 🔴 テスト用の後始末（登録を解除する）。本番経路からは呼ばない。 */
export function resetAccountMailQueue(): void {
  queue = null;
}

/**
 * 登録済みのキューを取り出す。未登録なら例外（fail-closed）。
 *
 * 🔴 呼び出し側は**副作用を起こす前に**これを呼ぶ。理由は 2 つある:
 *    ① DB に招待を作ってから「キューが無い」と分かると、届かない招待だけが残る
 *    ② パスワード再設定では、後ろに置くと「該当したときだけ失敗する」＝
 *       応答がアカウントの存在を教えることになる（docs/05 §4.8 / §6.3 #5）
 */
export function requireAccountMailQueue(): AccountMailQueue {
  if (queue === null) throw new AccountMailQueueUnavailableError();
  return queue;
}

/**
 * `development` / `demo`（= メールコネクタがモック）で使う保留キュー。
 *
 * 🔴 これは「モックのメール送信」ではない。**ジョブが積まれた事実だけを保持する**入れ物であり、
 *    実際の送信 / モック送信は SP-04 の `account.mail` ハンドラが
 *    `packages/connectors/src/mock/**` の `MockEmailSender` で行う（docs/05 §13.2。
 *    テスト専用の別モックを作らない）。
 * 🔴 `production` でこれが選ばれることはない（`bootstrap.ts` が選択の根拠を
 *    `resolveConnectorSelection` に置いており、`production` の email は必ず `real`）。
 */
export class PendingAccountMailQueue implements AccountMailQueue {
  private readonly jobs: AccountMailJob[] = [];

  async enqueue(job: AccountMailJob): Promise<AccountMailDeliveryState> {
    this.jobs.push(job);
    return 'MOCKED';
  }

  /** 積まれた件数（docs/05 §13.2 の `callCount()` と同じ用途）。 */
  callCount(): number {
    return this.jobs.length;
  }

  /** 積まれたジョブ（🔴 平文トークンを含む。テストとローカルの確認以外で外に出さない）。 */
  jobsOf(kind: AccountMailKind): readonly AccountMailJob[] {
    return this.jobs.filter((job) => job.kind === kind);
  }
}
