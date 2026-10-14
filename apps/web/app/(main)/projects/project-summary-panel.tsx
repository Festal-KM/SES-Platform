// apps/web/app/(main)/projects/project-summary-panel.tsx
// `S-010` の**副カラム（案件の要点パネル）** — SP-22 段④（人間のワイヤーフレーム
// 「SES Hub案件管理ダッシュボード.png」の右パネル）。`docs/04` §7.1 の幅クラス B の副カラム。
// ✅ **2026-10-14: 受領した定義書 `docs/design-system-projects.md` §1.8（案件詳細 Panel）に
//    形を合わせた**（帯 → 案件名 + 状態 Badge → Key-Value 30px → 下端の操作行）。
//
// ============================================================================
// 🔴 このパネルが「新しい開示」を 1 つも作っていないこと
// ============================================================================
// 🔴 **描くのは `ProjectListRowView`（= 一覧の行）の値だけである。** 行の型以外の入力を
//    受け取らないので、**商流情報（エンド企業名 / 内部単価）・担当者・他社の提案を描く枝が
//    そもそも書けない**（一覧は取得の時点でその 2 列を読んでいない。`lib/projects/list.ts` の
//    `PROJECT_LIST_SELECT`）。`F-013 AC-2` / `F-014 AC-4` / `BR-07`。
//    🔴 定義書 §1.8 の Key-Value には **企業名 / 業務内容 / 商流 / 精算単位 / 担当者**が在るが、
//       いずれも**この行に無い**。企業名（= エンド企業名）の判断は
//       [Issue #100](https://github.com/Festal-KM/SES-Platform/issues/100)（既定 = 出さない）、
//       残りは読み取り経路を広げる話なので `docs/design-system-projects.md` の差分表に
//       理由つきで記録した。
// 🔴 **新しいエンドポイント・新しい読み取りを 1 本も足していない。** パネルは
//    `listProjects` が返した**同じ 1 ページの行**から描かれる（追加の往復が無いので、
//    一覧の p95〔`F-015 AC-2`〕に影響しない）。
// 🔴 **公開先の設定状況（`row.visibility`）は取引先の行では型として `null` である**
//    （`projectListRow` が `audience` の判別子で保証する）。ここで `null` を書かないだけ。
// 🔴 **閲覧の監査記録はここで起きない**（`BR-27` / `F-013 AC-3`。記録対象は「案件**詳細**の
//    閲覧」= `S-011` であり、一覧の描画では記録しない。`docs/04` §S-010「操作と結果」の ⚠️）。
//    🔴 したがって**パネルにスキルシート・エンジニア・提案の中身を 1 つも持ち込まない**
//    （`HANDOFF.md` §3.3 の「`Drawer` に台帳を含めない」と同じ理由。一覧をなぞるだけで
//    監査ログが膨張する経路を作らない）。
//
// ============================================================================
// 🔴 `Drawer` ではない（`docs/04` §11-25 / §5-13）
// ============================================================================
// `Drawer` プリミティブの適用は **`S-003` / `S-004` の要対応キューの行のみ**である。
// ここは **`PageBody widthClass="split"` の副カラム**であり（`S-016` の右パネルと同じ位置づけ）、
// `lg` 未満では `PageBody` が**本体の下に積む**（隠さない。`CLAUDE.md` §13.3）。
//
// ============================================================================
// 🔴 定義書（§1.8）から**意図して変えた / 落とした**もの
// ============================================================================
// | 定義書 | ここ | 理由 |
// |---|---|---|
// | 帯の語は `案件詳細` | **`案件の要点`**（既存の文言キー） | 🔴 §7.8: **同じ語が 2 つの概念を指さない。** `詳細` は画面（`S-011`）を指す語であり、副カラムは要点である（操作列の語を `内容を見る` にしたのと同じ理由） |
// | 帯の高さ 48 | **40**（`SECTION_HEADER_HEIGHT_CLASS`） | 🔴 「見出しの帯」の高さを 2 つ作らない（`docs/design-system.md` §4 の Section Header と同じ段。48 を別に持つと、同じ形の帯が画面ごとに 2 つの高さになる） |
// | 案件名 20/700 | **16/700**（`text-lg`） | §3.2 の型に 20/700 が無い。17/700（`text-rail`）は `RailCard` 専用で、`tests/static/design-tokens.test.ts` が使用箇所を固定している |
// | Key-Value のキー列 96 | **124**（`PANEL_KEY_WIDTH_CLASS`） | チャットの関連情報パネル（§4.5）と**同じ 1 定数**にする。パネルごとにキー列が違うと、値の左端が画面を移るたびに動く |
// | ヘッダの ✕（閉じる） | **描かない** | 🔴 **閉じられない** —— 開いている行は URL（`?selected=`）が持ち、未指定のときは先頭行に落ちる（`selectedProjectId`）。閉じる状態が URL に無いので、押しても何も起きないボタンになる |
// | 均等 5 タブ（基本情報 / 募集要件 / 提案状況 / 関連ファイル / メモ） | **描かない** | 中身が 1 面しか無い（提案状況は Phase 1 で常に空、関連ファイル・メモは実体が無い）。🔴 押しても何も起きないタブを置かない |
// | `編集` / `案件を複製` / `…` | **編集のみ**（下端の操作行） | 案件の複製という機能が存在しない（API も画面も無い）。`…` は中身が 1 つしか無いメニューになる |
// | 下端は `チャット` + `人材を提案`（primary） | **`案件詳細を開く` / `編集する` / `この案件に合う人材を探す`**（いずれも secondary） | チャットは Phase 2（`CLAUDE.md` §5）。🔴 primary は 1 画面に 1 つ（§7.6）であり、この画面の primary は帯の `案件を登録` である |
// | 状態は**素のテキスト** ← 着手前の実装 | ✅ **`StatusBadge`**（`entity="project"`） | 定義書 §1.7 / §1.8 が Badge を定めた。🔴 色は `@ses/ui` が状態名から決め、**画面は渡せない**（割り当ては [Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98)、既定 A） |
//
// 🔴 `'use client'` を宣言しない（状態を持たない。開いている行は URL が持つ）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import Link from 'next/link';
import {
  Card,
  Icon,
  PANEL_KEY_WIDTH_CLASS,
  PANEL_KV_ROW_HEIGHT_CLASS,
  SECONDARY_BUTTON_LINK_CLASSES,
  SECTION_HEADER_HEIGHT_CLASS,
  StatusBadge,
  cn,
} from '@ses/ui';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';

