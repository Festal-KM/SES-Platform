'use client';

// apps/web/app/(main)/proposals/(list)/error.tsx
// `S-019` の取得失敗（docs/04 §10.1「取得できませんでした」+ 再試行）。T-09-09。
//
// 🔴 ルートグループ `(list)` の葉に置く（`tests/static/route-boundaries.test.ts`）。
// 🔴 **失敗の理由を画面に出さない**（docs/05 §15.2）。`error.message` には内部の情報が入りうる。
// 🔴 T-22-06: 色は §7.9 の semantic トークン（失敗は `--color-danger`）。幅は
//    `PageBody widthClass="full"`（`S-019` はクラス A）であり、画面に `max-w-*` を書かない。
import { Button, PageBody } from '@ses/ui';
import { t } from '@ses/i18n';

export default function ProposalListError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="py-6">
      <PageBody widthClass="full">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('proposals.list.title')}</h1>
        <p role="alert" className="mb-4 text-body font-semibold text-danger" data-testid="proposal-list-error">
          {t('proposals.list.error.title')}
        </p>
        <Button type="button" onClick={() => reset()} data-testid="proposal-list-retry">
          {t('proposals.list.error.retry')}
        </Button>
      </PageBody>
    </main>
  );
}
