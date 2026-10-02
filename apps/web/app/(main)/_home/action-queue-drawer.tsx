'use client';

// apps/web/app/(main)/_home/action-queue-drawer.tsx
// 要対応キューの行の `内容を見る` で開く引き出し（`docs/04` §4.1 `S-003` 操作表 / §S-004 操作と結果 /
// §5-13 `Drawer` / §11-25 / docs/05 §6.11.3）。T-22-10。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
//   ① 🔴 **実行系のアクションを 1 つも置かない**（承認 / 却下 / 送信 / 再送 / 応諾 / 公開 / 解除）。
//      担保は**型**であり、本ファイルに「置かない」と書いたからではない:
//        - 中身の型（`lib/home/drawer.ts` の `ActionQueueDrawerView`）に `action` のキーが無い
//        - `@ses/ui` の `Drawer` は `children` / `footer` / `actions` / `onClick` のいずれの口も
//          持たず、受け取るのは `items`（`label` / `value` の**文字列**）と `detailLink`（`href`）だけ
//          （`packages/ui/src/components/drawer.tsx` 冒頭）
//      したがって `<Button>` や `formAction` を**構文として渡せない**。
//   ② 🔴 **台帳に触らない。** 読むのは ⓐ キューの行（`#9` の応答）と ⓑ **提案詳細（#46）の履歴**だけ。
//      `/api/engineers` / `/api/skill-sheets` を叩かない（`tests/static/home-drawer-no-ledger.test.ts` ②）。
//      🔴 **`Drawer` 専用のエンドポイントを作らない**（docs/05 §6.8 / §6.11.3）—— #46 は
//      **`AuditLog` を書かない**読み取りであり（`app/api/(main)/proposals/[id]/route.ts` の 🔴。
//      `BR-27` が記録を要求するのはエンジニア詳細・スキルシート・案件詳細の閲覧で、提案の閲覧は対象外）、
//      だから「開くたびに `engineer.view` が積まれる」ことが起きない。
//   ③ 🔴 **依頼の行では履歴も凍結情報も描かない**（凍結は応諾で初めて起きる）。判定は
//      `hasProposalDrawerHistory(row.kind)` の 1 箇所で、**fetch 自体も起こさない**。
//   ④ 🔴 **モバイルは全画面オーバーレイ**（`DRAWER_PANEL_CLASSES` の `w-full` → `sm:w-100`。
//      下からのシートにしない。`docs/04` §3.4）。**閉じたら一覧の位置とスクロールが保たれる**
//      —— 遷移を伴わないオーバーレイであり、フォーカスは Radix が開く前の要素
//      （= 行の `内容を見る`）へ戻す。
//   ⑤ 🔴 **`Drawer` の中で `Drawer` を開かない**（入れ子にする口が無い。§5-13）。
//   ⑥ 文言は props（`packages/i18n` はサーバ側 `action-queue-props.ts` が解決する）。
//      本ファイルは日本語の語を書かない。
//
// 🔴 **Tier 1 の判断画面（`S-021` / `S-018` / `S-030`）では引き出しを使わない**（`docs/04` §5-13）。
//    本部品が在るのは `S-003` / `S-004` の要対応キューの行だけである。
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Drawer } from '@ses/ui/client';
import {
  actionQueueDrawerView,
  hasProposalDrawerHistory,
  proposalDrawerHistoryLines,
  type ActionQueueDrawerEvent,
  type ActionQueueDrawerHistoryMessages,
  type ActionQueueDrawerHistoryState,
  type ActionQueueDrawerMessages,
  type ActionQueueDrawerValues,
} from '../../../lib/home/drawer';
import type { ActionQueueRow } from '../../../lib/home/types';

/**
 * 引き出しの語。🔴 **`open` は行の `IconButton` の `aria-label`**（テキストの無い操作には語が要る。
 * `docs/04` §5-13 / §7.11 の用語 `内容を見る`）。
 */
export type ActionQueueDrawerMessageBundle = ActionQueueDrawerMessages & {
  readonly open: string;
  readonly close: string;
  readonly historyLabel: string;
  readonly history: ActionQueueDrawerHistoryMessages;
};

export type ActionQueueDrawerProps = {
  readonly row: ActionQueueRow;
  readonly values: ActionQueueDrawerValues;
  readonly messages: ActionQueueDrawerMessageBundle;
  readonly onClose: () => void;
};

/** #46 の応答のうち本部品が読む部分（🔴 **他のキーを型として持たない** = 凍結情報に触らない）。 */
type ProposalHistoryResponseBody = {
  readonly events?: readonly ActionQueueDrawerEvent[];
};

export function ActionQueueDrawer({ row, values, messages, onClose }: ActionQueueDrawerProps) {
  const withHistory = hasProposalDrawerHistory(row.kind);
  const [history, setHistory] = useState<ActionQueueDrawerHistoryState>({ status: 'LOADING' });

  useEffect(() => {
    // 🔴 依頼の行では取得しない（履歴そのものが存在しない段階である。冒頭 ③）。
    if (!withHistory) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/proposals/${row.targetId}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('history unavailable');
        const body = (await response.json()) as ProposalHistoryResponseBody;
        if (cancelled) return;
        setHistory({
          status: 'READY',
          lines: proposalDrawerHistoryLines(body.events ?? [], messages.history),
        });
      } catch {
        // 🔴 握り潰さない（空と区別できる語を出す。`lib/home/drawer.ts` の `historyFailed`）。
        if (!cancelled) setHistory({ status: 'FAILED' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [withHistory, row.targetId, messages.history]);

  const view = actionQueueDrawerView(row, values, messages, history);
  return (
    <Drawer
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={view.title}
      items={view.fields}
      history={view.variant === 'PROPOSAL' ? view.history : undefined}
      historyLabel={view.variant === 'PROPOSAL' ? messages.historyLabel : undefined}
      detailLink={view.detailLink}
      linkComponent={Link}
      closeLabel={messages.close}
      data-testid="home-action-queue-drawer"
    />
  );
}
