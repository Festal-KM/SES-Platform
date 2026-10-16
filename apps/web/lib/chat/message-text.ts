// apps/web/lib/chat/message-text.ts
// ✅ 2026-10-14（チャットレーン）: `S-031` の本文の見せ方と入力欄の補助（純粋関数）。
//
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない（クライアントの島からも呼べる）。

/** 本文の 1 片。`url` は押せるリンクにする。 */
export type MessageSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'url'; readonly value: string };

/** `http://` / `https://` で始まる語（空白・全角の区切りまで）。 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`、。「」『』（）【】]+/g;
/** URL の末尾に付きがちな句読点・閉じ括弧（リンクに含めない）。 */
const TRAILING = /[.,;:!?)\]}]+$/;

/**
 * 本文を「文字」と「URL」に分ける。
 * 🔴 **`http` / `https` だけ**をリンクにする（`javascript:` などは文字のまま）。
 * 🔴 リンク先を取りに行かない（プレビューを作らない）—— 外部に問い合わせると、誰がどのリンクを
 *    開こうとしているかが外へ出る。
 */
export function splitMessageText(text: string): readonly MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    let url = match[0];
    const trailing = TRAILING.exec(url);
    if (trailing !== null) url = url.slice(0, url.length - trailing[0].length);
    if (url.length <= 'https://'.length) continue;
    if (start > last) segments.push({ kind: 'text', value: text.slice(last, start) });
    segments.push({ kind: 'url', value: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });
  return segments;
}

/** 長い本文を畳む閾値（文字数・行数）。 */
export const MESSAGE_COLLAPSE_CHARS = 600;
export const MESSAGE_COLLAPSE_LINES = 12;
/** 畳んだときに見せる長さ。 */
const COLLAPSED_CHARS = 400;
const COLLAPSED_LINES = 8;

/** 畳むべき長さか。 */
export function isLongMessage(text: string): boolean {
  return text.length > MESSAGE_COLLAPSE_CHARS || text.split('\n').length > MESSAGE_COLLAPSE_LINES;
}

/** 畳んだときに見せる先頭（行数と文字数の両方で切る。末尾に「…」）。 */
export function collapsedMessageText(text: string): string {
  const byLines = text.split('\n').slice(0, COLLAPSED_LINES).join('\n');
  const head = byLines.length > COLLAPSED_CHARS ? byLines.slice(0, COLLAPSED_CHARS) : byLines;
  return `${head.trimEnd()}…`;
}

/** 残り文字数を出し始める閾値。 */
export const REMAINING_CHARS_WARN_AT = 200;

/** 残り文字数（閾値より多く残っていれば `null` = 出さない）。 */
export function remainingChars(body: string, max: number): number | null {
  const remaining = max - body.length;
  return remaining <= REMAINING_CHARS_WARN_AT ? Math.max(remaining, 0) : null;
}

/**
 * 下書きの保存先の鍵。
 * 🔴 保存先は **`sessionStorage`**（タブを閉じたら消える）。下書きには取引先とのやり取りの本文が入るので、
 *    共有の PC に残り続けないようにする。
 */
export function chatDraftKey(threadId: string): string {
  return `ses.chat.draft.${threadId}`;
}

/** 会話の一番下から、どれだけ上にいるか（px）。これを超えたら「最新へ」を出す。 */
export const SCROLL_TO_LATEST_THRESHOLD_PX = 240;

/** 「最新へ」を出すべきか。 */
export function isAwayFromLatest(scroll: { readonly scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number }): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > SCROLL_TO_LATEST_THRESHOLD_PX;
}
