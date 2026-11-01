// apps/web/lib/chat/layout.ts
// `S-031` の会話の並べ方を、スレッドの種類から決める（2026-10-13、チャット担当の決定。Lark 寄せ）。
//
//   - ~~案件スレッド（`PROJECT`）… **話題型**。全員を左に寄せ、名前と時刻を毎回出す。~~
//     ✅ 2026-10-29（紺野「自分の発言はどの部屋でも右」）: 案件スレッドも**会話型**にした。会社グループを画面から
//     隠していく方針で、案件スレッドが主な部屋になるため、自分の発言の位置を部屋ごとに変えない。
//   - 企業スレッド（`COMPANY`）・DM・グループ … **会話型**。自分の発言を右、ほかの人（同僚を含む）の発言を名前つきで左に置く
//     （Lark / LINE と同じ）。自分の発言かどうかを位置だけで見分けられることを優先する。
//   🔴 `topic`（全員左寄せ）の描き方は、`layout` を渡さない呼び出し（部品の既定）のために残している。画面は常に `chat` を渡す。
//
// 🔴 スレッドの参加会社は常にホストと 1 パートナーの 2 社である（`chat_threads.partner_company_id`。
//    `schema.prisma` の 🔴「ホストと 1 パートナーの組み合わせに限る」）。左右の 2 方向で表しきれる。
// 🔴 純粋関数に閉じる（クライアントの島から呼ばれるため。`tests/static/client-db-boundary.test.ts`）。
import type { ChatThreadDetailView, ChatThreadKind } from './views';

/** 会話の並べ方。`topic` = 全員左寄せ（話題型）/ `chat` = 自分は右（会話型）。 */
export type ChatConversationLayout = 'topic' | 'chat';

export function conversationLayoutFor(kind: ChatThreadKind): ChatConversationLayout {
  // ✅ 2026-10-29: どの種類の部屋でも自分の発言は右（上の ✅）。種類は引数に残す（部屋ごとに分ける余地を残す）。
  void kind;
  return 'chat';
}

/** 会話の見出しに出す名前（Lark の会話ヘッダに当たる）。読めなければ `null`（画面が既定の見出しに戻す）。 */
export type ChatConversationTitle = {
  readonly title: string | null;
  readonly subtitle: string | null;
  /** ✅ 2026-10-19: DM の相手のひとこと状態（名前の横に出す）。DM 以外・状態が無ければ `null` / 省略。 */
  readonly status?: string | null;
};

/**
 * 会話の見出しを決める。
 *   - 案件スレッド … 見出し = 案件名、補足 = 相手の会社名
 *   - 企業スレッド … 見出し = 相手の会社名、補足なし
 * 🔴 **関連情報パネル（`ChatThreadPanel`）と一覧が既に出している名前だけを使う**。新しい情報を
 *    画面に増やさない（読み手に見えてよい範囲は `lib/chat/read.ts` と RLS が決めている）。
 */
export function conversationTitleFor(
  thread: Pick<ChatThreadDetailView, 'kind' | 'project' | 'counterpartyName'> & Partial<Pick<ChatThreadDetailView, 'members'>>,
): ChatConversationTitle {
  if (thread.kind === 'PROJECT') {
    return { title: thread.project?.name ?? thread.counterpartyName, subtitle: thread.project === null ? null : thread.counterpartyName };
  }
  if (thread.kind === 'DM') {
    // 🔴 右の欄（メンバー）に既に出ている相手の状態だけを使う（新しい情報を足さない）。
    const peer = thread.members?.find((member) => !member.self);
    return { title: thread.counterpartyName, subtitle: null, status: peer?.status ?? null };
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
