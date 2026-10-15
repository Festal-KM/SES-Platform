// apps/web/app/(main)/partner-engineers/page.tsx
// `パートナー連携` > `人材一覧`（✅ 2026-10-14。人間の明示指示）。**準備中**。
//
// 🔴 ホスト所属だけが開ける。理由と判定の軸は `../page.tsx` 冒頭の 🔴 と同一である。
//
// ============================================================================
// 🔴🔴 この画面は**経路 4（匿名共有）そのもの**である（`CLAUDE.md` §3.1）
// ============================================================================
// ホストが取引先の人材を見る経路は、**匿名共有（経路 4）1 本しか無い**。したがって中身を
// 入れるときは次が全部効く:
//
//   - 🔴 **開示してよいのは 5 項目だけ**（スキル / 経験年数 / 単価レンジ / 稼働可能時期 /
//     勤務地・リモート可否）。**実名・所属会社名・スキルシートは `Proposal` の作成まで出ない。**
//   - 🔴 **項目を増やすのは人間の承認事項**（§8.6）。
//   - 🔴 **共有は既定オフ**であり、取引先が解除した時点でここから消える。
//   - 🔴 **案件をまたいで同一人物を追跡できる識別子を出さない**（突き合わせで個人が特定される）。
//   - 🔴 **行の高さを内容量で変えない** —— それ自体が 6 つ目の開示項目になる
//     （`HANDOFF.md` §3.3 に実際に壊れた記録が在る）。
//
// ⚠️ **いまは読み取りを 1 本も持たない**（準備中の表記だけ）。既存の匿名候補の経路
//    （`S-016` 候補検索）と**同じ 1 実装**を通すこと（2 つ目の匿名化を書かない）。Issue #102。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { EmptyState, PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { HOME_PATH } from '../../../lib/home/hrefs';
import { PARTNER_ENGINEERS_TRAIL } from '../../../lib/shell/page-trail';
import { PageHeading } from '../_shell/page-heading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('partners.engineers.title') };

export default async function PartnerEngineersPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (outcome.ctx.partnerCompanyId !== null) redirect(HOME_PATH);

  return (
    <main className="py-6">
      <PageBody widthClass="prose">
        <PageHeading trail={PARTNER_ENGINEERS_TRAIL} title={t('partners.engineers.title')} />
        <EmptyState
          description={t('shell.preparing.description')}
          testIdPrefix="partner-engineers-preparing-"
        />
      </PageBody>
    </main>
  );
}
