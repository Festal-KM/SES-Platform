'use client';

// apps/web/app/(main)/chat/error.tsx
// `S-031` の取得失敗（`docs/04` §10.1「取得できませんでした」+ 再試行）。
//
// 🔴 **失敗の理由を画面に出さない**（`docs/05` §15.2）。`error.message` には内部の情報が入りうる
//    （チャットでは本文・社名が混ざりうるため、ここは特に厳しく守る）。
import { Button, PageBody } from '@ses/ui';
import { t } from '@ses/i18n';

export default function ChatError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="py-6">
      <PageBody widthClass="split">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('chat.title')}</h1>
        <p role="alert" className="mb-4 text-body font-semibold text-danger" data-testid="chat-error">
          {t('chat.error.title')}
        </p>
        <Button type="button" onClick={() => reset()} data-testid="chat-retry">
          {t('chat.error.retry')}
        </Button>
      </PageBody>
    </main>
  );
}
