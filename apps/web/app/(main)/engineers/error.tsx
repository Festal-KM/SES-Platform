'use client';

// apps/web/app/(main)/engineers/error.tsx
// `S-005` の取得失敗（docs/04 §10.1 `S-005` Err「検索を実行できませんでした」+ 条件保持の再試行）。
// T-05-09。
//
// 🔴 **条件を保持したまま再試行する。** `reset()` は同じ URL（＝ 同じ `?cursor=` と、
//    T-06-04 以降は同じ検索条件）でセグメントを再描画する。ここでホームへ戻したり
//    URL を捨てたりしない —— 利用者が組み立てた条件が失われる。
// 🔴 **失敗の理由を画面に出さない**（docs/05 §15.2）。`error.message` には内部の情報が入りうる。
//    相関 ID（`x-request-id`）は API 応答のヘッダにあり、画面側は持たない。
import { t } from '@ses/i18n';

export default function EngineerLedgerError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('engineers.list.title')}</h1>
      <p role="alert" className="mb-1 text-sm font-semibold text-red-700" data-testid="engineer-list-error">
        {t('engineers.list.error.title')}
      </p>
      <p className="mb-4 text-sm text-slate-700">{t('engineers.list.error.lead')}</p>
      <button
        type="button"
        className="ses-submit w-auto px-4"
        onClick={() => reset()}
        data-testid="engineer-list-retry"
      >
        {t('engineers.list.error.retry')}
      </button>
    </main>
  );
}
