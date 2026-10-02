// apps/web/app/(main)/engineers/[id]/detail-section.tsx
// `S-006` のセクションの器（`<details open>`）。T-05-02 で `page.tsx` に置いていたものを、T-12-16 でセクション 4・5 を
// 別ファイル（`engineer-proposal-sections.tsx`）に描くために切り出した。**見た目は変えず、`?diff=` のアンカー用に `id` 属性（`#engineer-detail-snapshot-diff`）だけを足した。**
//
// 🔴 T2（モバイル閲覧可）。折りたためるだけで、既定で隠す項目は 1 つも無い（`CLAUDE.md` §13.3 / docs/04 §S-006）。
// 🔴 `'use client'` を付けない（状態もイベントハンドラも持たない器。付けると `S-006` が丸ごとクライアントバンドルへ移る）。
import type { ReactNode } from 'react';
import { Card } from '@ses/ui';

export function DetailSection({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    // 🔴 面（radius / 枠線 / 地）は `@ses/ui` の `Card` だけが持つ（画面で面を作らない。
    //    `tests/static/ui-shadow-and-size.test.ts`「画面が面のクラス定数を再実装していない」）。
    //    ⚠️ `Card` は `div` である（旧実装の `<section>` から要素名が変わる）。`id` は
    //       `?diff=` のアンカー（`#engineer-detail-snapshot-diff`）であり、`div` でも機能する。
    <Card id={`engineer-detail-${id}`} data-testid={`engineer-detail-${id}`}>
      <details open>
        <summary className="cursor-pointer px-4 py-3 text-lg font-semibold text-fg">
          {title}
        </summary>
        <div className="border-t border-border px-4 py-4">{children}</div>
      </details>
    </Card>
  );
}
