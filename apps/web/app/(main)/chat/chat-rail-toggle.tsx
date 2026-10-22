'use client';

// ✅ 2026-10-20（紺野「ハンバーガーメニュー」）: スマホでは左の絞り込みの列を 1 つのボタンにたたむ。
// ✅ 2026-10-22（紺野「スマホ版おわってる」・Lark の参考）: スマホの上部を「すべて／未読 N／保存済み」の切り替えと
//    「≡ 絞り込み」にした。よく使う 3 つはいつでも 1 回で押せ、取引先・グループ・連絡先などは ≡ で開く。
// 🔴 デジタル庁デザインシステムに合わせ、アイコンだけにせず**文字を付ける**（「≡ 絞り込み」）。押せる大きさは 44px 以上。
// 🔴 `md` 以上では切り替えを出さず、列は常に開いている（PC ではサイドバーを最初から隠さない。Apple HIG）。
// 🔴 たたんでも中身は消さない（`hidden` は `md:block` で戻す。`CLAUDE.md` §13.3）。
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button, cn } from '@ses/ui';

export type ChatRailTab = {
  readonly key: 'all' | 'unread' | 'saved';
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
  /** 件数（未読など。0 なら出さない）。 */
  readonly count?: number;
};

export type ChatRailToggleProps = {
  /** ≡ の文字（例:「絞り込み」）。今の絞り込みが 3 つ以外なら、その名前を添える。 */
  readonly label: string;
  readonly closeLabel: string;
  /** スマホの上部の切り替え（すべて／未読／保存済み）。 */
  readonly tabs: readonly ChatRailTab[];
  readonly children: ReactNode;
};

export function ChatRailToggle({ label, closeLabel, tabs, children }: ChatRailToggleProps) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="chat-rail-toggle">
      <div className="flex items-center gap-2 p-2 md:hidden">
        <nav className="flex min-w-0 flex-1 rounded-md bg-bg-inset p-1" data-testid="chat-rail-tabs">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 text-cell',
                tab.active ? 'bg-bg font-semibold text-brand' : 'text-fg-muted',
              )}
              data-testid={`chat-rail-tab-${tab.key}`}
            >
              <span className="truncate">{tab.label}</span>
              {tab.count === undefined || tab.count === 0 ? null : <span className="shrink-0">{String(tab.count)}</span>}
            </Link>
          ))}
        </nav>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 shrink-0 gap-1"
          aria-expanded={open}
          aria-controls="chat-rail-panel"
          onClick={() => setOpen((value) => !value)}
          data-testid="chat-rail-toggle-button"
        >
          <span aria-hidden="true">≡</span>
          <span className="truncate">{open ? closeLabel : label}</span>
        </Button>
      </div>
      <div id="chat-rail-panel" className={cn(open ? 'block' : 'hidden', 'md:block')}>
        {children}
      </div>
    </div>
  );
}
