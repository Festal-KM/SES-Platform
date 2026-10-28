'use client';

import { useLayoutEffect } from 'react';

/** 折り返すバナーや下部ナビの寸法をチャット側で読み、共通の外枠は変えない。 */
export function ChatViewportHeight() {
  useLayoutEffect(() => {
    const screen = document.querySelector<HTMLElement>('[data-chat-screen]');
    const tabs = document.querySelector<HTMLElement>('[data-testid="app-bottom-tabs"]');
    if (screen === null) return;
    const viewport = window.visualViewport;
    const update = () => {
      // 下部ナビがある幅だけ適用する。幅の境界値を画面側に複製しない。
      if (tabs === null || getComputedStyle(tabs).display === 'none') {
        screen.style.removeProperty('--chat-mobile-height');
        return;
      }
      const bottom = viewport === null ? window.innerHeight : viewport.offsetTop + viewport.height;
      const height = Math.max(0, bottom - screen.getBoundingClientRect().top - tabs.getBoundingClientRect().height);
      screen.style.setProperty('--chat-mobile-height', `${height}px`);
    };
    const observer = new ResizeObserver(update);
    // 高さが可変の上部要素も監視し、文字の折り返しや読み込み後の変化を拾う。
    for (const element of document.querySelectorAll('[data-testid="app-header"], [data-environment], [data-testid="app-bottom-tabs"]')) {
      observer.observe(element);
    }
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      screen.style.removeProperty('--chat-mobile-height');
    };
  }, []);
  return null;
}
