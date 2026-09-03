// apps/web/app/layout.tsx
// 🔴 文言は `packages/i18n` から引く（CLAUDE.md §3.5 / BR-32）。画面にベタ書きしない。
// 🔴 非本番環境バナー（`F-028`）は T-10-05 の担当であり、ここには置かない。
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { DEFAULT_LOCALE, t } from '@ses/i18n';
// 🔴 Tailwind を先に読み込み、`globals.css` を後に読み込む（同じセレクタが競合した場合に
//    既存ページ（S-001 / S-002 / S-041）の手書き CSS を優先させる。T-03-06 追加スコープ）。
import './tailwind.css';
import './globals.css';

export const metadata: Metadata = {
  title: t('product.name'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body>{children}</body>
    </html>
  );
}
