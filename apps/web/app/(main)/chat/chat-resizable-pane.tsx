'use client';

import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { FOCUS_RING_CLASSES, ROW_HOVER_CLASSES, cn } from '@ses/ui';

// ✅ 2026-10-26（紺野「複数開いた時幅がきついので、調節できる機能」。Codex が作成・Claude がレビュー）:
//    並べた会話の右端の境目をつまんで（または矢印キーで）幅を変える。最小 320px。
//    会話ごとの内容や識別子は保存せず、列の幅だけを端末に覚える。
//    🔴 島（'use client'）は `@ses/i18n` を値 import しない —— 読み上げ名は props で受ける。
export function ChatResizablePane({ enabled, storageKey, resizeLabel, className, children, ...attributes }: {
  readonly enabled: boolean;
  /** 境目の読み上げ名（`chat.pane.resize`）。 */
  readonly resizeLabel: string;
  readonly storageKey: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(320);
  const [extent, setExtent] = useState<number | null>(null);
  const key = `ses.chat.extent.${storageKey}`;
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      setExtent(Number.isFinite(saved) && saved >= 320 && saved <= 1600 ? saved : null);
    } catch { setExtent(null); }
  }, [key]);
  useEffect(() => {
    const element = paneRef.current;
    if (element === null || !enabled) return;
    const measure = () => setMeasured(Math.round(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);
  function resize(value: number) {
    const next = Math.round(Math.min(1600, Math.max(320, value)));
    setExtent(next);
    try { localStorage.setItem(key, String(next)); } catch { /* 保存できなくても幅は変える。 */ }
  }
  function drag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const initial = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 320;
    event.currentTarget.dataset.start = String(start);
    event.currentTarget.dataset.initial = String(initial);
  }
  return (
    <div ref={paneRef} {...attributes} className={cn(className, 'relative', enabled ? 'md:min-w-80' : null, enabled && extent !== null ? 'md:flex-none md:basis-(--chat-pane-extent)' : null)} style={enabled && extent !== null ? { '--chat-pane-extent': `${extent}px` } as React.CSSProperties : undefined}>
      {children}
      {enabled ? <div role="separator" aria-label={resizeLabel} aria-orientation="vertical" aria-valuemin={320} aria-valuemax={1600} aria-valuenow={extent ?? measured} tabIndex={0}
        className={cn("absolute inset-y-0 right-0 z-10 hidden w-2 cursor-col-resize touch-none bg-border md:block", FOCUS_RING_CLASSES, ROW_HOVER_CLASSES)}
        data-testid={`chat-pane-resize-${storageKey}`}
        onPointerDown={drag}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          resize(Number(event.currentTarget.dataset.initial) + event.clientX - Number(event.currentTarget.dataset.start));
        }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const current = extent ?? event.currentTarget.parentElement?.getBoundingClientRect().width ?? 320;
          resize(event.key === 'Home' ? 320 : event.key === 'End' ? 1600 : current + (event.key === 'ArrowLeft' ? -32 : 32));
        }} /> : null}
    </div>
  );
}
