import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Textarea } from './textarea.js';

describe('テキストエリアの高さを呼出側で選ぶ', () => {
  it('既存画面の既定の最小高さを維持する', () => {
    const html = renderToStaticMarkup(createElement(Textarea));
    expect(html).toContain('min-h-20');
    expect(html).not.toContain('min-h-9');
  });
  it('明示したカード入力だけをコンパクトにする', () => {
    const html = renderToStaticMarkup(createElement(Textarea, { compact: true }));
    expect(html).toContain('min-h-9');
    expect(html).not.toContain('min-h-20');
    expect(html).not.toContain('compact=');
  });
});
