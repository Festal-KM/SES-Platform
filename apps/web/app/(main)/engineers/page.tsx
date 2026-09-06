// apps/web/app/(main)/engineers/page.tsx
// `S-005` エンジニア台帳（一覧）。docs/04 §S-005 / `F-009` / docs/05 §6.4 #15。T-05-09。
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-005 の必要ロールは全ロール）。取引先も `VIEWER` も
//    この画面に到達してよい —— 見えるものが変わるのはロール判定ではなく `engineers` の
//    RLS（C3 OWNER_SCOPED）である。ロールで分けるのは「人材を登録」の導線だけ。
// 🔴 **一覧はサーバコンポーネントから `listEngineers` を直接読む**（自己 fetch しない。
//    `S-009` / `S-014` / `S-007` と同じ方針）。`GET /api/engineers`（#15）と**同じ関数**を通るので、
//    画面と API で母集団・並び順・件数がずれない。
// 🔴 **監査ログを書かない。** `BR-27` / `F-008 AC-4` の記録対象は「エンジニア**詳細**の閲覧」で
//    あり、docs/04 §S-005 も記録を行クリック（→ `S-006`）に置いている
//    （理由は `lib/engineers/list.ts` 冒頭 / docs/05 §6.4「#15 の実装の決着」）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { listEngineers } from '../../../lib/engineers/list';
import {
  engineerListRows,
  engineerPopulationLabel,
} from '../../../lib/engineers/list-rows';
import { engineerListQuerySchema } from '../../../lib/engineers/schemas';
import { EngineerLedgerScreen } from './engineer-ledger-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('engineers.list.title') };

/** 🔴 一覧の入口。`ENGINEER_FORM_CANCEL_HREF`（`_form/form-props.ts`）と同じ値である。 */
const LIST_PATH = '/engineers';

export default async function EngineerLedgerPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const ctx = outcome.ctx;
  // 🔴 API と**同じスキーマ**で検証する（不正なカーソルが Prisma に届かない。`pagination.ts`）。
  //    画面では 400 を出す先が無いので、壊れたカーソルは 1 ページ目へ戻す（URL も揃える）——
  //    黙って無視すると、URL には残っているのに効いていない状態になる。
  const parsed = engineerListQuerySchema.safeParse(await searchParams);
  if (!parsed.success) redirect(LIST_PATH);

  const view = await listEngineers(ctx, parsed.data);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('engineers.breadcrumb.home')} / {t('engineers.breadcrumb.list')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('engineers.list.title')}</h1>
      <EngineerLedgerScreen
        rows={engineerListRows(view.items)}
        // 🔴 取引先には所属区分の列を出さない（docs/04 §S-005 権限差分）。出所は ctx である。
        showOwnershipColumn={ctx.partnerCompanyId === null}
        // 🔴 `VIEWER` は `S-007` に到達できない（docs/04 §S-007 権限差分）。押しても戻される
        //    だけの導線を描かない。⚠️ 拒否の本体は `#16` のガードと `S-007` のリダイレクトである。
        canRegister={ctx.role !== 'VIEWER'}
        nextCursor={view.nextCursor}
        showFirstPageLink={parsed.data.cursor !== undefined}
        messages={{
          populationLabel: engineerPopulationLabel(ctx.partnerCompanyId, view.total),
          partnerScopeNotice:
            ctx.partnerCompanyId === null ? null : t('engineers.list.partnerScopeNotice'),
          orderNote: t('engineers.list.orderNote'),
          searchComingSoon: t('engineers.list.searchComingSoon'),
          experienceComingSoon: t('engineers.list.experienceComingSoon'),
          register: t('engineers.list.register'),
          readOnlyNote: t('engineers.list.readOnlyNote'),
          columnName: t('engineers.list.column.name'),
          columnOwnership: t('engineers.list.column.ownership'),
          columnSkills: t('engineers.list.column.skills'),
          columnUnitPrice: t('engineers.list.column.unitPrice'),
          columnAvailableFrom: t('engineers.list.column.availableFrom'),
          columnLocation: t('engineers.list.column.location'),
          columnAvailability: t('engineers.list.column.availability'),
          columnUpdatedOn: t('engineers.list.column.updatedOn'),
          emptyTitle: t('engineers.list.empty.title'),
          emptyLead: t('engineers.list.empty.lead'),
          nextPage: t('engineers.list.nextPage'),
          firstPage: t('engineers.list.firstPage'),
          valueNone: t('engineers.detail.valueNone'),
        }}
      />
    </main>
  );
}
