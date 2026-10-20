// apps/web/app/(main)/chat/loading.tsx
// `S-031` のローディング（`docs/04` §10.4 `S-031`「スレッド一覧の骨格」「一覧を先に、メッセージは後」）。
//
// ✅ 2026-10-20（紺野「スケルトンスクリーン」）: v2 の画面の形（左の絞り込みの列・会話の一覧・会話）をした骨格にする。
//    読み込みが終わった瞬間に同じ場所へ中身が入るので、画面が跳ねない。
// 🔴 **件数を書かない**（0 件と読み違えられる。`S-019` / `S-022` の loading と同じ判断）。
// 🔴 `/chat` に子ルートを持たせていないので、この位置に置いても他画面を包まない
//    （`tests/static/route-boundaries.test.ts`。スレッドの選択は `?thread=` であり `[id]` ではない）。
// 🔴 スマホでは左の列と会話を出さない形にしない（隠さない）—— `md` 未満は一覧だけの縦 1 列で、骨格もそれに合わせる。
import { t } from '@ses/i18n';
import { Card, PageBody, Skeleton } from '@ses/ui';

const RAIL_ROWS = 7;
const LIST_ROWS = 8;
const BUBBLES = ['half', 'quarter', 'half'] as const;

export default function ChatLoading() {
  return (
    <main className="py-6" aria-busy="true">
      <PageBody widthClass="split">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('chat.title')}</h1>
        <p role="status" className="sr-only" data-testid="chat-loading">
          {t('chat.loading')}
        </p>
        <Card className="flex min-h-0 flex-1 flex-col p-0 md:flex-row" data-testid="chat-skeleton">
          {/* 左の絞り込みの列 */}
          <div className="flex flex-col gap-3 bg-bg-inset p-3 md:w-44">
            {Array.from({ length: RAIL_ROWS }, (_, index) => (
              <div key={`rail-${String(index)}`} className="flex items-center gap-2">
                <Skeleton className="size-6 shrink-0" />
                <Skeleton width="half" />
              </div>
            ))}
          </div>
          {/* 会話の一覧（アバター + 2 段） */}
          <div className="flex flex-col gap-4 bg-bg-subtle p-3 md:w-96">
            <Skeleton height="title" />
            {Array.from({ length: LIST_ROWS }, (_, index) => (
              <div key={`row-${String(index)}`} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton width="half" />
                  <Skeleton height="cell" />
                </div>
              </div>
            ))}
          </div>
          {/* 会話（吹き出し） */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
            <Skeleton height="title" width="quarter" />
            {BUBBLES.map((width, index) => (
              <div key={`bubble-${String(index)}`} className="flex items-start gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <Skeleton height="body" width={width} />
              </div>
            ))}
          </div>
        </Card>
      </PageBody>
    </main>
  );
}
