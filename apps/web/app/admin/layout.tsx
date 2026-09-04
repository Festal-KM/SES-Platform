// apps/web/app/admin/layout.tsx
// `A-001`〜`A-014` の共通レイアウト（docs/04 §A-001 セクション 1「平面帯（`運営者コンソール`）」）。
//
// 🔴 主平面（`app/(main)/**`）とはルートが別である（`CLAUDE.md` §10.5「別ルート」）。
//    認可はレイアウトではなく各ページ / API が `requirePlatformCtx` で行う
//    （レイアウトは Next.js のレンダリング境界であって認可の境界ではない）。
//    `/admin` の**別ミドルウェア**は T-03-08 が追加する。
// 🔴 文言は `packages/i18n` から引く（CLAUDE.md §3.5 / BR-32）。
import type { ReactNode } from 'react';
import { t } from '@ses/i18n';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ses-admin-plane">
      <p className="ses-plane-band">{t('admin.plane.band')}</p>
      {children}
    </div>
  );
}
