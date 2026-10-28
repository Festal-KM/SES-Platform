'use client';

// ✅ 2026-10-22（紺野「いらないところは省略表示できるようにしようか」）: 左の列の「取引先」「案件スレッド」「連絡先」を
//    見出しで開閉できるようにする。閉じた状態はこの端末に覚えておく（次に開いても閉じたまま）。
// 🔴 閉じていても未読は見落とさせない —— 見出しの横に未読の件数を出す。
// 🔴 覚えるのは開閉だけ（`localStorage`。読めない・書けない環境では毎回開いた状態で始める）。
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@ses/ui';

const STORAGE_PREFIX = 'ses.chat.rail.closed.';

export type ChatRailSectionProps = {
  /** 覚えておく鍵（`companies` / `projects` / `contacts` / ✅ 2026-10-27 `favorites`）。 */
  readonly sectionKey: 'companies' | 'projects' | 'contacts' | 'favorites';
  readonly heading: string;
  /** 閉じているときに見出しの横に出す未読の件数（0 なら出さない）。 */
  readonly unread: number;
  readonly children: ReactNode;
  /**
   * ✅ 2026-10-27: 左の列の外（一覧の欄のお気に入り）で使うとき false。左の列を畳んだときの見え方の指定を付けず、
   *    閉じた中身は描かない（一覧の中で表示を消すユーティリティを使わない。`chat-people.render.test.tsx` ②）。
   */
  readonly inRail?: boolean;
};

export function ChatRailSection({ sectionKey, heading, unread, children, inRail = true }: ChatRailSectionProps) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    try {
      setClosed(window.localStorage.getItem(STORAGE_PREFIX + sectionKey) === '1');
    } catch {
      // 保存領域が使えない環境では、開いた状態のまま。
    }
  }, [sectionKey]);

  function toggle(): void {
    setClosed((current) => {
      const next = !current;
      try {
        if (next) window.localStorage.setItem(STORAGE_PREFIX + sectionKey, '1');
        else window.localStorage.removeItem(STORAGE_PREFIX + sectionKey);
      } catch {
        // 覚えられなくても開閉は効く。
      }
      return next;
    });
  }

  const panelId = `chat-rail-section-${sectionKey}`;
  return (
    <section data-testid={`chat-rail-section-${sectionKey}`}>
      <h3 className={inRail ? 'm-0 md:in-[[data-collapsed=true]]:hidden' : 'm-0'}>
        <button
          type="button"
          aria-label={heading}
          aria-expanded={!closed}
          aria-controls={panelId}
          onClick={toggle}
          className="flex w-full items-center gap-1 rounded-md px-2 pt-3 pb-1 text-left text-xs font-normal text-fg-muted"
          data-testid={`chat-rail-section-toggle-${sectionKey}`}
        >
          <span aria-hidden="true" className="w-3 shrink-0">
            {closed ? '▸' : '▾'}
          </span>
          <span className="min-w-0 flex-1 truncate">{heading}</span>
          {closed && unread > 0 ? (
            <span className="shrink-0 rounded-full bg-danger px-1 text-xs font-semibold text-bg" data-testid={`chat-rail-section-unread-${sectionKey}`}>
              {String(unread)}
            </span>
          ) : null}
        </button>
      </h3>
      {/* 列を畳んだ間は節の開閉を適用せず、印と未読を残す。 */}
      {inRail ? (
        <div id={panelId} className={cn(closed ? 'hidden' : 'block', 'md:in-[[data-collapsed=true]]:block')}>
          {children}
        </div>
      ) : closed ? null : (
        <div id={panelId}>{children}</div>
      )}
    </section>
  );
}
