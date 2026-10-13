'use client';

// apps/web/app/(main)/_home/action-section.tsx
// 🔴 `要対応` タブの**セクションの中身**（行の一覧 + 空状態 + 引き出し）。✅ 2026-10-11。
//
// ============================================================================
// 🔴 なぜ中身だけを共有部品にしたのか
// ============================================================================
// 人間の仕様（2026-10-11）は `要対応` タブに **5 セクションを縦に並べる**ことを定めた。
// セクションは 4 つ（`今日やること` / `返信待ち` / `面談調整中` / `提案後フォロー`）になり、
// 🔴 **行の見た目・落とす境界・引き出しの作法が 4 箇所に写ると必ず片方だけ直る**
// （`UI_GUIDELINES` §8「同じ見た目のローカル実装を 2 つ作らない」）。
//
// 🔴 **器（`Card` と `SectionHeader`）は各セクションのファイルが持つ。**
//    理由: `今日やること` だけが「自分の担当のみ」トグルとポーリング失敗の注記を持ち、
//    **`data-testid` が凍結されている**（`home-action-queue` / `home-action-queue-header-*`。
//    `tests/static/testid-freeze.test.ts` は改名・削除を認めない）。器まで共通化すると
//    凍結値の出所が props 経由になり、静的に解けなくなる危険がある。
//
// 🔴 **引き出し（`Drawer`）はセクションごとに 1 つだけ据える**（行ごとに 50 個のポータルを
//    作らない。`./action-queue-drawer.tsx` 冒頭 ⑩）。開いている行は `openTargetId` が持ち、
//    **ポーリングで行が消えたら引き出しも閉じる**（`openRow` が `null` になる）。
// 🔴 **文言を持たない**（`packages/i18n` の解決は `./action-queue-props.ts`）。
// 🔴 `@ses/db` に辿れる値 import を持たない（`client-db-boundary.test.ts`）。
import { useState } from 'react';
import { EmptyState } from '@ses/ui';
import type { HomeSectionRow } from '../../../lib/home/sections';
import type { ActionQueueHomeBlock } from '../../../lib/home/types';
import { ActionQueueDrawer } from './action-queue-drawer';
import { ActionRow, drawerValues, type ActionQueueMessages } from './action-row';

export type ActionSectionBodyProps = {
  /**
   * 🔴 `data-testid` の接頭辞。**呼び出し側が文字列リテラルで渡す**
   *    （`tests/static/testid-inventory.test.ts` の `composeTestIds` が静的に解く形）。
   * 🔴 `今日やること` は **`home-action-queue-`**（凍結値の出所）。
   */
  readonly testIdPrefix: string;
  /** 🔴 描く行（**順はサーバが決めた順のまま**。この部品は並べ替えも選別もしない）。 */
  readonly rows: readonly HomeSectionRow[];
  /** 🔴 ブロック直下の可否（全エントリ。`ACTION_QUEUE` が毎回全量返したものを全セクションに当てる）。 */
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  /** 「新着」の印を付ける行（前回のポーリングで更新があったもの）。 */
  readonly changedIds: ReadonlySet<string>;
  /** 🔴 経過時間 / 残り時間 / 優先度の基準（**サーバの応答時刻**。端末時刻を混ぜない）。 */
  readonly nowMs: number;
  /** 🔴 0 件のときの 1 文（**必須**。空の箱を出さない）。 */
  readonly emptyLabel: string;
  readonly messages: ActionQueueMessages;
};

export function ActionSectionBody({
  testIdPrefix,
  rows,
  availability,
  changedIds,
  nowMs,
  emptyLabel,
  messages,
}: ActionSectionBodyProps) {
  const [openTargetId, setOpenTargetId] = useState<string | null>(null);
  const openRow = rows.find((entry) => entry.row.targetId === openTargetId)?.row ?? null;

  return (
    <>
      {rows.length === 0 ? (
        // ⚠️ 器の `data-testid`（`{prefix}empty`）は凍結済みの値であり、`EmptyState` が出す
        //    `{prefix}root` / `{prefix}description` は**追加**である（改名ではない）。
        <div className="px-4 pb-4" data-testid={`${testIdPrefix}empty`}>
          {/* 🔴 **0 件は説明のみ**（Primary / Secondary を置かない。§5-13 / §10.4 ——
              0 件は正常であり、行動を促す相手がいない）。 */}
          <EmptyState testIdPrefix={`${testIdPrefix}empty-state-`} description={emptyLabel} />
        </div>
      ) : (
        // ✅ 改訂 23: **列の見出し行を持たない**（行は 2 段の compact な行。`./action-row.tsx` の 🔴）。
        // 🔴 区切りは**行自身の `border-top`**（`docs/design-system.md` §3.6）。`divide-y` を
        //    やめたのは、行の左端 2px の印（期限が近い / 放置が長い）と罫線が重なると、印が
        //    罫線に見えてしまうためである。
        <ul className="m-0 flex list-none flex-col p-0" data-testid={`${testIdPrefix}list`}>
          {rows.map((entry) => (
            <ActionRow
              key={entry.row.targetId}
              row={entry.row}
              priority={entry.priority}
              availability={availability}
              changed={changedIds.has(entry.row.targetId)}
              nowMs={nowMs}
              messages={messages}
              onOpenDrawer={setOpenTargetId}
            />
          ))}
        </ul>
      )}
      {/* ✅ T-22-10: 行の `内容を見る` の引き出し（**セクションに 1 つだけ**）。
          🔴 実行系のアクションを持たない（型で担保。`lib/home/drawer.ts`）。 */}
      {openRow === null ? null : (
        <ActionQueueDrawer
          row={openRow}
          values={drawerValues(openRow, nowMs, messages)}
          messages={messages.drawer}
          onClose={() => setOpenTargetId(null)}
        />
      )}
    </>
  );
}
