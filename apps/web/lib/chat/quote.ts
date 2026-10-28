// apps/web/lib/chat/quote.ts
// ✅ 2026-10-27（紺野の決定「軽い版・DB を変えない」）: 発言を引用して返信する（`docs/02` F-038 改訂 13 ⑬ / AC-15）。
//
// 引用は**本文の頭に置く決まった形の文字列**で表す（表も列も足さない）:
//
//   > 引用 [名前](chat-message:<発言の UUID>)
//   > 引用した発言の冒頭（40 文字まで・1 行）
//
//   返信の本文
//
// 🔴 ここが守るもの
//   ① **送った時点の写し**（Slack と同じ）。元の発言を直しても消しても、引用の文字は変わらない。
//   ② **見出しの行は本文の 1 行目にあるときだけ**引用として読む。本文の途中や 2 行目以降に同じ形を書いても、
//      ただの引用（`>`）か文字のまま。返信の本文は空行の後ろに置くので、返信の本文で見出しを作れない。
//   ③ 名前と冒頭は 1 行に畳み、見出しの形を壊す記号（`[` `]` `(` `)`）を名前から外す（引用を偽の見出しに書き換えさせない）。
//   ④ 新しい読み取りの経路を作らない。冒頭は、読み手がいま同じ部屋で読めている発言から画面の中で写すだけで、
//      `chat-message:` の参照は**開いている部屋の中だけ**で探す（ほかの部屋を読みに行かない）。
//   ⑤ 純粋関数（I/O なし）。
//
// 🔴 見出しの語（`引用`）は保存される形式の一部であり、翻訳の対象ではない（変えると過去の発言が読めなくなる）。

/** 冒頭として写す文字数。 */
export const CHAT_QUOTE_SNIPPET_MAX = 40;

const QUOTE_WORD = '引用';
const QUOTE_SCHEME = 'chat-message:';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const HEADER = new RegExp(`^> ${QUOTE_WORD} \\[([^\\[\\]\\n]+)\\]\\(${QUOTE_SCHEME}(${UUID})\\)$`);
const QUOTE_LINE = /^>\s?(.*)$/;

/** 入力欄で選んでいる引用（送るまで手元に持つ）。 */
export type ChatQuoteDraft = {
  readonly messageId: string;
  readonly name: string;
  readonly snippet: string;
};

/** 本文から読み取った引用。 */
export type ChatQuote = {
  readonly messageId: string;
  readonly name: string;
  /** 写した冒頭（行ごと）。 */
  readonly lines: readonly string[];
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** 名前から見出しを壊す記号を外す（1 行に畳む）。空になったら `?`。 */
export function sanitizeQuoteName(name: string): string {
  const cleaned = oneLine(name.replace(/[[\]()]/g, ' '));
  return cleaned === '' ? '?' : cleaned;
}

/**
 * 引用する発言の本文から、写す冒頭を作る（1 行・40 文字まで。長ければ末尾に「…」）。
 * 🔴 引用の発言をさらに引用するときは、元の引用を外して**その人の書いた部分**だけを写す。
 */
export function chatQuoteSnippet(body: string): string {
  const own = splitChatQuote(body).rest;
  const text = oneLine(own);
  const chars = [...text];
  return chars.length > CHAT_QUOTE_SNIPPET_MAX ? `${chars.slice(0, CHAT_QUOTE_SNIPPET_MAX).join('')}…` : text;
}

/** 入力欄の引用を作る（発言の ID・送り手の名前・本文から）。 */
export function chatQuoteDraft(message: { readonly id: string; readonly senderName: string | null; readonly body: string }, unknownName: string): ChatQuoteDraft {
  return { messageId: message.id, name: sanitizeQuoteName(message.senderName ?? unknownName), snippet: chatQuoteSnippet(message.body) };
}

/** 本文の頭に付ける引用の文字列（末尾の空行まで）。 */
export function chatQuotePrefix(quote: ChatQuoteDraft): string {
  if (!new RegExp(`^${UUID}$`).test(quote.messageId)) throw new Error('quote target must be a message id');
  const header = `> ${QUOTE_WORD} [${sanitizeQuoteName(quote.name)}](${QUOTE_SCHEME}${quote.messageId})`;
  const snippet = oneLine(quote.snippet);
  return `${header}\n> ${snippet === '' ? '…' : snippet}\n\n`;
}

/** 送る本文（引用 + 返信）。返信は空行の後ろに置く（② 返信の本文で見出しを作れない）。 */
export function buildQuotedBody(quote: ChatQuoteDraft, reply: string): string {
  return `${chatQuotePrefix(quote)}${reply}`;
}

/**
 * 本文を「引用」と「残り（その人の書いた部分）」に分ける。
 * 🔴 見出しは 1 行目にあるときだけ。2 行目以降の `>` の行が写した冒頭で、空行か `>` で始まらない行で終わる。
 */
export function splitChatQuote(body: string): { readonly quote: ChatQuote | null; readonly rest: string } {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const header = HEADER.exec(lines[0] ?? '');
  if (header === null) return { quote: null, rest: body };
  const quoted: string[] = [];
  let index = 1;
  while (index < lines.length) {
    const match = QUOTE_LINE.exec(lines[index] as string);
    if (match === null) break;
    quoted.push(match[1] as string);
    index += 1;
  }
  while (index < lines.length && (lines[index] as string).trim() === '') index += 1;
  return {
    quote: { name: header[1] as string, messageId: header[2] as string, lines: quoted },
    rest: lines.slice(index).join('\n'),
  };
}

/** 一覧・アナウンス・保存済みの冒頭に使う本文（引用の見出しと写しを除いた、その人が書いた部分）。 */
export function chatOwnText(body: string): string {
  return splitChatQuote(body).rest;
}

/** 入力欄の文字数の上限から、引用の分を引いた残り（返信に書ける文字数）。 */
export function replyMaxLength(max: number, quote: ChatQuoteDraft | null): number {
  return quote === null ? max : Math.max(0, max - chatQuotePrefix(quote).length);
}

/** 入力欄の札の文字（`引用: 名前「冒頭」`）。前置きの語は呼び出し側が文言の集約先から渡す。 */
export function chatQuoteChipText(quote: ChatQuoteDraft, prefix: string): string {
  return `${prefix}${quote.name}「${quote.snippet}」`;
}
