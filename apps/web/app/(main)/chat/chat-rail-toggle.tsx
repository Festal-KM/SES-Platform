'use client';

// ✅ 2026-10-20（紺野「ハンバーガーメニュー」）: スマホでは左の絞り込みの列を 1 つのボタンにたたむ。
// 🔴 デジタル庁デザインシステムに合わせ、アイコンだけにせず**文字を付ける**（「絞り込み：すべて」）。
//    画面の下にナビゲーションを増やさない（同ガイドは非推奨）。押せる大きさは 44px 以上。
// 🔴 `md` 以上では常に開いている（PC ではサイドバーを最初から隠さない。Apple HIG）。
// 🔴 たたんでも中身は消さない（`hidden` は `md:block` で戻す。`CLAUDE.md` §13.3）。
import { useState, type ReactNode } from 'react';
import { Button, cn } from '@ses/ui';

export type ChatRailToggleProps = {
  /** ボタンの文字（例:「絞り込み：すべて」）。 */
  readonly label: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
};

export function ChatRailToggle({ label, closeLabel, children }: ChatRailToggleProps) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="chat-rail-toggle">
      <div className="p-2 md:hidden">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 w-full justify-between"
          aria-expanded={open}
          aria-controls="chat-rail-panel"
          onClick={() => setOpen((value) => !value)}
          data-testid="chat-rail-toggle-button"
        >
          <span className="truncate">{open ? closeLabel : label}</span>
          <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </Button>
      </div>
      <div id="chat-rail-panel" className={cn(open ? 'block' : 'hidden', 'md:block')}>
        {children}
      </div>
    </div>
  );
}
