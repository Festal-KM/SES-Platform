// tests/static/__fixtures__/tailwind-breakpoints/non-default-variant.violation.tsx
// 🔴 検出されなければならない形: 既定の 5 つ（sm / md / lg / xl / 2xl）以外の画面幅バリアント。
//    `max-sm:` は既定値を使ってはいるが「上から下へ打ち消す」向きであり、モバイル優先の
//    書き方と混在させない（テスト側のコメント参照）。`xs:` は既定に存在しない。
export function NonDefaultVariant() {
  return (
    <div className="max-sm:hidden xs:block min-md:flex">
      <span className="lg:col-span-2" />
    </div>
  );
}
