// apps/web/app/admin/page.tsx
// 管理平面のホーム（Phase 0 は枠だけ。`A-002` テナント一覧は T-03-09 が実装する）。
//
// 🔴 本ページの存在意義は `F-055 AC-3` の担保である:
//    **2 要素認証を設定するまで管理平面のいずれの画面にも到達できない。**
//    強制は `resolvePlatformCtx`（packages/db）が毎リクエスト行う ——
//    ここで redirect を消しても、`AuthenticatedPlatformCtx` が生成されない以上、
//    管理平面のクエリ経路（T-03-08）は開かない。redirect は UI の都合である。
// 🔴 Edge の middleware に境界の強制を置かない（DB を読めない）。`/admin` の別ミドルウェア
//    （`apps/web/middleware.ts` + `lib/middleware/planes.ts`。T-03-08）が担うのは
//    「未認証なら `A-001` へ 302」だけである。
//
// 🔴 T-03-08: **画面の閲覧そのものを `AuditLog` に記録する**（`F-055 AC-4` / `BR-41` /
//    docs/05 §5.3 の注記②「`/admin` ホームの GET を含めて `withPlatformRead` 経由で記録」）。
//    ページは Prisma を直接触らず `readAdminHomeSummary`（`@ses/db/platform`）を呼ぶ。
//    同関数は `withPlatformRead` 経由であり、**監査ログの INSERT が成功した後でないと
//    クエリを実行しない**（記録の無い閲覧が構造的に起こらない）。
import { redirect } from 'next/navigation';
import { readAdminHomeSummary } from '@ses/db/platform';
import { t } from '@ses/i18n';
import { readPlatformRequestMeta, resolvePlatformCtxOutcome } from '../../lib/auth/platform-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const meta = await readPlatformRequestMeta();
  const summary = await readAdminHomeSummary(outcome.ctx, { ipAddress: meta.ipAddress });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('admin.home.title')}</h1>
      {/* 🔴 運営者に見せてよいのは件数・状態・エラーだけである（CLAUDE.md §10.5）。
          テナント名・エンジニア名・案件名などの「内容」と、それらへの導線を置かない。 */}
      <dl className="mb-6 flex items-baseline gap-3">
        <dt className="text-sm text-slate-700">{t('admin.home.tenantCount.label')}</dt>
        <dd className="text-2xl font-bold text-slate-900">{summary.tenantCount}</dd>
      </dl>
      <p className="text-sm text-slate-700">{t('admin.home.placeholder')}</p>
    </main>
  );
}
