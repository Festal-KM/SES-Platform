// 一覧右側の基本情報とコピー用サマリ。basicInfoは閲覧権限に応じてサーバーで組む。
// 商流情報・内部備考・担当者はホスト専用。詳細内容を読む経路で閲覧監査を記録する。
import Link from 'next/link';
import type { ProjectBasicInfoField } from '../../../lib/projects/basic-info';
import {
  Card,
  NAV_TAB_CLASSES,
  NAV_TAB_CURRENT_CLASSES,
  PANEL_KEY_WIDTH_CLASS,
  PANEL_KV_ROW_HEIGHT_CLASS,
  SECONDARY_BUTTON_LINK_CLASSES,
  StatusBadge,
  cn,
} from '@ses/ui';
import { projectCopySummary } from '../../../lib/projects/copy-summary';
import { ProjectCopySummary } from './project-copy-summary';
import { ProjectStatusControl, type ProjectStatusControlMessages } from './project-status-control';
import {
  PROJECT_PANEL_TABS,
  type ProjectListRowView,
  type ProjectPanelTab,
} from '../../../lib/projects/list-rows';

export type ProjectSummaryPanelMessages = {
  readonly copyAction: string;
  readonly copyCopied: string;
  readonly copyFailed: string;
  readonly statusControl: ProjectStatusControlMessages;
  /**
   * 帯の語（✅✅ **2026-10-16: `案件の要点` → `案件サマリ`**。人間の明示指示
   * 「右側の案件の要点は案件サマリに文言を変更して」）。🔴 行が 1 件も無いときの見出しも兼ねる。
   */
  readonly title: string;
  readonly empty: string;
  /**
   * ✅✅ **2026-10-16: 下端の操作は 1 つだけになった**（人間の明示指示「案件サマリの
   * ボタンは、詳細を開くだけでよい」）。🔴 `編集する` / `この案件に合う人材を探す` は
   * **画面から外した**（行き先は `S-011` からそのまま辿れる）。
   */
  readonly detail: string;
  /**
   * ✅✅ **2026-10-16: タイル内のタブ**（人間の明示指示「タイル内にタブを設置して、
   * 基本情報とコピペ用サマリ（添付を参考）」）。
   */
  readonly tabBasic: string;
  readonly tabCopy: string;
  /** コピペ用サマリの面の 2 行（用途と、まだ保存できないこと）。 */
  readonly copyHint: string;
  readonly copyGeneratedNote: string;
  /** キーバリューのラベル（🔴 **一覧の列見出しと同じ語を使う** —— 同じ値に 2 つの名前を作らない）。 */
  readonly fieldMustRequirements: string;
  readonly fieldUnitPrice: string;
  readonly fieldStartDate: string;
  readonly fieldLocation: string;
  /** ✅ 2026-10-15: 稼働形態（一覧で `勤務地` と 2 列に分けたので、パネルも 2 行に分ける）。 */
  readonly fieldRemoteMode: string;
  readonly fieldHeadcount: string;
  readonly fieldUpdatedOn: string;
  readonly fieldVisibility: string;
};



/** Key-Value の 1 行（30px）。🔴 キーの列は 124px 固定（値の左端が縦に通る）。 */
const KV_ROW_CLASSES = cn(
  'flex shrink-0 items-start gap-2 border-t border-border-row py-1.5',
  PANEL_KV_ROW_HEIGHT_CLASS,
);
const KV_KEY_CLASSES = cn('shrink-0 text-cell text-fg-muted', PANEL_KEY_WIDTH_CLASS);
const KV_VALUE_CLASSES = 'm-0 min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-body text-fg';

// ============================================================================
// ✅✅ 2026-10-16: タイル内のタブ（人間の明示指示「タイル内にタブを設置して、
//     基本情報とコピペ用サマリ（添付を参考）」）
// ============================================================================
/**
 * 🔴 **`@ses/ui` の `Tabs`（Radix）を使っていない。** あれは `'use client'` であり、
 *    import する側も `'use client'` を宣言しなければならない
 *    （`tests/static/ui-dependency-single-path.test.ts` の検査 ⑤）。この画面は
 *    **クライアントの島を 1 つも持たない**状態になっており（`project-list-screen.tsx` の ⚠️）、
 *    タブのために島を 1 つ戻すと、水和の前に押せないタブが生まれる。
 * 🔴 したがってタブは**リンク 2 本**である（`?panelTab=`。`nav-panel.tsx` が「遷移するタブ」に
 *    ついて書いているのと同じ判断）。選ばれた面はサーバが描く。
 * 🔴 **見え方は `@ses/ui` の 1 定義**（`NAV_TAB_CLASSES` / `NAV_TAB_CURRENT_CLASSES`）——
 *    下端 2px とブランド色を画面側で組み直さない（§7.10）。
 * 🔴 `role="tablist"` を自作しない —— リンクの並びは**ナビゲーション**であり、
 *    `tablist` を名乗ると矢印キーで動く約束をしたことになる（Radix 版だけがそれを果たせる）。
 */
const PANEL_TAB_BAR_CLASSES = 'flex shrink-0 items-stretch gap-4 border-b border-border px-4';

/** コピペ用サマリの面。🔴 等幅にしない（貼る先は LINE やメールであり、整形はしない）。 */

