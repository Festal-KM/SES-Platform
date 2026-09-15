'use client';

// apps/web/app/(main)/_shared/polling-refresher.tsx
// 🔴 一定間隔でサーバコンポーネントを読み直す小さな部品（`router.refresh()`）。T-08-07。
//
// 最初の利用者は `S-017`（提案依頼の一覧）のホスト視点である —— `docs/04` §S-017「応諾は取引先の操作で
// 即時に `ACCEPTED` になり、**ホスト側の一覧はポーリングで反映**（60 秒）」。
//
// 🔴 `window.location.reload()` にしない: 全再読込は行の選択状態と詳細パネルを毎分吹き飛ばす。
//    `router.refresh()` はサーバコンポーネントの出力だけを差し替え、クライアントの state を保つ。
// 🔴 画面本体（`'use client'` の `ProposalRequestScreen`）に `useRouter` を持ち込まない理由:
//    描画テスト（`renderToStaticMarkup`）は App Router の文脈を持たず、`useRouter()` は文脈外で例外になる。
//    ポーリングは画面の描画とは独立した関心なので、部品として切り出して**サーバコンポーネント（`page.tsx`）が置く**。
// 🔴 描画するものは無い（`null`）。文言も持たない。
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function PollingRefresher({ intervalMs }: { readonly intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return undefined;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
