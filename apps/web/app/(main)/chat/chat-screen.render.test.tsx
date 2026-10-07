// apps/web/app/(main)/chat/chat-screen.render.test.tsx
// `S-031` チャットの 3 コンポーネント（`ChatThreadList` / `ChatConversation` / `ChatThreadPanel`）の
// 描画テスト（`docs/04` §S-031 / `F-038` / `BR-44` / `U-10` / `CLAUDE.md` §13.3）。
//
// ============================================================================
// 🔴 なぜ描画のテストが要るか（この画面は「描かれていないこと」で要件を満たしている）
// ============================================================================
// `S-031` の 3 ファイルは冒頭で「**未読 / 添付 / 接続状態 / 件数を 1 つも描かない**」「**投稿できない
// ロールにはボタンを描かず理由を置く**」「**`md` 未満は遮断ではなく切替**」を宣言している。いずれも
// **DOM に出たかどうかでしか確かめられない**規律であり、API の結合テストでは示せない。
//
// 🔴 **宣言がコメントにしか無い状態は、次の編集で静かに破れる。** 実体の無い語（未読バッジ・添付の
//    クリップ・「接続中」）は UI の見た目としては自然に見えるため、後から「あった方が親切」として
//    足されやすい。足されたときに落ちる検出器をここに置く。
//
// 固定するもの（`code-reviewer` 指摘の 5 点）:
//   ① 🔴 **`ChatThreadList` に数字だけのバッジと `unread` の語が 1 つも無い**
//      （`messages` に既読の列が無く、未読の実体が存在しない。`lib/chat/views.ts` の ④）
//   ② 🔴 **`canPost: false` で `chat-compose` を描かず、`disabled` / `aria-disabled` / `opacity` で
//      表さず、`chat-compose-not-allowed` を置く**（`BR-44` / `U-10`。グレーアウトは分離の後退）
//   ③ 🔴 **`md` 未満は遮断ではなく切替** —— 会話に `md:hidden` の戻り道があり、一覧の器は
//      `hidden md:block`（`CLAUDE.md` §13.3「Tier 3 の画面をモバイルで非表示にしない」）
//   ④ 🔴 **`item.own` が効くのは `data-own` と面の色だけ** —— 幅・形・寄せで区別していない
//   ⑤ 🔴 **`添付` / `接続中` / `未読` / `件数` の語が 1 つも描かれない**
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`engineer-share-screen.render.test.tsx` と同じ）。
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import type {
  ChatMessageView,
  ChatParticipantView,
  ChatThreadDetailView,
  ChatThreadListItem,
} from '../../../lib/chat/views';
import { ChatConversation, type ChatConversationProps } from './chat-conversation';
import { chatConversationMessages } from './chat-props';
import { ChatThreadList, type ChatThreadListProps } from './chat-thread-list';
import { ChatThreadPanel, type ChatThreadPanelProps } from './chat-thread-panel';

const THREAD_PROJECT = '01930000-0000-7000-8000-0000000000c1';
const THREAD_COMPANY = '01930000-0000-7000-8000-0000000000c2';
const PROJECT_ID = '01930000-0000-7000-8000-0000000000f1';

/** 🔴 **件数の多い状態**で検査する（1 件だけなら「数字が出ない」は自明に真になる）。 */
const THREAD_ROWS: readonly ChatThreadListItem[] = [
  {
    id: THREAD_PROJECT,
    kind: 'PROJECT',
    project: { id: PROJECT_ID, name: '合成案件（チャット）' },
    counterpartyName: '架空パートナー A',
    lastMessageAt: '2026-09-30T01:00:00.000Z',
  },
  {
    id: THREAD_COMPANY,
    kind: 'COMPANY',
    project: null,
    counterpartyName: '架空パートナー B',
    lastMessageAt: null,
  },
];

const MESSAGE_OWN: ChatMessageView = {
  id: '01930000-0000-7000-8000-0000000000d1',
  sentAt: '2026-09-30T01:00:00.000Z',
  senderName: '山田 太郎',
  senderCompanyName: '合成ホスト株式会社',
  own: true,
  body: '自社の発言（合成データ）',
};

const MESSAGE_OTHER: ChatMessageView = {
  id: '01930000-0000-7000-8000-0000000000d2',
  sentAt: '2026-09-30T02:00:00.000Z',
  senderName: '鈴木 花子',
  senderCompanyName: '架空パートナー A',
  own: false,
  body: '相手の発言（合成データ）',
};

const PARTICIPANTS: readonly ChatParticipantView[] = [
  { companyName: '合成ホスト株式会社', isHost: true, joinedAt: '2026-09-01T00:00:00.000Z', leftAt: null },
  { companyName: '架空パートナー A', isHost: false, joinedAt: '2026-09-02T00:00:00.000Z', leftAt: null },
];

