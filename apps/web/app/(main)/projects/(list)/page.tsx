// apps/web/app/(main)/projects/(list)/page.tsx
// `S-010` 案件一覧・検索。docs/04 §S-010 / `F-015` / docs/05 §6.4 #25。T-06-03。
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-010 の必要ロールは全ロール）。取引先も `VIEWER` も
//    この画面に到達してよい —— 見えるものが変わるのはロール判定ではなく `projects` の
//    RLS（C4 VISIBILITY）である。ロールで分けるのは「案件を登録」の導線だけ。
// 🔴 **一覧はサーバコンポーネントから `listProjects` を直接読む**（自己 fetch しない。
//    `S-005` / `S-011` と同じ方針）。`GET /api/projects`（#25）と**同じ関数**を通るので、
//    画面と API で母集団・並び順・件数がずれない。
// 🔴 **監査ログを書かない。** `BR-27` / `F-013 AC-3` の記録対象は「案件**詳細**の閲覧」であり、
//    docs/04 §S-010 も記録を行クリック（→ `S-011`）に置いている
//    （理由は `lib/projects/list.ts` 冒頭 / docs/05 §6.4「#25 の実装の決着」）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { listProjects } from '../../../../lib/projects/list';
import {
  hasProjectListFilters,
  parseHiddenProjectColumns,
  projectColumnToggleHref,
  projectListHref,
  projectListPrimaryAction,
  projectListRows,
  projectPopulationLabel,
  projectSelectHref,
  selectedProjectId,
  PROJECT_LIST_PATH,
  PROJECT_SELECTED_PARAM,
} from '../../../../lib/projects/list-rows';
import { isProjectEditorRole } from '../../../../lib/projects/policy';
import { projectListQuerySchema } from '../../../../lib/projects/schemas';
import { HIDDEN_COLUMNS_PARAM } from '../../../../lib/ui/hidden-columns';
import {
  projectColumnToggleItems,
  projectListDescription,
  projectListScreenMessages,
  projectPrefectureFilterOptions,
  projectStatusFilterOptions,
  projectSummaryPanelMessages,
} from '../list-props';
import { ProjectListScreen } from '../project-list-screen';
import { ProjectSummaryPanel } from '../project-summary-panel';
import { PageHeading } from '../../_shell/page-heading';
import { isPageActionRole, PROJECT_LIST_TRAIL } from '../../../../lib/shell/page-trail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('projects.list.title') };

