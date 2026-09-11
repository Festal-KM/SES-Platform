// apps/web/app/(main)/engineer-shares/page.tsx
// `S-015` 匿名共有の設定（取引先）。docs/04 §S-015 / `F-016` / docs/05 §6.4 #29。T-08-02。
//
// 🔴 **取引先専用**（`docs/04` §S-015 権限差分「ホスト側ロールにはこの画面が存在しない」）。
//    到達できるのは `PARTNER_ADMIN` / `PARTNER_SALES` だけであり、それ以外はホームへ戻す。
//    ⚠️ **画面で止めるのは補助である。** 拒否の本体は `#29` の `requireRole` と、
//    `listEngineerShares` / `setEngineerShare` の `assertPartnerContext`、そして
//    `engineer_shares` / `engineers` の RLS（C3 OWNER_SCOPED）である
//    （`F-004 AC-9`「API を直接呼んでも拒否される」）。
//
// 🔴 **`AuditLog` を書かない。** 記録するのは共有の**開始・停止**（`F-016 AC-4`）であり、
//    それは `setEngineerShare` の業務トランザクション内が書く。台帳の氏名と共有状態の一覧は
//    `BR-27` の「エンジニア詳細の閲覧」ではない（`S-005` / `#15` と同じ線引き。
//    docs/05 §6.4「#15 の実装の決着（T-05-09）」）。
//
// 🔴 **自己 fetch しない**（既存のサーバコンポーネントと同じ）。同じ `listEngineerShares` を
//    直接呼ぶので、画面と `GET /api/engineer-shares` で見え方が食い違わない。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { executionDenialMessageKey } from '../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { isEngineerShareRole } from '../../../lib/engineer-shares/policy';
import { listEngineerShares } from '../../../lib/engineer-shares/service';
import { toJstIsoDay } from '../../../lib/format/datetime';
import { EngineerShareScreen } from './engineer-share-screen';
import { engineerShareRows, engineerShareScreenMessages } from './share-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('engineerShares.title') };

const HOME_PATH = '/';
/** `S-007`（人材の登録）。台帳が空のときの導線（`docs/04` §S-015 空状態）。 */
const REGISTER_HREF = '/engineers/new';

export default async function EngineerSharesPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  // 🔴 `#29` と**同じ定数**を見る（`lib/engineer-shares/policy.ts`）。書き写さない ——
  //    画面と API で食い違うと「開けるのに操作できない」か「開けないのに API は通る」になる。
  if (!isEngineerShareRole(outcome.ctx.role)) redirect(HOME_PATH);

  const view = await listEngineerShares(outcome.ctx, toJstIsoDay(new Date()));
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は共有の操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(outcome.ctx.lifecycleState);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('engineerShares.breadcrumb.home')} / {t('engineerShares.breadcrumb.current')}
      </p>
      <h1 className="mb-2 text-xl font-bold text-slate-900">{t('engineerShares.title')}</h1>
      <EngineerShareScreen
        rows={engineerShareRows(view)}
        registerHref={REGISTER_HREF}
        denialMessage={denialKey === null ? null : t(denialKey)}
        messages={engineerShareScreenMessages()}
      />
    </main>
  );
}
