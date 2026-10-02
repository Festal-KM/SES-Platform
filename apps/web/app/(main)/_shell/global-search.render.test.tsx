// apps/web/app/(main)/_shell/global-search.render.test.tsx
// 🔴 上部バーの検索の入口（`docs/04` §3.1 の ③ / 改訂 23）。2026-10-02。
//
// 固定するもの:
//   ① 🔴 **サーバ描画（hydration 前）の近道は `Ctrl+K`**（多数側に寄せる。macOS だけ島が差し替える）
//   ② 🔴 **押せる遷移先を持つ**（動かない検索窓を置かない。§3.1 の ③）
//   ③ 🔴 プラットフォームの判定は**純粋関数**で、`userAgentData` を持たないブラウザでも Mac を見分ける
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlobalSearch, isMacPlatform } from './global-search';

function render(): string {
  return renderToStaticMarkup(
    createElement(GlobalSearch, {
      href: '/engineers',
      placeholder: 'PLACEHOLDER',
      label: 'LABEL',
      shortcutMac: '⌘K',
      shortcutDefault: 'Ctrl+K',
    }),
  );
}

describe('🔴 ①② 検索の入口', () => {
  it('🔴 遷移先を持つ（押して何も起きない入力欄を置かない）', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-search"');
    expect(html).toContain('href="/engineers"');
    expect(html).toContain('PLACEHOLDER');
    // 🔴 読み上げの語（入力欄に見えるが実体はリンクなので、語が無いと用途が伝わらない）。
    expect(html).toContain('LABEL');
  });

  it('🔴 サーバ描画の近道は `Ctrl+K`（Windows の利用者が Mac の記号を見ない）', () => {
    const html = render();
    expect(html).toContain('Ctrl+K');
    expect(html).not.toContain('⌘K');
  });

  it('🔴 `<input>` を置かない（入力して `Enter` で何も起きない形を作らない）', () => {
    expect(render()).not.toContain('<input');
  });
});

describe('🔴 ③ プラットフォームの判定（純粋関数）', () => {
  it('`userAgentData.platform` が macOS なら Mac と判定する', () => {
    expect(isMacPlatform('macOS', 'Mozilla/5.0 (Macintosh)')).toBe(true);
  });

  it('🔴 `userAgentData` を持たないブラウザ（Safari / Firefox）も UA で判定できる', () => {
    expect(isMacPlatform(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605')).toBe(true);
  });

  it('Windows は Mac ではない', () => {
    expect(isMacPlatform('Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });

  it('🔴 判定材料が 1 つも無ければ Mac ではない（既定の `Ctrl+K` に倒す）', () => {
    expect(isMacPlatform(undefined, undefined)).toBe(false);
  });
});
