// apps/web/app/(main)/page.tsx
// 🔴 Phase 0 は**空のダッシュボード**（CLAUDE.md §5）。役割別ホーム（`S-003` / `S-004`、
//    `GET /api/me` / `GET /api/home`）は **T-03-06** が実装する。
//    ここではサインイン後の到達先が存在することだけを保証する（未認証なら `S-001` へ）。
//
// 🔴 T-03-02: 2 要素認証が未充足なら `S-001` の 2 段階目へ送る（docs/05 §6.2 の
//    「画面遷移だけを担う」部分）。**遷移は UI の都合であり、境界の強制ではない** ——
//    強制は `resolveTenantCtx` が毎リクエスト行う（ここで redirect を消しても、
//    業務データが漏れることはない）。Edge の middleware に置かないのは DB を読めないため。
import { redirect } from 'next/navigation';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  return (
    <main className="ses-auth-layout">
      <div className="ses-auth-card">
        <p className="ses-wordmark">{t('product.name')}</p>
      </div>
    </main>
  );
}
