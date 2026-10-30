'use client';

// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑯）: 左の列の並び替え。「並び替え」で編集に入り、項目ごとの ↑ ↓ で動かし、「完了」で戻る。
//    並びはこの端末に覚える（`lib/chat/rail-order.ts`）。
//
// 🔴 ここが守るもの
//   ① 項目（中身・件数・リンク先）はサーバの `chat-rail.tsx` が決める。ここは**並べ方だけ**を変える（項目を増やさない・隠さない）。
//   ② キーボードで操作できる（↑ ↓ は `IconButton`。動かした後も同じ項目の印にフォーカスを残す）。スマホでは 44px。
//   ③ 端の項目には押せない印を描かない（`disabled` にせず、場所だけ空ける）。
//   ④ 列を畳んだ（印だけの）ときは編集の欄を出さず、ふだんの並びを出す。
//   ⑤ 文言は props で受ける（`@ses/i18n` を値 import しない）。
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Button, Icon, IconButton } from '@ses/ui';
import {
  CHAT_RAIL_ORDER_STORAGE_KEY,
  applyChatRailOrder,
  moveChatRailItem,
  parseChatRailOrder,
  serializeChatRailOrder,
  type ChatRailItemKey,
} from '../../../lib/chat/rail-order';

export type ChatRailBlock = {
  readonly key: ChatRailItemKey;
  /** `link` = 1 行のリンク（`<li>`）/ `section` = 見出しで開閉する節。連続する `link` は 1 つの並びにまとめて描く。 */
  readonly kind: 'link' | 'section';
  /** 編集の欄に出す名前。 */
  readonly label: string;
  readonly node: ReactNode;
};

export type ChatRailOrderLabels = {
  readonly reorder: string;
  readonly done: string;
  readonly reset: string;
  readonly listLabel: string;
  readonly hint: string;
  /** 名前の後ろに続けて読む語（「未読を上へ」）。 */
  readonly moveUp: string;
  readonly moveDown: string;
};

const LINK_LIST_CLASSES = 'm-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col md:overflow-visible';
const MOVE_BUTTON_CLASSES = 'h-11 w-11 md:h-8 md:w-8';

function renderBlocks(blocks: readonly ChatRailBlock[]): ReactNode[] {
  const out: ReactNode[] = [];
  let links: ChatRailBlock[] = [];
  const flush = (): void => {
    if (links.length === 0) return;
    out.push(
      <ul key={`links-${links[0]?.key ?? ''}`} className={LINK_LIST_CLASSES}>
        {links.map((block) => (
          <Fragment key={block.key}>{block.node}</Fragment>
        ))}
      </ul>,
    );
    links = [];
  };
  for (const block of blocks) {
    if (block.kind === 'link') {
      links.push(block);
      continue;
    }
    flush();
    out.push(<Fragment key={block.key}>{block.node}</Fragment>);
  }
  flush();
  return out;
}

export function ChatRailOrder({ blocks, labels }: { readonly blocks: readonly ChatRailBlock[]; readonly labels: ChatRailOrderLabels }) {
  const [saved, setSaved] = useState<readonly ChatRailItemKey[] | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try {
      setSaved(parseChatRailOrder(window.localStorage.getItem(CHAT_RAIL_ORDER_STORAGE_KEY)));
    } catch {
      // 保存領域が使えない端末では、最初の並びのまま。
    }
  }, []);
  const ordered = applyChatRailOrder(blocks, saved);

  function persist(keys: readonly ChatRailItemKey[] | null): void {
    setSaved(keys);
    try {
      if (keys === null) window.localStorage.removeItem(CHAT_RAIL_ORDER_STORAGE_KEY);
      else window.localStorage.setItem(CHAT_RAIL_ORDER_STORAGE_KEY, serializeChatRailOrder(keys));
    } catch {
      // 覚えられなくても、開いている間の並びは変わる。
    }
  }

  function move(key: ChatRailItemKey, delta: -1 | 1): void {
    const next = moveChatRailItem(
      ordered.map((block) => block.key),
      key,
      delta,
    );
    persist(next);
    // 端に着いて押した印が消えても、同じ項目の残った印にフォーカスを移す（キーボードで続けて動かせる）。
    window.requestAnimationFrame(() => {
      const same = document.querySelector<HTMLElement>(`[data-testid="chat-rail-reorder-${delta < 0 ? 'up' : 'down'}-${key}"]`);
      const other = document.querySelector<HTMLElement>(`[data-testid="chat-rail-reorder-${delta < 0 ? 'down' : 'up'}-${key}"]`);
      (same ?? other)?.focus();
    });
  }

  return (
    <>
      {/* 畳んだ列（印だけ）では編集の欄を出さないので、ふだんの並びを残す。 */}
      <div className={editing ? 'hidden md:in-[[data-collapsed=true]]:block' : undefined} data-testid="chat-rail-items">
        {renderBlocks(ordered)}
      </div>
      {editing ? (
        <div role="group" aria-label={labels.listLabel} className="flex flex-col gap-1 md:in-[[data-collapsed=true]]:hidden" data-testid="chat-rail-reorder">
          <p className="m-0 px-2 py-1 text-xs text-fg-muted">{labels.hint}</p>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {ordered.map((block, index) => (
              <li key={block.key} className="flex min-h-11 items-center gap-1 rounded-md bg-bg px-2 text-cell text-fg md:min-h-8" data-testid={`chat-rail-reorder-item-${block.key}`}>
                <span className="min-w-0 flex-1 truncate">{block.label}</span>
                {index === 0 ? (
                  <span aria-hidden="true" className={MOVE_BUTTON_CLASSES} />
                ) : (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={MOVE_BUTTON_CLASSES}
                    icon={<Icon name="chat-move-up" />}
                    aria-label={`${block.label}${labels.moveUp}`}
                    title={`${block.label}${labels.moveUp}`}
                    onClick={() => move(block.key, -1)}
                    data-testid={`chat-rail-reorder-up-${block.key}`}
                  />
                )}
                {index === ordered.length - 1 ? (
                  <span aria-hidden="true" className={MOVE_BUTTON_CLASSES} />
                ) : (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={MOVE_BUTTON_CLASSES}
                    icon={<Icon name="chat-move-down" />}
                    aria-label={`${block.label}${labels.moveDown}`}
                    title={`${block.label}${labels.moveDown}`}
                    onClick={() => move(block.key, 1)}
                    data-testid={`chat-rail-reorder-down-${block.key}`}
                  />
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
            <Button type="button" variant="secondary" size="sm" className="min-h-11 md:min-h-8" onClick={() => setEditing(false)} data-testid="chat-rail-reorder-done">
              {labels.done}
            </Button>
            {saved === null ? null : (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={() => persist(null)} data-testid="chat-rail-reorder-reset">
                {labels.reset}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="px-2 pt-3 md:in-[[data-collapsed=true]]:hidden">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-8"
            onClick={() => setEditing(true)}
            data-testid="chat-rail-reorder-toggle"
          >
            {labels.reorder}
          </Button>
        </div>
      )}
    </>
  );
}
