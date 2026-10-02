// apps/web/lib/home/drawer.ts
// 🔴 要対応キューの行の `内容を見る`（`Drawer`）の**中身の組み立て**（`docs/04` §4.1 `S-003` 操作表 /
//    §S-004 操作と結果 / §5-13 `Drawer` / §11-25 / docs/05 §6.11.3）。T-22-10。
//
// ============================================================================
// 🔴 この引き出しが**出さない**もの（ここが本ファイルの主眼）
// ============================================================================
//   ① 🔴 **実行系のアクションを 1 つも持たない**（承認 / 却下 / 送信 / 再送 / 応諾 / 公開 / 解除）。
//      担保は**型**である —— 下の `ActionQueueDrawerView` に `action` のキーが無い
//      （`docs/05` §6.11.3 の 🔴「`Drawer` の中身を組み立てる関数の戻り値の型に `action` を持たせない」。
//      §6.11.2 の `action` は**キューの行**が持つものであり、引き出しには型として無い）。
//      出口は `detailLink` の**遷移 1 本**だけで、`@ses/ui` の `Drawer` も `href` しか受け取らない
//      （`packages/ui/src/components/drawer.tsx` 冒頭。`onClick` を渡す口が無い）。
//      理由は `CLAUDE.md` §3.3 —— ゲートは「判断材料を全部見たうえで承認する」ことが前提であり、
//      **要約だけで押せる承認導線はゲートの実質的な形骸化**である。
//   ② 🔴 **台帳のエンジニア詳細とスキルシートを出さない**（`CLAUDE.md` §3.5 / `BR-27`）。
//      出せば**行を開くたびに `engineer.view` が積まれ**、60 秒ポーリングと往復して
//      「誰の経歴を誰がいつ見たか」が読めなくなる（ホームに氏名を出さないと決めた理由と同じ）。
//      本ファイルは **キューの行（`#9` の応答）と、提案詳細（#46）の履歴**しか材料にしない。
//      検査は `tests/static/home-drawer-no-ledger.test.ts`（(l)。本ファイルの型も ③ の射程に入る）。
//   ③ 🔴 **依頼の行では凍結情報の欄を 1 つも描かない**（`docs/04` §4.1 / docs/05 §6.11.3）——
//      凍結は応諾で初めて起きるので、**無い情報の空欄は「開示されていない」ではなく「まだ
//      入っていない」に読める**。担保は**型**である: `ProposalRequestActionQueueDrawerView` に
//      `history` のキーが無く（履歴は `ProposalEvent` = 提案が在って初めて生まれる）、
//      凍結側の値を持つ欄も無い。
//   ④ 🔴 **履歴にメモ・理由・失敗種別の本文を入れない。** 出すのは **日時 / 出来事 / 状態の遷移**
//      だけである（本文は `S-023` で読む）。自由文は単価・エンド企業名・ホスト内部の検討を含みうる
//      （`CLAUDE.md` §3.1 経路 5 の 🔴）一方、引き出しは**要約**であり、
//      60 秒ごとに開き直される場所に自由文を置く理由が無い。
//
// ============================================================================
// 🔴 出す項目は `docs/04` §4.1 の列挙そのまま
// ============================================================================
// **対象の名称 / 相手 / 状態 / 経過時間 / 期限 / 直近の履歴 3 行**（§5-13 の 🔴）。
// 種別は**表題**に置く（項目を増やさないため。表題は「いま何を見ているか」であって項目ではない）。
// 🔴 **匿名化規則は行からそのまま継承する** —— ホストの `提案依頼の返答待ち` の行は
//    `subjectLabel` が「案件名 / 共有候補（匿名）」、`counterpartyLabel` が `null` であり
//    （`lib/home/action-queue.ts` の `toHostRequestActionRow`）、本ファイルはそれを**写すだけ**で
//    中身を判断しない。取引先の依頼の行が自社エンジニアの実名になるのは
//    **非対称であることが正しい**（自社の情報であって越境ではない。docs/05 §6.11.3 の表）。
//
// 🔴 I/O を持たない / `t()` を呼ばない（文言は解決済みの文字列を受ける。`CLAUDE.md` §3.5。
//    クライアント部品から使うため `@ses/db` へ辿る値 import を持たない）。
import { formatDateTimeJst } from '../format/datetime';
import {
  proposalTimelineKindOf,
  type ProposalTimelineKind,
  type ProposalTimelineKindInput,
} from '../proposals/timeline-kind';
import type { ActionQueueKind, ActionQueueRow } from './types';

