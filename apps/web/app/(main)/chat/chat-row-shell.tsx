'use client';

// ✅ 2026-10-19（v2）: 一覧の 1 行の外枠。「右に並べる」は**マウスを当てたとき・キーボードで行に移ったときだけ**出す
// （常に出すと名前が切り詰められる。紺野の指摘）。
// 🔴 `group-hover:` は画面に書けない（`tests/static/ui-state-in-primitives.test.ts` (j)）。どの行の導線を出すかは
//    この部品の状態で決める（押し心地ではない）。
// 🔴 スマホ（指）にはカーソルが無いので、`pointer-fine` の機器だけで隠す（スマホでは常に出す）。
// 🔴 隠すのは `invisible`（場所を取ったまま見えない）—— 出たときに行の中身がずれない。
import { useState, type ReactNode } from 'react';
import { cn } from '@ses/ui';

export type ChatRowShellProps = {
  readonly className: string;
  /** 行の会話の ID と、DM・グループか（目印を静的に読めるテンプレートで書くため）。 */
  readonly id: string;
  readonly room: boolean;
  readonly selected: boolean;
  readonly kind: string;
  readonly children: ReactNode;
  /** 行にマウスを当てたときだけ出す導線（無ければ `null`）。 */
  readonly reveal: ReactNode;
};

export function ChatRowShell({ className, id, room, selected, kind, children, reveal }: ChatRowShellProps) {
  const [active, setActive] = useState(false);
  return (
    <li
      data-testid={room ? `chat-room-${id}` : `chat-thread-row-${id}`}
      data-selected={selected ? 'true' : 'false'}
      data-kind={kind}
      className={className}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
      }}
    >
      {children}
      {reveal === null ? null : <span className={cn('flex shrink-0 items-center', active ? null : 'pointer-fine:invisible')}>{reveal}</span>}
    </li>
  );
}
