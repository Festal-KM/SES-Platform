// apps/web/app/(main)/page.tsx
// 🔴 Phase 0 は**空のダッシュボード**（CLAUDE.md §5）。役割別ホーム（`S-003` / `S-004`、
//    `GET /api/me` / `GET /api/home`）は **T-03-06** が実装する。
//    ここではサインイン後の到達先が存在することだけを保証する（未認証なら `S-001` へ）。
import { redirect } from 'next/navigation';
import { t } from '@ses/i18n';
import { currentClaims } from '../../lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const claims = await currentClaims();
  if (claims === null) redirect('/signin');
  return (
    <main className="ses-auth-layout">
      <div className="ses-auth-card">
        <p className="ses-wordmark">{t('product.name')}</p>
      </div>
    </main>
  );
}
