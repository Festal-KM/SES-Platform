// apps/web/lib/home/sections.ts
// 🔴 `要対応` タブの**セクションの定義と並び**（人間の仕様 2026-10-11「5 セクションを縦に並べる」）。
//
// ============================================================================
// 🔴 このファイルが「タスク生成ロジック」である（UI と分離する理由）
// ============================================================================
// 人間の仕様は 🔴 **「タスク生成ロジックと UI を分離する（将来システムが自動で `HomeTask` を
// 生成するため）」**と定めている。本ファイルは **行 → セクションへの割り当て / セクションの順 /
// 件数 / アンカー**だけを決める**純粋関数**であり、**描画も `t()` も `db` も持たない**。
// 将来 `Task`（`CLAUDE.md` §4.1）由来の行が入るときも、変わるのは
// **`toHomeSections` に渡す入力**だけで、UI 側（`_home/actions-tab.tsx`）は触らない。
//
// ============================================================================
// 🔴 並びは「人間の仕様」が正である（`docs/04` §4.1 との差分は報告対象）
// ============================================================================
// 人間の仕様: **今日やること → 未返信 → 面談・期限あり → 提案フォロー → 稼働開始**。
// `docs/04` §4.1 改訂 23 の割り振り表は **1 今日やること / 2 返信待ち / 3 提案後フォロー /
// 4 面談調整中** であり、🔴 **3 と 4 が逆である。** 本実装は人間の仕様（新しい方）に従い、
// `docs/04` 側の訂正を報告する（`CLAUDE.md` §8.7）。
//
// 🔴 **`稼働開始が近い人材` は出さない**（`Assignment` は Phase 2 で、行はエンジニアの氏名を
//    要する = `BR-27`「ホームに氏名を出さない」と検査 (l)「ホームから台帳に触らない」の両方に
//    当たる）。**データが無いものを作らない**。
//
// ============================================================================
// 🔴 セクションの中の並べ替えをここで行わない
// ============================================================================
// 人間の仕様は「期限が近いほど上、優先度が高いほど上」と定める。これは**サーバの並びで既に
// 成立している**:
//   - `今日やること` … `sortActionQueueRows`（種別の重み → 種別の中は期限 / 放置の昇順）。
//     🔴 **クライアントで並べ替えない** —— 右レールの「先に動くもの」はこの順の先頭から
//     取られており（`docs/04` §4.1 右レール ②）、画面の 2 箇所で順位が違うと**どちらも
//     信用されなくなる**。種別の重み（`送信失敗` が最上位）は「取り返しのつかなさ」であり、
//     優先度（期限の関数）より上位の業務判断である（§S-003「なぜこの順か」）。
//   - 他の 3 セクション … 状態が 1 つに閉じているので、**期限 / 放置の昇順 = 優先度の降順**
//     である（`./priority.ts` の導出規則がそうなっている）。
import type { IconName } from '@ses/ui';
import type { ProposalState } from '@ses/domain';
import { proposalsHref } from '../proposals/hrefs';
import { homeSectionAnchorId } from './hrefs';
import { homeRowPriority, type HomePriority } from './priority';
import type { ActionQueueKind, ActionQueueRow } from './types';

// ============================================================================
// 🔴 このファイルは `@ses/i18n` に依存しない
// ============================================================================
// 🔴 クライアント部品（`_home/home-screen.tsx` / `_home/actions-tab.tsx`）が**値として**読む
//    （ポーリングのたびにセクションを組み直す）。`./action-queue.ts` は `t()` を使うので、
//    セクションの定義をあちらに置くと**カタログがクライアントバンドルへ流れる**
//    （`./action-queue-urgency.ts` 冒頭の 🔴 と同じ分担）。
// 🔴 **語を 1 つも持たない**（見出し・空文言の解決は `_home/home-props.ts`）。

/**
 * 🔴 `要対応` タブのセクション（**上から出る順**）。
 *
 * 🔴 **`TODAY` だけが `ACTION_QUEUE` ブロック由来**で、残り 3 つは `FOLLOW_UP` ブロック由来
 *    である（`./types.ts` の `FollowUpHomeBlock` の 🔴）。
 */
