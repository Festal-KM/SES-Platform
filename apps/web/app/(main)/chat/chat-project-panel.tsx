'use client';

// ✅ 2026-10-29（紺野の決定）: 案件カードの「案件詳細を開く」—— チャットを離れずに、右の欄（スマホは全画面）で案件を開く。
//
// 🔴 ここが守るもの
//   ① 読むのは既存の案件詳細の API（`GET /api/projects/{id}`。#27）だけ。🔴 **開くたびにそこが閲覧の監査（`project.view`）を書き**、
//      公開範囲（ホスト = 自社の案件 / 取引先 = 自社に公開中の案件だけ。越境経路 1）を RLS で決める。新しい読み取りの経路を作らない。
//   ② 欄に出すのはカードと同じ考え方の共通項目だけ（`lib/chat/project-panel.ts` ②。単価・エンド企業名・公開先を出さない）。
//      全項目は「案件のページで開く」（案件詳細の画面）で見る。
//   ③ 重なりは `@ses/ui` の `Drawer`（Esc・背景・「閉じる」で閉じる）。閉じたらカードの操作にフォーカスを戻す。
//   ④ 読めなかった（404・失敗）ときは理由を書き分けず「この案件は表示できません」だけを出す。
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Button } from '@ses/ui';
import { Drawer } from '@ses/ui/client';
import { chatProjectHref } from '../../../lib/chat/project-card-text';
import { chatProjectDetailApiPath, chatProjectPanelItems, pickChatProjectPanelDetail, type ChatProjectPanelDetail } from '../../../lib/chat/project-panel';
import type { ChatConversationMessages } from './chat-props';

type PanelState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'open'; readonly detail: ChatProjectPanelDetail };

export function ChatProjectPanelButton({
  messageId,
  projectId,
  labels,
}: {
  readonly messageId: string;
  readonly projectId: string;
  readonly labels: ChatConversationMessages['projectCard'];
}) {
  const [state, setState] = useState<PanelState>({ kind: 'closed' });
  const trigger = useRef<HTMLButtonElement | null>(null);

  async function open(): Promise<void> {
    if (state.kind === 'loading') return;
    setState({ kind: 'loading' });
    try {
      const response = await fetch(chatProjectDetailApiPath(projectId), { cache: 'no-store' });
      const detail = response.ok ? pickChatProjectPanelDetail(await response.json()) : null;
      setState(detail === null ? { kind: 'failed' } : { kind: 'open', detail });
    } catch {
      setState({ kind: 'failed' });
    }
  }

  function close(): void {
    setState({ kind: 'closed' });
    // `Drawer` は開いた操作を知らないので、閉じた後にカードの操作へフォーカスを戻す。
    window.setTimeout(() => trigger.current?.focus(), 0);
  }

  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 md:h-8"
        aria-haspopup="dialog"
        onClick={() => void open()}
        data-testid={`chat-message-project-open-${messageId}`}
      >
        {state.kind === 'loading' ? labels.panel.loading : labels.open}
      </Button>
      {state.kind === 'failed' ? (
        <p className="m-0 w-full text-xs text-fg-muted" role="status" data-testid={`chat-message-project-failed-${messageId}`}>
          {labels.panel.failed}
        </p>
      ) : null}
      {state.kind === 'open' ? (
        <Drawer
          open
          onOpenChange={(next) => {
            if (!next) close();
          }}
          title={state.detail.name}
          items={chatProjectPanelItems(state.detail, { ...labels, ...labels.panel, start: labels.start, location: labels.location })}
          detailLink={{ href: chatProjectHref(projectId), label: labels.panel.openPage }}
          linkComponent={Link}
          closeLabel={labels.panel.close}
          data-testid={`chat-project-panel-${messageId}`}
        />
      ) : null}
    </>
  );
}
