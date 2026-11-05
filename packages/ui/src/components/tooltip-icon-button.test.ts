import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TooltipIconButton } from './tooltip-icon-button.js';

describe('コピー操作', () => {
  it('操作名と識別子をボタンに渡し、フォームを送信しない', () => {
    const html = renderToStaticMarkup(createElement(TooltipIconButton, {
      label: 'コピー', iconName: 'copy', onClick: vi.fn(), 'data-testid': 'copy-button',
    }));
    expect(html).toContain('aria-label="コピー"');
    expect(html).toContain('data-testid="copy-button"');
    expect(html).toContain('type="button"');
  });

  it('保存操作では submit を維持する', () => {
    const html = renderToStaticMarkup(createElement(TooltipIconButton, {
      label: '保存', iconName: 'save', type: 'submit', onClick: vi.fn(),
    }));
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="保存"');
  });
});