const THREAD_DETAIL: ChatThreadDetailView = {
  id: THREAD_PROJECT,
  kind: 'PROJECT',
  project: { id: PROJECT_ID, name: '合成案件（チャット）' },
  counterpartyName: '架空パートナー A',
  participants: PARTICIPANTS,
};

function renderThreadList(overrides: Partial<ChatThreadListProps> = {}): string {
  const props: ChatThreadListProps = {
    items: THREAD_ROWS,
    selectedThreadId: THREAD_PROJECT,
    // 🔴 「以前のスレッドを読み込む」が出ている状態で検査する（ページングの導線が
    //    件数つきの `Pagination` に差し替わったら ① が落ちる）。
    nextCursor: 'cursor-1',
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ChatThreadList, props));
}

function renderConversation(overrides: Partial<ChatConversationProps> = {}): string {
  const props: ChatConversationProps = {
    threadId: THREAD_PROJECT,
    initialMessages: [MESSAGE_OTHER, MESSAGE_OWN],
    initialNextCursor: 'cursor-m1',
    canPost: true,
    messages: chatConversationMessages(),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ChatConversation, props));
}

function renderPanel(overrides: Partial<ChatThreadPanelProps> = {}): string {
  const props: ChatThreadPanelProps = { thread: THREAD_DETAIL, ...overrides };
  return renderToStaticMarkup(createElement(ChatThreadPanel, props));
}

/** `<li ... class="…">` / `<div class="…">` のクラスを語の集合で取り出す。 */
function classTokensOf(html: string, testId: string): readonly string[] {
  const pattern = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`);
  const tag = pattern.exec(html);
  expect(tag, `${testId} の要素が無い`).not.toBeNull();
  const classAttr = /class="([^"]*)"/.exec((tag as RegExpExecArray)[0]);
  expect(classAttr, `${testId} に class が無い`).not.toBeNull();
  return (classAttr as RegExpExecArray)[1].split(/\s+/).filter((token) => token !== '');
}

// ---------------------------------------------------------------------------
// ① 未読の実体が無い
// ---------------------------------------------------------------------------

describe('🔴 ①: 未読の実体が無いので、未読らしきものを 1 つも描かない（F-038 AC-1 / views.ts ④）', () => {
  it('🔴 数字だけのバッジ（`>12<`）が 1 つも無い', () => {
    const html = renderThreadList();
    // 🔴 「中身が数字だけの要素」= 未読件数 / 総件数のバッジの形そのものである。
    //    最終更新は `YYYY-MM-DD HH:MM JST` なので数字だけにならない（日時は検出されない）。
    const digitOnly = [...html.matchAll(/>\s*\d+\s*</g)].map((match) => match[0]);
    expect(digitOnly, `数字だけの要素が ${String(digitOnly.length)} 件あります`).toEqual([]);
  });

  it('対照: 検出器は現に数字だけの要素を拾う（0 件が自明に真になっていない）', () => {
    // 🔴 `testid-freeze.test.ts` / `ui-screen-width.test.ts` と同じ作法 —— 検出器が壊れて
    //    何も拾わなくなったときも「違反 0 件」は真になるので、拾える形を 1 つ示す。
    expect([...'<span class="x">12</span>'.matchAll(/>\s*\d+\s*</g)]).toHaveLength(1);
  });

  it('🔴 `unread` の語が markup に 1 つも無い（属性名・クラス名・testid を含む）', () => {
    const html = renderThreadList();
    expect(html.toLowerCase()).not.toContain('unread');
    // 一覧に現に行が出ている状態で見ている（空の markup を見て真になっていない）。
    expect(html).toContain(`data-testid="chat-thread-row-${THREAD_PROJECT}"`);
    expect(html).toContain(`data-testid="chat-thread-row-${THREAD_COMPANY}"`);
  });

  it('🔴 件数つきのページング（`Pagination`）ではなく「以前のスレッドを読み込む」1 本である', () => {
    const html = renderThreadList();
    expect(html).toContain('data-testid="chat-threads-more"');
    expect(html).toContain(t('chat.threads.more'));
    // 件数を出す器（総件数 / N 件中 M 件）が無い。
    expect(html).not.toContain('data-testid="chat-threads-pagination"');
  });
});

// ---------------------------------------------------------------------------
// ② 不能は disabled で表さない
// ---------------------------------------------------------------------------

describe('🔴 ②: 投稿できないロールにボタンを描かない（BR-44 / U-10）', () => {
  it('🔴 `canPost: false` で `chat-compose` が描かれず、理由テキストが出る', () => {
    const html = renderConversation({ canPost: false });
    expect(html).not.toContain('data-testid="chat-compose"');
    expect(html).not.toContain('data-testid="chat-compose-body"');
    expect(html).not.toContain('data-testid="chat-compose-submit"');
    expect(html).toContain('data-testid="chat-compose-not-allowed"');
    expect(html).toContain(t('chat.compose.notAllowed'));
  });

  it('対照: `canPost: true` では `chat-compose` が描かれ、理由テキストは出ない', () => {
    // 🔴 これが無いと「常に描かれない」実装でも ② が緑になる。
    const html = renderConversation({ canPost: true });
    expect(html).toContain('data-testid="chat-compose"');
    expect(html).toContain('data-testid="chat-compose-submit"');
    expect(html).not.toContain('data-testid="chat-compose-not-allowed"');
  });

  it('🔴 `canPost: false` の markup に `disabled` 属性 / `aria-disabled` / `opacity` が 1 つも無い', () => {
    const html = renderConversation({ canPost: false });
    // 🔴 `disabled` の**属性**を探す（`disabled=""` / `disabled>`）。素の部分一致は使えない ——
    //    `Button` のクラスには `DISABLED_CLASSES`（`disabled:cursor-not-allowed` …）が常に入り、
    //    これは「無効になったときの見え方」であって「無効な操作」ではない。
    expect(html).not.toMatch(/\sdisabled(=|\s|\/?>)/);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('opacity');
    // 🔴 `disabled` の文字列が出るのは `disabled:` バリアント（クラス名）のときだけである。
    for (const match of html.matchAll(/disabled/g)) {
      const index = match.index ?? 0;
      expect(
        html.slice(index, index + 'disabled'.length + 1),
        `クラス名のバリアントでない \`disabled\` が ${String(index)} にあります`,
      ).toBe('disabled:');
    }
  });

  it('🔴 操作の無い状態（ページングも無い）では `<button` が 1 つも無い', () => {
    // 🔴 ② の本体は「不能を描かない」である。会話の口（送信）と過去の読み込みが共に無い状態で、
    //    押せない何かが残っていないことを見る。
    const html = renderConversation({ canPost: false, initialNextCursor: null });
    expect(html).not.toContain('<button');
    expect(html).not.toContain('disabled');
    expect(html).toContain('data-testid="chat-compose-not-allowed"');
  });
});

