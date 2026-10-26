'use client';

// apps/web/app/(main)/chat/chat-project-picker.tsx
// ✅ 2026-10-23（チャットレーン・紺野）: 入力欄の「/」→「案件を貼る」で開く、貼る案件を選ぶ小窓。
//
// 🔴 候補は `GET /api/threads/{id}/projects`（#51n）が返したものだけ（送る人の RLS + 部屋の取引先に公開中）。
//    この島は候補を絞らない・足さない。**最終の判定は投稿のサーバ側**（ここに出ない ID は 400 になる）。
// 🔴 候補に単価・エンド企業名は来ない（応答は ID・案件名・状態だけ）。
// 🔴 重なり（`role="dialog"`）を自作しない —— 入力欄の枠の中に開く小さな面である。
import { useEffect, useState } from 'react';
import { Alert, Button, Icon, IconButton } from '@ses/ui';
import { SearchInput } from '@ses/ui/client';
import { chatProjectCandidatesApiPath } from '../../../lib/chat/screen-query';
import type { ChatConversationMessages } from './chat-props';

/** 候補 1 件（#51n の応答）。 */
export type ChatPickedProject = { readonly id: string; readonly name: string };
type CandidateResponse = { readonly items: readonly { readonly id: string; readonly name: string; readonly status: string }[] };

export type ChatProjectPickerProps = {
  readonly threadId: string;
  readonly labels: ChatConversationMessages['pasteProject'];
  readonly statuses: Readonly<Record<string, string>>;
  readonly onPick: (project: ChatPickedProject) => void;
  readonly onClose: () => void;
};

export function ChatProjectPicker({ threadId, labels, statuses, onPick, onClose }: ChatProjectPickerProps) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<
    { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'ready'; readonly items: CandidateResponse['items'] }
  >({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const response = await fetch(chatProjectCandidatesApiPath(threadId, q), { cache: 'no-store' });
        if (!active) return;
        if (!response.ok) {
          setState({ kind: 'failed' });
          return;
        }
        const payload = (await response.json()) as CandidateResponse;
        if (active) setState({ kind: 'ready', items: payload.items });
      } catch {
        if (active) setState({ kind: 'failed' });
      }
    })();
    return () => {
      active = false;
    };
  }, [threadId, q]);

  return (
    <div className="flex flex-col gap-2 border-b border-border px-2 py-2" data-testid="chat-compose-project-picker">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-fg">{labels.title}</span>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          // ✅ 2026-10-26（Codex のレビュー）: スマホでは押せる大きさを 44px にする（`md` 以上は 32px のまま）。
          className="ml-auto h-11 w-11 md:h-8 md:w-8"
          icon={<Icon name="x" />}
          aria-label={labels.close}
          onClick={onClose}
          data-testid="chat-compose-project-close"
        />
      </div>
      <SearchInput
        aria-label={labels.search}
        placeholder={labels.search}
        icon={<Icon name="search" />}
        onSearchChange={setQ}
        testIdPrefix="chat-compose-project-"
      />
      <p className="m-0 text-xs text-fg-muted">{labels.hint}</p>
      {state.kind === 'loading' ? (
        <p className="m-0 text-xs text-fg-muted" aria-live="polite" data-testid="chat-compose-project-loading">
          {labels.loading}
        </p>
      ) : state.kind === 'failed' ? (
        <Alert variant="danger" data-testid="chat-compose-project-failed">
          {labels.failed}
        </Alert>
      ) : state.items.length === 0 ? (
        <p className="m-0 text-xs text-fg-muted" data-testid="chat-compose-project-empty">
          {labels.empty}
        </p>
      ) : (
        <ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0" data-testid="chat-compose-project-options">
          {state.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                // ✅ 2026-10-26（Codex のレビュー）: スマホでは 44px（隣の案件を押し間違えないように）。
                className="h-11 min-w-0 flex-1 justify-start md:h-8"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick({ id: item.id, name: item.name })}
                data-testid={`chat-compose-project-option-${item.id}`}
              >
                <span className="truncate">{item.name}</span>
              </Button>
              <span className="shrink-0 text-xs text-fg-muted">{statuses[item.status] ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
