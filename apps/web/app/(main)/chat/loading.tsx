// apps/web/app/(main)/chat/loading.tsx
// `S-031` のローディング（`docs/04` §10.4 `S-031`「スレッド一覧の骨格」「一覧を先に、メッセージは後」）。
//
// 🔴 **件数を書かない**（0 件と読み違えられる。`S-019` / `S-022` の loading と同じ判断）。
// 🔴 `/chat` に子ルートを持たせていないので、この位置に置いても他画面を包まない
//    （`tests/static/route-boundaries.test.ts`。スレッドの選択は `?thread=` であり `[id]` ではない）。
import { t } from '@ses/i18n';
import { PageBody, Skeleton } from '@ses/ui';

const SKELETON_ROWS = 6;

export default function ChatLoading() {
  return (
    <main className="py-6" aria-busy="true">
      <PageBody widthClass="split">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('chat.title')}</h1>
        <p role="status" className="mb-4 text-body text-fg-muted" data-testid="chat-loading">
          {t('chat.loading')}
        </p>
        <div data-testid="chat-skeleton">
          <Skeleton height="body" lines={SKELETON_ROWS} />
        </div>
      </PageBody>
    </main>
  );
}