/** 🔴 `docs/04` §4.1 の「直近の履歴 3 行」。**画面ごとに別の値を持たせない**（本定数が唯一の出所）。 */
export const ACTION_QUEUE_DRAWER_HISTORY_LIMIT = 3;

/** 読み取り項目 1 件（`@ses/ui` の `DrawerItem` と同じ形。🔴 **値は文字列**であり要素を持てない）。 */
export type ActionQueueDrawerField = {
  readonly label: string;
  readonly value: string;
};

/** 項目名と、履歴の状態を表す語（すべて解決済み。`packages/i18n` からサーバ側が引く）。 */
export type ActionQueueDrawerMessages = {
  readonly fieldSubject: string;
  readonly fieldCounterparty: string;
  readonly fieldState: string;
  readonly fieldTime: string;
  readonly fieldDeadline: string;
  readonly detailLink: string;
  readonly historyLoading: string;
  readonly historyFailed: string;
  /** 🔴 値が無いこと（`—`）。**空文字で埋めない**（欄が消えると「無い」と「読めない」が混ざる）。 */
  readonly valueNone: string;
};

/**
 * 行から引き写す値（整形は行と**同じ関数**で済ませてから渡す）。
 * 🔴 **経過時間・状態の語をここで組み立て直さない** —— 行の表示と引き出しの表示が食い違うと、
 *    「同じものを見ている」確認にならない。
 */
export type ActionQueueDrawerValues = {
  /** 種別の語（表題）。 */
  readonly kind: string;
  /** 状態バッジの語（`StatusBadge` と同じ写像で解決済み）。 */
  readonly state: string;
  /** 経過時間 / 残り時間（行と同じ整形済みの文字列）。 */
  readonly time: string;
};

/** 履歴の取得状態。🔴 **失敗を黙って空にしない**（空と「読めなかった」を区別する）。 */
export type ActionQueueDrawerHistoryState =
  | { readonly status: 'LOADING' }
  | { readonly status: 'READY'; readonly lines: readonly string[] }
  | { readonly status: 'FAILED' };

type ActionQueueDrawerShared = {
  readonly targetId: string;
  readonly title: string;
  readonly fields: readonly ActionQueueDrawerField[];
  /** 🔴 **遷移 1 本**（行のクリックと同じ既存の URL。新しいルートを作らない）。 */
  readonly detailLink: { readonly href: string; readonly label: string };
};

/**
 * 提案の 4 種別（`承認待ち` / `ゲート差し戻し` / `送信失敗` / `送信保留`）の引き出し。
 * 🔴 **履歴を持つのはこちらだけ**（`ProposalEvent` は提案が在って初めて生まれる）。
 */
export type ProposalActionQueueDrawerView = ActionQueueDrawerShared & {
  readonly variant: 'PROPOSAL';
  readonly history: readonly string[];
};

/**
 * 提案依頼の行（`提案依頼の返答待ち`）の引き出し。
 * 🔴 **`history` のキーを持たない**（上の ③。凍結情報の欄も履歴の欄も型として存在しない）。
 */
export type ProposalRequestActionQueueDrawerView = ActionQueueDrawerShared & {
  readonly variant: 'PROPOSAL_REQUEST';
};

export type ActionQueueDrawerView =
  | ProposalActionQueueDrawerView
  | ProposalRequestActionQueueDrawerView;

/**
 * 🔴 その行の引き出しが履歴を持つか（= 提案の行か）。
 *    **種別の列挙で判定する**（`PROPOSAL_REQUEST_PENDING` 以外、という書き方にしない ——
 *    Phase 2 で `面談日程が未確定` / `延長確認` が足されたとき、黙って「提案の行」側に倒れる）。
 */
const PROPOSAL_DRAWER_KINDS: readonly ActionQueueKind[] = [
  'SEND_FAILED',
  'APPROVAL_PENDING',
  'GATE_FAILED',
  'SEND_HELD',
];

export function hasProposalDrawerHistory(kind: ActionQueueKind): boolean {
  return PROPOSAL_DRAWER_KINDS.includes(kind);
}

