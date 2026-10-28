// packages/ui/src/lib/chat-composer-classes.ts
// ✅ 2026-10-27（紺野「視認性が死んだ」）: チャットの入力欄の枠（`S-031` だけで使う）。
// 状態のバリアント（`focus-within:` / `focus-visible:`）は `apps/web/app` に書けない（`tests/static/ui-state-in-primitives.test.ts`）ため、ここに置く。

/** 入力中の枠は、入力欄と操作の段をまとめた外側の 1 つに出す（入力欄だけを囲むと、操作の段が別の箱に見えていた）。 */
export const CHAT_COMPOSER_FOCUS_CLASSES = 'focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2';
/** 外枠で位置を示すため、内側の入力欄にはリングを重ねない。 */
export const CHAT_COMPOSER_INPUT_FOCUS_CLASSES = 'focus-visible:ring-0 focus-visible:ring-offset-0';
