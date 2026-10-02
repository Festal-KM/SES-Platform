// apps/web/app/(main)/projects/project-summary-panel.tsx
// `S-010` の**副カラム（案件の要点パネル）** — SP-22 段④（人間のワイヤーフレーム
// 「SES Hub案件管理ダッシュボード.png」の右パネル）。`docs/04` §7.1 の幅クラス B の副カラム。
//
// ============================================================================
// 🔴 このパネルが「新しい開示」を 1 つも作っていないこと
// ============================================================================
// 🔴 **描くのは `ProjectListRowView`（= 一覧の行）の値だけである。** 行の型以外の入力を
//    受け取らないので、**商流情報（エンド企業名 / 内部単価）・担当者・他社の提案を描く枝が
//    そもそも書けない**（一覧は取得の時点でその 2 列を読んでいない。`lib/projects/list.ts` の
//    `PROJECT_LIST_SELECT`）。`F-013 AC-2` / `F-014 AC-4` / `BR-07`。
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
// 🔴 ワイヤーフレームから**意図して落としたもの**（押しても何も起きない UI を作らない）
// ============================================================================
// | ワイヤーフレーム | 落とした理由 |
// |---|---|
// | `複製` / `…`（その他メニュー） | 案件の複製という機能が存在しない（API も画面も無い） |
// | タブ `関連ファイル` / `メモ` | 案件に添付・メモの実体が無い（`docs/04` §S-011 のセクションにも無い） |
// | タブ `提案状況` | 提案の一覧は `S-011` セクション 6 にあり、Phase 1 では常に空である（同§の 🔴） |
// | `この案件についてチャット` | チャットは **Phase 2**（`CLAUDE.md` §5） |
// | 状態の**バッジ** | `Project.status`（`募集中` / `充足` / `後任募集`）は `docs/04` §5-1 の 36 状態に
//   含まれておらず、`StatusBadge` の `STATUS_BADGE_APPEARANCES` に `project` の表が無い。
//   🔴 **色の割り当ては §7.4 / §5-1 の改訂（人間の判断。`CLAUDE.md` §8.6）であり実装で決めない**ので、
//   一覧の状態列と同じ**素のテキスト**で描く（完了報告で申し送る） |
//
// 🔴 `'use client'` を宣言しない（状態を持たない。開いている行は URL が持つ）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SECONDARY_LINK_CLASSES,
} from '@ses/ui';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';

export type ProjectSummaryPanelMessages = {
  /** 行が 1 件も無いときの見出し（`案件の要点`）。 */
  readonly title: string;
  readonly empty: string;
  readonly detail: string;
  readonly edit: string;
  readonly candidates: string;
  /** キーバリューのラベル（🔴 **一覧の列見出しと同じ語を使う** —— 同じ値に 2 つの名前を作らない）。 */
  readonly fieldStatus: string;
  readonly fieldMustRequirements: string;
  readonly fieldUnitPrice: string;
  readonly fieldStartDate: string;
  readonly fieldLocation: string;
  readonly fieldHeadcount: string;
  readonly fieldUpdatedOn: string;
  readonly fieldVisibility: string;
};

type PanelField = { readonly key: string; readonly label: string; readonly value: string };

/**
 * キーバリューの並び。🔴 **一覧の列の並びに合わせる**（表で左から読んだ順と、パネルで上から
 * 読んだ順が違うと、同じ値を 2 回探すことになる）。
 */
function panelFields(
  row: ProjectListRowView,
  messages: ProjectSummaryPanelMessages,
): readonly PanelField[] {
  const fields: PanelField[] = [
    { key: 'status', label: messages.fieldStatus, value: row.status },
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
        <CardHeader>
          <CardTitle>{messages.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-body text-fg-muted" data-testid="project-list-panel-empty">
            {messages.empty}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="project-list-panel" data-project-id={row.id}>
      <CardHeader>
        {/* 🔴 `h1` にしない —— 画面の `h1` は帯（`PageHeader`）が持つ（1 画面 1 つ。
            `tests/static/page-heading-single.test.ts`）。`CardTitle` は `h2` である。 */}
        <CardTitle data-testid="project-list-panel-name">{row.name}</CardTitle>
        <CardDescription data-testid="project-list-panel-status">{row.status}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="mb-4 text-body">
          {panelFields(row, messages).map((field) => (
            <div
              key={field.key}
              className="flex gap-3 border-b border-border py-2 last:border-b-0"
            >
              <dt className="w-32 shrink-0 text-fg-muted">{field.label}</dt>
              <dd
                className="m-0 min-w-0 text-fg"
                data-testid={`project-list-panel-field-${field.key}`}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
        {/* 🔴 primary は 1 画面に 1 つ（§7.6）—— 帯の「案件を登録」が primary なので、
            ここは **secondary とテキストリンク**に落とす。`案件詳細を開く` が最初である
            （`docs/04` §S-010「行クリック → `S-011`」と同じ行き先であり、新しい遷移ではない）。 */}
        <div className="flex flex-col items-start gap-3">
          <Link
            className={SECONDARY_LINK_CLASSES}
            href={`/projects/${row.id}`}
            data-testid="project-list-panel-detail"
          >
            {messages.detail}
          </Link>
          <Link
            className={SECONDARY_LINK_CLASSES}
            href={`/projects/${row.id}/candidates`}
            data-testid="project-list-panel-candidates"
          >
            {messages.candidates}
          </Link>
          {canEdit ? (
            <Link
              className={SECONDARY_LINK_CLASSES}
              href={`/projects/${row.id}/edit`}
              data-testid="project-list-panel-edit"
            >
              {messages.edit}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