export function ProjectSummaryPanel({
  row,
  tab,
  tabHrefOf,
  messages,
  basicInfo,
  canEdit = false,
}: {
  /** 副カラムで開いている行（1 件も無いページでは `null`）。 */
  readonly row: ProjectListRowView | null;
  /**
   * ✅✅ **2026-10-16: 開いているタブ**（`?panelTab=`。`projectPanelTab` が決める）。
   * 🔴 **画面が状態を持たない** —— 再読込・共有・戻るで同じ面が開く。
   */
  readonly tab: ProjectPanelTab;
  /** そのタブを開く URL（`projectPanelTabHref`。検索条件・ページ・開いている行を保つ）。 */
  readonly tabHrefOf: (tab: ProjectPanelTab) => string;
  readonly messages: ProjectSummaryPanelMessages;
  readonly basicInfo: readonly ProjectBasicInfoField[];
  readonly canEdit?: boolean;
}) {
  if (row === null) {
    return (
      <Card className="h-full rounded-none border-0" data-testid="project-list-panel">
        <div className="p-4">
          <p className="m-0 text-body text-fg-muted" data-testid="project-list-panel-empty">
            {messages.empty}
          </p>
        </div>
      </Card>
    );
  }

  // 🔴 **タブの語と面の対応はこの 1 つの配列で決まる**（語だけ足して面が無いタブを作れない）。
  const tabs: readonly { readonly value: ProjectPanelTab; readonly label: string }[] = [
    { value: 'BASIC', label: messages.tabBasic },
    { value: 'COPY', label: messages.tabCopy },
  ];
  // 🔴 値集合の出所は `PROJECT_PANEL_TABS` の 1 本である（タブを足したらここで落ちる）。
  if (tabs.length !== PROJECT_PANEL_TABS.length) {
    throw new Error('案件サマリのタブの語が PROJECT_PANEL_TABS と一致しません');
  }

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0" data-testid="project-list-panel" data-project-id={row.id}>
      {/* 案件名 + 状態。🔴 `h1` にしない —— 画面の `h1` は帯（`PageHeading`）が持つ
          （1 画面 1 つ。`tests/static/page-heading-single.test.ts`）。
          🔴 **タブより上に置く** —— どのタブに居ても「どの案件か」が見えていなければならない
             （ホームの要対応の 0 件をタブより上に置いたのと同じ理由）。 */}
      {/* 公開先列の凍結IDは選択中の案件へ移す。取引先にはIDも公開先情報も出さない。 */}
      <div
        className="flex shrink-0 flex-col gap-2 p-4"
        data-testid={tab === 'BASIC' && row.visibility !== null ? `project-list-visibility-${row.id}` : undefined}
        title={tab === 'BASIC' ? row.visibility ?? undefined : undefined}
      >
        <h2 className="m-0 min-w-0 text-lg font-bold text-fg" data-testid="project-list-panel-name">
          {row.name}
        </h2>
        {/* 🔴 色は渡していない（`entity` + 状態名だけ）。語は `packages/i18n` 由来である。 */}
        <div data-testid="project-list-panel-status">
          {canEdit ? (
            <ProjectStatusControl key={row.id} id={row.id} status={row.statusState} messages={messages.statusControl} />
          ) : <StatusBadge entity="project" state={row.statusState} label={row.status} />}
        </div>
      </div>
      {/* ✅✅ 2026-10-16: タイル内のタブ。 */}
      <div className={PANEL_TAB_BAR_CLASSES} data-testid="project-list-panel-tabs">
        {/* 🔴 **現在のタブも押せる**（押すと同じ URL に戻るだけであり、`aria-current="page"` が
            「いまここ」を読み上げに伝える）。
            🔴 **`data-testid` はテンプレートリテラルで書く** —— 変数をそのまま渡すと
               `tests/static/testid-inventory.test.ts` が値を静的に解決できず、凍結の穴になる。 */}
        {tabs.map((item) => (
          <Link
            key={item.value}
            className={item.value === tab ? NAV_TAB_CURRENT_CLASSES : NAV_TAB_CLASSES}
            href={tabHrefOf(item.value)}
            aria-current={item.value === tab ? 'page' : undefined}
            data-testid={`project-list-panel-tab-${item.value.toLowerCase()}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      {tab === 'BASIC' ? (
        <dl className="m-0 flex min-h-0 flex-1 flex-col overflow-y-auto px-4" data-testid="project-list-panel-basic">
          {basicInfo.map((field) => (
            <div key={field.key} className={KV_ROW_CLASSES}>
              <dt className={KV_KEY_CLASSES}>{field.label}</dt>
              <dd className={KV_VALUE_CLASSES} data-testid={`project-list-panel-field-${field.key}`}>
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <ProjectCopySummary text={projectCopySummary(row.name, basicInfo)} messages={{
          label: messages.tabCopy, hint: messages.copyHint, copy: messages.copyAction,
          copied: messages.copyCopied, failed: messages.copyFailed,
        }} />
      )}
      {/* 下端の操作行。
          ✅✅ **2026-10-16: 1 つだけにした**（人間の明示指示「案件サマリのボタンは、
             詳細を開くだけでよい」）。🔴 secondary である —— primary は 1 画面に 1 つで、
             この画面では帯の `新規案件登録` が持つ（§7.6）。
          🔴 行き先は `S-011` であり、**新しい画面を足していない**（一覧の行クリックと同じ）。 */}
      <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border p-4">
        <Link
          className={cn(SECONDARY_BUTTON_LINK_CLASSES, 'w-full')}
          href={`/projects/${row.id}`}
          data-testid="project-list-panel-detail"
        >
          {messages.detail}
        </Link>
      </div>
    </Card>
  );
}
