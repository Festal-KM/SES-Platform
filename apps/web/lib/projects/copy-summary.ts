// apps/web/lib/projects/copy-summary.ts
// ✅✅ **2026-10-16: 案件サマリの「コピペ用サマリ」タブの本文**（人間の明示指示
//    「コピペ用サマリは、LINE やメールとかにそのままコピペできる形式のテキストにする。
//     案件登録時に生成されるが、情報がアップデート都度生成される。人が書き換えて保存も可能」）。
//
// ============================================================================
// 🔴 いまできていること / まだできていないこと
// ============================================================================
// 🔴 **できている**: 一覧の行の値から、そのまま貼れる 1 つのテキストを**決定的に**組む。
// 🔴 **まだできていない**: 「登録時に生成して保存する」「人が書き換えて保存する」。
//    保存先の列（`projects.copy_summary`）が無いためである（列を足すのは
//    [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113) を根拠にした後続の作業）。
//    画面はその旨を 1 行で書く（`projects.list.panel.copy.generatedNote`）——
//    **できないことを黙って隠さない**（`projects.list.searchComingSoon` と同じ規律）。
//
// ============================================================================
// 🔴 外へ貼られる前提のテキストである（`CLAUDE.md` §3.1 / §3.3 の商流層）
// ============================================================================
// 🔴 **商流情報を 1 つも入れない。** エンド企業名（`end_client_name`）と内部単価
//    （`internal_unit_price`）は、そもそも一覧が**取得していない**（`PROJECT_LIST_SELECT` に
//    識別子が無い）ので、入力の型（`ProjectListRowView`）にも存在しない —— **入れようとすると
//    コンパイルで落ちる。**
// 🔴 **公開先の設定状況（`row.visibility`）を入れない。** これは「何社に公開しているか」=
//    ホスト内部の情報であり、貼り先が取引先なら**他社の存在を漏らす**（§3.1 の 🔴
//    「パートナー同士が相互に参照できる経路を 1 つも作らない」）。行の型には在るが、
//    **この関数は意図して読まない**（下の `COPY_SUMMARY_EXCLUDED_FIELDS` が理由ごと数える）。
// 🔴 **単価は一覧と同じ万円表記である**（`row.unitPrice` をそのまま使う）。画面に出ている値と
//    貼られる値が違うと、営業は「どちらが正しいのか」を確かめられない。
//    ⚠️ 万円は 1,000 円未満を丸める（`lib/format/number.ts` の 🔴）。**金額を確定させる面
//    （詳細・承認・提案）は円のまま**であり、ここは走査・共有のための面である。
//
// 🔴 **純粋関数である**（I/O・現在時刻・乱数を持たない）。同じ行からは常に同じテキストが出る。
import { t } from '@ses/i18n';
import type { ProjectListRowView } from './list-rows';

/**
 * 🔴 **意図して載せない項目**（レビューが「増えていないこと」を数えられるように名前で残す）。
 *    理由は本ファイル冒頭の 🔴。**増やすときは理由を併記する。**
 */
export const COPY_SUMMARY_EXCLUDED_FIELDS = [
  // ホスト内部の情報（貼り先が取引先なら他社の存在を漏らす）。
  'visibility',
] as const;

/** 1 行の形（`【案件名】基幹システム刷新`）。🔴 記号は文言カタログから取る。 */
function line(label: string, value: string): string {
  return `${t('projects.list.panel.copy.labelOpen')}${label}${t('projects.list.panel.copy.labelClose')}${value}`;
}

/**
 * 🔴 **未設定（`—`）の行は落とす。** `【開始時期】—` を貼られたテキストに残すと、
 *    受け取った相手は「未定」なのか「書き忘れ」なのか判断できない。**項目ごと消す**。
 */
function isUnset(value: string): boolean {
  return value === t('projects.detail.valueNone');
}

/**
 * 必須要件の 1 行。
 *
 * 🔴 **一覧の行が持つのは上位 3 件だけである**（`MUST_REQUIREMENT_SUMMARY_LIMIT`）。
 *    超過を黙って落とすと、**貼られたテキストだけが要件を満たしているように見える** ——
 *    `（ほか 2 件）` と添えて、全量は詳細（`S-011`）にあることを示す。
 * 🔴 `+N` の記号をそのまま貼らない（一覧の表の中では読めるが、文章の中では読めない）。
 */
function mustRequirementsValue(row: ProjectListRowView): string {
  if (row.moreMustRequirements === null) return row.mustRequirements;
  // 🔴 行が持つのは `+2` の形なので、数だけを取り出して語に組み直す。
  const more = row.moreMustRequirements.replace('+', '');
  return (
    row.mustRequirements +
    t('projects.list.panel.copy.moreOpen') +
    more +
    t('projects.list.panel.copy.moreClose')
  );
}

/**
 * 🔴 **コピペ用サマリの本文**（人間の指示の「そのままコピペできる形式のテキスト」）。
 *
 * 🔴 項目の並びは**基本情報タブと同じ**である（同じ案件を 2 つの面で読んだときに、
 *    上から順に目で突き合わせられる）。
 */
export function projectCopySummary(row: ProjectListRowView): string {
  const lines: readonly (readonly [string, string])[] = [
    [t('projects.list.panel.copy.label.name'), row.name],
    [t('projects.list.panel.copy.label.status'), row.status],
    [t('projects.list.panel.copy.label.mustRequirements'), mustRequirementsValue(row)],
    [t('projects.list.panel.copy.label.unitPrice'), row.unitPrice],
    [t('projects.list.panel.copy.label.startDate'), row.startDate],
    [t('projects.list.panel.copy.label.location'), row.location],
    // 🔴 稼働形態は未設定のとき `null`（Badge を描かないため）。`—` ではないので分けて畳む。
    ...(row.remoteMode === null
      ? []
      : ([[t('projects.list.panel.copy.label.remoteMode'), row.remoteMode]] as const)),
    [t('projects.list.panel.copy.label.headcount'), row.headcount],
  ];
  return lines
    .filter(([, value]) => !isUnset(value))
    .map(([label, value]) => line(label, value))
    .join('\n');
}
