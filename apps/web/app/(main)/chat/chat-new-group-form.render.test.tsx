// ✅ 2026-10-19（#128）: グループを作る部品。
// ✅ 2026-10-22: 一覧の列が切り替わる「新しいグループ」画面に作り直した（会社ごとの候補・選んだ人・絞り込み）。
// 🔴 固定すること: 押せないボタンを置かない（`disabled` 属性が無い）・メンバーの候補は渡された人だけ・
//    候補の行は「選んだかどうか」を `aria-checked` で読める。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatNewGroupForm } = await import('./chat-new-group-form');

const LABELS = {
  title: '新しいグループ',
  back: '戻る',
  name: 'グループの名前',
  namePlaceholder: '例',
  search: '絞り込む',
  selected: '選んだ人',
  selectedNone: 'まだ',
  self: '自分',
  remove: 'を外す',
  partnerLimit: '取引先は 1 社まで',
  noMatch: 'いません',
  external: '外部',
  submit: '作る',
  needName: '名前',
  needMembers: 'メンバー',
  failed: '失敗',
  createdToast: '作りました',
  openGroup: '開く',
} as const;

describe('グループを作る', () => {
  const html = renderToStaticMarkup(
    createElement(ChatNewGroupForm, {
      companies: [
        { companyName: '株式会社サンプル', isHost: true, people: [{ userId: 'u1', name: '見本 太郎', status: '商談中' }] },
        { companyName: '株式会社ダミー', isHost: false, people: [{ userId: 'u2', name: '仮名 花子' }] },
      ],
      labels: LABELS,
    }),
  );

  it('渡された人だけがメンバーの候補に出て、ボタンは押せる（disabled 属性が無い）', () => {
    expect(html).toContain('data-testid="chat-new-group-member-u1"');
    expect(html).toContain('data-testid="chat-new-group-member-u2"');
    expect(html.match(/data-testid="chat-new-group-member-/g)).toHaveLength(2);
    expect(html).toContain('data-testid="chat-new-group-submit"');
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it('候補は会社ごとに区切られ、取引先には「外部」の札が付き、選んだかどうかを aria-checked で読める', () => {
    expect(html).toContain('株式会社サンプル');
    expect(html).toContain('株式会社ダミー');
    expect(html).toContain('外部');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('商談中');
  });
});
