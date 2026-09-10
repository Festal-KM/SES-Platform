// tests/static/__fixtures__/tailwind-breakpoints/arbitrary-variant.violation.tsx
// 🔴 検出されなければならない形: 任意値の画面幅バリアント（独自ブレークポイントそのもの）。
export function ArbitraryVariant() {
  return (
    <div className="min-[900px]:grid max-[42rem]:hidden">
      <span className="text-sm md:text-base" />
    </div>
  );
}
