// ✅ 2026-11-01（F-038 改訂 17 / S-031 改訂 48）: グループにメンバーを追加する画面。
// 🔴 固定すること: 押せないボタンを置かない（`disabled` 属性が無い）・いまのメンバーは「参加中」で選べない（押せる形にしない）・
//    候補は渡された人だけ・読める範囲の 3 つの選び方（既定は「すべて」）・押したときの検査。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatAddMembersForm, addMembersProblem } = await import('./chat-add-members-form');

const LABELS = {
  title: 'メンバーを追加',
  back: '会話に戻る',
  search: '絞り込む',
  selected: '追加する人',
  selectedNone: 'まだ',
  remove: 'を外す',
  history: '読める過去の発言',
  historyAll: 'すべて',
  historyJoined: '追加した時から',
  historyDate: '日付を指定',
  historyDateLabel: 'この日から',
  historyNote: '前の発言は表示されません',
  quoteNote: '引用は見えます',
  submit: '追加する',
  needMembers: '人を選んで',
  needDate: '日付を選んで',
  futureDate: '未来は不可',
  limit: '50 人まで',
  failed: '失敗',
  rejected: '入れられない人',
  truncated: '一部だけ',
  addedToast: '追加しました',
  openGroup: '開く',
} as const;

const PICKER_LABELS = {
  tabs: '人の探し方',
  byCompany: '会社から探す',
  byName: '名前から探す',
  noMatch: 'いません',
  external: '外部',
  memberUnit: '人',
  alreadyIn: '参加中',
} as const;

const COMPANIES = [
  { companyName: '株式会社サンプル', isHost: true, people: [{ userId: 'u1', name: 'みほん 太郎' }, { userId: 'u0', name: 'あいだ 一郎' }, { userId: 'me', name: 'じぶん' }] },
];

function render(overrides: Partial<Parameters<typeof ChatAddMembersForm>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ChatAddMembersForm, {
      threadId: 't1',
      companies: COMPANIES,
      memberUserIds: ['me', 'u0'],
      backHref: '/chat?thread=t1',
      todayJst: '2026-11-01',
      ruleNote: '社内だけの部屋なので取引先の人は追加できません',
      truncated: false,
      labels: LABELS,
      pickerLabels: PICKER_LABELS,
      ...overrides,
    }),
  );
}

describe('メンバーを追加する画面', () => {
  const html = render();

  it('いまのメンバーは「参加中」として出て、選べる行（checkbox）にならない', () => {
    expect(html).toContain('data-testid="chat-add-members-member-u1"');
    expect(html).toContain('data-testid="chat-add-members-fixed-u0"');
    expect(html).toContain('data-testid="chat-add-members-fixed-me"');
    expect(html).not.toContain('data-testid="chat-add-members-member-u0"');
    expect(html).toContain('参加中');
    expect(html.match(/role="checkbox"/g)).toHaveLength(1);
  });

  it('押せないボタンを置かない（disabled 属性が無い）・戻り道と追加のボタンがある', () => {
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(html).toContain('data-testid="chat-add-members-submit"');
    expect(html).toContain('href="/chat?thread=t1"');
  });

  it('読める範囲は 3 つの選び方で、既定は「すべて」（日付の欄と注意書きは出ない）', () => {
    for (const value of ['ALL', 'JOINED', 'DATE']) expect(html).toContain(`data-testid="chat-add-members-history-${value}"`);
    expect(html).toMatch(/history-ALL"[^>]*checked=""/);
    expect(html).not.toContain('data-testid="chat-add-members-date"');
    expect(html).not.toContain('data-testid="chat-add-members-history-note"');
  });

  it('部屋の取引先の決まりを 1 行で書く・多すぎるときは一部だけと言う', () => {
    expect(html).toContain('社内だけの部屋なので取引先の人は追加できません');
    expect(html).not.toContain('data-testid="chat-add-members-truncated"');
    expect(render({ truncated: true })).toContain('data-testid="chat-add-members-truncated"');
  });
});

describe('押したときの検査（addMembersProblem）', () => {
  const base = { selectedCount: 1, memberCount: 3, history: 'ALL' as const, historyDate: '', todayJst: '2026-11-01' };
  it('良ければ null', () => {
    expect(addMembersProblem(base)).toBeNull();
    expect(addMembersProblem({ ...base, history: 'JOINED' })).toBeNull();
    expect(addMembersProblem({ ...base, history: 'DATE', historyDate: '2026-11-01' })).toBeNull();
  });
  it('足りないもの・上限・日付を言う', () => {
    expect(addMembersProblem({ ...base, selectedCount: 0 })).toBe('needMembers');
    expect(addMembersProblem({ ...base, memberCount: 50 })).toBe('limit');
    expect(addMembersProblem({ ...base, history: 'DATE' })).toBe('needDate');
    expect(addMembersProblem({ ...base, history: 'DATE', historyDate: '2026-11-02' })).toBe('futureDate');
  });
});
