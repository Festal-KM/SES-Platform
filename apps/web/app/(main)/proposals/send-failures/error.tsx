'use client';

// apps/web/app/(main)/proposals/send-failures/error.tsx
// `S-022` の取得失敗（docs/04 §10.1 `S-022` Err「取得できませんでした」+ 再試行）。T-09-08。
//
// 🔴 `send-failures/` は子ルートを持たない葉のセグメントなので、境界はこの画面だけを包む
//    （`tests/static/route-boundaries.test.ts`。`projects/(list)` の教訓）。
// 🔴 **失敗の理由を画面に出さない**（docs/05 §15.2）。`error.message` には内部の情報が入りうる。
// 🔴 SP-22 段④: 色は §7.9 の semantic トークン（失敗は `--color-danger`）。幅は
//    `PageBody widthClass="split"`（🔴 **改訂 26（2026-10-03）で `S-022` はクラス B になった。**
//    `aside` は渡さない —— 失敗時に副カラムの中身が無いため。`projects/(list)/error.tsx` と同じ形）
//    であり、画面に `max-w-*` を書かない。
// 🔴 **`page.tsx` と同じクラスにする。** §7.1 は「どの画面も 1 つのクラスにしか属さない」であり、
//    境界（error / loading）だけ別のクラスだと、同じ `S-022` が読み込み中と表示中で本体幅が動く。
import { Button, PageBody } from '@ses/ui';
import { t } from '@ses/i18n';

export default function SendFailuresError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="py-6">
      <PageBody widthClass="split">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('sendFailures.title')}</h1>
        <p role="alert" className="mb-4 text-body font-semibold text-danger" data-testid="send-failure-error">
          {t('sendFailures.error.title')}
        </p>
        <Button type="button" onClick={() => reset()} data-testid="send-failure-retry">
          {t('sendFailures.error.retry')}
        </Button>
      </PageBody>
    </main>
  );
}
