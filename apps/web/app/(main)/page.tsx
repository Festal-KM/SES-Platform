// apps/web/app/(main)/page.tsx
// 役割別ホーム（`S-003` ホスト / `S-004` 取引先。docs/05 §6.3 #9 / `F-006`）。T-03-06。
//
// 🔴 Phase 0 は**空のダッシュボード**(CLAUDE.md §5)。要対応キュー等のセクションは Phase 1 /
//    Phase 2 が追加する（`apps/web/app/(main)/_home/home-sections.tsx`）。
// 🔴 `getHomeView` は純粋関数（DB を読まない）。Phase 0 は静的な内容のため、`GET /api/home` を
//    自己 fetch せずサーバコンポーネントから直接呼ぶ（Phase 1 が 60 秒ポーリングを足す時点で
//    クライアント化する。docs/04 program-design 申し送り 6）。
//
// 🔴 T-03-02: 2 要素認証が未充足なら `S-001` の 2 段階目へ送る(docs/05 §6.2 の
//    「画面遷移だけを担う」部分)。**遷移は UI の都合であり、境界の強制ではない** ——
//    強制は `resolveTenantCtx` が毎リクエスト行う(ここで redirect を消しても、
//    業務データが漏れることはない)。Edge の middleware に置かないのは DB を読めないため。
import { redirect } from 'next/navigation';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../lib/auth/session';
import { getHomeView } from '../../lib/home/service';
import { HostHomeSections, PartnerHomeSections } from './_home/home-sections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const view = getHomeView(outcome.ctx);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('home.title')}</h1>
      {view.audience === 'HOST' ? (
        <HostHomeSections />
      ) : (
        <PartnerHomeSections noticeText={t(view.visibilityNotice.messageKey)} />
      )}
    </main>
  );
}
