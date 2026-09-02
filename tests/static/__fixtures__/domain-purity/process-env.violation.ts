// 違反: process.env を直接参照している（環境変数は packages/config 経由。CLAUDE.md §3.5）。
export function featureFlag(): string | undefined {
  return process.env.SOME_FLAG;
}