export type ProjectSummaryPanelMessages = {
  /** 帯の語（`案件の要点`）。🔴 行が 1 件も無いときの見出しも兼ねる。 */
  readonly title: string;
  readonly empty: string;
  readonly detail: string;
  readonly edit: string;
  readonly candidates: string;
  /** キーバリューのラベル（🔴 **一覧の列見出しと同じ語を使う** —— 同じ値に 2 つの名前を作らない）。 */
  readonly fieldMustRequirements: string;
  readonly fieldUnitPrice: string;
  readonly fieldStartDate: string;
  readonly fieldLocation: string;
  readonly fieldHeadcount: string;
  readonly fieldUpdatedOn: string;
  readonly fieldVisibility: string;
};

type PanelField = { readonly key: string; readonly label: string; readonly value: string };

/** 帯（40h。アイコン + 語 + 下枠）。🔴 寸法は `layout-tokens.ts` の定数から取る。 */
const PANEL_HEAD_CLASSES = cn(
  'flex items-center gap-2 border-b border-border px-4',
  SECTION_HEADER_HEIGHT_CLASS,
);
/** 帯の語（15/700）。🔴 `h2` にしない —— この帯は器の名前であり、見出しは案件名である。 */
const PANEL_HEAD_LABEL_CLASSES = 'min-w-0 truncate text-row font-bold text-fg';
/** Key-Value の 1 行（30px）。🔴 キーの列は 124px 固定（値の左端が縦に通る）。 */
const KV_ROW_CLASSES = cn(
  'flex items-start gap-2 border-t border-border-row py-1.5',
  PANEL_KV_ROW_HEIGHT_CLASS,
);
const KV_KEY_CLASSES = cn('shrink-0 text-cell text-fg-muted', PANEL_KEY_WIDTH_CLASS);
const KV_VALUE_CLASSES = 'm-0 min-w-0 flex-1 text-body text-fg';

/**
 * キーバリューの並び。🔴 **一覧の列の並びに合わせる**（表で左から読んだ順と、パネルで上から
 * 読んだ順が違うと、同じ値を 2 回探すことになる）。
 *
 * 🔴 **状態（`status`）はここに無い** —— 案件名の隣の `StatusBadge` が出している。
 *    **同じ値を 1 つのパネルに 2 回描かない**（定義書 §1.8 の Key-Value には `ステータス` が
 *    在るが、あちらはタイトル行の Badge と Key-Value の両方に同じ値を置いている）。
 */