export const HOME_SECTIONS = [
  'TODAY',
  'AWAITING_REPLY',
  'INTERVIEW_COORDINATION',
  'PROPOSAL_FOLLOW_UP',
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/**
 * 🔴 `FOLLOW_UP` ブロックに載る種別（`ActionQueueKind` の部分集合）。
 *    **セクションと 1 対 1** なので、`HomeSection` から `TODAY` を除いたものと同じ集合である。
 */
export type FollowUpKind = 'AWAITING_REPLY' | 'INTERVIEW_COORDINATION' | 'PROPOSAL_FOLLOW_UP';

/** 🔴 セクションの並び（**人間の仕様の順**。`HOME_SECTIONS` の `TODAY` 以降と一致させる）。 */
export const FOLLOW_UP_KIND_ORDER = [
  'AWAITING_REPLY',
  'INTERVIEW_COORDINATION',
  'PROPOSAL_FOLLOW_UP',
] as const satisfies readonly FollowUpKind[];

/**
 * 🔴 セクション → 載せる提案の状態（**列挙**。`満了` のような他の種別が黙って混ざらない）。
 * 🔴 **`今日やること` の状態（`SUBMIT_FAILED` / `APPROVAL_PENDING` / `GATE_FAILED` /
 *    保留中 `APPROVED`）と交わらない**ことが「行を重複させない」の担保である
 *    （`./sections.test.ts` が全状態を走査して固定する）。
 * 🔴 **終端（`WON` / `LOST` / `WITHDRAWN`）を 1 つも含まない**（`F-024 AC-2` / `BR-23`）。
 */
export const FOLLOW_UP_PROPOSAL_STATES = {
  AWAITING_REPLY: ['SUBMITTED'],
  INTERVIEW_COORDINATION: ['INTERVIEW_SCHEDULED'],
  // 🔴 「面談は終わったが結果が記録されていない」の 2 状態（`F-025`）。
  PROPOSAL_FOLLOW_UP: ['INTERVIEWED', 'RESULT_PENDING'],
} as const satisfies Readonly<Record<FollowUpKind, readonly ProposalState[]>>;

/** 状態 → 種別（🔴 **`FOLLOW_UP_PROPOSAL_STATES` から導出する**。2 つ目の表を手で書かない）。 */
export function followUpKindOfState(state: ProposalState): FollowUpKind | null {
  for (const kind of FOLLOW_UP_KIND_ORDER) {
    if ((FOLLOW_UP_PROPOSAL_STATES[kind] as readonly ProposalState[]).includes(state)) return kind;
  }
  return null;
}

/**
 * 🔴 `FOLLOW_UP` ブロックの行の種別 → セクション（**1 対 1**）。
 *    `Record` なので、種別を足してセクションを当て忘れるとコンパイルが落ちる。
 */
export const FOLLOW_UP_SECTION_OF_KIND = {
  AWAITING_REPLY: 'AWAITING_REPLY',
  INTERVIEW_COORDINATION: 'INTERVIEW_COORDINATION',
  PROPOSAL_FOLLOW_UP: 'PROPOSAL_FOLLOW_UP',
} as const satisfies Readonly<Record<FollowUpKind, HomeSection>>;

export function isFollowUpKind(kind: ActionQueueKind): kind is FollowUpKind {
  return (FOLLOW_UP_KIND_ORDER as readonly string[]).includes(kind);
}

/**
 * 🔴 セクション → アイコン（`docs/04` §4.1 の割り振り表の括弧内。§7.5 の許可④ =
 *    `S-003` / `S-004` のセクション見出しのみ）。
 * 🔴 **比喩アイコンを使わない**（写像に無い名前は型エラー）。`clock` = 返信待ち /
 *    `calendar-clock` = 面談調整中 / `send` = 提案後フォロー（`docs/04` の指定どおり）。
 */
export const FOLLOW_UP_SECTION_ICONS: Readonly<Record<FollowUpKind, IconName>> = {
  AWAITING_REPLY: 'clock',
  INTERVIEW_COORDINATION: 'calendar-clock',
  PROPOSAL_FOLLOW_UP: 'send',
};

/**
 * 🔴 セクション → `すべて見る` の遷移先（**1 つだけ**。`docs/04` §4.1 の 🔴
 *    「そのセクションの母集団をそのまま開く一覧 + フィルタ」）。
 * 🔴 **母集団は `FOLLOW_UP_PROPOSAL_STATES` から導出する**（一覧のフィルタとセクションの
 *    母集団が食い違うと、`すべて見る` が「別のもの」を開くことになる）。
 */
export const FOLLOW_UP_SECTION_SEE_ALL_HREFS: Readonly<Record<FollowUpKind, string>> = {
  AWAITING_REPLY: proposalsHref({ state: [...FOLLOW_UP_PROPOSAL_STATES.AWAITING_REPLY] }, null),
  INTERVIEW_COORDINATION: proposalsHref(
    { state: [...FOLLOW_UP_PROPOSAL_STATES.INTERVIEW_COORDINATION] },
    null,
  ),
  PROPOSAL_FOLLOW_UP: proposalsHref({ state: [...FOLLOW_UP_PROPOSAL_STATES.PROPOSAL_FOLLOW_UP] }, null),
};

/** 1 行 + **導出した優先度**（🔴 行自身は `priority` のキーを持たない。`./priority.ts` の 🔴）。 */
export type HomeSectionRow = {
  readonly row: ActionQueueRow;
  readonly priority: HomePriority;
};

/** 1 セクション。🔴 **語を持たない**（`t()` の解決は `_home/**` の props 側）。 */
export type HomeSectionView = {
  readonly section: HomeSection;
  /** 🔴 フラグメントの移動先（KPI カードのクリックがここへ来る）。 */
  readonly anchorId: string;
  readonly rows: readonly HomeSectionRow[];
};

/**
 * 🔴 セクションを組む（**純粋関数**）。
 *
 * - `queueRows` … `ACTION_QUEUE` ブロックの行（**順はサーバのまま**）。
 * - `followUpRows` … `FOLLOW_UP` ブロックの行（**順はサーバのまま**。種別で分けるだけ）。
 * - `nowMs` … 優先度の基準（**サーバの応答時刻**。端末時刻を混ぜない）。
 *
 * 🔴 **0 件のセクションも返す**（描くかどうかの判断は画面側の 1 箇所。`docs/04` §4.1 は
 *    「0 件のセクションは見出しごと描かない」と定めるが、**その判断を 2 箇所に分散させない**
 *    ために、ここでは件数だけを返して捨てない）。
 */
export function toHomeSections(
  queueRows: readonly ActionQueueRow[],
  followUpRows: readonly ActionQueueRow[],
  nowMs: number,
): readonly HomeSectionView[] {
  const withPriority = (rows: readonly ActionQueueRow[]): readonly HomeSectionRow[] =>
    rows.map((row) => ({ row, priority: homeRowPriority(row, nowMs) }));
  return HOME_SECTIONS.map((section): HomeSectionView => ({
    section,
    anchorId: homeSectionAnchorId(section),
    rows: withPriority(
      section === 'TODAY'
        ? queueRows
        : // 🔴 種別で引く（`FOLLOW_UP` の行は種別とセクションが 1 対 1 である）。
          followUpRows.filter((row) => sectionOfFollowUpRow(row) === section),
    ),
  }));
}

/** 🔴 `FOLLOW_UP` の行 → セクション（写像に無い種別は `null` = どのセクションにも入らない）。 */
export function sectionOfFollowUpRow(row: ActionQueueRow): HomeSection | null {
  return isFollowUpKind(row.kind) ? FOLLOW_UP_SECTION_OF_KIND[row.kind] : null;
}

/**
 * 🔴 `要対応` タブの件数バッジに出す数（**`今日やること` の件数だけ**）。
 *
 * ============================================================================
 * 🔴 なぜ「全セクションの合計」にしないのか
 * ============================================================================
 * ✅ 2026-10-11 に 4 セクションへ分けた時点で「タブの数 = 合計」にもできたが、**採らない**:
 *
 *   ① 🔴 `docs/04` §S-003 の 🔴 **「種別ごとの件数を 1 つの合計に丸めない」** に反する ——
 *      `返信待ち`（相手の番）と `今日やること`（自分の番）を 1 つの数に丸めると、
 *      **性質の違う仕事の混同の表示**になる（`F-024 AC-2` / `BR-23` と同じ論理）。
 *   ② 🔴 **同じ画面に矛盾する 2 行を作らない。** 挨拶行の一文（「対応が必要なものが N 件
 *      あります。午前中に片付けると…」）と KPI カード 1（`今日やること`）は**同じ数**であり、
 *      タブだけ別の数にすると、利用者から見れば画面のバグである
 *      （`home.kpi.allZero` の値を差し替えた 2026-10-03 と同じ種類の事故）。
 *   ③ 🔴 **`返信待ち` は「片付けられるもの」ではない**（返答するのは相手である）。
 *      挨拶の一文の主語に含めると、催促を促す表示になる。
 *
 * 🔴 各セクションの件数は**セクション見出しのバッジ**が持つ（合計ではなく内訳で見せる）。
 */
export function homeActionsTabCount(sections: readonly HomeSectionView[]): number {
  return sections.find((section) => section.section === 'TODAY')?.rows.length ?? 0;
}
