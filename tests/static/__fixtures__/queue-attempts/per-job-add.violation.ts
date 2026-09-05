// 違反 fixture: `.add()` の per-job オプションで `attempts` / `backoff` を上書きする
// （T-04-03。キュー定義の `attempts: 1` は既定値でしかなく、enqueue 側で上書きできてしまう）。
declare const queue: {
  add(name: string, payload: unknown, options?: Record<string, unknown>): Promise<void>;
};

export async function enqueueProposal(proposalId: string): Promise<void> {
  // 🔴 これが素通りすると `send.proposal` が 3 回再試行され、二重送信になる。
  await queue.add('send.proposal', { proposalId }, { attempts: 3 });
}

export async function enqueueContract(contractId: string): Promise<void> {
  await queue.add('send.contract', { contractId }, { backoff: { type: 'fixed', delay: 1000 } });
}
