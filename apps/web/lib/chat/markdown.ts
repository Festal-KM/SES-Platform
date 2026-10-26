// apps/web/lib/chat/markdown.ts
// ✅ 2026-10-22（紺野「こういうチャット枠が必要だよね」= GitHub のコメント欄）: 発言の書式（Markdown の一部）。
//
// 🔴 ここが守るもの
//   ① **HTML を通さない。** 文字列を「段落・箇条書き・番号つき・引用・コードの塊」と「太字・斜体・コード・リンク・@名前」に
//      分けるだけで、画面は React の要素として組む（`dangerouslySetInnerHTML` を使わない）。`<script>` と書いても文字のまま。
//   ② **リンクは http / https だけ。** `[文字](javascript:…)` はリンクにしない（文字のまま出す）。
//   ③ **部品を外から足さない**（依存の追加は人間の承認事項）。対応する書き方は書式ボタンが入れるものだけに絞る。
//   ④ 純粋関数（I/O なし）。入力欄の書式ボタンも、ここの `applyChatFormat` で文字列を組む。
import { splitMessageText } from './message-text';

export type ChatInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bold'; readonly children: readonly ChatInline[] }
  | { readonly kind: 'italic'; readonly children: readonly ChatInline[] }
  | { readonly kind: 'code'; readonly value: string }
  | { readonly kind: 'link'; readonly href: string; readonly label: string }
  | { readonly kind: 'mention'; readonly name: string };

