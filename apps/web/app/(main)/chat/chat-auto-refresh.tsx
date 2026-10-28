'use client';
// apps/web/app/(main)/chat/chat-auto-refresh.tsx
// ✅ 2026-10-26（#164 の 3）: 一覧・左の列・右の欄（サーバで描いている部分）を定期的に描き直す。
//
// 🔴 なぜ要るか: 会話の本文は 15 秒ごとに取り直しているが、一覧・右の欄は開いた時点のままだった。
//    別の画面で案件の公開を取り消した・部屋から外された後も、案件名・部屋の名前・メンバーが残っていた。
//    描き直せば、読めなくなったものは RLS がサーバで落とす（画面で足し引きしない）。
// 🔴 画面が見えているときだけ（裏のタブでは回さない）。会話の島の状態（入力中の文章など）は描き直しでは消えない。
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 描き直しの間隔。会話の新着（15 秒）より長くする（一覧は本文ほど急がない・サーバの負荷を抑える）。 */
export const CHAT_SCREEN_REFRESH_MS = 60_000;

export function ChatAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(refresh, CHAT_SCREEN_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  return null;
}
