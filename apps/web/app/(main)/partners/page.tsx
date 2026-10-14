// apps/web/app/(main)/partners/page.tsx
// `パートナー連携` > `パートナー一覧`（✅ 2026-10-14。人間の明示指示）。
//
// ============================================================================
// 🔴 この画面は**準備中**である（中身をまだ持たない）
// ============================================================================
// 人間の指示は「**タブ内のコンテンツについては準備中という表記でよいです**」であり、
// 外枠と到達手段だけを先に作る（`app/(main)/calendar/page.tsx` 冒頭の 🔴 と同じ扱い）。
//
// ============================================================================
// 🔴 ホスト所属だけが開ける（`CLAUDE.md` §3.1）
// ============================================================================
// 🔴 取引先所属がこれを開くと、**他社の一覧**になる。§3.1 の
//    「🔴 パートナー同士が相互に参照できる経路を 1 つも作らない」の正面からの違反であり、
//    **中身が準備中であることは理由にならない** —— 画面が在ること自体が「他社の一覧が在る」
//    ことの示唆になる（§3.1 / `F-004 AC-4` の「件数は他社情報の示唆になりうる」と同じ）。
// 🔴 **判定は所属（`partnerCompanyId`）で行い、ロール名で代用しない**（`memberships` の CHECK と
//    1 対 1。`lib/shell/nav.ts` / `app/(main)/layout.tsx` と同じ軸）。
// 🔴 **サイドバーに出さないことは拒否ではない**（`lib/shell/nav.ts` の `partners` 群は
//    ホストにしか出ないが、あれは UI の配慮である）。**拒否の本体はこの redirect である。**
//
// 🔴 **`S-014`（取引先企業。`/settings/partner-companies`）には寄せていない。** 同じ母集団を
//    指す画面が 2 つ在る状態であり、統合は人間の判断事項（Issue #102 の既定 = A「分けたまま」）。
//    寄せると**サイドバーの `パートナー一覧` と `設定` が同時に光る**（`nav.ts` の 🔴）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { EmptyState, PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { HOME_PATH } from '../../../lib/home/hrefs';
import { PARTNER_LIST_TRAIL } from '../../../lib/shell/page-trail';
import { PageHeading } from '../_shell/page-heading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('partners.companies.title') };

export default async function PartnerListPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  // 🔴 上の 🔴。所属で決める。
  if (outcome.ctx.partnerCompanyId !== null) redirect(HOME_PATH);

  return (
    <main className="py-6">
      <PageBody widthClass="prose">
        <PageHeading trail={PARTNER_LIST_TRAIL} title={t('partners.companies.title')} />
        <EmptyState description={t('shell.preparing.description')} testIdPrefix="partner-list-preparing-" />
      </PageBody>
    </main>
  );
}