/** 履歴 1 行の材料（`ProposalEventView` の部分集合。他の列を見ないことを型で示す）。 */
export type ActionQueueDrawerEvent = ProposalTimelineKindInput & {
  /** ISO 8601（UTC）。 */
  readonly occurredAt: string;
};

/** 履歴 1 行の語（出来事の 9 種 + 状態 + 矢印。すべて解決済み）。 */
export type ActionQueueDrawerHistoryMessages = {
  readonly kinds: Readonly<Record<ProposalTimelineKind, string>>;
  /** 状態の語（`proposals.state.*` の写像。未知の値はそのまま出す）。 */
  readonly states: Readonly<Record<string, string>>;
  readonly arrow: string;
  readonly valueNone: string;
};

/**
 * 🔴 提案詳細（#46）の `events` → 引き出しの履歴（**直近 3 行**。古い順）。
 *
 * - 並びは #46 の契約（古い順）をそのまま使い、**末尾 3 件**を取る（直近 = 末尾）。
 *   🔴 **並べ替えない** —— `S-023` と同じ順序で読めることが「同じものを見ている」確認の前提である。
 * - 1 行 = `日時 出来事 [遷移]`。🔴 **メモ・理由・失敗種別の本文を含めない**（冒頭 ④）。
 * - 出来事の分類と語は `lib/proposals/timeline-kind.ts` の 1 実装（`S-023` と共有）。
 */
export function proposalDrawerHistoryLines(
  events: readonly ActionQueueDrawerEvent[],
  messages: ActionQueueDrawerHistoryMessages,
  limit: number = ACTION_QUEUE_DRAWER_HISTORY_LIMIT,
): readonly string[] {
  const recent = limit <= 0 ? [] : events.slice(Math.max(0, events.length - limit));
  return recent.map((event) => {
    const kind = proposalTimelineKindOf(event);
    const transition =
      event.toState === null
        ? null
        : `${stateLabel(event.fromState, messages)}${messages.arrow}${stateLabel(event.toState, messages)}`;
    const head = `${formatDateTimeJst(event.occurredAt)} ${messages.kinds[kind]}`;
    return transition === null ? head : `${head} ${transition}`;
  });
}

function stateLabel(state: string | null, messages: ActionQueueDrawerHistoryMessages): string {
  if (state === null) return messages.valueNone;
  return messages.states[state] ?? state;
}

/**
 * 🔴 行 + 取得済みの履歴 → 引き出しの中身。
 *
 * 🔴 **行に無い値を足さない。** `subjectLabel` / `counterpartyLabel` / `deadline` は
 *    サーバ（`lib/home/action-queue.ts`）が境界を踏まえて決めた値であり、ここは写すだけである。
 */
export function actionQueueDrawerView(
  row: ActionQueueRow,
  values: ActionQueueDrawerValues,
  messages: ActionQueueDrawerMessages,
  history: ActionQueueDrawerHistoryState,
): ActionQueueDrawerView {
  const shared: ActionQueueDrawerShared = {
    targetId: row.targetId,
    title: values.kind,
    fields: [
      { label: messages.fieldSubject, value: row.subjectLabel },
      { label: messages.fieldCounterparty, value: row.counterpartyLabel ?? messages.valueNone },
      { label: messages.fieldState, value: values.state },
      { label: messages.fieldTime, value: values.time },
      {
        label: messages.fieldDeadline,
        value: row.deadline === null ? messages.valueNone : formatDateTimeJst(row.deadline),
      },
    ],
    detailLink: { href: row.href, label: messages.detailLink },
  };
  if (!hasProposalDrawerHistory(row.kind)) return { ...shared, variant: 'PROPOSAL_REQUEST' };
  return { ...shared, variant: 'PROPOSAL', history: historyLines(history, messages) };
}

/**
 * 🔴 取得状態 → 表示する行。**失敗と空を同じ見え方にしない**（冒頭の `historyFailed`）。
 *    空（理論上は起きない。#46 は作成時の 1 件を必ず持つ）は `—` に倒し、節自体は描く。
 */
function historyLines(
  history: ActionQueueDrawerHistoryState,
  messages: ActionQueueDrawerMessages,
): readonly string[] {
  switch (history.status) {
    case 'LOADING':
      return [messages.historyLoading];
    case 'FAILED':
      return [messages.historyFailed];
    case 'READY':
      return history.lines.length === 0 ? [messages.valueNone] : history.lines;
  }
}