export default async function ProjectListPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const ctx = outcome.ctx;
  // 🔴 API と**同じスキーマ**で検証する（不正なカーソル・未知の状態が Prisma に届かない）。
  //    画面では 400 を出す先が無いので、壊れた条件は素の一覧へ戻す（URL も揃える）——
  //    黙って無視すると、URL には残っているのに効いていない状態になる。
  const raw = await searchParams;
  const parsed = projectListQuerySchema.safeParse(raw);
  if (!parsed.success) redirect(PROJECT_LIST_PATH);

  const query = parsed.data;
  const view = await listProjects(ctx, query);
  const isPartner = ctx.partnerCompanyId !== null;
  const filtered = hasProjectListFilters(query);
  // 🔴 **列表示切替の状態は URL のクエリ（`?hide=`）だけが持つ**（`T-22-06`。`docs/04` §7.1）。
  //    🔴 **API には渡さない** —— 列の表示・非表示は表示の話であり、取得する項目は変わらない
  //       （`projectListQuerySchema` はこのキーを持たず、未知のキーは Zod の既定（strip）で落ちる。
  //       したがって `?hide=` が付いていても上の `safeParse` は成功し、URL も書き換わらない）。
  //    🔴 許可リスト外の値は捨てる（URL 直打ちで壊れない）。
  const hiddenColumns = parseHiddenProjectColumns(raw[HIDDEN_COLUMNS_PARAM]);
  const rows = projectListRows(view.items);
  // 🔴 **副カラムで開く行**（SP-22 段④）。`?selected=` も**表示の状態**であり API には渡さない
  //    （`?hide=` と同じ扱い。`projectListQuerySchema` はこのキーを持たず、Zod の既定〔strip〕で
  //    落ちるので上の `safeParse` は成功し、URL も書き換わらない）。
  // 🔴 **いまのページの行に照合してから使う** —— URL 直打ちで「このページに無い ID」を
  //    指されても、先頭行に落ちる（`selectedProjectId`）。**DB を引き直さない。**
  const selectedId = selectedProjectId(raw[PROJECT_SELECTED_PARAM], rows);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const canRegister = isProjectEditorRole(ctx.role);
  // 🔴 9 列目（公開先の設定状況）そのものが無い取引先には**切替を渡さない**（`F-014 AC-4` / `BR-07`）。
  const columnToggleItems = isPartner
    ? []
    : projectColumnToggleItems({
        hidden: hiddenColumns,
        // 🔴 検索条件と**いま見ているページ**（`cursor`）、**開いている行**を保つ
        //    （列を外して行を見失わない / パネルが閉じない）。
        hrefOf: (columnId) =>
          projectColumnToggleHref(
            query,
            query.cursor ?? null,
            hiddenColumns,
            columnId,
            selectedId,
          ),
      });

  return (
    // 🔴 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`）。画面ファイルに
    //    `max-w-*` を書かない（検査 (c) / (k)）。
    // 🔴 ✅ **SP-22 段④ で `full`（クラス A）→ `split`（クラス B）に変えた**（人間のワイヤー
    //    フレーム「SES Hub案件管理ダッシュボード.png」= 一覧 + 右の案件詳細パネル）。
    //    ⚠️ **`docs/04` §7.1 の表はまだ `S-010` をクラス A に置いている**（完了報告で
    //    上流の訂正として申し送る。`CLAUDE.md` §8.7）。
    //    🔴 副カラムは **`lg` 未満では `PageBody` が本体の下に積む**（遮断しない。§13.3）。
    //    🔴 **`Drawer` ではない**（`Drawer` は `S-003` / `S-004` の要対応キュー専用。§11-25）。
    <main className="py-6">
      <PageBody
        widthClass="split"
        // 🔴 ✅ 2026-10-03: **副カラムの並置は `2xl` から**（`@ses/ui` の `PageBodyAsideFrom` の 🔴）。
        //    実測（1280px）: 右パネル 400px により表の器が **582px** になり、9 列 1,313px のうち
        //    **44% しか見えず、続きがあることを示す印も無かった**。§7.1 は「列を削らないことが先」
        //    と定めているので列は 1 つも減らさず、**パネルを下段に送って主カラムを 1,008px にする**。
        //    `2xl` 未満ではパネルは表の下に積まれる（遮断しない。`CLAUDE.md` §13.3）。
        asideFrom="2xl"
        aside={
          <ProjectSummaryPanel
            row={selectedRow}
            // 🔴 `S-012`（編集）に到達できるのはホストの 3 ロールだけ（`PROJECT_EDITOR_ROLES`）。
            canEdit={canRegister}
            messages={projectSummaryPanelMessages()}
          />
        }
      >
      {/* 🔴 primary は帯の 1 つだけ（§7.6）。`ACTION` なので `canAct` が偽のロールには
          描かれない（`PageHeading`）。**判定の出所は `canRegister` の 1 つ**であり、
          `projectListPrimaryAction` が `null` を返す側と二重の壁になっている。
          ⚠️ testid（`project-list-register`）は移設前から凍結されている値である（`U-22`）。 */}
      <PageHeading
        trail={PROJECT_LIST_TRAIL}
        title={t('projects.list.title')}
        primaryAction={projectListPrimaryAction(canRegister)}
        canAct={isPageActionRole(ctx.role)}
        testId="project-list-register"
      />
      {/* 🔴 帯の「説明 1 行」（`docs/04` §3.1）。`settings/page.tsx` と同じ形で帯の直下に置く
          （`PageHeader` は説明の prop を持たない）。母集団が違うので文も違う。 */}
      <p className="mb-4 text-body text-fg-muted" data-testid="project-list-description">
        {projectListDescription(isPartner)}
      </p>
      <ProjectListScreen
        rows={rows}
        filters={{
          q: query.q ?? '',
          status: query.status ?? '',
          startFrom: query.startFrom ?? '',
          prefecture: query.prefecture ?? '',
        }}
        statusOptions={projectStatusFilterOptions}
        prefectureOptions={projectPrefectureFilterOptions}
        // 🔴 取引先には公開先の列を出さない（docs/04 §S-010 / `F-014 AC-4`）。出所は ctx である。
        showVisibilityColumn={!isPartner}
        // 🔴 `S-012` に到達できるのはホストの 3 ロールだけである（`PROJECT_EDITOR_ROLES`）。
        //    押しても戻されるだけの導線を描かない。拒否の本体は `#26` のガードと
        //    `S-012` のリダイレクトである。
        canRegister={canRegister}
        showClearFilters={filtered}
        // 🔴 ページングのリンクは**検索条件と列の表示状態を保つ**（`projectListHref`）——
        //    次ページで隠した列が復活すると、利用者は何が起きたか説明できない。
        // 🔴 **`?selected=` は引き継がない** —— 開いていた行は次のページに居ないので、
        //    引き継ぐと「このページに無い ID」になる（遷移先で先頭行に落ちる）。
        nextPageHref={
          view.nextCursor === null ? null : projectListHref(query, view.nextCursor, hiddenColumns)
        }
        firstPageHref={
          query.cursor === undefined ? null : projectListHref(query, null, hiddenColumns)
        }
        columnToggleItems={columnToggleItems}
        selectedId={selectedId}
        // 🔴 行から副カラムを開く URL（検索条件・ページの位置・列の表示状態を保つ）。
        selectHrefOf={(projectId) =>
          projectSelectHref(query, query.cursor ?? null, hiddenColumns, projectId)
        }
        messages={projectListScreenMessages({
          populationLabel: projectPopulationLabel(ctx.partnerCompanyId, view.total),
          isPartner,
          filtered,
        })}
      />
      </PageBody>
    </main>
  );
}
