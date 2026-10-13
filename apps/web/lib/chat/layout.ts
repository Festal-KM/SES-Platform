// apps/web/lib/chat/layout.ts
// `S-031` の会話の並べ方を、スレッドの種類から決める（2026-10-13、チャット担当の決定。Lark 寄せ）。
//
//   - 案件スレッド（`PROJECT`）… **話題型**。全員を左に寄せ、名前と時刻を毎回出す。
//     特定の案件について話題が続く場であり、「誰が何を言ったか」を順に追えることを優先する。
//   - 企業スレッド（`COMPANY`）… **会話型**。自分の発言を右、相手の発言を左に置く（Lark / LINE と同じ）。
//     ふだんの連絡の場であり、自分の発言かどうかを位置だけで見分けられることを優先する。
//
// 🔴 スレッドの参加会社は常にホストと 1 パートナーの 2 社である（`chat_threads.partner_company_id`。
//    `schema.prisma` の 🔴「ホストと 1 パートナーの組み合わせに限る」）。左右の 2 方向で表しきれる。
// 🔴 純粋関数に閉じる（クライアントの島から呼ばれるため。`tests/static/client-db-boundary.test.ts`）。
import type { ChatThreadDetailView, ChatThreadKind } from './views';

/** 会話の並べ方。`topic` = 全員左寄せ（話題型）/ `chat` = 自分は右（会話型）。 */
export type ChatConversationLayout = 'topic' | 'chat';

export function conversationLayoutFor(kind: ChatThreadKind): ChatConversationLayout {
  return kind === 'PROJECT' ? 'topic' : 'chat';
}

/** 会話の見出しに出す名前（Lark の会話ヘッダに当たる）。読めなければ `null`（画面が既定の見出しに戻す）。 */
export type ChatConversationTitle = { readonly title: string | null; readonly subtitle: string | null };

/**
 * 会話の見出しを決める。
 *   - 案件スレッド … 見出し = 案件名、補足 = 相手の会社名
 *   - 企業スレッド … 見出し = 相手の会社名、補足なし
 * 🔴 **関連情報パネル（`ChatThreadPanel`）と一覧が既に出している名前だけを使う**。新しい情報を
 *    画面に増やさない（読み手に見えてよい範囲は `lib/chat/read.ts` と RLS が決めている）。
 */
export function conversationTitleFor(
  thread: Pick<ChatThreadDetailView, 'kind' | 'project' | 'counterpartyName'>,
): ChatConversationTitle {
  if (thread.kind === 'PROJECT') {
    return { title: thread.project?.name ?? thread.counterpartyName, subtitle: thread.project === null ? null : thread.counterpartyName };
  }
  return { title: thread.counterpartyName, subtitle: null };
}

/**
 * 入力欄で押されたキーが「送信」か（Enter で送信、Shift+Enter で改行）。
 * 🔴 **日本語入力の変換確定の Enter では送らない**（`isComposing`）。これを見ないと、
 *    漢字変換を確定した瞬間に書きかけの文が相手に届く。
 * 🔴 Safari は確定の Enter で `isComposing` が `false` になることがあり、代わりに
 *    `keyCode` が 229（IME 処理中）で来る。両方を見る。
 */
export function isSendKey(event: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode?: number;
}): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  return event.key === 'Enter' && !event.shiftKey;
}
