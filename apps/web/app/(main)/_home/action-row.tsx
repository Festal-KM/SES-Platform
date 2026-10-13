'use client';

// apps/web/app/(main)/_home/action-row.tsx
// 🔴 `要対応` タブの**行 1 本**（`docs/04` §4.1 の「セクションの行の構成」）。✅ 2026-10-11。
//
// ============================================================================
// 🔴 なぜ `action-queue-section.tsx` から切り出したのか
// ============================================================================
// 人間の仕様（2026-10-11）は `要対応` タブに **5 セクションを縦に並べる**ことと、
// 🔴 **「1 ファイルにまとめない。コンポーネントを分ける」**ことを定めた。行の見た目と
// 落とす境界（`sm` / `xl`）は**全セクションで同一でなければならない**ので、
// **行は 1 実装**にしてここへ置く（`UI_GUIDELINES` §8「同じ見た目のローカル実装を 2 つ作らない」）。
//
// ============================================================================
// 🔴 この行が守るもの（移行前の `action-queue-section.tsx` から 1 つも落としていない）
// ============================================================================
//   ① 🔴 **2 段の compact な行**（列の grid にしない）。1 段目 = 種別 / 優先度 / 件名 / 時刻 /
//      `内容を見る`、2 段目 = 相手 / 期限 / 状態 / 操作。
//      理由（実測）: 右レール（副カラム 360〜480px）が在るため主カラムは `lg` ≈ 504px /
//      `xl` ≈ 552px / `2xl` ≈ 728px であり、7 列の固定トラック（808px）は**どの幅にも入らない**。
//      溢れると行が右レールの下に潜り、`内容を見る` が押せなくなる（Tier 1 の遮断）。
//   ② 🔴 **落とす境界は 2 段のまま**（`sm` 未満 = 相手 / 期限 / `xl` 未満 = 状態 / 操作）。
//      🔴 **`内容を見る` はどのブレークポイントでも落とさない**（Tier 1）。
//      🔴 **優先度はモバイルでも落とさない** —— 優先度は期限と放置時間から導出した
//      **判断材料**であり、`CLAUDE.md` §13.3「狭い画面を理由に判断材料を隠さない」に当たる。
//   ③ 🔴 **行の高さが内容量で変わらない**（2 段目は該当が無くても `—` で描く。
//      `HANDOFF.md` §3.3 の 1 件目: 高さの差は、それ自体が開示項目になる）。
//   ④ 🔴 **色は「期限超過」と「経過時間が閾値超」の行だけ**（行の背景を塗らない。行頭 2px の
//      縦バーと期限セルの文字色だけ）。🔴 行の色に**赤を使わない**。
//   ⑤ 🔴 **`操作` はサーバが決めた `action` と `actionAvailability` の 2 項だけを見る**
//      （画面はロールも状態も見ない）。`enabled === false` はボタンを描かず理由テキストを置く。
//   ⑥ 🔴 **`data-testid` は移行前のまま**（`home-action-queue-*`）。
//      理由: `tests/static/testid-freeze.test.ts` が完全一致と接頭辞を凍結しており、
//      **改名・削除は不可**（追加のみ可）。`targetId` は提案 / 依頼の id なのでセクションを
//      またいで衝突しない。🔴 **セクションごとに接頭辞を変えると凍結値が消える。**
//   ⑦ 🔴 **チェックボックスを描かない**（`docs/04` §4.1 の行の構成はチェックボックスを
//      「`Task` が実体としてある行にのみ」と定めるが、🔴 **`Task` の API が存在しない**
//      （`/api/tasks` が無く、`db.task` を読み書きするコードがリポジトリに 1 行も無い）。
//      押して何も起きない要素を置かない（`U-10` と同じ規律）。
//   ⑧ 🔴 **`…`（その他メニュー）を描かない** —— 項目が `内容を見る` の 1 つだけになり、
//      その 1 つは既に行に在る（空のメニューを出さない。`docs/04` §5-13）。
//   ⑨ 🔴 `@ses/db` に辿れる値 import を持たない（`client-db-boundary.test.ts`）。
import Link from 'next/link';
import {
  Badge,
  Icon,
  IconButton,
  NAME_CELL_LINK_CLASSES,
  ROW_ACTION_LINK_CLASSES,
  ROW_ACTION_WIDTH_CLASS,
  ROW_BADGE_WIDTH_CLASS,
  ROW_HEIGHT_CLASS,
  ROW_HOVER_CLASSES,
  ROW_META_WIDTH_CLASS,
  StatusBadge,
  type BadgeVariant,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { formatElapsedWith, type ElapsedLabels } from '../../../lib/format/elapsed';
import { isActionQueueRowUrgent } from '../../../lib/home/action-queue-urgency';
import type { ActionQueueDrawerValues } from '../../../lib/home/drawer';
import { PRIORITY_BADGE_VARIANTS, type HomePriority } from '../../../lib/home/priority';
import type {
  ActionQueueActionKind,
  ActionQueueHomeBlock,
  ActionQueueKind,
  ActionQueueRow,
} from '../../../lib/home/types';
import { formatRemaining, type RemainingLabels } from '../../../lib/proposal-requests/remaining';
import type { ActionQueueDrawerMessageBundle } from './action-queue-drawer';

export type ActionQueueMessages = {
  readonly title: string;
  readonly lead: string;
  readonly empty: string;
  readonly scopeLegend: string;
  readonly scopeMine: string;
  readonly scopeAll: string;
  readonly columnKind: string;
  readonly columnSubject: string;
  readonly columnCounterparty: string;
  readonly columnTime: string;
  readonly columnDeadline: string;
  /** ✅ T-22-09: `状態` 列 / `操作` 列の語（docs/04 改訂 16）。 */
  readonly columnState: string;
  readonly columnAction: string;
  /** 🔴 種別ラベル。全種別を持つ（`Record` で割り当て漏れをコンパイラに強制させる）。 */
  readonly kinds: Readonly<Record<ActionQueueKind, string>>;
  /** ✅ T-22-09: `操作` の語。🔴 1 行につき 1 つ（配列にしない = 一括操作を作らない）。 */
  readonly actions: Readonly<Record<ActionQueueActionKind, string>>;
  /**
   * ✅ T-22-09: 状態バッジの語（`Proposal` の 14 + `ProposalRequest` の 5）。
   * 🔴 **色はここに無い** —— `StatusBadge` が状態名から導出する（§5-13。画面側で色を指定しない）。
   */
  readonly proposalStates: Readonly<Record<string, string>>;
  readonly proposalRequestStates: Readonly<Record<string, string>>;
  /**
   * ✅ T-22-09: 操作が不能な理由の語（`MessageKey` → 解決済みの文言）。
   * 🔴 **サーバが返した `reasonKey` をそのまま引く**（画面が理由を組み立てない。docs/05 §6.11.2）。
   */
  readonly denied: Readonly<Record<string, string>>;
  /** ✅ T-22-09: セクションのヘッダ右のテキストリンク（`S-017` への入口）。 */
  readonly openRequestList: string;
  /**
   * ✅ T-22-10: 行の `内容を見る`（`Drawer`）の語。
   * 🔴 **実行系の語を 1 つも持たない**（承認 / 送信 / 再送 / 応諾 の語は上の `actions` にあり、
   *    引き出しの束には入れない。docs/04 §11-25）。
   */
  readonly drawer: ActionQueueDrawerMessageBundle;
  /**
   * ✅ 2026-10-11: 🔴 **優先度の語**（`優先度 高` / `中` / `低`）と、その導出の根拠の 1 行。
   * 🔴 **これは状態ではない**（`lib/home/priority.ts` の 🔴）。
   */
  readonly priorities: Readonly<Record<HomePriority, string>>;
  readonly priorityNote: string;
  /** ✅ 2026-10-11: セクションごとの見出し・空文言（`./actions-tab.tsx` が解決して渡す）。 */
  readonly valueNone: string;
  readonly changed: string;
  readonly pollError: string;
  readonly elapsed: ElapsedLabels;
  readonly remaining: RemainingLabels;
};

/**
 * 種別バッジの色味。
 * 🔴 T-22-09: **§7.4 の意味の割り当てに合わせた**（移行前は `GATE_FAILED` が赤 / `APPROVAL_PENDING` が橙だった）。
 *    - `SEND_FAILED` = **赤**（§7.4 が赤を許す 3 状態のうちの `SUBMIT_FAILED`。外部に到達したか分からない）
 *    - `GATE_FAILED` = **橙**（🔴 赤にしない —— 外部では何も起きておらず「直せば進む」）
 *    - `APPROVAL_PENDING` / `PROPOSAL_REQUEST_PENDING` = **ブランド藍**（「次はあなたの番」）
 *    - `SEND_HELD` = **無彩色の枠線**（保留は失敗ではない。docs/05 §10.4）
 * 🔴 ✅ 2026-10-11 の 3 種別:
 *    - `AWAITING_REPLY` = **無彩色**（🔴 **次はこちらの番ではない**。藍にすると「あなたの番」に読める）
 *    - `INTERVIEW_COORDINATION` = **ブランド藍**（日程の確定はこちらの行動である）
 *    - `PROPOSAL_FOLLOW_UP` = **橙**（記録が落ちると `S-034` の転換率が汚れる = 直せば進む。
 *      🔴 赤にしない —— 外部では何も失敗していない）
 */
const KIND_VARIANTS: Readonly<Record<ActionQueueKind, BadgeVariant>> = {
  SEND_FAILED: 'danger',
  APPROVAL_PENDING: 'brand',
  GATE_FAILED: 'warning',
  SEND_HELD: 'outline',
  PROPOSAL_REQUEST_PENDING: 'brand',
  AWAITING_REPLY: 'neutral',
  INTERVIEW_COORDINATION: 'brand',
  PROPOSAL_FOLLOW_UP: 'warning',
};

/**
 * ✅ 2026-10-02（改訂 23）: 時間の欄の語（**行・引き出し・右レールで同じ 1 実装**）。
 *
 * 提案依頼の行 = 返答期限までの残り（期限切れが最も痛い）/ それ以外 = 経過時間（放置時間）。
 * 🔴 **`./home-screen.tsx` の右レールもこれを呼ぶ** —— 同じ行が 2 箇所で違う時間を示すと、
 *    どちらも信用されなくなる。
 */
export function actionQueueRowTimeLabel(
  row: ActionQueueRow,
  nowMs: number,
  messages: ActionQueueMessages,
): string {
  return row.deadline === null
    ? formatElapsedWith(row.since, nowMs, messages.elapsed)
    : formatRemaining(row.deadline, nowMs, messages.remaining);
}

/** 🔴 `sm` 未満で落ちる列（`相手` / `期限`）。 */
const COLUMN_SM_CLASSES = 'hidden sm:block';
/** 🔴 `xl` 未満で落ちる列（✅ T-22-09 で足した `状態` / `操作`）。 */
const COLUMN_XL_CLASSES = 'hidden xl:inline';

/**
 * 1 行（ファイル冒頭 ①〜⑧）。
 *
 * 🔴 **行の順序はサーバが決める**（この部品は渡された 1 行を描くだけで、並べ替えも選別もしない）。
 */
export function ActionRow({
  row,
  priority,
  availability,
  changed,
  nowMs,
  messages,
  onOpenDrawer,
}: {
  readonly row: ActionQueueRow;
  /** 🔴 **導出した優先度**（`lib/home/priority.ts`。応答のキーではない）。 */
  readonly priority: HomePriority;
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly changed: boolean;
  readonly nowMs: number;
  readonly messages: ActionQueueMessages;
  readonly onOpenDrawer: (targetId: string) => void;
}) {
  const time = actionQueueRowTimeLabel(row, nowMs, messages);
  const urgent = isActionQueueRowUrgent(row, nowMs);
  const overdue = row.deadline !== null && Date.parse(row.deadline) < nowMs;
  // 🔴 種別と状態が同じ語になる行がある（下の 🔴）。語の一致だけで判定し、状態の集合を列挙しない。
  const kindLabel = messages.kinds[row.kind];
  const stateLabel = rowStateLabel(row, messages);
  return (
    <li
      // ✅ **2026-10-13（`docs/design-system.md` §4.1）: 45px の 1 行**にした。
      // 🔴 列は 全画面で同じ —— 件名 `1fr` / 時刻 120 / バッジ 240 / 操作 146 / 内容を見る 24。
      // 🔴 **`2xl` 未満では折り返す**（件名が自分の行を取る）。🔴 ✅ **2026-10-13 に `lg` から
      //    `2xl` へ上げた** —— 1280px の実測で、固定列（120 + 280 + 146 + 32 + 余白）が主カラム
      //    （624px）を 158px 超え、**行がカードの外へはみ出して右レールの下に潜っていた**。
      //    `内容を見る` のボタンがレールに覆われ、E2E の `click()` が 120 秒待って落ちた
      //    （`HANDOFF.md` §6 の 22）。🔴 **1 行に収めるのは、収まる幅のときだけである。**
      // 🔴 左端 2px は「期限が近い / 放置が長い」の印である（`data-urgent` と対。残す）。
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-row px-4 py-2 2xl:flex-nowrap 2xl:py-0 ${ROW_HOVER_CLASSES} ${ROW_HEIGHT_CLASS} ${
        urgent ? 'border-l-2 border-l-warning' : 'border-l-2 border-l-transparent'
      }`}
      data-testid={`home-action-queue-row-${row.targetId}`}
      data-kind={row.kind}
      data-changed={changed ? 'true' : 'false'}
      data-urgent={urgent ? 'true' : 'false'}
      data-priority={priority}
    >
      {/* 件名（1fr）。🔴 **行の主題は 15 / 500、相手は 13**（`docs/design-system.md` §3.2）——
          45px に 2 段を収めるので、2 つの段の差が 1px しか無いと 1 かたまりに見える。 */}
      <span className="order-first min-w-0 basis-full 2xl:order-none 2xl:flex-1 2xl:basis-auto">
        <Link
          href={row.href}
          title={row.subjectLabel}
          className={`${NAME_CELL_LINK_CLASSES} block truncate text-row font-medium`}
          data-testid={`home-action-queue-subject-${row.targetId}`}
        >
          {row.subjectLabel}
        </Link>
        <span
          className={`block truncate text-cell text-fg-muted ${COLUMN_SM_CLASSES}`}
          title={row.counterpartyLabel ?? undefined}
          data-testid={`home-action-queue-counterparty-${row.targetId}`}
        >
          {row.counterpartyLabel ?? messages.valueNone}
        </span>
      </span>
      {/* 時刻（120）。🔴 **期限超過はこのセルの文字色だけ**で示す（行の背景を塗らない）。 */}
      <span
        className={`shrink-0 whitespace-nowrap text-row tabular-nums ${ROW_META_WIDTH_CLASS} ${
          overdue ? 'text-warning' : 'text-fg'
        }`}
        data-testid={`home-action-queue-time-${row.targetId}`}
      >
        {time}
      </span>
      {/* 期限。🔴 時刻の列（残り / 経過）と役割が違う（こちらは**いつか**）。狭い画面では畳む。
          🔴 ✅ 2026-10-13: **バッジの前に移した** —— 操作の列の `—`（操作が無い行）と横に並び、
             実機で 2 つの `—` が「壊れている」ように見えた（2026-10-13 の実測）。 */}
      <span
        className={`shrink-0 whitespace-nowrap text-cell ${overdue ? 'text-warning' : 'text-fg-muted'} ${COLUMN_XL_CLASSES}`}
        data-testid={`home-action-queue-deadline-${row.targetId}`}
      >
        {row.deadline === null ? messages.valueNone : formatDateTimeJst(row.deadline)}
      </span>
      {/* バッジ（240）。🔴 **仕様書の 180 から広げている** —— モックは 1 行に 1 つだが、本実装は
          種別（何をすべきか）/ 優先度 / 状態（いまどこか）の 2〜3 つを出す（`docs/04` §4.1）。
          180 のままだと 13px のバッジが 2 行に折り返し、45px の刻みが崩れる。 */}
      <span className={`flex shrink-0 flex-wrap items-center gap-1 ${ROW_BADGE_WIDTH_CLASS}`}>
        <Badge variant={KIND_VARIANTS[row.kind]} data-testid={`home-action-queue-kind-${row.targetId}`}>
          {messages.kinds[row.kind]}
        </Badge>
        {/* 🔴 **優先度は「状態」ではない**（`lib/home/priority.ts` の 🔴。`StatusBadge` を使わず
              `Badge` の variant を当てる。`S-022` の失敗理由バッジと同じ扱い）。
              🔴 色の写像は `PRIORITY_BADGE_VARIANTS` の 1 箇所だけが持つ（画面で variant を書かない）。
              🔴 **モバイルでも落とさない**（判断材料である。ファイル冒頭 ②）。 */}
        <Badge
          variant={PRIORITY_BADGE_VARIANTS[priority]}
          title={messages.priorityNote}
          data-testid={`home-action-queue-priority-${row.targetId}`}
        >
          {messages.priorities[priority]}
        </Badge>
        {changed ? (
          <Badge variant="success" data-testid={`home-action-queue-changed-${row.targetId}`}>
            {messages.changed}
          </Badge>
        ) : null}
        {/* 🔴 状態は `StatusBadge`（`エンティティ + 状態` の組）。**画面側で色を決めない**。
            🔴 **種別バッジと同じ語になる行では描かない**（同じ語・同じ色が 2 回出る）。
            🔴 **語が違う行では必ず両方出す**（種別 = 何をすべきか / 状態 = いまどこか）。 */}
        {stateLabel === kindLabel ? null : (
          <span className={COLUMN_XL_CLASSES}>
            {row.stateBadge.entity === 'PROPOSAL' ? (
              <StatusBadge
                entity="proposal"
                state={row.stateBadge.state}
                label={stateLabel}
                data-testid={`home-action-queue-state-${row.targetId}`}
              />
            ) : (
              <StatusBadge
                entity="proposalRequest"
                state={row.stateBadge.state}
                label={stateLabel}
                data-testid={`home-action-queue-state-${row.targetId}`}
              />
            )}
          </span>
        )}
      </span>
      {/* 操作（146 × 32）。🔴 **行内の操作は 1 パターンだけ**（`docs/design-system.md` §5-4）。 */}
      <span className={`flex shrink-0 justify-start ${ROW_ACTION_WIDTH_CLASS}`}>
        <ActionCell row={row} availability={availability} messages={messages} />
      </span>
      {/* ✅ T-22-10: 行の `内容を見る`（`Drawer` を開く）。
          🔴 **遷移ではない**（押しても URL は変わらず、一覧の位置は保たれる）。
          🔴 **どのブレークポイントでも落とさない**（Tier 1）。
          🔴 仕様書の `…`（More）の位置である —— 中身が `内容を見る` 1 つしか無いメニューを
             作らず、その 1 つを直接置いた（`docs/design-system.md` §6 ④）。 */}
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon name="eye" />}
        aria-label={messages.drawer.open}
        onClick={() => onOpenDrawer(row.targetId)}
        data-testid={`home-action-queue-drawer-open-${row.targetId}`}
      />
    </li>
  );
}

/**
 * ✅ T-22-10: 状態の語（**行と引き出しで同じ 1 実装**）。
 * 🔴 写像は `action-queue-props.ts` が既存の `PROPOSAL_STATE_MESSAGE_KEYS` /
 *    `PROPOSAL_REQUEST_STATE_MESSAGE_KEYS` から解決したものであり、ここで語を作らない。
 */
export function rowStateLabel(row: ActionQueueRow, messages: ActionQueueMessages): string {
  const map = row.stateBadge.entity === 'PROPOSAL' ? messages.proposalStates : messages.proposalRequestStates;
  return map[row.stateBadge.state] ?? row.stateBadge.state;
}

/** ✅ T-22-10: 引き出しに渡す値（🔴 **行の表示と同じ文字列**）。 */
export function drawerValues(
  row: ActionQueueRow,
  nowMs: number,
  messages: ActionQueueMessages,
): ActionQueueDrawerValues {
  return {
    kind: messages.kinds[row.kind],
    state: rowStateLabel(row, messages),
    time: actionQueueRowTimeLabel(row, nowMs, messages),
  };
}

/**
 * 🔴 `操作` セル。**画面が見るのは 2 項だけ**である（docs/05 §6.11.2）:
 *    `row.action !== null && availability[row.action.kind].enabled`。
 *
 * 🔴 **`enabled === false` のときボタンを描かず、その位置に理由テキストを置く**（`disabled` にしない）。
 * 🔴 `action` が `null`（ホストの `提案依頼の返答待ち` / `返信待ち` の行）は**不能ではなく
 *    「操作が無い」**ので、理由ではなく `—` を置く。
 */
function ActionCell({
  row,
  availability,
  messages,
}: {
  readonly row: ActionQueueRow;
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly messages: ActionQueueMessages;
}) {
  if (row.action === null) {
    return (
      <span
        className="text-cell text-fg-placeholder"
        data-testid={`home-action-queue-action-none-${row.targetId}`}
      >
        {messages.valueNone}
      </span>
    );
  }
  const entry = availability[row.action.kind];
  if (!entry.enabled) {
    return (
      <span
        className="text-cell text-fg-muted"
        data-testid={`home-action-queue-action-denied-${row.targetId}`}
      >
        {messages.denied[entry.reasonKey]}
      </span>
    );
  }
  return (
    <Link
      className={ROW_ACTION_LINK_CLASSES}
      href={row.action.href}
      data-testid={`home-action-queue-action-${row.targetId}`}
    >
      {messages.actions[row.action.kind]}
    </Link>
  );
}
