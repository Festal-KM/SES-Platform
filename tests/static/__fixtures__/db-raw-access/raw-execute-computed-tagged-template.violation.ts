// 違反: $executeRaw の computed member access + タグ付きテンプレート形（CLAUDE.md §3.1 / docs/05 §4.3）
export async function run(client: { $executeRaw: (strings: TemplateStringsArray) => Promise<unknown> }) {
  return client['$executeRaw']`DELETE FROM engineers WHERE id = 'x'`;
}
