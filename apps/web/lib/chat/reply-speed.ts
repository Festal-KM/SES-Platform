// apps/web/lib/chat/reply-speed.ts
// ✅ 2026-10-14（チャットレーン）: `S-031` の「要返信の印」と「返信が早い取引先」（純粋関数）。
//
// 🔴 **ホストにだけ**使う（取引先には出さない —— 他社と比べた結果は他社の存在・件数の示唆になる）。
// 🔴 **良いところだけを出す**（紺野の決定）: 返信が早い上位だけに印を付け、遅いことは出さない・順位表を作らない。
// 🔴 使うのは発言の**時刻と送った側**だけ（本文を読まない）。入力は RLS（C6）を通って読めた行だけ。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない。

/** 発言 1 件（時刻と送った側だけ）。 */
export type ReplySample = {
  readonly threadId: string;
  /** まとめる鍵（スレッドの相手 = `chat_threads.partner_company_id`）。出力には載せない。 */
  readonly groupKey: string;
  /** 送ったのが取引先か（`messages.sender_partner_company_id IS NOT NULL`）。 */
  readonly fromPartner: boolean;
  readonly sentAt: Date;
};

/** 「返信が早い」と言うのに要る、1 社あたりの返信の数。 */
export const FAST_REPLY_MIN_SAMPLES = 3;
/** 比べる相手が少なすぎるときは印を付けない（1〜2 社で「上位」と言っても意味が無い）。 */
export const FAST_REPLY_MIN_COMPANIES = 3;
/** 上位の割合。 */
export const FAST_REPLY_TOP_RATIO = 0.1;
/** 見る期間（日）。 */
export const FAST_REPLY_WINDOW_DAYS = 90;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * 返信が早い取引先（の鍵）を返す。
 * - 返信の時間 = ホストの発言のあと、**取引先が最初に返すまで**の時間（同じスレッドの中）
 * - 取引先ごとの中央値で比べ、**速い順に上位 10%（最低 1 社）**だけを返す
 * - 返信の数が足りない取引先は比べない。比べられる取引先が 3 社未満なら誰にも付けない
 */
export function fastReplyGroupKeys(samples: readonly ReplySample[]): ReadonlySet<string> {
  const byThread = new Map<string, ReplySample[]>();
  for (const sample of samples) {
    const list = byThread.get(sample.threadId) ?? [];
    list.push(sample);
    byThread.set(sample.threadId, list);
  }
  const delays = new Map<string, number[]>();
  for (const list of byThread.values()) {
    list.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    let waitingSince: Date | null = null;
    for (const sample of list) {
      if (!sample.fromPartner) {
        // ホストの発言。まだ返事待ちでなければ、ここから待ち始める（連投は最初の発言から数える）。
        waitingSince ??= sample.sentAt;
        continue;
      }
      if (waitingSince !== null) {
        const bucket = delays.get(sample.groupKey) ?? [];
        bucket.push(sample.sentAt.getTime() - waitingSince.getTime());
        delays.set(sample.groupKey, bucket);
        waitingSince = null;
      }
    }
  }
  const eligible = [...delays.entries()]
    .filter(([, values]) => values.length >= FAST_REPLY_MIN_SAMPLES)
    .map(([key, values]) => ({ key, median: median(values) }));
  if (eligible.length < FAST_REPLY_MIN_COMPANIES) return new Set();
  eligible.sort((a, b) => a.median - b.median || (a.key < b.key ? -1 : 1));
  const count = Math.max(1, Math.floor(eligible.length * FAST_REPLY_TOP_RATIO));
  return new Set(eligible.slice(0, count).map((entry) => entry.key));
}

/**
 * 要返信か（**最後の発言が相手から**のスレッド）。
 * `lastFromCounterparty` は呼び出し側が「読み手の会社から見た相手か」で決める
 * （ホストなら取引先の発言、取引先ならホストの発言）。
 */
export function isAwaitingReply(last: { readonly fromCounterparty: boolean } | null): boolean {
  return last !== null && last.fromCounterparty;
}
