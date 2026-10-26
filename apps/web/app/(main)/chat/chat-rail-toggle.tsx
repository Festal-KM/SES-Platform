'use client';

// ✅ 2026-10-20（紺野「ハンバーガーメニュー」）: スマホでは左の絞り込みの列を 1 つのボタンにたたむ。
// ✅ 2026-10-22（紺野「スマホ版おわってる」・Lark の参考）: スマホの上部を「すべて／未読 N／保存済み」の切り替えと
//    「≡ 絞り込み」にした。よく使う 3 つはいつでも 1 回で押せ、取引先・グループ・連絡先などは ≡ で開く。
// 🔴 デジタル庁デザインシステムに合わせ、アイコンだけにせず**文字を付ける**（「≡ 絞り込み」）。押せる大きさは 44px 以上。
// ✅ 2026-10-26（紺野「左の連絡リストの出し入れもしたい」。Codex が作成・Claude がレビュー）: PC は既定で展開し、
//    利用者の選択で印だけの細い列に切り替える（この端末に覚える）。スマホの切り替えとは別に覚える。
//    🔴 島（'use client'）は `@ses/i18n` を値 import しない —— 文言は page.tsx から props で受ける。
// 🔴 たたんでも中身は消さない（`hidden` は `md:block` で戻す。`CLAUDE.md` §13.3）。
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
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
  /** ✅ 2026-10-26: パソコン幅で列を畳む・戻すボタンの読み上げ名（`chat.rail.collapseToggle`）。 */
  readonly collapseLabel: string;
  /** スマホの上部の切り替え（すべて／未読／保存済み）。 */
  readonly tabs: readonly ChatRailTab[];
  readonly children: ReactNode;
};

export function ChatRailToggle({ label, closeLabel, collapseLabel, tabs, children }: ChatRailToggleProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ses.chat.rail.collapsed') === '1';
      setCollapsed(saved);
      document.querySelector('[data-chat-rail-container]')?.setAttribute('data-collapsed', String(saved));
    } catch {
      // 保存できない端末では開く。
    }
  }, []);
  return (
    <div data-testid="chat-rail-toggle">
      <Button variant="ghost" className="hidden min-h-11 w-full md:flex" aria-expanded={!collapsed} aria-label={collapseLabel} onClick={() => {
        const next = !collapsed;
        setCollapsed(next);
        document.querySelector('[data-chat-rail-container]')?.setAttribute('data-collapsed', String(next));
        try { localStorage.setItem('ses.chat.rail.collapsed', next ? '1' : '0'); } catch { /* 開閉は続ける。 */ }
      }} data-testid="chat-rail-desktop-toggle"><span aria-hidden="true">{collapsed ? '»' : '«'}</span></Button>
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
