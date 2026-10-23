// apps/web/lib/chat/thread-tree.test.ts
// `S-031` のスレッド一覧を会社ごとの木にする（`lib/chat/thread-tree.ts`）。
import { describe, expect, it } from 'vitest';
import { buildThreadTree, lastMessageSnippet, type ChatThreadTreeInput } from './thread-tree';
import type { ChatThreadListItem } from './views';

function item(
  id: string,
  kind: ChatThreadListItem['kind'],
  counterpartyName: string | null,
  lastMessageAt: string | null,
  projectName: string | null = null,
): ChatThreadListItem {
  return {
    id,
    kind,
    project: projectName === null ? null : { id: `p-${id}`, name: projectName },
    counterpartyName,
    lastMessageAt,
  };
}

const A_CHAT = item('a1', 'COMPANY', 'アルファ', '2026-10-10T00:00:00.000Z');
const A_OLD = item('a2', 'PROJECT', 'アルファ', '2026-10-01T00:00:00.000Z', '物流システム刷新');
const A_NEW = item('a3', 'PROJECT', 'アルファ', '2026-10-13T00:00:00.000Z', '金融系 Web 基盤');
const B_CHAT = item('b1', 'COMPANY', 'ベータ', '2026-10-12T00:00:00.000Z');
const B_EMPTY = item('b2', 'PROJECT', 'ベータ', null, '保険コア更改');
const C_ONLY_THREAD = item('c1', 'PROJECT', 'ガンマ', '2026-10-05T00:00:00.000Z', '基幹移行');

const INPUT: readonly ChatThreadTreeInput[] = [
  { groupKey: 'A', item: A_CHAT },
  { groupKey: 'A', item: A_OLD },
  { groupKey: 'A', item: A_NEW },
  { groupKey: 'B', item: B_CHAT },
  { groupKey: 'B', item: B_EMPTY },
  { groupKey: 'C', item: C_ONLY_THREAD },
];

describe('buildThreadTree', () => {
  it('会社ごとにまとめ、チャットを親・案件スレッドを子にする', () => {
    const tree = buildThreadTree(INPUT, { sort: 'recent', q: null });
    const a = tree.find((group) => group.counterpartyName === 'アルファ');
    expect(a?.chat?.id).toBe('a1');
    expect(a?.threads.map((thread) => thread.id)).toEqual(['a3', 'a2']);
    // チャットがまだ無い会社もまとまりとして出る（親は空）。
    expect(tree.find((group) => group.counterpartyName === 'ガンマ')?.chat).toBeNull();
  });

  it('🔴 更新があったものが上: 会社の並びは、チャットとスレッドのうちいちばん新しい更新の順', () => {
    // アルファ（スレッド 10/13）> ベータ（チャット 10/12）> ガンマ（10/05）
    expect(buildThreadTree(INPUT, { sort: 'recent', q: null }).map((group) => group.counterpartyName)).toEqual([
      'アルファ',
      'ベータ',
      'ガンマ',
    ]);
  });

  it('発言の無いスレッドは会社の中で最後', () => {
    const tree = buildThreadTree([...INPUT, { groupKey: 'A', item: item('a4', 'PROJECT', 'アルファ', null, 'X') }], {
      sort: 'recent',
      q: null,
    });
    expect(tree[0]?.threads.map((thread) => thread.id)).toEqual(['a3', 'a2', 'a4']);
  });

  it('会社名順（読めない名前は最後）', () => {
    const tree = buildThreadTree([...INPUT, { groupKey: 'D', item: item('d1', 'COMPANY', null, '2026-10-14T00:00:00.000Z') }], {
      sort: 'company',
      q: null,
    });
    expect(tree.map((group) => group.counterpartyName)).toEqual(['アルファ', 'ガンマ', 'ベータ', null]);
  });

  it('検索: 会社名に当たれば会社ごと、当たらなければ案件名が当たるスレッドだけ', () => {
    const byCompany = buildThreadTree(INPUT, { sort: 'recent', q: 'ベータ' });
    expect(byCompany).toHaveLength(1);
    expect(byCompany[0]?.threads.map((thread) => thread.id)).toEqual(['b2']);

    const byProject = buildThreadTree(INPUT, { sort: 'recent', q: '金融' });
    expect(byProject).toHaveLength(1);
    expect(byProject[0]?.counterpartyName).toBe('アルファ');
    expect(byProject[0]?.threads.map((thread) => thread.id)).toEqual(['a3']);
    // 親のチャットは文脈として残す。
    expect(byProject[0]?.chat?.id).toBe('a1');
  });

  it('検索は大文字小文字を区別しない・前後の空白を無視する・当たらなければ空', () => {
    const tree = buildThreadTree([{ groupKey: 'E', item: item('e1', 'PROJECT', 'Echo', null, 'Web Portal') }], {
      sort: 'recent',
      q: '  web ',
    });
    expect(tree).toHaveLength(1);
    expect(buildThreadTree(INPUT, { sort: 'recent', q: '該当なし' })).toEqual([]);
  });

  it('🔴 読めない案件名（`project: null`）は検索で当たらない（名前を探れない）', () => {
    const hidden = item('h1', 'PROJECT', 'アルファ', null, null);
    const tree = buildThreadTree([{ groupKey: 'A', item: hidden }], { sort: 'recent', q: '秘密の案件' });
    expect(tree).toEqual([]);
  });

  it('🔴 出力に会社の鍵（groupKey）が載らない（`key` は会社の会話の行の ID であり、取引先の ID ではない）', () => {
    const tree = buildThreadTree(INPUT, { sort: 'recent', q: null });
    expect(Object.keys(tree[0] ?? {}).sort()).toEqual(['chat', 'counterpartyName', 'fastReply', 'key', 'threads']);
    const ids = new Set(INPUT.map((entry) => entry.item.id));
    for (const group of tree) expect(ids.has(group.key), group.key).toBe(true);
    for (const entry of INPUT) expect(tree.map((group) => group.key)).not.toContain(entry.groupKey);
  });
});

describe('messageSnippet（本文の検索の抜粋）', () => {
  it('当たった箇所の前後だけを切り出し、切ったら「…」を付ける', async () => {
    const { messageSnippet } = await import('./thread-tree');
    const body = `${'あ'.repeat(100)}面談の候補${'い'.repeat(100)}`;
    const snippet = messageSnippet(body, '面談', 10);
    expect(snippet).toBe(`…${'あ'.repeat(10)}面談${'の候補'}${'い'.repeat(7)}…`);
  });

  it('改行は空白にし、短い本文は切らない・大文字小文字を区別しない', async () => {
    const { messageSnippet } = await import('./thread-tree');
    expect(messageSnippet('Hello\nWorld', 'world')).toBe('Hello World');
  });
});

// ✅ 2026-10-23: 案件だけを貼った発言の一覧の 2 段目。🔴 案件名は入れない。
describe('lastMessageSnippet', () => {
  it('本文が空で案件を貼った発言は、渡された語を出す', () => {
    expect(lastMessageSnippet({ body: '', attachedProjectId: 'p1' }, '案件を共有しました')).toBe('案件を共有しました');
  });
  it('本文があれば本文の冒頭（案件を貼っていても）', () => {
    expect(lastMessageSnippet({ body: 'こちらです', attachedProjectId: 'p1' }, '案件を共有しました')).toBe('こちらです');
    expect(lastMessageSnippet({ body: null }, '案件を共有しました')).toBe('');
  });
});
