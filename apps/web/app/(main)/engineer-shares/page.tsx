// apps/web/app/(main)/engineer-shares/page.tsx
// `S-015` 匿名共有の設定（取引先）。docs/04 §S-015 / `F-016` / docs/05 §6.4 #29。T-08-02 → T-11-11
// （検索 3 条件 + 共有状態フィルタ + カーソルページング。docs/05 §6.4「#29 の改訂」）。
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
// 🔴 **自己 fetch しない**（既存のサーバコンポーネントと同じ）。1 ページ目は `listEngineerShares` を
//    直接呼ぶので、画面と `GET /api/engineer-shares` で見え方が食い違わない。「次の 50 件」だけは
//    画面が同じ API を `nextCursor` で呼び、取得済みの行の下に追加する（`docs/04` §S-015）。
// 🔴 **初回空（台帳 0 件）の判定は `hasAnyEngineer` を API とは別に読む**（応答に `total` / `ledgerEmpty` を
//    足さない 2 キーの契約。docs/05 §6.4「#29 の改訂」）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { executionDenialMessageKey } from '../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { isEngineerShareRole } from '../../../lib/engineer-shares/policy';
import {
  activeEngineerShareFilters,
  ENGINEER_SHARE_PATH,
  engineerShareApiSearch,
  engineerShareEmptyState,
  engineerShareScreenHref,
  engineerShareScreenQuerySchema,
  toEngineerShareListQuery,
} from '../../../lib/engineer-shares/screen-query';
import { hasAnyEngineer, listEngineerShares } from '../../../lib/engineer-shares/service';
import { toJstIsoDay } from '../../../lib/format/datetime';
import { EngineerShareScreen } from './engineer-share-screen';
import {
  engineerShareFilterOptions,
  engineerShareRowLabels,
  engineerShareRows,
  engineerShareScreenMessages,
} from './share-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('engineerShares.title') };

const HOME_PATH = '/';
/** `S-007`（人材の登録）。台帳が空のときの導線（`docs/04` §S-015 空状態）。 */
const REGISTER_HREF = '/engineers/new';

export default async function EngineerSharesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  // 🔴 `#29` と**同じ定数**を見る（`lib/engineer-shares/policy.ts`）。書き写さない ——
  //    画面と API で食い違うと「開けるのに操作できない」か「開けないのに API は通る」になる。
  if (!isEngineerShareRole(outcome.ctx.role)) redirect(HOME_PATH);

  // 🔴 条件は URL から（`S-005` と同じ。再読込・共有で状態を失わない）。壊れた条件は素の一覧へ戻す
  //    （黙って無視すると、URL には残っているのに効いていない状態になる）。`cursor` は画面の URL に持たない。
  const parsed = engineerShareScreenQuerySchema.safeParse(await searchParams);
  if (!parsed.success) redirect(ENGINEER_SHARE_PATH);
  const screen = parsed.data;
  const query = toEngineerShareListQuery(screen);

  const ctx = outcome.ctx;
  const [view, anyEngineer] = await Promise.all([
    listEngineerShares(ctx, query, toJstIsoDay(new Date())),
    hasAnyEngineer(ctx),
  ]);
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は共有の操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);
  const rowLabels = engineerShareRowLabels();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('engineerShares.breadcrumb.home')} / {t('engineerShares.breadcrumb.current')}
      </p>
      <h1 className="mb-2 text-xl font-bold text-slate-900">{t('engineerShares.title')}</h1>
      <EngineerShareScreen
        rows={engineerShareRows(view.items, rowLabels)}
        nextCursor={view.nextCursor}
        filters={{
          q: screen.q ?? '',
          availableBy: screen.availableBy ?? '',
          shared: screen.shared,
        }}
        filterOptions={engineerShareFilterOptions()}
        activeFilters={activeEngineerShareFilters(screen)}
        emptyState={engineerShareEmptyState(screen, anyEngineer, view.items.length)}
        showNotSharedHref={engineerShareScreenHref({ ...screen, shared: 'false' })}
        clearHref={ENGINEER_SHARE_PATH}
        apiSearch={engineerShareApiSearch(screen)}
        registerHref={REGISTER_HREF}
        denialMessage={denialKey === null ? null : t(denialKey)}
        rowLabels={rowLabels}
        messages={engineerShareScreenMessages()}
      />
    </main>
  );
}
