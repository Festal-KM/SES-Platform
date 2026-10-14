// apps/web/app/(main)/partners/projects/page.tsx
// `パートナー連携` > `案件一覧`（✅ 2026-10-14。人間の明示指示）。**準備中**。
//
// 🔴 ホスト所属だけが開ける。理由と判定の軸は `../page.tsx` 冒頭の 🔴 と同一である
//    （2 つ目のロール表を作らないため、ここでは繰り返さない）。
//
// ============================================================================
// 🔴 中身を入れる前に、人間の承認が要る（`CLAUDE.md` §8.6）
// ============================================================================
// この画面の「案件」が**取引先が持ち込んだ案件**を指すなら、それは **§3.1 の越境 5 経路の
// どれでもない** —— 経路 1（案件の公開）は「**ホストの案件を取引先に見せる**」向きであり、
// 逆向きの経路は 1 本も無い。🔴 **越境経路を増やすことは人間の承認事項**である（§8.6）。
//
// Issue #102 の既定は **B**: 🔴 **新しい経路を作らず、既存の経路 2（`Proposal`）の中に収める**
// ＝ 取引先からの提案に紐づく案件だけを、ホストが既に読めている範囲で並べる。
// ⚠️ **いまは読み取りを 1 本も持たない**（準備中の表記だけ）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { EmptyState, PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { HOME_PATH } from '../../../../lib/home/hrefs';
import { PARTNER_PROJECTS_TRAIL } from '../../../../lib/shell/page-trail';
import { PageHeading } from '../../_shell/page-heading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('partners.projects.title') };

export default async function PartnerProjectsPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (outcome.ctx.partnerCompanyId !== null) redirect(HOME_PATH);

  return (
    <main className="py-6">
      <PageBody widthClass="prose">
        <PageHeading trail={PARTNER_PROJECTS_TRAIL} title={t('partners.projects.title')} />
        <EmptyState
          description={t('shell.preparing.description')}
          testIdPrefix="partner-projects-preparing-"
        />
      </PageBody>
    </main>
  );
}
