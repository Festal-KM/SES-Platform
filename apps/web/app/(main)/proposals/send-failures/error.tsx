'use client';

// apps/web/app/(main)/proposals/send-failures/error.tsx
// `S-022` の取得失敗（docs/04 §10.1 `S-022` Err「取得できませんでした」+ 再試行）。T-09-08。
//
// 🔴 `send-failures/` は子ルートを持たない葉のセグメントなので、境界はこの画面だけを包む
//    （`tests/static/route-boundaries.test.ts`。`projects/(list)` の教訓）。
// 🔴 **失敗の理由を画面に出さない**（docs/05 §15.2）。`error.message` には内部の情報が入りうる。
import { Button } from '@ses/ui';
import { t } from '@ses/i18n';

export default function SendFailuresError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('sendFailures.title')}</h1>
      <p role="alert" className="mb-4 text-sm font-semibold text-red-700" data-testid="send-failure-error">
        {t('sendFailures.error.title')}
      </p>
      <Button type="button" onClick={() => reset()} data-testid="send-failure-retry">
        {t('sendFailures.error.retry')}
      </Button>
    </main>
  );
}
