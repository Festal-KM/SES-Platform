// apps/web/app/(main)/projects/(list)/page.tsx
// `S-010` 案件一覧・検索。docs/04 §S-010 / `F-015` / docs/05 §6.4 #25。T-06-03。
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-010 の必要ロールは全ロール）。取引先も `VIEWER` も
//    この画面に到達してよい —— 見えるものが変わるのはロール判定ではなく `projects` の
//    RLS（C4 VISIBILITY）である。ロールで分けるのは「案件を登録」の導線だけ。
// 🔴 **一覧はサーバコンポーネントから `listProjects` を直接読む**（自己 fetch しない。
//    `S-005` / `S-011` と同じ方針）。`GET /api/projects`（#25）と**同じ関数**を通るので、
//    画面と API で母集団・並び順・件数がずれない。
// 一覧だけの取得では監査しない。基本情報タブは詳細内容を1件読み、閲覧を監査する。
// `BR-27` / `F-013 AC-3` の記録対象は「案件**詳細**の閲覧」であり、
//    docs/04 §S-010 も記録を行クリック（→ `S-011`）に置いている
//    （理由は `lib/projects/list.ts` 冒頭 / docs/05 §6.4「#25 の実装の決着」）。
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
// ✅ 2026-10-16: 単価の逆転の判定（述語〔重なり〕と同じファイルの 1 本。人間の明示指示）。
import { isUnitPriceRangeInverted } from '@ses/db';
import { t } from '@ses/i18n';
import { PageBody, CONTENT_PADDING_Y_CLASS, cn } from '@ses/ui';
import { resolveTenantCtxOutcome, readRequestMeta } from '../../../../lib/auth/session';
import { readProjectBasicInfo } from '../../../../lib/projects/basic-info';
import { listProjects, projectPageFromCursor } from '../../../../lib/projects/list';
import { projectPagination, projectPageHref } from '../../../../lib/projects/pagination';
import {
  hasProjectListFilters,
  parseHiddenProjectColumns,
  PROJECT_DEFAULT_HIDDEN_COLUMN_IDS,
  PROJECT_HIDEABLE_COLUMN_IDS,
  projectColumnToggleHref,
  // ✅✅ 2026-10-16: 案件サマリのタブ（`?panelTab=`。人間の明示指示）。
  projectPanelTab,
  projectPanelTabHref,
  PROJECT_PANEL_TAB_PARAM,
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
// ✅✅ 2026-10-16: スキルの選択肢（人間の明示指示「スキル（リストから複数選択できる、or 検索）」）。
// 🔴 **`GET /api/skills`（#23）と同じ関数を通る**（`listSkills`）—— 辞書の並び
//    （`sortKey` 昇順 → `id`）と母集団を画面側で決め直さない。
// 🔴 `skills` は `CLAUDE.md` §3.1 の射程外の 4 表の 1 つ（グローバルなマスタ）であり、
//    誰が見ても同じ辞書である（テナントの境界に触れない）。
import { listSkills } from '../../../../lib/skills/service';
import { HIDDEN_COLUMNS_PARAM, hiddenColumnsParamValue } from '../../../../lib/ui/hidden-columns';
// ✅✅ 2026-10-16: 検索項目は 6 つになった（人間の明示指示）。🔴 **外した 4 つ
//    （案件区分 / 勤務地 / 開始時期 / 並行可否）の選択肢は import ごと外す** ——
//    受け取って使わない props を残さない（query と述語は残してある）。
import {
  projectAppliedSearchDraft,
  projectColumnToggleItems,
  projectListScreenMessages,
  projectSearchFilterOptions,
  projectSearchPanelMessages,
  projectSummaryPanelMessages,
} from '../list-props';
// ✅✅ 2026-10-19: 折りたたみの復元（改修指示書 §4）。
// 🔴 **`'use client'` を持たないモジュールから取る** —— 島の中の export を
//    サーバから呼ぶと Next.js が落とす（「client の関数を server から呼んだ」）。
import { searchExpandedCookieName } from '../_search/saved-searches';
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

  // ==========================================================================
  // 🔴🔴 **2026-10-19: 「並行可否」をこの画面の検索から外す**（人間の改修指示書 §3）
  // ==========================================================================
  // 指示書: 「ラベルと入力欄だけでなく、この画面の**検索状態・送信条件・保存対象**からも
  //        除外します。古い URL や保存条件に同項目が含まれていても、
  //        読み込み時に正規化して検索に影響させないでください。」
  //
  // 🔴 **この 1 行がその「正規化」である。** 以降のすべて
  //    （`listProjects` の述語 / `projectListHref` が組むすべての URL / 画面の条件）が
  //    `query` を見るので、ここで落とせば**検索に到達する経路が 1 つも無い**。
  // 🔴 **`safeParse` はそのまま通す**（`?parallelOk=1` 付きの共有 URL を 400 にしない）。
  // ⚠️ **DB の列も `packages/db` の述語も消していない**（指示書「DB の列削除や
  //    他画面の項目削除は不要」）—— `S-012`（登録・編集）は引き続き扱う。
  const query = { ...parsed.data, parallelOk: undefined };
  // 旧カーソルのブックマークも同じ公開範囲で位置を解決して番号URLへ引き継ぐ。
  const initialHidden = parseHiddenProjectColumns(raw[HIDDEN_COLUMNS_PARAM]);
  if(query.cursor && query.page === undefined) redirect(projectPageHref(query,await projectPageFromCursor(ctx,query),initialHidden,projectPanelTab(raw[PROJECT_PANEL_TAB_PARAM])));
  // ============================================================================
  // ✅ **2026-10-16（人間の明示指示「下限 > 上限 の場合はバリデーションエラーを表示し
  //    検索を実行しない」）**
  // ============================================================================
  // 🔴 **判定は `@ses/db` の `isUnitPriceRangeInverted` の 1 本**である（重なりの述語と同じ
  //    ファイル。人材一覧〔`S-005`〕も同じ関数を使える）。
  // 🔴 **「検索を実行しない」を字義どおりに実装する** —— 逆転したレンジは重なりが空であり、
  //    述語としては素通りして 0 件になる。0 件は「条件に合う案件が無い」と**見分けが付かない**
  //    ので、**問い合わせ自体を行わず**、単価の欄にエラーを出す（`docs/04` §S-010）。
  // 🔴 **`redirect` しない**（URL に残った条件を消すと、直すべき値が画面から消える）。
  const priceInverted = isUnitPriceRangeInverted(query);
  // 🔴 **開始時期の区分 → 日付の範囲の変換は `listProjects` が行う**（2026-10-16 に移した）。
  //    画面だけで変換していたときは、**API が同じ条件を黙って捨てていた** —— 読み取りの
  //    経路は 1 本であり、変換もその 1 本に置く（`lib/projects/list.ts` の 🔴🔴）。
  // ✅✅ **2026-10-16: 一覧とスキル辞書を 1 度に取る**（人間の明示指示のスキル絞り込み）。
  // 🔴 **`Promise.all` にする** —— 辞書は約 40 行の小さな問い合わせだが、直列にすると
  //    一覧の p95（`F-015 AC-2`）にその往復がそのまま足される。
  // 🔴 **単価が逆転しているときも辞書は読む** —— 読まないと**選択肢が消えた検索フォーム**が
  //    返り、利用者は「スキルの欄が壊れた」と読む（直すべきは単価の欄である）。
  const [view, skills] = await Promise.all([
    priceInverted
      ? Promise.resolve({
          items: [] as Awaited<ReturnType<typeof listProjects>>['items'],
          total: 0,
          nextCursor: null,
        })
      : listProjects(ctx, query),
    listSkills(ctx, {}),
  ]);
  const isPartner = ctx.partnerCompanyId !== null;
  const filtered = hasProjectListFilters(query);
  // 🔴 **列表示切替の状態は URL のクエリ（`?hide=`）だけが持つ**（`T-22-06`。`docs/04` §7.1）。
  //    🔴 **API には渡さない** —— 列の表示・非表示は表示の話であり、取得する項目は変わらない
  //       （`projectListQuerySchema` はこのキーを持たず、未知のキーは Zod の既定（strip）で落ちる。
  //       したがって `?hide=` が付いていても上の `safeParse` は成功し、URL も書き換わらない）。
  //    🔴 許可リスト外の値は捨てる（URL 直打ちで壊れない）。
  const hiddenColumns = parseHiddenProjectColumns(raw[HIDDEN_COLUMNS_PARAM]);
  const rows = projectListRows(view.items);
  const paging = projectPagination(query,view.total,rows.length,hiddenColumns,projectPanelTab(raw[PROJECT_PANEL_TAB_PARAM]));
  if((query.page ?? 1) > paging.last) redirect(projectPageHref(query,paging.last,hiddenColumns,projectPanelTab(raw[PROJECT_PANEL_TAB_PARAM])));
  // 🔴 **副カラムで開く行**（SP-22 段④）。`?selected=` も**表示の状態**であり API には渡さない
  //    （`?hide=` と同じ扱い。`projectListQuerySchema` はこのキーを持たず、Zod の既定〔strip〕で
  //    落ちるので上の `safeParse` は成功し、URL も書き換わらない）。
  // 🔴 **いまのページの行に照合してから使う** —— URL 直打ちで「このページに無い ID」を
  //    指されても、先頭行に落ちる（`selectedProjectId`）。基本情報は後段でこの1件だけ読む。
  const selectedId = selectedProjectId(raw[PROJECT_SELECTED_PARAM], rows);
  // ✅✅ **2026-10-16: 案件サマリのタブ**（人間の明示指示「タイル内にタブを設置して、
  //    基本情報とコピペ用サマリ」）。🔴 `?selected=` / `?hide=` と同じ**表示の状態**であり、
  //    API には渡さない（`projectListQuerySchema` はこのキーを持たず、Zod の既定〔strip〕で
  //    落ちるので上の `safeParse` は成功し、URL も書き換わらない）。
  //    🔴 未知の値は既定（基本情報）に落ちる（`redirect` しない）。
  const panelTab = projectPanelTab(raw[PROJECT_PANEL_TAB_PARAM]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const basicInfo = selectedRow !== null
    ? await readProjectBasicInfo(ctx, selectedRow.id, await readRequestMeta(), panelTab === 'COPY')
    : [];
  const canRegister = isProjectEditorRole(ctx.role);
  // 🔴 9 列目（公開先の設定状況）そのものが無い取引先には**その行を渡さない**（`F-014 AC-4` / `BR-07`）。
  // ✅ **2026-10-15: 取引先にも切替そのものは渡す** —— `必須要件の要約` を既定で格納したため、
  //    渡さないと**戻す手段が無くなる**（格納は「1 クリックで戻せる」ことが前提である）。
  const columnToggleItems = projectColumnToggleItems({
    ids: isPartner ? (['mustRequirements'] as const) : PROJECT_HIDEABLE_COLUMN_IDS,
    hidden: hiddenColumns,
    // 🔴 検索条件と**いま見ているページ**（`cursor`）、**開いている行**を保つ
    //    （列を外して行を見失わない / パネルが閉じない）。
    hrefOf: (columnId) =>
      projectColumnToggleHref(query, query.cursor ?? null, hiddenColumns, columnId, selectedId),
  });

  // ==========================================================================
  // ✅✅ 2026-10-19: 検索エリア（`_search/`）に渡すもの
  // ==========================================================================
  const searchOptions = projectSearchFilterOptions(skills.items);
  // 🔴 スキルの語は**辞書のデータ**であり `packages/i18n` に無いので、
  //    バッジの語彙にここで差し込む（`list-props.ts` は空で返す）。
  const panelMessages = projectSearchPanelMessages();
  const searchMessages = {
    ...panelMessages,
    chipLabels: { ...panelMessages.chipLabels, skillOptions: searchOptions.skillOptions },
  };
  // 🔴 **画面に欄が無いが URL には在る値**と**表示の状態**。
  //    🔴 **かつての `parallelOk` は入れない**（指示書 §3）。
  const passThroughParams: { readonly name: string; readonly value: string }[] = [];
  // 検索実行はpageを引き継がず先頭へ戻す。表示件数だけは維持する。
  passThroughParams.push({name:'limit',value:String(query.limit)});
  if (query.sourceKind !== undefined) {
    passThroughParams.push({ name: 'sourceKind', value: query.sourceKind });
  }
  if (query.recruitingOnly === true) passThroughParams.push({ name: 'recruitingOnly', value: '1' });
  if (query.startFrom !== undefined) {
    passThroughParams.push({ name: 'startFrom', value: query.startFrom });
  }
  // 🔴🔴 **生値（`raw`）を読まない。** `?hide=a&hide=b`（配列形）を受け取るのが
  //    `parseHiddenProjectColumns` の仕様であり（`lib/ui/hidden-columns.ts`）、
  //    生値を `typeof === 'string'` で見ると**配列形のときだけ列の表示状態が黙って消える**。
  // 🔴 **URL を組む経路を 1 本に戻す** —— `projectListHref` が使っているのと同じ関数である。
  //    既定と同じなら `null`（URL に痕跡を残さない）、既定から戻したときの空値も落ちない。
  const hideValue = hiddenColumnsParamValue(hiddenColumns, PROJECT_DEFAULT_HIDDEN_COLUMN_IDS);
  if (hideValue !== null) passThroughParams.push({ name: HIDDEN_COLUMNS_PARAM, value: hideValue });
  // ⚠️ **`selectedId` は未指定のとき先頭行に倒れる**（`selectedProjectId`）ので、
  //    検索を押すと**元々 URL に無かった `selected=` が付く**。表示は壊れない
  //    （新しい結果に無ければ新しい先頭行に倒れる = 古い案件を出し続けない）。
  // 🔴 **ページングが `selected` を引き継がないのとは判断が違う** —— あちらは
  //    「次のページにその行が居ない」が確定しているが、検索は**残る可能性がある**。
  if (selectedId !== null) passThroughParams.push({ name: PROJECT_SELECTED_PARAM, value: selectedId });
  if (panelTab !== 'BASIC') passThroughParams.push({ name: PROJECT_PANEL_TAB_PARAM, value: panelTab });
  // 🔴 **既定は「開いている」**（cookie が無い = 初回）。`'0'` のときだけ閉じる。
  const expandedCookie = (await cookies()).get(searchExpandedCookieName(ctx.userId))?.value;
  const defaultExpanded = expandedCookie !== '0';

  return (
    // ページ見出しの下に、検索＋一覧と右側の詳細を並べる（狭幅では縦積み）。
    <main className={cn(CONTENT_PADDING_Y_CLASS,'min-h-full bg-bg-subtle')}>
      <PageBody widthClass="full">
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
      {/* ✅✅ **2026-10-16: 説明の 1 行を外した**（人間の明示指示「タイトル下の説明文はいらない」）。
          🔴 **母集団の説明は失っていない** —— 表の上の件数行（`自社案件 6 件` /
             取引先では「公開された案件」）が母集団そのものを出しており、取引先向けの
             `partnerScopeNotice` も残っている。消したのは**重複していた 1 行**である。
          ⚠️ 文言キー（`projects.list.description*`）は消していない（`U-22` の凍結）。 */}
      <ProjectListScreen
        pagination={paging}
        summaryPanel={
          <ProjectSummaryPanel
            row={selectedRow}
            basicInfo={basicInfo}
            canEdit={canRegister}
            // ✅✅ 2026-10-16: 開いているタブ（人間の明示指示「タイル内にタブを設置して、
            //    基本情報とコピペ用サマリ」）。🔴 出所は URL（`?panelTab=`）であり、
            //    画面は状態を持たない。未知の値は既定（基本情報）に落ちる。
            // ⚠️ `canEdit` は渡さなくなった（人間の明示指示「案件サマリのボタンは、
            //    詳細を開くだけでよい」で `編集する` を画面から外したため）。
            tab={panelTab}
            tabHrefOf={(tab) =>
              projectPanelTabHref(query, query.cursor ?? null, hiddenColumns, selectedId, tab)
            }
            messages={projectSummaryPanelMessages()}
          />
        }
        rows={rows}
        // 🔴 **いま一覧に効いている条件**（`appliedFilters`。指示書 §6）。
        //    🔴 `parallelOk` は上で落としてあるので、ここに届く余地が無い。
        applied={projectAppliedSearchDraft(query)}
        searchOptions={searchOptions}
        // 🔴 **画面に欄を持たないが URL には在る値を素通しする**——
        //    検索を 1 回押しただけで、開いていた行も隠していた列も黙って消えない。
        //    ⚠️ **`parallelOk` は入らない**（指示書 §3 で除外した）。
        passThroughParams={passThroughParams}
        // 🔴 保存条件の置き場所を**会社×ユーザー**で分ける（指示書 §5）。
        storageTenantId={ctx.tenantId}
        storageUserId={ctx.userId}
        // 🔴 **再訪時に折りたたみを復元する**（指示書 §4）。
        //    🔴 **cookie で持つ**理由: サーバがその状態で描けるので、
        //       水合の後に閉じる「ちらつき」が出ない（`localStorage` だと出る）。
        defaultExpanded={defaultExpanded}
        searchMessages={searchMessages}
        // 🔴 取引先には公開先の列を出さない（docs/04 §S-010 / `F-014 AC-4`）。出所は ctx である。
        // 🔴 `S-012` に到達できるのはホストの 3 ロールだけである（`PROJECT_EDITOR_ROLES`）。
        //    押しても戻されるだけの導線を描かない。拒否の本体は `#26` のガードと
        //    `S-012` のリダイレクトである。
        canRegister={canRegister}
        // 🔴 ページングのリンクは**検索条件と列の表示状態を保つ**（`projectListHref`）——
        //    次ページで隠した列が復活すると、利用者は何が起きたか説明できない。
        // 🔴 **`?selected=` は引き継がない** —— 開いていた行は次のページに居ないので、
        //    引き継ぐと「このページに無い ID」になる（遷移先で先頭行に落ちる）。
        columnToggleItems={columnToggleItems}
        selectedId={selectedId}
        // 🔴 行から副カラムを開く URL（検索条件・ページの位置・列の表示状態を保つ）。
        // ✅✅ 2026-10-16: 🔴 **開いているタブも保つ** —— 行を次々に開いてコピペ用サマリを
        //    取るときに、毎回タブを押し直すことにならない。
        selectHrefOf={(projectId) =>
          projectSelectHref(query, query.cursor ?? null, hiddenColumns, projectId, panelTab)
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
