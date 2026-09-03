// apps/web/postcss.config.mjs
// Tailwind CSS v4（docs/03 §5.2）。T-03-06 の追加スコープ（CLAUDE.md §2 の確定スタックの導入）。
// 🔴 v4 は `tailwind.config.js` を必須としない（CSS 側の `@import "tailwindcss"` が入口）。
//    ブレークポイント等は既定値のまま変更しない（CLAUDE.md §13.3）。
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
