'use client';

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { CHAT_MESSAGE_PAGE_SIZE } from '@ses/config';
import { applyLatestMessages, CHAT_POLL_INTERVAL_MS, gapAnchor, hasGapBefore, hasOthersMessage, readGapAfter, type GapChunk } from '../../../lib/chat/live';
import { chatAnnouncementApiPath, chatMessagesApiPath } from '../../../lib/chat/screen-query';
import type { ChatAnnouncementView, ChatMessageView } from '../../../lib/chat/views';
import { createSubmitGuard } from '../../../lib/forms/submit-guard';

type MessagePageBody = { readonly items: readonly ChatMessageView[]; readonly nextCursor: string | null };

/** ✅ 2026-10-26（#166 の 4）: 取りこぼしを読み足すときの 1 回の件数と、読み足す回数の上限（無限に回さない）。 */
const GAP_PAGE_SIZE = 200;
const GAP_PAGES_MAX = 10;
type AnnouncementBody = { readonly announcement: ChatAnnouncementView | null };

type ChatMessagesOptions = {
  readonly threadId: string;
  readonly initialNextCursor: string | null;
  readonly itemsRef: RefObject<readonly ChatMessageView[]>;
  readonly awayRef: RefObject<boolean>;
  readonly scrollToLatestOnRender: RefObject<boolean>;
  readonly setItems: Dispatch<SetStateAction<readonly ChatMessageView[]>>;
  readonly setNewArrived: Dispatch<SetStateAction<boolean>>;
  readonly initialAnnouncement: ChatAnnouncementView | null;
  /**
   * ✅ 2026-10-26（#164 の 2 / #166 の 3）: 取得してよいか（実際に画面に見えていて、読めなくなっていない）。
   * 🔴 スマホで隠れている列・横スクロールの外の列は取りに行かない。
   */
  readonly active: boolean;
  /** ✅ 2026-10-26（#164 の 2）: 取得が 404（部屋から外れた・見えなくなった）だったときに呼ぶ。 */
  readonly onUnavailable: () => void;
};

