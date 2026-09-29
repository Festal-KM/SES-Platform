// tests/static/__fixtures__/ui-classes/clean.ok.tsx
// 🔴 対照（合成ソース）: `docs/04` §7.9 / §7.10 / §7.1 に**従っている**書き方。
//    (a)(c)(f)(g)(j) のどれも 0 件になる。**誤検知する検査はいずれ緩められる**ので、
//    「正しい書き方が通ること」を同じ強さで固定する。
//
// ⚠️ 次のものを**違反にしない**ことがこのファイルの要点である。
//    - `bg-transparent` / `text-current` / `border-transparent` … 構造であって色の選択ではない
//    - `text-left` / `text-nowrap` / `text-ellipsis` … `text-` で始まるが文字サイズではない
//    - `mx-auto` / `p-0` / `px-px` … 段ではなく「無し」の表現
//    - `sm:grid-cols-2` / `lg:table-cell` / `first:border-t-0` / `odd:bg-bg-subtle` … 状態ではない
//    - `min-w-40` / `w-full` … (c) が見るのは `max-w-*` と `style` の width だけ
export function Clean(): unknown {
  const color = 'text-fg text-fg-muted bg-bg-subtle border-border-strong bg-brand text-brand-fg';
  const structural = 'bg-transparent text-current border-transparent fill-current';
  const spacing = 'p-4 px-2 py-3 gap-6 mt-8 space-y-12 p-0 mx-auto px-px';
  const type = 'text-title text-lg text-body text-cell text-xs text-micro';
  const typeLike = 'text-left text-center text-nowrap text-ellipsis';
  const layout = 'sm:grid-cols-2 lg:table-cell first:border-t-0 odd:bg-bg-subtle min-w-40 w-full';
  return [color, structural, spacing, type, typeLike, layout];
}
