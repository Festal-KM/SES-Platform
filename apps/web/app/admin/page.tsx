// apps/web/app/admin/page.tsx
// 管理平面のホーム（Phase 0 は枠だけ。`A-002` テナント一覧は T-03-09 が実装する）。
//
// 🔴 本ページの存在意義は `F-055 AC-3` の担保である:
//    **2 要素認証を設定するまで管理平面のいずれの画面にも到達できない。**
//    強制は `resolvePlatformCtx`（packages/db）が毎リクエスト行う ——
//    ここで redirect を消しても、`AuthenticatedPlatformCtx` が生成されない以上、
//    管理平面のクエリ経路（T-03-08）は開かない。redirect は UI の都合である。
// 🔴 Edge の middleware に境界の強制を置かない（DB を読めない）。`/admin` の別ミドルウェアは
//    T-03-08 が「画面遷移だけを担うもの」として追加する。
import { redirect } from 'next/navigation';
import { t } from '@ses/i18n';
import { resolvePlatformCtxOutcome } from '../../lib/auth/platform-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('admin.home.title')}</h1>
      {/* 🔴 運営者に見せてよいのは件数・状態・エラーだけである（CLAUDE.md §10.5）。
          Phase 0 では表示する集計そのものが無いため、枠と説明だけを置く。 */}
      <p className="text-sm text-slate-700">{t('admin.home.placeholder')}</p>
    </main>
  );
}
