// apps/web/lib/chat/toast.ts
// ✅ 2026-10-20（紺野「トースト」）: チャットの操作の結果を、画面の右下のトースト（`@ses/ui/client` の `Toast`）で知らせる。
//
// 🔴 `Toast` の決まり（`packages/ui/src/components/toast.tsx`）に従う:
//   - **行き先のリンクが必須**（トーストだけで完了を伝えない。押せば対象に行ける）
//   - **エラーに使わない**（失敗は押した場所に一言出す。消えると原因が読めない）
//   - **自動で消さない**（閉じるのは利用者）
// 🔴 画面をまたいで出したいことがある（グループを作って、そのグループへ移った先で出す）ので、
//    `sessionStorage` に 1 件だけ置き、同じ画面ではイベントで知らせる。タブを閉じれば消える。
// 🔴 純粋な関数とブラウザの API だけ（`@ses/db` / `@ses/i18n` に依存しない。島から読む）。

/** トースト 1 件（文言は呼び出し側が `packages/i18n` から渡す）。 */
export type ChatToastPayload = {
  readonly message: string;
  readonly href: string;
  readonly linkLabel: string;
};

export const CHAT_TOAST_STORAGE_KEY = 'ses.chat.toast';
export const CHAT_TOAST_EVENT = 'ses:chat-toast';

/** 形を検める（壊れた値・他の値は `null`）。 */
export function parseChatToast(raw: string | null): ChatToastPayload | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<ChatToastPayload>;
    if (typeof value.message !== 'string' || typeof value.href !== 'string' || typeof value.linkLabel !== 'string') return null;
    // 🔴 行き先はチャットの中だけ（外のサイトへ飛ばすリンクにしない）。
    if (!value.href.startsWith('/chat')) return null;
    return { message: value.message, href: value.href, linkLabel: value.linkLabel };
  } catch {
    return null;
  }
}

/** トーストを出す（同じ画面ならすぐ、移った先なら着いた時に）。 */
export function showChatToast(payload: ChatToastPayload): void {
  try {
    window.sessionStorage.setItem(CHAT_TOAST_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 保存できない（プライベートモードなど）ときは同じ画面だけで出す。
  }
  window.dispatchEvent(new CustomEvent(CHAT_TOAST_EVENT, { detail: payload }));
}
