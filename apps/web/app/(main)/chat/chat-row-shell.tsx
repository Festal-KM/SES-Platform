'use client';

// ✅ 2026-10-19（v2）: 一覧の 1 行の外枠。「右に並べる」は**マウスを当てたとき・キーボードで行に移ったときだけ**出す
// （常に出すと名前が切り詰められる。紺野の指摘）。
// 🔴 `group-hover:` は画面に書けない（`tests/static/ui-state-in-primitives.test.ts` (j)）。どの行の導線を出すかは
//    この部品の状態で決める（押し心地ではない）。
// 🔴 スマホ（指）にはカーソルが無いので、`pointer-fine` の機器だけで隠す（スマホでは常に出す）。
// 🔴 隠すのは `invisible`（場所を取ったまま見えない）—— 出たときに行の中身がずれない。
//
// ✅ 2026-10-20（紺野「スワイプアクション」）: スマホで行を**左にスワイプ**すると「ピン留め」「ミュート」が出る
//    （右にスワイプか、もう一度押すと閉じる）。
// 🔴 スワイプは近道であって唯一の道ではない（Apple HIG / Material 3）—— 同じ操作は会話の見出しにもある。
// 🔴 押せる大きさは 44px 以上（Apple HIG / デジタル庁）。動きは付けない（`transition-transform` は使えない決まり）。
// 🔴 閲覧専用でも自分の表示の設定（ピン留め・ミュート）は変えられる（見出しの切り替えと同じ。投稿ではない）。
import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, cn } from '@ses/ui';
import { chatThreadPrefsApiPath } from '../../../lib/chat/screen-query';

/** スワイプとみなす横の移動量（px）。縦のスクロールと取り違えないよう、縦の移動より大きいときだけ数える。 */
const SWIPE_THRESHOLD_PX = 48;

export type ChatRowSwipeLabels = {
  readonly pin: string;
  readonly unpin: string;
  readonly mute: string;
  readonly unmute: string;
};

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
  /** ✅ 2026-10-20: スワイプで出す操作（ピン留め・ミュート）。省略時はスワイプしない。 */
  readonly swipe?: { readonly pinned: boolean; readonly muted: boolean; readonly labels: ChatRowSwipeLabels };
};

/**
 * スワイプで出す 2 つのボタン。🔴 `useRouter` はここ（スワイプしたときだけ描く部品）でだけ使う ——
 *    行の外枠で使うと、サーバで描く一覧（render テスト）にアプリのルーターが要るようになる。
 */
function SwipeActions({
  id,
  swipe,
  onDone,
}: {
  readonly id: string;
  readonly swipe: NonNullable<ChatRowShellProps['swipe']>;
  readonly onDone: () => void;
}) {
  const router = useRouter();
  async function toggle(key: 'pinned' | 'muted', next: boolean): Promise<void> {
    try {
      const response = await fetch(chatThreadPrefsApiPath(id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      });
      if (response.ok) {
        onDone();
        router.refresh();
      }
    } catch {
      // 失敗しても行はそのまま（見出しの切り替えからやり直せる）。
    }
  }
  return (
    <span className="flex shrink-0 items-stretch" data-testid={`chat-row-swipe-${id}`}>
      <Button
        type="button"
        variant="primary"
        className="h-auto min-h-11 rounded-none"
        onClick={() => void toggle('pinned', !swipe.pinned)}
        data-testid={`chat-row-swipe-pin-${id}`}
      >
        {swipe.pinned ? swipe.labels.unpin : swipe.labels.pin}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-auto min-h-11 rounded-none"
        onClick={() => void toggle('muted', !swipe.muted)}
        data-testid={`chat-row-swipe-mute-${id}`}
      >
        {swipe.muted ? swipe.labels.unmute : swipe.labels.mute}
      </Button>
    </span>
  );
}

export function ChatRowShell({ className, id, room, selected, kind, children, reveal, swipe }: ChatRowShellProps) {
  const [active, setActive] = useState(false);
  const [swiped, setSwiped] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  return (
    <li
      data-testid={room ? `chat-room-${id}` : `chat-thread-row-${id}`}
      data-selected={selected ? 'true' : 'false'}
      data-kind={kind}
      data-swiped={swiped ? 'true' : 'false'}
      className={className}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        start.current = touch === undefined ? null : { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        const from = start.current;
        const touch = event.changedTouches[0];
        start.current = null;
        if (swipe === undefined || from === null || touch === undefined) return;
        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
        setSwiped(dx < 0);
      }}
    >
      {children}
      {swiped && swipe !== undefined ? (
        <SwipeActions id={id} swipe={swipe} onDone={() => setSwiped(false)} />
      ) : reveal === null ? null : (
        <span className={cn('flex shrink-0 items-center', active ? null : 'pointer-fine:invisible')}>{reveal}</span>
      )}
    </li>
  );
}