function panelFields(
  row: ProjectListRowView,
  messages: ProjectSummaryPanelMessages,
): readonly PanelField[] {
  const fields: PanelField[] = [
    {
      key: 'mustRequirements',
      label: messages.fieldMustRequirements,
      // 🔴 超過件数は一覧と同じ `+N` の形で添える（`projectListRow` が組んだ値をそのまま使う）。
      value:
        row.moreMustRequirements === null
          ? row.mustRequirements
          : `${row.mustRequirements} ${row.moreMustRequirements}`,
    },
    { key: 'unitPrice', label: messages.fieldUnitPrice, value: row.unitPrice },
    { key: 'startDate', label: messages.fieldStartDate, value: row.startDate },
    { key: 'location', label: messages.fieldLocation, value: row.location },
    { key: 'headcount', label: messages.fieldHeadcount, value: row.headcount },
    { key: 'updatedOn', label: messages.fieldUpdatedOn, value: row.updatedOn },
  ];
  // 🔴 取引先の行では `visibility` が `null` である（`F-014 AC-4` / `BR-07`）。DOM に出さない。
  if (row.visibility !== null) {
    fields.push({ key: 'visibility', label: messages.fieldVisibility, value: row.visibility });
  }
  return fields;
}

/** 帯（行の有無で位置が動かないよう、両方の状態で出す）。 */
function PanelHead({ label }: { readonly label: string }) {
  return (
    <div className={PANEL_HEAD_CLASSES}>
      {/* 🔴 印であって意味ではない（語がラベルを担う）。サイドバーの `案件管理` と同じ図形にする。 */}
      <Icon name="briefcase" size="md" />
      <span className={PANEL_HEAD_LABEL_CLASSES}>{label}</span>
    </div>
  );
}

export function ProjectSummaryPanel({
  row,
  canEdit,
  messages,
}: {
  /** 副カラムで開いている行（1 件も無いページでは `null`）。 */
  readonly row: ProjectListRowView | null;
  /**
   * 🔴 `S-012`（編集）へ到達できるのはホストの 3 ロールだけである（`PROJECT_EDITOR_ROLES`）。
   *    ⚠️ UI の配慮であり拒否の本体ではない（`#26` の `requireRole` / `S-012` の `redirect` /
   *    `projects` の RLS = C2）。
   */
  readonly canEdit: boolean;
  readonly messages: ProjectSummaryPanelMessages;
}) {
  if (row === null) {
    return (
      <Card data-testid="project-list-panel">
        <PanelHead label={messages.title} />
        <div className="p-4">
          <p className="m-0 text-body text-fg-muted" data-testid="project-list-panel-empty">
            {messages.empty}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col" data-testid="project-list-panel" data-project-id={row.id}>
      <PanelHead label={messages.title} />
      {/* 案件名 + 状態。🔴 `h1` にしない —— 画面の `h1` は帯（`PageHeading`）が持つ
          （1 画面 1 つ。`tests/static/page-heading-single.test.ts`）。 */}
      <div className="flex flex-col gap-2 p-4">
        <h2 className="m-0 min-w-0 text-lg font-bold text-fg" data-testid="project-list-panel-name">
          {row.name}
        </h2>
        {/* 🔴 色は渡していない（`entity` + 状態名だけ）。語は `packages/i18n` 由来である。 */}
        <div data-testid="project-list-panel-status">
          <StatusBadge entity="project" state={row.statusState} label={row.status} />
        </div>
      </div>
      <dl className="m-0 flex flex-col px-4">
        {panelFields(row, messages).map((field) => (
          <div key={field.key} className={KV_ROW_CLASSES}>
            <dt className={KV_KEY_CLASSES}>{field.label}</dt>
            <dd className={KV_VALUE_CLASSES} data-testid={`project-list-panel-field-${field.key}`}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
      {/* 下端の操作行（定義書 §1.8 のフッタ）。🔴 いずれも secondary である —— primary は
          1 画面に 1 つで、この画面では帯の `案件を登録` が持つ（§7.6）。
          🔴 `案件詳細を開く` が最初である（`docs/04` §S-010「行クリック → `S-011`」と同じ
             行き先であり、新しい遷移ではない）。 */}
      <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
        <div className="flex gap-2">
          <Link
            className={cn(SECONDARY_BUTTON_LINK_CLASSES, 'flex-1')}
            href={`/projects/${row.id}`}
            data-testid="project-list-panel-detail"
          >
            {messages.detail}
          </Link>
          {canEdit ? (
            <Link
              className={cn(SECONDARY_BUTTON_LINK_CLASSES, 'flex-1')}
              href={`/projects/${row.id}/edit`}
              data-testid="project-list-panel-edit"
            >
              {messages.edit}
            </Link>
          ) : null}
        </div>
        <Link
          className={cn(SECONDARY_BUTTON_LINK_CLASSES, 'w-full')}
          href={`/projects/${row.id}/candidates`}
          data-testid="project-list-panel-candidates"
        >
          {messages.candidates}
        </Link>
      </div>
    </Card>
  );
}
