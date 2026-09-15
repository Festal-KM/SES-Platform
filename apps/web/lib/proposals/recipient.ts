// apps/web/lib/proposals/recipient.ts
// 🔴 「提案先が設定されているか」の**唯一の判定**（docs/05 §6.5「T-09-01 の決着」/ SP-08 の申し送り②）。T-09-01。
//
// 経路 4 の応諾（#33。T-08-07）が作る `Proposal(DRAFT)` は提案先の 2 列が**空文字**である
// （依頼の時点では提案先を決められる主体が居ない。列は `NOT NULL`）。#37 がここを埋め、
// #39 は空のままの `DRAFT` を 422 で止める。判定を 2 か所に書くと、片方だけが「空白だけ」を通す。
//
// 🔴 純粋関数。I/O・`Date`・`@ses/db` に依存しない（`'use client'` の画面からも同じ判定を読む）。
export type ProposalRecipientColumns = {
  readonly recipientCompanyName: string;
  readonly recipientEmail: string;
};

/** 提案先の 2 列が**両方**埋まっているか（空白だけは未設定とみなす）。 */
export function hasProposalRecipient(columns: ProposalRecipientColumns): boolean {
  return columns.recipientCompanyName.trim() !== '' && columns.recipientEmail.trim() !== '';
}
