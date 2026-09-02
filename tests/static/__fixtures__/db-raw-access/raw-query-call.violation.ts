// 違反: $queryRaw の関数呼び出し形での直接呼び出し（CLAUDE.md §3.1 / docs/05 §4.3）
// packages/db/src/** と tests/isolation/** 以外では withTenant / withHostTenant 経由に限る。
export async function run(client: { $queryRaw: (sql: unknown) => Promise<unknown> }) {
  return client.$queryRaw('SELECT 1');
}
