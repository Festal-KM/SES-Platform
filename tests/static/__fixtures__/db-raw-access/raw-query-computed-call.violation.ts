// 違反: $queryRaw の computed member access 形での直接呼び出し（CLAUDE.md §3.1 / docs/05 §4.3）
// 🔴 ドット記法（client.$queryRaw）だけを塞ぐと、文字列添字が素通しの経路として残る
//    （T-01-06 レビュー申し送り。T-02-07 で塞いだ）。
export async function run(client: { $queryRaw: (sql: unknown) => Promise<unknown> }) {
  return client['$queryRaw']('SELECT 1');
}
