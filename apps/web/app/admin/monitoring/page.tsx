// apps/web/app/admin/monitoring/page.tsx
// `A-005` 運用監視（docs/04 §A-005 / API-A8 / `F-059` / `BR-40`）。T3 / Phase 1→P2→P3。T-11-04。
//
// 🔴 顧客が気づく前に運営者が気づく（docs/01 章 7.4）。失敗・滞留・異常を種別ごとに一覧し、各項目から `A-003`（テナント詳細）→
//    `A-006` → `A-007` への導線を繋ぐ（環境全体の値である項目 13 / 14 の `PROVIDER_QUOTA` / 16 / 17 は導線を持たない）。
// 🔴 両ロール（`PLATFORM_OWNER` / `PLATFORM_SUPPORT`）閲覧のみ。書き込み操作なし。画面タイトル右に「閲覧のみ」を常時表示する（`BR-37`）。
// 🔴 表示するのは件数・状態・エラー種別・日時のみで、提案本文・エンジニア氏名・スキルシート内容・チャット本文は含まれない（`F-059 AC-3`）。
// 🔴 このページ自身は DB を読まない（材料は API-A8 が読み、その読み取りが `admin.monitoring.view` として記録される）。
// 🔴 文言は `packages/i18n` から引いてクライアントへ props で渡す（`CLAUDE.md` §3.5）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { Badge } from '@ses/ui';
import { resolvePlatformCtxOutcome } from '../../../lib/auth/platform-session';
import { AdminMonitoringView } from './admin-monitoring-view';
import { adminMonitoringMessages } from './_lib/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('admin.monitoring.title') };

/** API-A8 の URL（docs/05 §6.9）。 */
const MONITORING_ENDPOINT = '/api/admin/monitoring';

export default async function AdminMonitoringPage() {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('admin.monitoring.title')}</h1>
        {/* 🔴 BR-37: 運営者コンソールは既定 read-only。書き込み操作なしを常時明示する。 */}
        <Badge>{t('admin.readOnly.badge')}</Badge>
      </div>
      <p className="mb-6 text-sm text-slate-600" data-testid="admin-monitoring-lead">
        {t('admin.monitoring.lead')}
      </p>
      <AdminMonitoringView messages={adminMonitoringMessages()} endpoint={MONITORING_ENDPOINT} />
    </main>
  );
}
