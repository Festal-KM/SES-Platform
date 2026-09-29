// tests/static/__fixtures__/ui-classes/violation.tsx
// 🔴 対照（合成ソース）: `docs/05` §17.7.1 の (a)(c)(f)(g)(j) の違反を**意図的に**1 ファイルに集めたもの。
//    走査（ファイル収集 → AST → クラス名候補 → 検出器）が端から端まで働くことを示す。
//    🔴 このファイルは `collectSourceFiles` が `__fixtures__` を除外するため、本番の走査には入らない
//       （テスト側が明示的にこのディレクトリを root として渡したときだけ読まれる）。
//
// ⚠️ **コメントの中に書いたクラス名（`text-slate-500` / `max-w-3xl` / `hover:underline`）は
//    拾われない**こと自体が対照である（正規表現でファイル全体を割る実装なら拾ってしまう）。
export function Violation(): unknown {
  // (a) 色: primitive の階調 / 無彩色の極 / 任意値
  const color = 'text-slate-700 bg-white border-red-300 text-[#111827] text-[var(--color-fg)]';
  // (c) 幅: `max-w-*`
  const width = 'max-w-3xl sm:max-w-md';
  // (f) spacing: 段の外
  const spacing = 'pl-5 py-0.5 mt-10';
  // (g) 文字サイズ: 6 トークンの外
  const type = 'text-sm text-2xl text-[13px]';
  // (j) 8 状態: 画面側のバリアント
  const state = 'hover:underline focus-visible:ring-2 disabled:opacity-60 data-[state=selected]:bg-brand-bg';
  return [color, width, spacing, type, state];
}