export type ChatBlock =
  | { readonly kind: 'paragraph'; readonly lines: readonly (readonly ChatInline[])[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly (readonly ChatInline[])[] }
  | { readonly kind: 'quote'; readonly lines: readonly (readonly ChatInline[])[] }
  | { readonly kind: 'code'; readonly value: string };

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/;
const BULLET = /^\s*[-*・]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```/;

/** 本文を塊に分ける。 */
export function parseChatMarkdown(text: string, mentionNames: readonly string[] = []): readonly ChatBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ChatBlock[] = [];
  const inline = (line: string) => parseChatInline(line, mentionNames);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    if (FENCE.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1; // 閉じの ``` を飛ばす（無ければ末尾まで）
      blocks.push({ kind: 'code', value: body.join('\n') });
      continue;
    }
    const listKind = BULLET.test(line) ? 'bullet' : ORDERED.test(line) ? 'ordered' : null;
    if (listKind !== null) {
      const pattern = listKind === 'bullet' ? BULLET : ORDERED;
      const items: (readonly ChatInline[])[] = [];
      while (index < lines.length && pattern.test(lines[index] as string)) {
        items.push(inline((pattern.exec(lines[index] as string) as RegExpExecArray)[1] as string));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: listKind === 'ordered', items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: (readonly ChatInline[])[] = [];
      while (index < lines.length && QUOTE.test(lines[index] as string)) {
        quoted.push(inline((QUOTE.exec(lines[index] as string) as RegExpExecArray)[1] as string));
        index += 1;
      }
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }
    // 段落: 空行・ほかの塊の始まりまで（改行はそのまま残す）。
    // 空行は塊の区切り（画面は塊の間に余白を置く）。
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const paragraph: (readonly ChatInline[])[] = [];
    while (index < lines.length) {
      const current = lines[index] as string;
      if (current.trim() === '') break;
      if (paragraph.length > 0 && (FENCE.test(current) || BULLET.test(current) || ORDERED.test(current) || QUOTE.test(current))) break;
      paragraph.push(inline(current));
      index += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

/**
 * 1 行の中の書式。対応: `` `コード` `` / `**太字**` / `*斜体*`・`_斜体_` / `[文字](https://…)` / 裸の URL / `@名前`（部屋の人の名前だけ）。
 */
export function parseChatInline(line: string, mentionNames: readonly string[] = []): readonly ChatInline[] {
  const out: ChatInline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer === '') return;
    // 裸の URL はここでリンクにする（既存の切り出しと同じ規則）。
    for (const segment of splitMessageText(buffer)) {
      out.push(segment.kind === 'url' ? { kind: 'link', href: segment.value, label: segment.value } : { kind: 'text', value: segment.value });
    }
    buffer = '';
  };
  // 長い名前を先に当てる（「見本 太郎」と「見本」の両方がいるとき）。
  const names = [...mentionNames].filter((name) => name !== '').sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    // コード
    const code = /^`([^`]+)`/.exec(rest);
    if (code !== null) {
      flush();
      out.push({ kind: 'code', value: code[1] as string });
      i += code[0].length;
      continue;
    }
    // 太字
    const bold = /^\*\*(.+?)\*\*/.exec(rest);
    if (bold !== null) {
      flush();
      out.push({ kind: 'bold', children: parseChatInline(bold[1] as string, mentionNames) });
      i += bold[0].length;
      continue;
    }
    // 斜体（単語の途中の `_` は斜体にしない: snake_case を壊さない）
    const italic = /^(\*|_)([^*_\s][^*_]*?)\1/.exec(rest);
    const prev = i === 0 ? ' ' : (line[i - 1] as string);
    if (italic !== null && (italic[1] === '*' || !/\w/.test(prev))) {
      flush();
      out.push({ kind: 'italic', children: parseChatInline(italic[2] as string, mentionNames) });
      i += italic[0].length;
      continue;
    }
    // リンク（http / https だけ）
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link !== null && SAFE_URL.test(link[2] as string)) {
      flush();
      out.push({ kind: 'link', href: link[2] as string, label: link[1] as string });
      i += link[0].length;
      continue;
    }
    // @名前（部屋の人の名前と一致するときだけ）
    if (rest.startsWith('@')) {
      const name = names.find((candidate) => rest.startsWith(`@${candidate}`));
      if (name !== undefined) {
        flush();
        out.push({ kind: 'mention', name });
        i += name.length + 1;
        continue;
      }
    }
    buffer += line[i];
    i += 1;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// 入力欄の書式ボタン
// ---------------------------------------------------------------------------

export const CHAT_FORMATS = ['bold', 'italic', 'code', 'link', 'bullet', 'ordered', 'quote'] as const;
export type ChatFormat = (typeof CHAT_FORMATS)[number];

export type ChatEdit = { readonly text: string; readonly selectionStart: number; readonly selectionEnd: number };

const WRAP: Partial<Record<ChatFormat, readonly [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  code: ['`', '`'],
};

/**
 * 選んだ範囲に書式を付ける（GitHub のコメント欄と同じ振る舞い）。
 *  - 太字・斜体・コード: 選んだ文字を記号で挟む。何も選んでいなければ記号の間にカーソルを置く
 *  - リンク: `[選んだ文字](https://)` にして、URL の部分を選んだ状態にする
 *  - 箇条書き・番号つき・引用: 選んだ行の頭に記号を付ける
 */
export function applyChatFormat(text: string, selectionStart: number, selectionEnd: number, format: ChatFormat): ChatEdit {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const selected = text.slice(start, end);
  const wrap = WRAP[format];
  if (wrap !== undefined) {
    const [open, close] = wrap;
    const next = text.slice(0, start) + open + selected + close + text.slice(end);
    return { text: next, selectionStart: start + open.length, selectionEnd: start + open.length + selected.length };
  }
  if (format === 'link') {
    const label = selected;
    const url = 'https://';
    const inserted = `[${label}](${url})`;
    const next = text.slice(0, start) + inserted + text.slice(end);
    const urlStart = start + label.length + 3;
    return label === ''
      ? { text: next, selectionStart: start + 1, selectionEnd: start + 1 }
      : { text: next, selectionStart: urlStart, selectionEnd: urlStart + url.length };
  }
  // 行の頭に付ける書式
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = text.indexOf('\n', end);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const block = text.slice(lineStart, lineEnd);
  const prefixed = block
    .split('\n')
    .map((line, n) => (format === 'bullet' ? `- ${line}` : format === 'ordered' ? `${String(n + 1)}. ${line}` : `> ${line}`))
    .join('\n');
  const next = text.slice(0, lineStart) + prefixed + text.slice(lineEnd);
  return { text: next, selectionStart: lineStart + prefixed.length, selectionEnd: lineStart + prefixed.length };
}

/** カーソルの位置に `@名前 ` を入れる。 */
export function insertChatMention(text: string, selectionStart: number, selectionEnd: number, name: string): ChatEdit {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const before = text.slice(0, start);
  const lead = before === '' || /\s$/.test(before) ? '' : ' ';
  const inserted = `${lead}@${name} `;
  const next = before + inserted + text.slice(end);
  const caret = start + inserted.length;
  return { text: next, selectionStart: caret, selectionEnd: caret };
}
