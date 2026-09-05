// packages/connectors/src/email/domain-jobs.ts
// `domain.provision` / `domain.verify` の payload とキューの契約（docs/05 §8.3 / §9.9）。T-04-04。
//
// 🔴 `account-mail.ts` と同じ理由でここに置く: payload の形は `apps/web`（enqueue する側。
//    #71 / #72 / API-A4）と `apps/worker`（実行する側）の**契約**であり、片方のアプリに置くと
//    もう片方が「同じ形のはずの型」を再定義することになる。
//    キュー定義（名前・`attempts`）は `packages/connectors/src/queues.ts` の 1 箇所にある。
//
// 🔴 payload に秘匿値は無い（ドメイン名と行の ID だけ）。DKIM トークンは DNS に公開する値であり、
//    これも秘匿ではない（`TenantSendingDomain.dkimTokens` の列コメント）。

/** 🔴 §9.1「payload に `tenantId` を必ず含める」。 */
export type DomainJob = {
  readonly tenantId: string;
  readonly sendingDomainId: string;
};

/**
 * enqueue の実装（BullMQ / 保留キュー）が満たす契約。
 *
 * 🔴 **キューが未登録のまま enqueue できてはならない**（`CLAUDE.md` §11.1）。未登録なら
 *    呼び出し側が例外にして操作ごと失敗させる —— 黙って捨てると「登録したのに DNS レコードが
 *    永久に出てこない」状態になり、`F-001 AC-4` が完了しない理由が利用者に分からない。
 */
export type DomainJobQueue = {
  enqueueProvision(job: DomainJob): Promise<void>;
  enqueueVerify(job: DomainJob): Promise<void>;
};
