'use client';

// apps/web/app/(main)/projects/_search/use-element-width.ts
// 要素の**実幅**を測る（改修指示書 §2 / §3）。
//
// ============================================================================
// 🔴 なぜビューポート幅（`lg:` 等）では駄目なのか
// ============================================================================
// 指示書 §2: 「ブラウザー幅ではなく、**サイドバーと右サマリを除いた『検索エリア自身の幅』**を
//             基準にしてください。」
//
// `S-010` は `PageBody` の分割レイアウト（主カラム + 右サマリ）であり、**同じビューポート幅でも
// 検索エリアの実幅が変わる**（右サマリが並ぶか下に積むかが主カラムの min-content で決まる。
// `packages/ui` の `PageBodyAsideFrom` の 🔴）。したがってビューポートの接頭辞では
// 「960px 以上なら 4 列」を正しく表せない。
//
// 🔴 **Tailwind のブレークポイントを独自に増やしていない**（`CLAUDE.md` §13.3）。
//    列数は測った幅から**クラス定数を選ぶ**だけである（`FILTER_GRID_COLUMN_CLASSES`）。
// ⚠️ **サーバでは測れない。** 初期値は `null` で、呼び出し側が「まだ測っていない」を
//    既定の段（4 列）に倒す —— 測り終える前に 1 列で描くと、広い画面で一瞬 1 列になる。

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 要素の幅（px）。測るまでは `null`。
 *
 * 🔴 **`ResizeObserver` が無い環境では `null` のまま**（サーバ描画と同じ段に留まる）——
 *    測れないことを 0px として扱うと、1 列に落ちて見た目が崩れる。
 */
export function useElementWidth<T extends HTMLElement>(): readonly [RefObject<T | null>, number | null] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    // 🔴 初回は observer の発火を待たずに入れる（1 フレームぶんのちらつきを消す）。
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, width] as const;
}
