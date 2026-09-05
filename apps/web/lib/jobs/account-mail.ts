// apps/web/lib/jobs/account-mail.ts
// `account.mail`（docs/05 §9.4）の **enqueue 側だけ**。
//
// 🔴 T-04-03: payload の型（`AccountMailJob` / `AccountMailKind` / `AccountMailDeliveryState`）は
//    **`@ses/connectors` へ移設した**（T-03-03 からの申し送り）。payload は `apps/web`（enqueue）と
//    `apps/worker`（実行）の**契約**であり、片方のアプリに置くともう片方が同じ形を再定義する。
//    ジョブ本体（`EmailDispatch` の作成・保留判定・送信）は `apps/worker/src/jobs/account-mail.ts`。
//    キュー定義（名前・`attempts`・バックオフ）は `packages/connectors/src/queues.ts` の 1 箇所。
//
// 🔴 CLAUDE.md §11.1 の「成功したように見えて実際には送信されていない」を作らないための構造:
//    ① 実装が **1 つも登録されていない状態で enqueue したら例外**（黙って捨てない）
//    ② 実装の選択は起動時の 1 箇所（`lib/db/bootstrap.ts`）だけで行い、
//       その判断材料は `resolveConnectorSelection`（`packages/config`。APP_ENV 分岐の唯一の場所）である
//    ③ 「送られる予定」なのか「モックで終わる」のかを、呼び出し側が推測せず戻り値で受け取る
//       （#14 の `deliveryState`。docs/05 §6.4）
import {
  ACCOUNT_MAIL_DELIVERY_STATES,
  ACCOUNT_MAIL_KINDS,
  type AccountMailDeliveryState,
  type AccountMailJob,
  type AccountMailKind,
  type AccountMailQueue,
} from '@ses/connectors';
import { isAccountMailRecipientClass } from '@ses/db';
import type { AccountMailRecipientClass, RecipientClass } from '@ses/db';

export {
  ACCOUNT_MAIL_DELIVERY_STATES,
  ACCOUNT_MAIL_KINDS,
  type AccountMailDeliveryState,
  type AccountMailJob,
  type AccountMailKind,
  type AccountMailQueue,
};

/**
 * 🔴 `account.mail` に載せられない宛先分類（分類 3 / 4）が導かれた（docs/05 §9.4）。
 *
 * 招待・パスワード再設定の宛先は「招待中の本人 / 本人」に限られるため、実際には起こらない。
 * 起きるとすれば所属の引き当てが壊れているときであり、**その状態で送ってはならない**
 * （分類 3 / 4 は業務上の外部送信であり、`account.mail` の経路には独自ドメインの検証も
 * `sandbox` のモック分岐も無い）。握り潰さず操作ごと失敗させる（CLAUDE.md §11.1）。
 */
export class AccountMailRecipientClassError extends Error {
  constructor(readonly recipientClass: RecipientClass) {
    super(
      `宛先分類 '${recipientClass}' は account.mail に載せられません（docs/05 §9.4）。` +
        '招待・パスワード再設定の宛先は分類 1 / 2 に限られます。',
    );
    this.name = 'AccountMailRecipientClassError';
  }
}

/**
 * 🔴 `resolveRecipientClass` が返した分類を `account.mail` の payload 型へ絞る唯一の関数。
 *    絞れないときは例外（fail-closed）。**`CLIENT` を黙って送信対象にしない。**
 */
export function requireAccountMailRecipientClass(
  recipientClass: RecipientClass,
): AccountMailRecipientClass {
  if (!isAccountMailRecipientClass(recipientClass)) {
    throw new AccountMailRecipientClassError(recipientClass);
  }
  return recipientClass;
}

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
 *    実際の送信 / モック送信は `apps/worker/src/jobs/account-mail.ts` が
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
