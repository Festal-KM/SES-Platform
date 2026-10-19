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
// ✅ 2026-10-16: 単価の逆転の判定（述語〔重なり〕と同じファイルの 1 本。人間の明示指示）。
import { isUnitPriceRangeInverted } from '@ses/db';
import { t } from '@ses/i18n';
import { PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { listProjects } from '../../../../lib/projects/list';
import {
  hasProjectListFilters,
  parseHiddenProjectColumns,
  PROJECT_HIDEABLE_COLUMN_IDS,
  projectColumnToggleHref,
  projectListHref,
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
import { HIDDEN_COLUMNS_PARAM } from '../../../../lib/ui/hidden-columns';
// ✅✅ 2026-10-16: 検索項目は 6 つになった（人間の明示指示）。🔴 **外した 4 つ
//    （案件区分 / 勤務地 / 開始時期 / 並行可否）の選択肢は import ごと外す** ——
//    受け取って使わない props を残さない（query と述語は残してある）。
import {
  projectColumnToggleItems,
  projectListScreenMessages,
  projectCategoryFilterOptions,
  projectRemoteModeFilterOptions,
  projectSkillFilterOptions,
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
  // 🔴 **副カラムで開く行**（SP-22 段④）。`?selected=` も**表示の状態**であり API には渡さない
  //    （`?hide=` と同じ扱い。`projectListQuerySchema` はこのキーを持たず、Zod の既定〔strip〕で
  //    落ちるので上の `safeParse` は成功し、URL も書き換わらない）。
  // 🔴 **いまのページの行に照合してから使う** —— URL 直打ちで「このページに無い ID」を
  //    指されても、先頭行に落ちる（`selectedProjectId`）。**DB を引き直さない。**
  const selectedId = selectedProjectId(raw[PROJECT_SELECTED_PARAM], rows);
  // ✅✅ **2026-10-16: 案件サマリのタブ**（人間の明示指示「タイル内にタブを設置して、
  //    基本情報とコピペ用サマリ」）。🔴 `?selected=` / `?hide=` と同じ**表示の状態**であり、
  //    API には渡さない（`projectListQuerySchema` はこのキーを持たず、Zod の既定〔strip〕で
  //    落ちるので上の `safeParse` は成功し、URL も書き換わらない）。
  //    🔴 未知の値は既定（基本情報）に落ちる（`redirect` しない）。
  const panelTab = projectPanelTab(raw[PROJECT_PANEL_TAB_PARAM]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
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
        // 🔴 ✅ 2026-10-03（**同日中に差し替え**）: **副カラムの並置は「主カラムが下限（1,320px
        //    = この表の min-content 1,313px）を保てるとき」だけ**（`@ses/ui` の
        //    `PageBodyAsideFrom` の 🔴）。
        //    ⚠️ 直前の実装（`asideFrom="2xl"`）は **1536px で主カラムを 1,238 → 758px に半減**させ、
        //    この表の可視率を **94% → 58%** に落としていた（＝ **幅を広げると悪化する**）。
        //    崖を 1280 から 1536 へ移しただけであり、1536 は Windows ノートで最も多い論理幅である。
        //    判定は `flex-wrap` が主カラムの `basis` で行うので、**画面幅の境界を 1 つも使わない**。
        //    🔴 列は 1 つも減らしていない（§7.1「列を削らないことが先」）。
        asideFrom="main-min"
        aside={
          <ProjectSummaryPanel
            row={selectedRow}
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
      {/* ✅✅ **2026-10-16: 説明の 1 行を外した**（人間の明示指示「タイトル下の説明文はいらない」）。
          🔴 **母集団の説明は失っていない** —— 表の上の件数行（`自社案件 6 件` /
             取引先では「公開された案件」）が母集団そのものを出しており、取引先向けの
             `partnerScopeNotice` も残っている。消したのは**重複していた 1 行**である。
          ⚠️ 文言キー（`projects.list.description*`）は消していない（`U-22` の凍結）。 */}
      <ProjectListScreen
        rows={rows}
        filters={{
          q: query.q ?? '',
          status: query.status ?? '',
          startFrom: query.startFrom ?? '',
          prefecture: query.prefecture ?? '',
          // ✅ 2026-10-15: 単価レンジ（未指定は空文字 ＝ 入力欄が空）。人材一覧と同じ形である。
          priceMin: query.priceMin === undefined ? '' : String(query.priceMin),
          priceMax: query.priceMax === undefined ? '' : String(query.priceMax),
          // ✅ 2026-10-16（人間の明示指示）: 稼働形態 / 募集中のみ。
          remoteMode: query.remoteMode ?? '',
          recruitingOnly: query.recruitingOnly === true ? '1' : '',
          // ✅ 2026-10-16（受領モック）: カテゴリ / 案件区分 / 並行可否 / 開始時期。
          category: query.category ?? '',
          sourceKind: query.sourceKind ?? '',
          parallelOk: query.parallelOk === undefined ? '' : query.parallelOk ? '1' : '0',
          startWithin: query.startWithin ?? '',
          // ✅✅ 2026-10-16（人間の明示指示「スキル（リストから複数選択できる、or 検索）」）。
          // 🔴 **これだけが配列である**（`<select multiple>` の選択状態）。未指定は空配列
          //    = 何も選ばれていない = すべて（番兵を置かない）。
          skills: query.skills ?? [],
        }}
        statusOptions={projectStatusFilterOptions}
        remoteModeOptions={projectRemoteModeFilterOptions}
        categoryOptions={projectCategoryFilterOptions}
        // ✅✅ 2026-10-16: スキルの選択肢はグローバル辞書（`Skill`）である。
        // 🔴 **語は辞書の `name`** であり `packages/i18n` に無い（辞書はデータであって文言ではない）。
        // 🔴 **並びは `listSkills` が決めた決定的な順**（`sortKey` 昇順 → `id`）をそのまま使う。
        skillOptions={projectSkillFilterOptions(skills.items)}
        // ⚠️ **2026-10-19: `skillRemoveHrefOf` を渡さなくなった。** バッジの `×` は
        //    URL への遷移ではなく**チェックを外す操作**になった（受領モックの
        //    「チェック = バッジ」に揃えたため。`skill-filter-select.tsx` 冒頭の 🔴）。
        priceInverted={priceInverted}
        // 🔴 取引先には公開先の列を出さない（docs/04 §S-010 / `F-014 AC-4`）。出所は ctx である。
        // 🔴 `S-012` に到達できるのはホストの 3 ロールだけである（`PROJECT_EDITOR_ROLES`）。
        //    押しても戻されるだけの導線を描かない。拒否の本体は `#26` のガードと
        //    `S-012` のリダイレクトである。
        canRegister={canRegister}
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
