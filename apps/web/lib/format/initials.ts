// apps/web/lib/format/initials.ts
// アバターのイニシャル（**1〜2 文字**）。`packages/ui` の `Avatar` は切り出しをしない ——
// 「山田太郎 → 山」の規則は言語と氏名の持ち方に依存するため、呼び出し側が決める。
//
// 🔴 **`T-22-05` が `app/(main)/_shell/main-shell.tsx` に置いた `accountInitials` の本体をここへ移した。**
//    `S-031`（チャット）の吹き出しは `'use client'` の島が**投稿の応答から新しい吹き出しを 1 つ足す**
//    ため、サーバ専用モジュール（`@ses/db` に辿るもの）に依存しない形が要る
//    （`tests/static/client-db-boundary.test.ts`。`lib/format/elapsed.ts` が
//    `lib/proposals/approval-rows.ts` から移ったのと同じ理由）。
// 🔴 **規則は 1 実装**（2 本になると、ヘッダのアバターとチャットのアバターが同じ氏名で別の文字を出す）。
//
// 🔴 純粋関数。現在時刻も `@ses/i18n` も読まない。

/**
 * 🔴 **日本語の氏名・商号は先頭 1 文字**（姓の 1 文字目）。**ASCII は語頭 2 文字**（`Yamada Taro` → `YT`）。
 * 🔴 **空文字を返さない**（円の中が空のアバターは「壊れている」に見える）。
 */
export function displayInitials(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '?';
  // 🔴 `[\x20-\x7E]` = 印字可能な ASCII（空白〜`~`）。全角の氏名はここに入らない。
  const asciiWords = trimmed.split(/\s+/).filter((word) => /^[\x20-\x7E]+$/.test(word));
  if (asciiWords.length >= 2) {
    return `${asciiWords[0]?.[0] ?? ''}${asciiWords[1]?.[0] ?? ''}`.toUpperCase();
  }
  if (asciiWords.length === 1 && asciiWords[0] === trimmed) {
    return trimmed.slice(0, 2).toUpperCase();
  }
  // 🔴 日本語（全角）は先頭 1 文字（2 文字にすると円の中で潰れる）。サロゲートペアを割らない。
  return [...trimmed][0] ?? '?';
}
