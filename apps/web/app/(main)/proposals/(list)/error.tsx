'use client';

// apps/web/app/(main)/proposals/(list)/error.tsx
// `S-019` の取得失敗（docs/04 §10.1「取得できませんでした」+ 再試行）。T-09-09。
//
// 🔴 ルートグループ `(list)` の葉に置く（`tests/static/route-boundaries.test.ts`）。
// 🔴 **失敗の理由を画面に出さない**（docs/05 §15.2）。`error.message` には内部の情報が入りうる。
import { Button } from '@ses/ui';
import { t } from '@ses/i18n';

export default function ProposalListError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('proposals.list.title')}</h1>
      <p role="alert" className="mb-4 text-sm font-semibold text-red-700" data-testid="proposal-list-error">
        {t('proposals.list.error.title')}
      </p>
      <Button type="button" onClick={() => reset()} data-testid="proposal-list-retry">
        {t('proposals.list.error.retry')}
      </Button>
    </main>
  );
}