// ---------------------------------------------------------------------------
// ③ md 未満は遮断ではなく切替
// ---------------------------------------------------------------------------

describe('🔴 ③: md 未満は「一覧 → 会話」の切替であって遮断ではない（CLAUDE.md §13.3）', () => {
  it('🔴 会話に `md:hidden` の戻り道（`chat-back-to-list`）が在る', () => {
    const html = renderConversation();
    const tokens = classTokensOf(html, 'chat-back-to-list');
    // 🔴 `md` 以上では一覧が横に並ぶので戻り道は不要（出すと同じ場所へ 2 本の導線ができる）。
    expect(tokens).toContain('md:hidden');
    expect(html).toContain(t('chat.backToList'));
    // 🔴 戻り先は素の `/chat`（クエリを引き継ぐと「一覧に戻ったのに会話が開いている」になる）。
    expect(html).toMatch(/<a[^>]*data-testid="chat-back-to-list"[^>]*href="\/chat"/);
  });

  it('🔴 `page.tsx` で `hidden` を持つ器は必ず `md:block` で戻る（遮断しない）', () => {
    const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    // 🔴 クラスの文字列リテラルを 1 つずつ見る（ファイル全体を 1 つの正規表現で割らない）。
    const withHidden = [...page.matchAll(/'([^']*\bhidden\b[^']*)'/g)].map((match) => match[1]);
    // 走査が空振りしていない（`md` 未満の畳みが現に 2 箇所ある: 一覧の器と会話の器）。
    expect(withHidden).toHaveLength(2);
    for (const classes of withHidden) {
      expect(classes, `${classes} が md で戻っていません`).toContain('md:block');
    }
    // 🔴 一覧の器（選択中）は畳むが `md` で戻る。
    expect(page).toContain("'hidden md:block md:w-80 md:shrink-0'");
    // 🔴 会話の器（未選択）は `md` 未満では一覧が全幅なので畳む。こちらも `md` で戻る。
    expect(page).toContain("'hidden min-w-0 flex-1 md:block'");
  });

  it('🔴 一覧そのものに `hidden` の表示ユーティリティが無い（部品側で遮断していない）', () => {
    // 器が畳む / 戻すのであって、一覧の中身が自分で消えるのではない。
    const html = renderThreadList();
    // 🔴 **クラスの語として**見る（`overflow-hidden` は表示の遮断ではないので対象外。
    //    `\bhidden\b` の部分一致ではこれを誤検知する）。
    const tokens = [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/));
    expect(tokens.length).toBeGreaterThan(10);
    const hiding = tokens.filter((token) => token === 'hidden' || /:hidden$/.test(token));
    expect(hiding, `一覧の中身が自分で消えています: ${hiding.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ④ own は data-own と面の色にだけ効く
// ---------------------------------------------------------------------------

describe('🔴 ④: 自社 / 相手の弁別は `data-own` と面の色だけ（幅・形で区別しない）', () => {
  it('🔴 2 つの吹き出しのクラスの差が面の色 2 語だけである', () => {
    const html = renderConversation();
    const own = classTokensOf(html, `chat-message-${MESSAGE_OWN.id}`);
    const other = classTokensOf(html, `chat-message-${MESSAGE_OTHER.id}`);
    const onlyOwn = own.filter((token) => !other.includes(token));
    const onlyOther = other.filter((token) => !own.includes(token));
    // 🔴 差は「面の色」1 語ずつ。寸法・角丸・寄せ・余白の差が 1 語でもあれば落ちる。
    expect(onlyOwn).toEqual(['bg-brand-bg']);
    expect(onlyOther).toEqual(['bg-bg-subtle']);
  });

  it('🔴 どちらの吹き出しにも幅・寄せの語が無い（`ui-screen-width.test.ts` (c) と同じ規律）', () => {
    const html = renderConversation();
    for (const id of [MESSAGE_OWN.id, MESSAGE_OTHER.id]) {
      const tokens = classTokensOf(html, `chat-message-${id}`);
      for (const token of tokens) {
        expect(token, `${id}: ${token} は幅・寄せの指定である`).not.toMatch(
          /^(w-|max-w-|min-w-\[|ml-auto$|mr-auto$|self-|justify-end$|flex-row-reverse$|text-right$)/,
        );
      }
    }
  });

  it('🔴 `data-own` が両方の行に出る（判定を画面が作り直していない）', () => {
    const html = renderConversation();
    expect(html).toMatch(
      new RegExp(`data-testid="chat-message-${MESSAGE_OWN.id}"[^>]*data-own="true"`),
    );
    expect(html).toMatch(
      new RegExp(`data-testid="chat-message-${MESSAGE_OTHER.id}"[^>]*data-own="false"`),
    );
  });
});

// ---------------------------------------------------------------------------
// ⑤ 実体の無い語を 1 つも描かない
// ---------------------------------------------------------------------------

describe('🔴 ⑤: 実体の無い語を 1 つも描かない（添付 / 接続中 / 未読 / 件数）', () => {
  /**
   * 🔴 いずれも配線が無い:
   *   - `添付` … ウイルススキャンの配線が無い（`CLAUDE.md` §3.4。スキャン前の URL を出せない）
   *   - `接続中` … `GET /api/realtime/threads/{id}`（`docs/05` §6.5 #52）が未実装
   *   - `未読` … `messages` に既読の列が無い
   *   - `件数` … 他社の示唆になりうる（`F-038 AC-1` / `HANDOFF.md` §3.3）
   */
  const FORBIDDEN_WORDS = ['添付', '接続中', '未読', '件数'] as const;

  const SURFACES: readonly (readonly [string, () => string])[] = [
    ['ChatThreadList', () => renderThreadList()],
    ['ChatThreadList（空）', () => renderThreadList({ items: [], nextCursor: null })],
    ['ChatConversation（投稿可）', () => renderConversation()],
    ['ChatConversation（投稿不可）', () => renderConversation({ canPost: false })],
    ['ChatConversation（空）', () => renderConversation({ initialMessages: [], initialNextCursor: null })],
    ['ChatThreadPanel', () => renderPanel()],
    ['ChatThreadPanel（案件なし）', () => renderPanel({ thread: { ...THREAD_DETAIL, project: null } })],
  ];

  for (const [name, render] of SURFACES) {
    it(`${name} に ${FORBIDDEN_WORDS.join(' / ')} が 1 つも無い`, () => {
      const html = render();
      for (const word of FORBIDDEN_WORDS) {
        expect(html, `${name} に「${word}」が描かれています`).not.toContain(word);
      }
    });
  }

  it('対照: 走査している markup には現に文言が入っている（空文字を見ていない）', () => {
    // 🔴 3 面それぞれが現に描画できていることを、出るはずの語で示す。
    expect(renderThreadList()).toContain(t('chat.threads.column.target'));
    expect(renderConversation()).toContain(t('chat.message.own'));
    expect(renderPanel()).toContain(t('chat.panel.participants'));
  });
});
