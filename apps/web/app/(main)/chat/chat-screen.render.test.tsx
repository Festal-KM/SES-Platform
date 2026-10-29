import { ChatResizablePane } from './chat-resizable-pane';
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
import { buildThreadTree } from '../../../lib/chat/thread-tree';
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
  mine: true,
  body: '自社の発言（合成データ）',
};

const MESSAGE_OTHER: ChatMessageView = {
  id: '01930000-0000-7000-8000-0000000000d2',
  sentAt: '2026-09-30T02:00:00.000Z',
  senderName: '鈴木 花子',
  senderCompanyName: '架空パートナー A',
  own: false,
  mine: false,
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
    // ✅ 2026-10-14: 一覧は会社ごとの木（`lib/chat/thread-tree.ts`）。鍵はテストでは会社名で足りる。
    groups: buildThreadTree(
      THREAD_ROWS.map((item) => ({ groupKey: item.counterpartyName ?? item.id, item })),
      { sort: 'recent', q: null },
    ),
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

  // ✅ 2026-10-16: 未読の実体（`chat_read_states`）ができたので、「未読を 1 つも描かない」から
  //    「**未読の件数は実データがあるときだけ描く**」に改めた（架空の数を出さない、という意図は同じ）。
  it('🔴 未読の件数は実データ（`unreadCounts`）があるときだけ描く（架空の数を出さない）', () => {
    const html = renderThreadList();
    expect(html).not.toContain('chat-thread-unread-');
    const withUnread = renderThreadList({ unreadCounts: { [THREAD_PROJECT]: 3 } });
    expect(withUnread).toContain(`data-testid="chat-thread-unread-${THREAD_PROJECT}"`);
    expect(withUnread).not.toContain(`chat-thread-unread-${THREAD_COMPANY}`);
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
    // ✅ 2026-10-14: 発言の操作（コピー・続きを読む・2026-10-16 から「ここから未読にする」）は閲覧専用でも**押せて働く**
    //    （自分の表示の状態を変えるだけ）ので在ってよい。
    //    ✅ 2026-10-29（F-038 ⑰）: 会話の中の検索も閲覧専用で押せて働く（読むだけ）ので在ってよい。
    //    🔴 それ以外の `<button>`（送信・再送・定型文・過去の読み込み）は 1 つも無い。
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    for (const button of buttons) {
      expect(button, `発言の操作ではないボタンがあります: ${button}`).toMatch(/data-testid="chat-(message-(copy|expand|mark-unread)|search-toggle)-/);
    }
    expect(html).not.toContain('chat-compose-submit');
    expect(html).not.toContain('chat-compose-template');
    // 🔴 `disabled` の**属性**が無い（`Button` のクラスの `disabled:` バリアントは見え方の定義なので除く。上の検査と同じ）。
    expect(html).not.toMatch(/\sdisabled(=|\s|\/?>)/);
    expect(html).not.toContain('aria-disabled');
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
    // 🔴 ✅ 2026-10-13: `overflow-hidden`（器の角丸で中身を切る指定）は**畳みではない**ので
    //    除く。`\bhidden\b` は `overflow-hidden` にも当たるため、前が `-` の出現を外す。
    const withHidden = [...page.matchAll(/'([^']*(?<![-\w])hidden\b[^']*)'/g)].map((match) => match[1]);
    // 走査が空振りしていない（`md` 未満の畳みが現に 5 箇所ある: 一覧の器と会話の器、
    // ✅ 2026-10-14 から右に並べた会話の器とドラッグの受け口、✅ 2026-10-19 から左の絞り込みの列）。
    expect(withHidden).toHaveLength(5);
    for (const classes of withHidden) {
      // 🔴 戻し方は `md:block` でも `md:flex` でもよい（**見えるようになること**が条件であり、
      //    `display` の値は器の中身が決める）。✅ 2026-10-13: 会話の器は縦 3 段になったので `md:flex`。
      expect(classes, `${classes} が md で戻っていません`).toMatch(/md:(?:block|flex)\b/);
    }
    // スクロールの連鎖を止め、左の列の開閉幅を追加したためクラスの期待値も更新する。
    // 🔴 一覧の器（選択中）は畳むが `md` で戻る。
    // ✅ 2026-10-22: `md` 以上は器の中だけでスクロールする（`md:overflow-y-auto`）。
    expect(page).toContain("'hidden bg-bg md:block md:w-96 md:shrink-0 md:overflow-y-auto overscroll-contain md:border-r md:border-border'");
    // 🔴 会話の器（未選択）は `md` 未満では一覧が全幅なので畳む。こちらも `md` で戻る。
    expect(page).toContain("'hidden min-h-0 min-w-0 flex-1 md:flex md:flex-col'");
    // ✅ 2026-10-14: 右に並べた会話とドラッグの受け口は `md` 未満では出さない（モバイルは 1 列の切替）。
    //    🔴 どちらも `md` で戻る（遮断ではない）。
    expect(page).toContain("'hidden min-h-0 min-w-0 flex-1 flex-col overscroll-contain border-l border-border md:flex'");
    expect(page).toContain("'hidden md:flex'");
    // ✅ 2026-10-19（v2）: 左の絞り込みの列も、会話を開いたときだけ畳み、`md` で戻る。
    expect(page).toContain("'hidden shrink-0 bg-bg-subtle md:block md:w-44 md:data-[collapsed=true]:w-16 md:overflow-y-auto overscroll-contain'");
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
    // ✅ **2026-10-13: 色が載っている要素が `<li>` から吹き出し（`chat-message-body-*`）に
    //    移った**（デザインシステム v1.0 §3.12 の Slack 型。行は器を持たず、吹き出しだけが面を持つ）。
    // 🔴 **見ている内容は 1 つも減らしていない** —— 「差は面の色 1 語ずつだけ」である。
    const html = renderConversation();
    const own = classTokensOf(html, `chat-message-body-${MESSAGE_OWN.id}`);
    const other = classTokensOf(html, `chat-message-body-${MESSAGE_OTHER.id}`);
    expect(own.length, '吹き出しのクラスが 1 つも取れていない（検査の空振り）').toBeGreaterThan(0);
    const onlyOwn = own.filter((token) => !other.includes(token));
    const onlyOther = other.filter((token) => !own.includes(token));
    // 🔴 差は「面の色」1 語ずつ。寸法・角丸・寄せ・余白の差が 1 語でもあれば落ちる。
    // ✅ 2026-10-27（紺野「色分けとか、みづらい」）: 相手は「白に濃い枠」にした（自社の薄い青と、ひと目で分かる差）。
    //    差は依然として面（塗り・枠）の語だけ。寸法・角丸・寄せ・余白の差は 1 語も許さない。
    // ✅ 2026-10-27（紺野「まだ区別しにくい」）: 自分の発言は濃い青に白い文字。相手は白に灰色の枠（同僚は薄い青に青い枠）。
    //    差は依然として面（塗り・枠・その上の文字色）の語だけ。寸法・角丸・寄せ・余白の差は 1 語も許さない。
    expect([...onlyOwn].sort()).toEqual(['bg-brand', 'text-brand-fg']);
    expect([...onlyOther].sort()).toEqual(['bg-bg', 'border', 'border-border-strong', 'text-fg']);
    // 🔴 行（`<li>`）の側には色が 1 語も無い（面を 2 重に持たない）。
    for (const id of [MESSAGE_OWN.id, MESSAGE_OTHER.id]) {
      for (const token of classTokensOf(html, `chat-message-${id}`)) {
        expect(token, `${id}: 行に面の色が付いている`).not.toMatch(/^bg-/);
      }
    }
  });

  it('🔴 吹き出しに寄せの語が無く、幅は自社 / 相手で同じである', () => {
    // ✅ **2026-10-13: 上限幅（560px）は持つ**（定義書 §3.12）。🔴 **持ってよいのは
    //    「両方に同じ 1 つ」だけ**であり、差があれば上の検査が落とす。
    // 🔴 **寄せの語は依然として 1 つも許さない** —— 位置で誰の発言かを表すと、参加会社が
    //    3 社以上になったときに表しようがなくなる（`chat-conversation.tsx` の 🔴）。
    const html = renderConversation();
    for (const id of [MESSAGE_OWN.id, MESSAGE_OTHER.id]) {
      for (const token of classTokensOf(html, `chat-message-body-${id}`)) {
        expect(token, `${id}: ${token} は寄せの指定である`).not.toMatch(
          /^(ml-auto$|mr-auto$|self-|justify-end$|flex-row-reverse$|text-right$)/,
        );
      }
    }
    // 🔴 **画面のソースに `max-w-` のリテラルが無い**（幅の上限は `packages/ui` の定数が持つ。
    //    `tests/static/ui-screen-width.test.ts` (c) と同じ規律であり、ここでは会話の
    //    ファイルだけを名指しで見る）。
    const source = readFileSync(new URL('./chat-message-item.tsx', import.meta.url), 'utf8');
    // 🔴 クラスとして書かれた `max-w-<値>` が 1 つも無いことを見る（コメント中の `max-w-*` や
    //    `` `max-w-` `` は値を伴わないので当たらない）。
    expect(source.match(/max-w-[\w.]+/g) ?? []).toEqual([]);
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

describe('🔴 ⑤: 実体の無い語を 1 つも描かない（添付 / 接続中 / 件数。未読は 2026-10-16 に実体ができた）', () => {
  /**
   * 🔴 いずれも配線が無い:
   *   - `添付` … ウイルススキャンの配線が無い（`CLAUDE.md` §3.4。スキャン前の URL を出せない）
   *   - `接続中` … `GET /api/realtime/threads/{id}`（`docs/05` §6.5 #52）が未実装
   *   - ~~`未読` … `messages` に既読の列が無い~~ → ✅ 2026-10-16 に実体（`chat_read_states`）ができたので外した
   *     （件数は実データがあるときだけ描く。上の ①）
   *   - `件数` … 他社の示唆になりうる（`F-038 AC-1` / `HANDOFF.md` §3.3）
   */
  const FORBIDDEN_WORDS = ['添付', '接続中', '件数'] as const;

  const SURFACES: readonly (readonly [string, () => string])[] = [
    ['ChatThreadList', () => renderThreadList()],
    ['ChatThreadList（空）', () => renderThreadList({ groups: [], nextCursor: null })],
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

describe('⑥: 日付の区切り（定義書 §3.12。2026-10-13 追加）', () => {
  it('JST の日付ごとに区切りが 1 つ出て、発言の前に来る', () => {
    const html = renderConversation();
    // 2 件とも JST 2026-09-30 の発言 → 区切りは 1 つだけ。
    expect([...html.matchAll(/data-testid="chat-day-separator-/g)]).toHaveLength(1);
    const separatorAt = html.indexOf('data-testid="chat-day-separator-2026-09-30"');
    const firstMessageAt = html.indexOf(`data-testid="chat-message-${MESSAGE_OWN.id}"`);
    expect(separatorAt).toBeGreaterThan(-1);
    expect(separatorAt).toBeLessThan(firstMessageAt);
  });

  it('日付が変わる位置に区切りが増える', () => {
    const nextDay: ChatMessageView = { ...MESSAGE_OTHER, id: '01930000-0000-7000-8000-0000000000d3', sentAt: '2026-10-01T03:00:00.000Z' };
    const html = renderConversation({ initialMessages: [MESSAGE_OWN, nextDay] });
    expect(html).toContain('data-testid="chat-day-separator-2026-09-30"');
    expect(html).toContain('data-testid="chat-day-separator-2026-10-01"');
  });

  it('🔴 円形（`rounded-full`）を使わない（§7.9: 円はアバターとカウンタのみ）', () => {
    const html = renderConversation();
    const separator = /<div[^>]*data-testid="chat-day-separator-[^"]*"[^>]*>(.*?)<\/div>/s.exec(html);
    expect(separator).not.toBeNull();
    expect((separator as RegExpExecArray)[1]).not.toContain('rounded-full');
  });

  it('日付はその日の発言の前だけに表示し、本文に重ねない', () => {
    const nextDay = { ...MESSAGE_OTHER, id: 'next-day', sentAt: '2026-10-01T03:00:00.000Z' };
    const html = renderConversation({ initialMessages: [MESSAGE_OWN, nextDay] });
    const groups = [...html.matchAll(/<li[^>]*data-chat-day="([^"]+)"[^>]*>(.*?)<\/ol><\/li>/gs)];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.[2]).toContain(`data-testid="chat-message-${MESSAGE_OWN.id}"`);
    expect(groups[0]?.[2]).not.toContain('chat-message-next-day');
    expect(groups[1]?.[2]).toContain('data-testid="chat-message-next-day"');
    for (const day of ['2026-09-30', '2026-10-01']) {
      // ✅ 2026-10-27: 日付は箱ではなく線と文字（吹き出しと見間違えない）。貼り付けない（本文に重ねない）。
      expect(classTokensOf(html, `chat-day-separator-${day}`)).not.toContain('sticky');
      expect(classTokensOf(html, `chat-day-separator-${day}`)).not.toContain('bg-bg-subtle');
    }
  });

  it('検索の操作は縮めず折り返さず、スマホのタップ高さを保つ', () => {
    const html = renderThreadList();
    expect(classTokensOf(html, 'chat-threads-q')).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
    expect(classTokensOf(html, 'chat-threads-search-submit')).toEqual(expect.arrayContaining(['min-h-11', 'shrink-0', 'whitespace-nowrap']));
  });

  it('発言が無ければ区切りも出ない', () => {
    const html = renderConversation({ initialMessages: [], initialNextCursor: null });
    expect(html).not.toContain('chat-day-separator-');
  });
});

describe('⑦: 並べ方の切り替え（2026-10-13、Lark 寄せ。lib/chat/layout.ts）', () => {
  it('会話型（企業スレッド）: 自分の発言は右に寄り、名前とアバターを出さない', () => {
    const html = renderConversation({ layout: 'chat' });
    const own = new RegExp(`<li[^>]*data-testid="chat-message-${MESSAGE_OWN.id}"[^>]*>(.*?)</li>`, 's').exec(html);
    expect(own).not.toBeNull();
    const ownLi = (own as RegExpExecArray)[0];
    expect(ownLi).toContain('items-end');
    expect(ownLi).toContain('data-layout="chat"');
    expect(ownLi).not.toContain(`data-testid="chat-message-sender-${MESSAGE_OWN.id}"`);
    // 🔴 読み上げには「自社」を残す（位置は目でしか分からない）。
    expect(ownLi).toContain(t('chat.message.own'));
  });

  it('会話型（企業スレッド）: 相手の発言は左のまま、名前を出す', () => {
    const html = renderConversation({ layout: 'chat' });
    expect(html).toContain(`data-testid="chat-message-sender-${MESSAGE_OTHER.id}"`);
    const other = new RegExp(`<li[^>]*data-testid="chat-message-${MESSAGE_OTHER.id}"[^>]*>`, 's').exec(html);
    expect((other as RegExpExecArray)[0]).not.toContain('items-end');
  });

  it('話題型（案件スレッド・既定）: 自分の発言も左で、名前を出す（従来どおり）', () => {
    for (const html of [renderConversation(), renderConversation({ layout: 'topic' })]) {
      expect(html).toContain(`data-testid="chat-message-sender-${MESSAGE_OWN.id}"`);
      expect(html).not.toContain('data-layout="chat"');
    }
  });

  it('page.tsx はスレッドの種類から並べ方を決めて渡す', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('layout={conversationLayoutFor(selected.kind)}');
  });
});

describe('⑧: 連続した発言のまとめ・時刻・見出し（2026-10-13、Lark 寄せ）', () => {
  const FOLLOW_UP: ChatMessageView = {
    ...MESSAGE_OTHER,
    id: '01930000-0000-7000-8000-0000000000d4',
    sentAt: '2026-09-30T02:03:00.000Z', // MESSAGE_OTHER の 3 分後、同じ人
  };

  it('同じ人の 5 分以内の続きは名前を出さず、アバターは出さない（幅は残す）', () => {
    const html = renderConversation({ initialMessages: [MESSAGE_OWN, MESSAGE_OTHER, FOLLOW_UP] });
    expect(html).toContain(`data-testid="chat-message-sender-${MESSAGE_OTHER.id}"`);
    expect(html).not.toContain(`data-testid="chat-message-sender-${FOLLOW_UP.id}"`);
    const li = new RegExp(`<li[^>]*data-testid="chat-message-${FOLLOW_UP.id}"[^>]*>(.*?)</li>`, 's').exec(html);
    expect((li as RegExpExecArray)[0]).toContain('data-continued="true"');
    // ✅ 2026-10-22: 見えないアバター（高さも取る）をやめ、幅だけの詰め物にした（続きの行を詰める）。
    expect((li as RegExpExecArray)[1]).toContain('w-9 shrink-0');
    expect((li as RegExpExecArray)[1]).not.toContain('app-header-avatar');
    // 🔴 読み上げでは誰の発言かを残す。
    expect((li as RegExpExecArray)[1]).toContain(`sr-only">${String(FOLLOW_UP.senderName)}`);
  });

  it('時刻は HH:MM だけを出し、日付つきの時刻は title に残す', () => {
    const html = renderConversation();
    // MESSAGE_OWN = 2026-09-30T01:00Z = JST 10:00
    expect(html).toMatch(/<time[^>]*title="2026-09-30 10:00 JST"[^>]*>10:00<\/time>/);
  });

  it('見出しに会話の相手を出し、名前が無ければ既定の見出しに戻す', () => {
    const titled = renderConversation({ title: { title: '金融系 Web API 改修', subtitle: '架空パートナー A' } });
    expect(titled).toContain('金融系 Web API 改修');
    expect(titled).toContain('data-testid="chat-conversation-subtitle"');
    const fallback = renderConversation({ title: { title: null, subtitle: null } });
    expect(fallback).toContain(t('chat.messages.heading'));
    expect(fallback).not.toContain('data-testid="chat-conversation-subtitle"');
  });
});

describe('⑨: 自分だけ右・同僚は左（2026-10-14、チャット担当の決定）', () => {
  const COLLEAGUE: ChatMessageView = {
    ...MESSAGE_OWN,
    id: '01930000-0000-7000-8000-0000000000d5',
    senderName: '佐々木 次郎',
    sentAt: '2026-09-30T03:00:00.000Z',
    mine: false, // 同じ会社（own）だが本人ではない
  };

  it('会話型: 同僚の発言は own でも左に置き、名前を出す', () => {
    const html = renderConversation({ layout: 'chat', initialMessages: [MESSAGE_OWN, COLLEAGUE] });
    const li = new RegExp(`<li[^>]*data-testid="chat-message-${COLLEAGUE.id}"[^>]*>`, 's').exec(html);
    expect((li as RegExpExecArray)[0]).toContain('data-own="true"');
    expect((li as RegExpExecArray)[0]).not.toContain('data-layout="chat"');
    expect(html).toContain(`data-testid="chat-message-sender-${COLLEAGUE.id}"`);
  });

  it('会話型: 本人の発言だけが右に寄る', () => {
    const html = renderConversation({ layout: 'chat', initialMessages: [MESSAGE_OWN, COLLEAGUE] });
    const own = new RegExp(`<li[^>]*data-testid="chat-message-${MESSAGE_OWN.id}"[^>]*>`, 's').exec(html);
    expect((own as RegExpExecArray)[0]).toContain('data-layout="chat"');
  });
});

describe('⑩: 会話を右に並べて開く（2026-10-14、チャットレーン）', () => {
  const OTHER_THREAD = '01930000-0000-7000-8000-0000000000c9';
  const LABEL = t('chat.pane.openBeside');

  /** testid で `<a>` を探し、href を URL として返す（属性の並び順に依らない）。 */
  function linkUrl(html: string, testId: string): URL | null {
    const tag = new RegExp(`<a [^>]*data-testid="${testId}"[^>]*>`).exec(html);
    if (tag === null) return null;
    const href = /href="([^"]*)"/.exec(tag[0]);
    return href === null ? null : new URL(href[1].replaceAll('&amp;', '&'), 'https://app.test');
  }

  it('会話を開いていれば、開いていない行にだけ「右に並べる」が出る（行き先は `pane` を足した URL）', () => {
    const html = renderThreadList({ openBesideLabel: LABEL });
    // 左端に開いている行（THREAD_PROJECT）には出さない。
    expect(html).not.toContain(`data-testid="chat-thread-open-beside-${THREAD_PROJECT}"`);
    const url = linkUrl(html, `chat-thread-open-beside-${THREAD_COMPANY}`);
    expect(url, '「右に並べる」が描かれていない').not.toBeNull();
    expect(url?.searchParams.get('thread')).toBe(THREAD_PROJECT);
    expect(url?.searchParams.getAll('pane')).toEqual([THREAD_COMPANY]);
  });

  it('🔴 何も開いていない・上限（3 列）に達した・語を渡さないときは描かない（押して何も起きない導線を置かない）', () => {
    expect(renderThreadList({ openBesideLabel: LABEL, selectedThreadId: null })).not.toContain(
      'chat-thread-open-beside-',
    );
    expect(
      renderThreadList({ openBesideLabel: LABEL, paneThreadIds: [OTHER_THREAD, '01930000-0000-7000-8000-0000000000ca'] }),
    ).not.toContain('chat-thread-open-beside-');
    expect(renderThreadList()).not.toContain('chat-thread-open-beside-');
  });

  it('行をクリックして選び直しても、右に並べた会話は残る', () => {
    const html = renderThreadList({ openBesideLabel: LABEL, paneThreadIds: [OTHER_THREAD] });
    const url = linkUrl(html, `chat-thread-link-${THREAD_COMPANY}`);
    expect(url?.searchParams.get('thread')).toBe(THREAD_COMPANY);
    expect(url?.searchParams.getAll('pane')).toEqual([OTHER_THREAD]);
  });

  it('「閉じる」は並べているときだけ描く', () => {
    expect(renderConversation()).not.toContain(`chat-pane-close-${THREAD_PROJECT}`);
    const html = renderConversation({ closeHref: `/chat?thread=${OTHER_THREAD}` });
    const url = linkUrl(html, `chat-pane-close-${THREAD_PROJECT}`);
    expect(url?.pathname).toBe('/chat');
    expect(url?.searchParams.get('thread')).toBe(OTHER_THREAD);
    expect(html).toContain(t('chat.pane.close'));
  });

  it('🔴 「閉じる」は `md` 未満で畳まれる（共通の語の `inline-block` に `hidden` を消されていない）', () => {
    const html = renderConversation({ closeHref: `/chat?thread=${OTHER_THREAD}` });
    const tokens = classTokensOf(html, `chat-pane-close-${THREAD_PROJECT}`);
    expect(tokens).toContain('hidden');
    expect(tokens).toContain('md:inline-block');
    expect(tokens).not.toContain('inline-block');
  });
});

describe('⑫: 会話の操作の改修（2026-10-14、チャットレーン）', () => {
  it('🔴 本文の URL は新しいタブで開くリンクにし、開いた先に画面を触らせない（noopener / noreferrer）', () => {
    const html = renderConversation({
      initialMessages: [{ ...MESSAGE_OTHER, body: '資料: https://example.com/doc?x=1 です' }],
    });
    const link = new RegExp(`<a [^>]*data-testid="chat-message-link-${MESSAGE_OTHER.id}"[^>]*>`).exec(html)?.[0] ?? '';
    expect(link).toContain('href="https://example.com/doc?x=1"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer nofollow"');
  });

  it('🔴 javascript: はリンクにしない', () => {
    const html = renderConversation({ initialMessages: [{ ...MESSAGE_OTHER, body: 'javascript:alert(1)' }] });
    expect(html).not.toContain(`chat-message-link-${MESSAGE_OTHER.id}`);
  });

  it('長い本文は畳み、「続きを読む」を出す（短い本文には出さない）', () => {
    const long = renderConversation({ initialMessages: [{ ...MESSAGE_OTHER, body: 'あ'.repeat(700) }] });
    expect(long).toContain(`data-testid="chat-message-expand-${MESSAGE_OTHER.id}"`);
    expect(long).toContain(t('chat.message.readMore'));
    expect(long).not.toContain('あ'.repeat(500));
    expect(renderConversation()).not.toContain('chat-message-expand-');
  });

  it('発言ごとにコピーを出す（本文が削除された発言には出さない）', () => {
    expect(renderConversation()).toContain(`data-testid="chat-message-copy-${MESSAGE_OTHER.id}"`);
    const purged = renderConversation({ initialMessages: [{ ...MESSAGE_OTHER, body: null }] });
    expect(purged).not.toContain('chat-message-copy-');
  });

  it('投稿できるときは定型文の選択欄を出す。残り文字数は空のうちは出さない', () => {
    const html = renderConversation();
    expect(html).toContain('data-testid="chat-compose-template"');
    expect(html).toContain(t('chat.compose.template.interview'));
    expect(html).not.toContain('chat-compose-remaining');
  });

  it('発言が無い会話では、投稿できる人には最初の一言を促す', () => {
    expect(renderConversation({ initialMessages: [], initialNextCursor: null })).toContain(t('chat.messages.first'));
    expect(renderConversation({ initialMessages: [], initialNextCursor: null, canPost: false })).toContain(
      t('chat.messages.empty'),
    );
  });
});

describe('⑪: 会社ごとの木・検索・並べ替え（2026-10-14、チャットレーン）', () => {
  const CHAT_A = '01930000-0000-7000-8000-0000000000e1';
  const TREE_ROWS: readonly ChatThreadListItem[] = [
    { id: CHAT_A, kind: 'COMPANY', project: null, counterpartyName: '架空パートナー A', lastMessageAt: '2026-09-29T00:00:00.000Z' },
    ...THREAD_ROWS,
  ];
  const groups = buildThreadTree(
    TREE_ROWS.map((item) => ({ groupKey: item.counterpartyName ?? item.id, item })),
    { sort: 'recent', q: null },
  );

  // ✅ 2026-10-19（v2・紺野「くっそ醜い」）: 字下げをやめ、1 行 = 1 会話。種類はアバターの形と色・小さな札で分ける。
  it('会社チャットと案件スレッドは字下げせず平らに並び、形と札で見分けられる', () => {
    const html = renderThreadList({ groups });
    expect(html).toContain(`chat-thread-row-${CHAT_A}`);
    expect(html).toContain(`chat-thread-row-${THREAD_PROJECT}`);
    expect(classTokensOf(html, `chat-thread-row-${THREAD_PROJECT}`)).not.toContain('pl-6');
    // ✅ 2026-10-29: 種類は色つきのアバター（案件 = 橙の「#」、会社 = 墨色の頭文字）で分ける。会社・案件の行に札を付けない。
    const projectRow = new RegExp(`<li data-testid="chat-thread-row-${THREAD_PROJECT}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
    const companyRow = new RegExp(`<li data-testid="chat-thread-row-${CHAT_A}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
    expect(projectRow).toContain('bg-warning');
    expect(projectRow).not.toContain('bg-neutral-bg');
    expect(projectRow).toContain('>#<');
    expect(companyRow).toContain('rounded-md bg-fg text-bg');
    expect(projectRow).not.toContain(t('chat.tag.external'));
    expect(companyRow).not.toContain(t('chat.tag.external'));
    // 「チャット / スレッド」の文字は出さない（見た目で分ける）。
    expect(html).not.toContain(`>${t('chat.thread.kind.COMPANY')}<`);
  });

  it('チャットがまだ無い会社のスレッドも、そのまま 1 行で出る（親の見出しを作らない）', () => {
    const html = renderThreadList({
      groups: buildThreadTree([{ groupKey: 'X', item: THREAD_ROWS[0] as ChatThreadListItem }], { sort: 'recent', q: null }),
    });
    expect(html).toContain(`chat-thread-row-${(THREAD_ROWS[0] as ChatThreadListItem).id}`);
    expect(html).not.toContain('chat-thread-group-header-');
  });

  it('検索は GET のフォームで、開いている会話（thread / pane）を引き継ぐ', () => {
    const html = renderThreadList({ groups, paneThreadIds: [CHAT_A], q: '架空', sort: 'company' });
    const form = /<form[^>]*data-testid="chat-threads-search"[^>]*>([\s\S]*?)<\/form>/.exec(html);
    expect(form?.[0]).toMatch(/method="get"/);
    expect(form?.[1]).toContain(`name="thread" value="${THREAD_PROJECT}"`);
    expect(form?.[1]).toContain(`name="pane" value="${CHAT_A}"`);
    expect(form?.[1]).toContain('value="架空"');
  });

  it('行のリンクは検索語と並べ方を保つ', () => {
    const html = renderThreadList({ groups, q: '架空', sort: 'company' });
    const tag = new RegExp(`<a [^>]*data-testid="chat-thread-link-${CHAT_A}"[^>]*>`).exec(html)?.[0] ?? '';
    const href = /href="([^"]*)"/.exec(tag)?.[1] ?? '';
    const url = new URL(href.replaceAll('&amp;', '&'), 'https://app.test');
    expect(url.searchParams.get('q')).toBe('架空');
    expect(url.searchParams.get('sort')).toBe('company');
  });

  it('検索して 0 件なら「該当なし」と「検索をやめる」（検索欄は残す）', () => {
    const html = renderThreadList({ groups: [], q: '該当なし' });
    expect(html).toContain('data-testid="chat-threads-search"');
    expect(html).toContain('data-testid="chat-threads-search-empty"');
    expect(html).toContain(t('chat.threads.search.clear'));
  });

  it('上限を超えたら「古いスレッドは表示していません」と書く（黙って落とさない）', () => {
    expect(renderThreadList({ groups, truncated: true })).toContain(t('chat.tree.truncated'));
    expect(renderThreadList({ groups })).not.toContain('chat-threads-truncated');
  });
});

describe('⑬: 返信が早い取引先（2026-10-14、チャットレーン）。要返信の印は 2026-10-22 に外した', () => {
  const groups = buildThreadTree(
    THREAD_ROWS.map((item) => ({ groupKey: item.counterpartyName ?? item.id, item })),
    { sort: 'recent', q: null, fastReplyKeys: new Set(['架空パートナー A']) },
  );

  it('✅ 2026-10-22（紺野）: 赤い「要返信」の札をどの行にも出さない', () => {
    const html = renderThreadList({ groups });
    expect(html).not.toContain('chat-thread-awaiting-');
    expect(html).not.toContain(t('chat.thread.awaitingReply'));
  });

  it('🔴 返信が早い会社にだけ良い印を付け、他の会社には何も出さない（遅いとは書かない）', () => {
    const html = renderThreadList({ groups });
    const fast = groups.find((group) => group.fastReply);
    const representative = (fast?.chat ?? fast?.threads[0])?.id ?? '';
    expect(html).toContain(`data-testid="chat-thread-fast-${representative}"`);
    expect(html.split(t('chat.tree.fastReply')).length - 1).toBe(1);
    expect(html).not.toMatch(/遅い|順位|ランキング/);
  });
});

describe('⑭: 本文の検索の結果（2026-10-14、チャットレーン）', () => {
  const groups = buildThreadTree(
    THREAD_ROWS.map((item) => ({ groupKey: item.counterpartyName ?? item.id, item })),
    { sort: 'recent', q: null },
  );
  const HIT = {
    threadId: THREAD_COMPANY,
    messageId: '01930000-0000-7000-8000-0000000000f9',
    sentAt: '2026-10-01T00:00:00.000Z',
    threadTitle: '架空パートナー B',
    snippet: '…面談の候補をお送りします…',
  };

  it('当たった発言を出し、押すとそのスレッドを開く', () => {
    const html = renderThreadList({ groups, q: '面談', messageHits: [HIT] });
    expect(html).toContain('data-testid="chat-threads-message-hits"');
    expect(html).toContain(HIT.snippet);
    const tag = new RegExp(`<a [^>]*data-testid="chat-threads-message-hit-${HIT.messageId}"[^>]*>`).exec(html)?.[0] ?? '';
    expect(tag).toContain(`thread=${THREAD_COMPANY}`);
  });

  it('会社名・案件名に当たらなくても、本文に当たれば「該当なし」にしない', () => {
    const html = renderThreadList({ groups: [], q: '面談', messageHits: [HIT] });
    expect(html).not.toContain('chat-threads-search-empty');
    expect(html).toContain('chat-threads-message-hits');
  });
});

describe('⑮: 既読・未読（2026-10-16、チャットレーン）', () => {
  it('既読位置の後ろの、相手の最初の発言の直前に「ここから未読」の線を引く', () => {
    const html = renderConversation({ initialMessages: [MESSAGE_OWN, MESSAGE_OTHER], lastReadMessageId: MESSAGE_OWN.id });
    expect(html).toContain('data-testid="chat-unread-marker"');
    expect(html.indexOf('chat-unread-marker')).toBeLessThan(html.indexOf(`chat-message-${MESSAGE_OTHER.id}`));
  });

  it('最後まで読んでいれば線を引かない', () => {
    const html = renderConversation({ initialMessages: [MESSAGE_OWN, MESSAGE_OTHER], lastReadMessageId: MESSAGE_OTHER.id });
    expect(html).not.toContain('chat-unread-marker');
  });

  it('相手の発言にだけ「ここから未読にする」を出す', () => {
    const html = renderConversation({ initialMessages: [MESSAGE_OWN, MESSAGE_OTHER] });
    expect(html).toContain(`data-testid="chat-message-mark-unread-${MESSAGE_OTHER.id}"`);
    expect(html).not.toContain(`chat-message-mark-unread-${MESSAGE_OWN.id}`);
  });
});

describe('⑯: リアクション（2026-10-16、チャットレーン）', () => {
  const WITH_REACTIONS = { ...MESSAGE_OTHER, reactions: [{ reaction: 'OK' as const, count: 2, mine: true }] };

  it('投稿できる人には押せるリアクションと「リアクション」の選択欄を出す（絵文字ではなく語）', () => {
    const html = renderConversation({ initialMessages: [WITH_REACTIONS] });
    const tag = new RegExp(`<button [^>]*data-testid="chat-message-reaction-${MESSAGE_OTHER.id}-OK"[^>]*>`).exec(html)?.[0] ?? '';
    expect(tag).toContain('aria-pressed="true"');
    expect(html).toContain(`${t('chat.reaction.OK')} 2`);
    expect(html).toContain(`data-testid="chat-message-reaction-add-${MESSAGE_OTHER.id}"`);
  });

  it('✅ 2026-10-22: 絵文字のリアクションは絵文字 + 件数で出し、読み上げ名を aria-label に持つ（閲覧専用も絵文字で出す）', () => {
    const withEmoji = { ...MESSAGE_OTHER, reactions: [{ reaction: 'THUMBS_UP' as const, count: 2, mine: true }] };
    const html = renderConversation({ initialMessages: [withEmoji] });
    const tag = new RegExp(`<button [^>]*data-testid="chat-message-reaction-${MESSAGE_OTHER.id}-THUMBS_UP"[^>]*>(.*?)</button>`, 's').exec(html);
    expect(tag?.[0] ?? '').toContain(`aria-label="${t('chat.reaction.THUMBS_UP')} 2"`);
    expect(tag?.[1] ?? '').toContain('👍 2');
    expect(renderConversation({ initialMessages: [withEmoji], canPost: false })).toContain('👍 2');
  });

  it('🔴 閲覧専用には件数を文字で出すだけ（押せないボタン・選択欄を描かない）', () => {
    const html = renderConversation({ initialMessages: [WITH_REACTIONS], canPost: false });
    expect(html).toMatch(new RegExp(`<span [^>]*data-testid="chat-message-reaction-${MESSAGE_OTHER.id}-OK"`));
    expect(html).not.toContain('chat-message-reaction-add-');
  });
});

describe('⑰: 自分の発言の編集・削除（2026-10-16、チャットレーン）', () => {
  it('投稿できる人の自分の発言にだけ「編集」「削除」を出す（相手の発言・閲覧専用には出さない）', () => {
    const html = renderConversation();
    expect(html).toContain(`data-testid="chat-message-edit-${MESSAGE_OWN.id}"`);
    expect(html).toContain(`data-testid="chat-message-delete-${MESSAGE_OWN.id}"`);
    expect(html).not.toContain(`chat-message-edit-${MESSAGE_OTHER.id}`);
    expect(renderConversation({ canPost: false })).not.toContain('chat-message-edit-');
  });

  it('編集済みの印と、本人が削除した発言の文言（保持期限の削除とは書き分ける）', () => {
    const html = renderConversation({
      initialMessages: [
        { ...MESSAGE_OTHER, edited: true },
        { ...MESSAGE_OWN, body: null, deleted: true },
      ],
    });
    expect(html).toContain(t('chat.message.edited'));
    expect(html).toContain(t('chat.message.deleted'));
    expect(html).not.toContain(`chat-message-edit-${MESSAGE_OWN.id}`);
  });
});

describe('⑱: ピン留め・ミュート（2026-10-16、チャットレーン）', () => {
  it('ピン留めした会話を一番上の「ピン留め」に出す（木にもそのまま残る）', () => {
    const html = renderThreadList({ pinnedIds: [THREAD_COMPANY] });
    expect(html).toContain('data-testid="chat-threads-pinned"');
    expect(html).toContain(`data-testid="chat-thread-pinned-${THREAD_COMPANY}"`);
    expect(html).toContain(`data-testid="chat-thread-row-${THREAD_COMPANY}"`);
    expect(renderThreadList()).not.toContain('chat-threads-pinned');
  });

  it('ミュートした会話は未読を強調しない（件数は無彩色・名前は太字にしない）', () => {
    // ✅ 2026-10-22（紺野「未読はアイコン横に赤丸」）: 未読はアバターの右上の赤丸。ミュート中は灰色。
    const muted = renderThreadList({ unreadCounts: { [THREAD_PROJECT]: 2 }, mutedIds: [THREAD_PROJECT] });
    expect(classTokensOf(muted, `chat-thread-unread-${THREAD_PROJECT}`)).toContain('bg-fg-muted');
    expect(classTokensOf(muted, `chat-thread-unread-${THREAD_PROJECT}`)).not.toContain('bg-danger');
    const loud = renderThreadList({ unreadCounts: { [THREAD_PROJECT]: 2 } });
    expect(classTokensOf(loud, `chat-thread-unread-${THREAD_PROJECT}`)).toContain('bg-danger');
  });
});

describe('⑲: 会話の書き出し（2026-10-16、チャットレーン）', () => {
  it('投稿できる人には「書き出す」を出し、閲覧専用には出さない（ダウンロード不可）', () => {
    expect(renderConversation()).toContain(`data-testid="chat-thread-export-${THREAD_PROJECT}"`);
    expect(renderConversation({ canPost: false })).not.toContain('chat-thread-export-');
  });
});

// ✅ 2026-10-26（Codex のレビュー・#162）: 🔴 画面に古いアナウンスを残さない。
//    状態の移り変わりは静的な描画では確かめられないので、作りの要（部屋ごとの作り直し・404 で消す・世代の番号）をソースで固定する。
describe('🔴 アナウンスの帯を古いまま残さない（2026-10-26）', () => {
  it('会話は部屋ごとに作り直す（前の部屋の帯を次の部屋に持ち越さない）', () => {
    const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/<ChatConversation\s+(?:\/\/[^\n]*\n\s*)*key=\{selected\.id\}/);
    expect(page).toMatch(/<ChatConversation\s+key=\{pane\.thread\.id\}/);
  });

  it('読み直しで 404 なら帯を消し、操作より前に始まった読み直しの応答は捨てる', () => {
    const source = readFileSync(new URL('./use-chat-messages.ts', import.meta.url), 'utf8');
    expect(source).toContain('next.status === 404');
    expect(source).toMatch(/if \(next\.status === 404\) \{\s*setAnnouncement\(null\)/);
    expect(source).toContain('announcementGeneration.current += 1');
    expect(source).toContain('generation !== announcementGeneration.current');
  });
});

// 並べた会話では PC でも操作を畳み、名前に幅を残す。
describe('並べた会話の見出しとスクロール', () => {
  it('並べたときの操作は md でも自動展開しない', () => {
    const html = renderConversation({ closeHref: '/chat' });
    expect(classTokensOf(html, `chat-header-actions-${THREAD_PROJECT}`)).not.toContain('md:flex');
    expect(classTokensOf(html, `chat-header-menu-${THREAD_PROJECT}`)).not.toContain('md:hidden');
    expect(classTokensOf(html, 'chat-messages-scroll')).toContain('overscroll-contain');
  });
});

describe('会話の幅の調節', () => {
  it('並べた会話にだけキーボード操作できる境目を描く', () => {
    const html = renderToStaticMarkup(<ChatResizablePane enabled storageKey="primary" resizeLabel={t('chat.pane.resize')} className="flex">{null}</ChatResizablePane>);
    expect(html).toContain('role="separator"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="320"');
    expect(html).toContain('aria-valuemax="1600"');
    expect(renderToStaticMarkup(<ChatResizablePane enabled={false} storageKey="primary" resizeLabel={t('chat.pane.resize')} className="flex">{null}</ChatResizablePane>)).not.toContain('role="separator"');
  });
});


describe('入力枠の操作（改訂 43）', () => {
  it('入力・下段の印・送信を同じ枠に収め、表示範囲の説明を枠の下に残す', () => {
    const html = renderConversation();
    const box = html.slice(html.indexOf('data-testid="chat-compose-box"'), html.indexOf(t('chat.compose.hint')));
    for (const id of ['body', 'format-toggle', 'mention', 'slash-toggle', 'template-toggle', 'submit']) {
      expect(box).toContain(`data-testid="chat-compose-${id}"`);
    }
    expect(classTokensOf(html, 'chat-compose-box')).toEqual(expect.arrayContaining(['focus-within:ring-2', 'focus-within:ring-brand']));
    expect(classTokensOf(html, 'chat-compose-body')).toContain('focus-visible:ring-0');
    expect(box).toContain('rows="1"');
    expect(box).not.toContain('data-testid="chat-compose-tab-write"');
    expect(box).toContain('h-11 w-11');
  });

  it('会話名があるときだけ、名前を含む入力案内を出す', () => {
    expect(renderConversation({ title: { title: '架空の会話', subtitle: null } })).toContain(
      `placeholder="架空の会話${t('chat.compose.placeholderSuffix')}"`,
    );
    expect(renderConversation()).toContain(`placeholder="${t('chat.compose.placeholder')}"`);
  });
});


describe('一覧の会社名と本文の抜粋', () => {
  it('会社名と抜粋が両方ある案件だけ区切りを出す', () => {
    const withoutSnippet = renderThreadList();
    expect(withoutSnippet).not.toContain(' ・ ');
    expect(withoutSnippet).toContain('架空パートナー A');
    const withSnippet = renderThreadList({ lastSnippets: { [THREAD_PROJECT]: '面談の候補日です' } });
    expect(withSnippet).toContain('架空パートナー A ・ 面談の候補日です');
  });

  it('会社の行は抜粋が無ければ空白で高さを足さず、名前を中央に置く', () => {
    const html = renderThreadList();
    expect(html).not.toContain(' ');
    expect(classTokensOf(html, `chat-thread-link-${THREAD_COMPANY}`)).toContain('items-center');
    const withSnippet = renderThreadList({ lastSnippets: { [THREAD_COMPANY]: '候補者をご紹介します' } });
    expect(withSnippet).toContain('候補者をご紹介します');
    expect(withSnippet).not.toContain(' ・ ');
    expect(html).toContain(`data-testid="chat-thread-counterparty-${THREAD_COMPANY}"`);
  });
});