// 発言とアナウンスの定期取得は、従来と同じタイマーと破棄条件を共有する。
export function useChatMessages({
  threadId, initialNextCursor, itemsRef, awayRef, scrollToLatestOnRender,
  setItems, setNewArrived, initialAnnouncement, active, onUnavailable,
}: ChatMessagesOptions) {
  // タイマーを張り直さずに最新の値を読むため（張り直すと 15 秒の間隔がずれる）。
  const activeRef = useRef(active);
  activeRef.current = active;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  /**
   * ✅ 2026-10-26（レビュー）: 読めなくなったら**その場で**止める（`active` は次の描画まで変わらないので、
   * その間に届いた応答が行を戻さないように）。一度止めたら戻さない。
   */
  const stoppedRef = useRef(false);
  const isLive = (): boolean => activeRef.current && !stoppedRef.current;
  function stop(): void {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    onUnavailableRef.current();
  }
  // ✅ 2026-10-26: アナウンス（帯）。🔴 手元で先に書き換えない（サーバの応答だけが正）。
  const [announcement, setAnnouncement] = useState<ChatAnnouncementView | null>(initialAnnouncement);
  /** ✅ 2026-10-26（Codex のレビュー）: アナウンスの操作の世代（古い読み直しの応答を捨てるため）。 */
  const announcementGeneration = useRef(0);
  const [announcementNotLoaded, setAnnouncementNotLoaded] = useState(false);
  const [announcementFailed, setAnnouncementFailed] = useState(false);
  const [olderGuard] = useState(() => createSubmitGuard<'LOADED' | 'FAILED'>());
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  // 新着を取りに行く。🔴 既存の API（#50）を呼ぶだけ（境界は API の RLS が決める）。画面が見えているときだけ。
  //    🔴 手元の行は置き換えない（過去を読み込んだ分・送った分を消さない）。
  useEffect(() => {
    let active = true;
    const poll = async (): Promise<void> => {
      if (document.visibilityState !== 'visible' || !isLive()) return;
      try {
        // ✅ 2026-10-26（Codex のレビュー）: アナウンスは発言の取得とは切り離して読み直す。
        //    🔴 404（部屋から外れた・見えなくなった）なら帯を消す —— 前に見えていた本文を画面に残さない。
        //    🔴 読み直しを始めた後に自分が設定・外した場合は、その古い応答を捨てる（世代の番号で見分ける）。
        const generation = announcementGeneration.current;
        void fetch(chatAnnouncementApiPath(threadId), { cache: 'no-store' })
          .then(async (next) => {
            if (!active || generation !== announcementGeneration.current) return;
            if (next.status === 404) {
              setAnnouncement(null);
              return;
            }
            if (next.ok) {
              const fresh = ((await next.json()) as AnnouncementBody).announcement;
              if (active && generation === announcementGeneration.current) setAnnouncement(fresh);
            }
          })
          .catch(() => undefined);
        const response = await fetch(chatMessagesApiPath(threadId), { cache: 'no-store' });
        if (!active || !isLive()) return;
        // ✅ 2026-10-26（#164 の 2）: 🔴 404 = 部屋から外れた・見えなくなった。手元の本文を残さない。
        if (response.status === 404) {
          stop();
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as MessagePageBody;
        // ✅ 2026-10-26（#166 の 4）: 直近のページが手元とつながっていなければ、手元の最後から後ろを読み足す。
        //    🔴 そのまま足すと会話の途中が黙って抜ける（過去の読み込みでも埋められない）。
        let latest = payload.items;
        // ✅ 2026-10-27（Codex レビュー 3 回目）: つながりの判定と読み足しの起点は、**取り直す前の**手元の行で決める
        //    （位置が動いた行〔検査が CLEAN になった添付〕を重なりの証拠にも起点にも使わない。`lib/chat/live.ts`）。
        const before = itemsRef.current;
        const anchor = gapAnchor(before, payload.items);
        if (anchor !== undefined && hasGapBefore(before, payload.items, CHAT_MESSAGE_PAGE_SIZE)) {
          let missing = false;
          const gap = await readGapAfter(
            anchor,
            async (after): Promise<GapChunk | null> => {
              const more = await fetch(
                `${chatMessagesApiPath(threadId)}?after=${encodeURIComponent(after)}&limit=${String(GAP_PAGE_SIZE)}`,
                { cache: 'no-store' },
              );
              if (more.status === 404) missing = true;
              // 読み足せなければ、今回は足さない（途中の抜けた状態を見せない）。次の回にやり直す。
              return more.ok ? ((await more.json()) as GapChunk) : null;
            },
            GAP_PAGES_MAX,
          );
          if (!active || !isLive()) return;
          if (missing) {
            stop();
            return;
          }
          if (gap === null) return;
          // 🔴 最新まで読み切れなければ、直近のページは足さない（間が永久に抜けるため）。次の回に続きを読む。
          latest = gap.complete ? [...gap.items, ...payload.items] : gap.items;
        }
        if (!isLive()) return;
        // ✅ 2026-10-16: 手元の発言のリアクションも取り直した値に揃える。
        // ✅ 2026-10-27: 🔴 当てる時点の手元に当てる（読み足しを待つ間に「以前のメッセージ」が読み込まれても落とさない）。
        //    新着の有無（知らせ・スクロール）は、いまの手元で見積もる。
        const preview = applyLatestMessages(itemsRef.current, latest);
        if (preview.added.length > 0) {
          if (awayRef.current) {
            if (hasOthersMessage(preview.added)) setNewArrived(true);
          } else {
            scrollToLatestOnRender.current = true;
          }
        }
        setItems((current) => applyLatestMessages(current, latest).items);
      } catch {
        // 取れなければ次の回に任せる（画面は再読込でも最新になる）。
      }
    };
    const timer = window.setInterval(() => void poll(), CHAT_POLL_INTERVAL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [threadId]);

  async function loadOlder(): Promise<void> {
    if (nextCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    const outcome = await olderGuard.run(async () => {
      try {
        const response = await fetch(
          `${chatMessagesApiPath(threadId)}?cursor=${encodeURIComponent(nextCursor)}`,
          {
            cache: 'no-store',
          },
        );
        if (response.status === 404) {
          stop();
          return 'LOADED' as const;
        }
        if (!response.ok) return 'FAILED' as const;
        const payload = (await response.json()) as MessagePageBody;
        if (!isLive()) return 'LOADED' as const;
        // 🔴 取得済みの**上**に足す（置き換えない）。同じ行が再び来たら 1 行に畳む。
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...payload.items.filter((item) => !seen.has(item.id)), ...current];
        });
        setNextCursor(payload.nextCursor);
        return 'LOADED' as const;
      } catch {
        return 'FAILED' as const;
      }
    });
    setLoadingOlder(false);
    if (outcome === 'FAILED') setOlderFailed(true);
  }
  /**
   * ✅ 2026-10-26（#166 の 8）: 指定の発言が読み込まれるまで、過去を続けて読む（古いアナウンスへ 1 操作で移る）。
   * 🔴 途中を飛ばさない（`cursor` で上へ続けて読む = 会話がつながったまま）。読む量に上限を置く（無限に回さない）。
   * 見つかれば true。
   */
  async function loadOlderUntil(messageId: string): Promise<boolean> {
    let cursor = nextCursor;
    let loaded: readonly ChatMessageView[] = itemsRef.current;
    for (let page = 0; page < GAP_PAGES_MAX; page += 1) {
      if (loaded.some((item) => item.id === messageId)) return true;
      if (cursor === null || !isLive()) return false;
      try {
        const response = await fetch(
          `${chatMessagesApiPath(threadId)}?cursor=${encodeURIComponent(cursor)}&limit=${String(GAP_PAGE_SIZE)}`,
          { cache: 'no-store' },
        );
        if (response.status === 404) {
          stop();
          return false;
        }
        if (!response.ok || !isLive()) return false;
        const payload = (await response.json()) as MessagePageBody;
        const seen = new Set(loaded.map((item) => item.id));
        loaded = [...payload.items.filter((item) => !seen.has(item.id)), ...loaded];
        setItems((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...payload.items.filter((item) => !known.has(item.id)), ...current];
        });
        cursor = payload.nextCursor;
        setNextCursor(payload.nextCursor);
      } catch {
        return false;
      }
    }
    return loaded.some((item) => item.id === messageId);
  }

  /** ✅ 2026-10-26: この発言をアナウンスにする（`PUT`）/ 外す（`DELETE`）。 */
  async function changeAnnouncement(method: 'PUT' | 'DELETE', messageId: string): Promise<void> {
    setAnnouncementFailed(false);
    // 🔴 これより前に始まった読み直しの応答は使わない（遅れて届いて、外した帯が戻るのを防ぐ）。
    announcementGeneration.current += 1;
    try {
      const response = await fetch(chatAnnouncementApiPath(threadId), {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
      if (!response.ok) {
        setAnnouncementFailed(true);
        return;
      }
      // 自分の操作の応答も、さらに後の操作があれば使わない。
      const settled = announcementGeneration.current;
      const result = ((await response.json()) as AnnouncementBody).announcement;
      if (settled === announcementGeneration.current) setAnnouncement(result);
      setAnnouncementNotLoaded(false);
    } catch {
      setAnnouncementFailed(true);
    }
  }

  return { stopMessages: () => { stoppedRef.current = true; }, nextCursor, loadingOlder, olderFailed, loadOlder, loadOlderUntil, announcement, setAnnouncement,
    announcementNotLoaded, setAnnouncementNotLoaded, announcementFailed, changeAnnouncement };
}
