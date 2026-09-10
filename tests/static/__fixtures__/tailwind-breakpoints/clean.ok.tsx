// tests/static/__fixtures__/tailwind-breakpoints/clean.ok.tsx
// 🔴 誤検知してはいけない形。
//    ①既定の画面幅バリアント（sm / md / lg / xl / 2xl）
//    ②画面幅ではないバリアント（hover / focus-visible / disabled / group-hover / 任意セレクタ）
//    ③`max-w-*` / `min-h-*` のような**ユーティリティ**（バリアントではない）
//    ④文字列中に現れる CSS プロパティ名（`max-width`）
export function Clean() {
  const media = 'max-width: 640px';
  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 lg:grid lg:grid-cols-2 2xl:gap-8" title={media}>
      <button className="min-h-10 bg-slate-900 hover:bg-slate-700 focus-visible:ring-2 disabled:opacity-60" />
      <span className="[&>svg]:size-4 group-hover:underline sm:text-sm xl:text-base" />
    </div>
  );
}
