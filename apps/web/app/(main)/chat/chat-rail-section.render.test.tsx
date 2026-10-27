import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatRailSection } from './chat-rail-section';
import { ChatRail } from './chat-rail';

describe('畳んだ左の列の節', () => {
  it.each([
    ['companies', '取引先'],
    ['projects', '案件スレッド'],
    ['contacts', '連絡先'],
  ] as const)('%s は見出し全体を隠し、印の行を残す', (sectionKey, heading) => {
    const html = renderToStaticMarkup(createElement(ChatRailSection, {
      sectionKey,
      heading,
      unread: 2,
      children: createElement('a', { href: '/chat' }, '印の行'),
    }));
    expect(html).toContain('<h3 class="m-0 md:in-[[data-collapsed=true]]:hidden">');
    expect(html).toContain(`data-testid="chat-rail-section-toggle-${sectionKey}"`);
    expect(html).toContain(`<span class="min-w-0 flex-1 truncate">${heading}</span>`);
    expect(html).not.toContain('aria-hidden="true" class="hidden');
    expect(html).toContain(`id="chat-rail-section-${sectionKey}" class="block md:in-[[data-collapsed=true]]:block"`);
    expect(html).toContain('印の行');
  });
});

describe('会社の印', () => {
  it('開いた列は社名だけ、畳んだ列では頭文字を残す', () => {
    const html = renderToStaticMarkup(createElement(ChatRail, {
      groups: [{ key: 'company-chat', counterpartyName: '株式会社ダミーチャーリー', chat: null, threads: [], fastReply: false }],
      rooms: [], unreadCounts: {}, filter: { kind: 'all' }, showContacts: false,
    }));
    expect(html).toContain('data-testid="chat-rail-company-company-chat"');
    expect(html).toContain('title="株式会社ダミーチャーリー"');
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*hidden rounded-md bg-neutral-bg text-fg-muted md:in-\[\[data-collapsed=true\]\]:inline-flex">ダ<\/span>/);
    expect(html).toContain('truncate md:in-[[data-collapsed=true]]:sr-only">ダミーチャーリー</span>');
  });
});
