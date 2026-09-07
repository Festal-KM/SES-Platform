// apps/web/app/(main)/engineers/(list)/page.tsx
// `S-005` エンジニア台帳（一覧・複合検索）。docs/04 §S-005 / `F-009` / docs/05 §6.4 #15。
// T-05-09（骨格）→ T-06-04（検索条件）→ T-06-05（並びの説明の判定を `@ses/db` の 1 本に寄せた）。
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
// 🔴 T-06-05: 「適合が並びに効くか」の判定は `@ses/db` の `search/engineers.ts` に 1 本化した
//    （画面の説明文と母集団の分割が同じ関数を通る）。ここに条件式を書き写さない。
import { ordersByFit } from '@ses/db';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { listEngineers } from '../../../../lib/engineers/list';
import {
  activeEngineerFilters,
  engineerListHref,
  engineerListRows,
  engineerPopulationLabel,
  hasEngineerListFilters,
  ENGINEER_LIST_PATH,
} from '../../../../lib/engineers/list-rows';
import { engineerListQuerySchema } from '../../../../lib/engineers/schemas';
import { listSkills } from '../../../../lib/skills/service';
import {
  engineerAvailabilityFilterOptions,
  engineerLedgerScreenMessages,
  engineerPrefectureFilterOptions,
  engineerRemoteFilterOptions,
  engineerSkillModeOptions,
} from '../list-props';
import { EngineerLedgerScreen } from '../engineer-ledger-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('engineers.list.title') };

export default async function EngineerLedgerPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const ctx = outcome.ctx;
  // 🔴 API と**同じスキーマ**で検証する（不正なカーソル・未知の値が Prisma に届かない。
  //    `pagination.ts` / `query-filters.ts`）。画面では 400 を出す先が無いので、壊れた条件は
  //    素の一覧へ戻す（URL も揃える）—— 黙って無視すると、URL には残っているのに
  //    効いていない状態になる。
  const parsed = engineerListQuerySchema.safeParse(await searchParams);
  if (!parsed.success) redirect(ENGINEER_LIST_PATH);

  const query = parsed.data;
  // 🔴 スキルの選択肢は `#23` と**同じ関数**（`listSkills`）から引く（`S-007` と同じ方針。
  //    2 本あると、検索の選択肢と登録の選択肢で辞書がずれる）。
  const [view, skills] = await Promise.all([listEngineers(ctx, query), listSkills(ctx, {})]);
  const skillOptions = skills.items.map((skill) => ({ value: skill.id, label: skill.name }));
  const skillNames = new Map(skills.items.map((skill) => [skill.id, skill.name]));
  const filtered = hasEngineerListFilters(query);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('engineers.breadcrumb.home')} / {t('engineers.breadcrumb.list')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('engineers.list.title')}</h1>
      <EngineerLedgerScreen
        rows={engineerListRows(view.items)}
        filters={{
          q: query.q ?? '',
          skills: query.skills ?? [],
          skillMode: query.skillMode,
          yearsMin: query.yearsMin === undefined ? '' : String(query.yearsMin),
          priceMin: query.priceMin === undefined ? '' : String(query.priceMin),
          priceMax: query.priceMax === undefined ? '' : String(query.priceMax),
          availableBy: query.availableBy ?? '',
          prefecture: query.prefecture ?? '',
          remote: query.remote ?? '',
          availability: query.availability ?? '',
          onlyInTime: query.onlyInTime,
          onlyCommutable: query.onlyCommutable,
        }}
        skillOptions={skillOptions}
        skillModeOptions={engineerSkillModeOptions}
        prefectureOptions={engineerPrefectureFilterOptions}
        remoteOptions={engineerRemoteFilterOptions}
        availabilityOptions={engineerAvailabilityFilterOptions}
        activeFilters={activeEngineerFilters(query, skillNames)}
        // 🔴 取引先には所属区分の列を出さない（docs/04 §S-005 権限差分）。出所は ctx である。
        showOwnershipColumn={ctx.partnerCompanyId === null}
        // 🔴 `VIEWER` は `S-007` に到達できない（docs/04 §S-007 権限差分）。押しても戻される
        //    だけの導線を描かない。⚠️ 拒否の本体は `#16` のガードと `S-007` のリダイレクトである。
        canRegister={ctx.role !== 'VIEWER'}
        // 🔴 ページングのリンクは**検索条件を保つ**（`engineerListHref`）。
        nextPageHref={view.nextCursor === null ? null : engineerListHref(query, view.nextCursor)}
        firstPageHref={query.cursor === undefined ? null : engineerListHref(query, null)}
        messages={engineerLedgerScreenMessages({
          populationLabel: engineerPopulationLabel(ctx.partnerCompanyId, view.total),
          isPartner: ctx.partnerCompanyId !== null,
          filtered,
          // 🔴 並びの説明を切り替える判定は `engineerSearchPlan` と**同じ関数**である
          //    （`@ses/db` の `ordersByFit`）。条件式をここに書き写すと、並びは分割したのに
          //    説明は分割前のまま（またはその逆）が静かに起きる ＝ 説明が嘘になる。
          ordersByFit: ordersByFit(query),
          checkboxOn: query.onlyInTime || query.onlyCommutable,
        })}
      />
    </main>
  );
}
