// ✅ 2026-10-19（#128）: グループを作る部品。
// ✅ 2026-10-22: 一覧の列が切り替わる「新しいグループ」画面に作り直した（会社ごとの候補・選んだ人・絞り込み）。
// 🔴 固定すること: 押せないボタンを置かない（`disabled` 属性が無い）・メンバーの候補は渡された人だけ・
//    候補の行は「選んだかどうか」を `aria-checked` で読める。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatNewGroupForm } = await import('./chat-new-group-form');
const { ChatPeoplePicker } = await import('./chat-people-picker');

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

const PICKER_LABELS = {
  tabs: '人の探し方',
  byCompany: '会社から探す',
  byName: '名前から探す',
  noMatch: 'いません',
  external: '外部',
  memberUnit: '人',
} as const;

const COMPANIES = [
  { companyName: '株式会社サンプル', isHost: true, people: [{ userId: 'u1', name: 'みほん 太郎', status: '商談中' }, { userId: 'u0', name: 'あいだ 一郎' }] },
  { companyName: '株式会社ダミー', isHost: false, people: [{ userId: 'u2', name: 'かめい 花子' }] },
  { companyName: '株式会社テスト', isHost: false, people: [{ userId: 'u3', name: 'しけん 次郎' }] },
];

describe('グループを作る', () => {
  const html = renderToStaticMarkup(createElement(ChatNewGroupForm, { companies: COMPANIES, labels: LABELS, pickerLabels: PICKER_LABELS }));

  it('渡された人だけがメンバーの候補に出て、ボタンは押せる（disabled 属性が無い）', () => {
    expect(html).toContain('data-testid="chat-new-group-member-u1"');
    expect(html).toContain('data-testid="chat-new-group-member-u0"');
    // ✅ 2026-10-30: 既定で開くのは自社だけ。取引先の人は会社を押すと出る。
    expect(html).not.toContain('data-testid="chat-new-group-member-u2"');
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

describe('✅ 2026-10-30（F-038 改訂 16 ⑳）: 候補は「会社から探す」「名前から探す」の 2 つのタブ', () => {
  const picker = (props: Partial<Parameters<typeof ChatPeoplePicker>[0]> & { selected?: readonly string[] } = {}) =>
    renderToStaticMarkup(
      createElement(ChatPeoplePicker, {
        mode: 'select',
        companies: COMPANIES,
        query: '',
        selected: [],
        onToggle: () => undefined,
        testIdPrefix: 'chat-new-group',
        labels: PICKER_LABELS,
        ...props,
      } as Parameters<typeof ChatPeoplePicker>[0]),
    );

  it('既定は「会社から探す」。会社は開閉でき（aria-expanded）、自社だけが開いている', () => {
    const html = picker();
    expect(html).toContain('data-testid="chat-new-group-tab-company"');
    expect(html).toContain('data-testid="chat-new-group-tab-name"');
    expect(html).toMatch(/aria-selected="true"[^>]*data-testid="chat-new-group-tab-company"|data-testid="chat-new-group-tab-company"[^>]*aria-selected="true"/);
    expect(html).toContain('data-testid="chat-new-group-company-toggle-0"');
    expect(html).toMatch(/aria-expanded="true"[^>]*data-testid="chat-new-group-company-toggle-0"/);
    expect(html).toMatch(/aria-expanded="false"[^>]*data-testid="chat-new-group-company-toggle-1"/);
    expect(html).not.toContain('data-testid="chat-new-group-by-name"');
  });

  it('「名前から探す」は全員を名前順（日本語の並び）に 1 列で、会社名と「外部」を添える', () => {
    const html = picker({ defaultTab: 'name' });
    expect(html).toContain('data-testid="chat-new-group-by-name"');
    const order = [...html.matchAll(/data-testid="chat-new-group-member-(u\d)"/g)].map((match) => match[1]);
    expect(order).toEqual(['u0', 'u2', 'u3', 'u1']);
    expect(html).toContain('株式会社テスト');
  });

  it('絞り込みは名前に当たる人だけ。会社のタブでは当たった会社を開く', () => {
    const byName = picker({ defaultTab: 'name', query: '花子' });
    expect([...byName.matchAll(/data-testid="chat-new-group-member-(u\d)"/g)].map((match) => match[1])).toEqual(['u2']);
    const byCompany = picker({ query: '花子' });
    expect(byCompany).toContain('data-testid="chat-new-group-member-u2"');
    expect(byCompany).not.toContain('data-testid="chat-new-group-member-u1"');
    expect(picker({ defaultTab: 'name', query: 'いない人' })).toContain('data-testid="chat-new-group-no-match"');
  });

  it('🔴 取引先 1 社まで: 隠す会社の人はどちらのタブにも出ない', () => {
    const hideCompany = (company: { readonly companyName: string; readonly isHost: boolean }) => company.companyName === '株式会社テスト';
    expect(picker({ defaultTab: 'name', hideCompany })).not.toContain('chat-new-group-member-u3');
    expect(picker({ hideCompany })).not.toContain('株式会社テスト');
  });

  it('押せないボタンを置かず、表示を消すユーティリティも使わない', () => {
    const html = picker();
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    const tokens = [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/));
    expect(tokens.filter((token) => token === 'hidden' || /:hidden$/.test(token))).toEqual([]);
  });
});
