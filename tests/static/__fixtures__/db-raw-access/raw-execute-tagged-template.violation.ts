// 違反: $executeRaw のタグ付きテンプレート形での直接呼び出し（CLAUDE.md §3.1 / docs/05 §4.3）
// Prisma の推奨記法（tests/isolation/roles.test.ts と同じ形）でも検出できることを確認する。
export async function run(client: { $executeRaw: (strings: TemplateStringsArray) => Promise<unknown> }) {
  return client.$executeRaw`DELETE FROM engineers WHERE id = 'x'`;
}
