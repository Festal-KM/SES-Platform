// ✅ 2026-10-19（#128）: グループを作る部品。
// 🔴 固定すること: 押せないボタンを置かない（`disabled` 属性が無い）・メンバーの候補は渡された人だけ・自分は候補に出さない（呼び出し側の責務を
//    ここでは「渡された人だけが出る」で確かめる）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatNewGroupForm } = await import('./chat-new-group-form');

const LABELS = {
  heading: 'グループを作る',
  name: 'グループの名前',
  namePlaceholder: '例',
  members: 'メンバー',
  submit: '作る',
  needName: '名前',
  needMembers: 'メンバー',
  failed: '失敗',
  createdToast: '作りました',
  openGroup: '開く',
} as const;

describe('グループを作る', () => {
  it('渡された人だけがメンバーの候補に出て、ボタンは押せる（disabled 属性が無い）', () => {
    const html = renderToStaticMarkup(
      createElement(ChatNewGroupForm, {
        people: [
          { userId: 'u1', name: '見本 太郎', companyName: '自社' },
          { userId: 'u2', name: '仮名 花子', companyName: '株式会社ダミー' },
        ],
        labels: LABELS,
      }),
    );
    expect(html).toContain('data-testid="chat-new-group-member-u1"');
    expect(html).toContain('data-testid="chat-new-group-member-u2"');
    expect(html.match(/chat-new-group-member-/g)).toHaveLength(2);
    expect(html).toContain('data-testid="chat-new-group-submit"');
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
  });
});
