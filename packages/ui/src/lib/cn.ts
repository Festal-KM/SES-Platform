// packages/ui/src/lib/cn.ts
// 🔴 shadcn/ui の取り込みコンポーネントが使う最小のクラス名結合ユーティリティ。
//    `class-variance-authority` / `tailwind-merge` は導入せず、必要になった時点で追加する
//    （CLAUDE.md「新規依存の追加は宣言のみ」/ docs/sprints/SP-03 T-03-06「必要な最小
//    コンポーネントのみ」）。競合するクラス名の後勝ちは呼び出し側の順序に委ねる。
export function cn(...classes: ReadonlyArray<string | false | null | undefined>): string {
  return classes
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}
