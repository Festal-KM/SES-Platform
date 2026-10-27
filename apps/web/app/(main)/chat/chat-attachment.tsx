'use client';

// apps/web/app/(main)/chat/chat-attachment.tsx
// ✅ 2026-10-27（`docs/04` §S-031 改訂 44 / `F-038` 改訂 12 ⑫）: 発言に添えたファイルと、右の欄の「ファイル」の一覧。
//
// 🔴 この島が守るもの
//   ① 🔴 **共有 URL を画面に持ち続けない** —— 「開く」「別タブで開く」は押すたびに #51q で取り直す（発行のたびに監査が 1 行残る）。
//      プレビュー（画像・PDF）だけは、表示している間その URL を使う（有効期限は 300 秒。開き直せば取り直す）。
//   ② 🔴 **ファイル名を出さない**（保存していない）。「PDF・1.2 MB」のように種類と大きさで出す。
//   ③ 🔴 `CLEAN` でないものは送った本人にしか届かない（サーバが決める）。ここは届いた状態をそのまま描く:
//      検査中 = 「ファイルを検査しています」/ 問題あり = 「このファイルは送れませんでした（…）」。開く導線は描かない。
//   ④ 🔴 閲覧専用（開けない人）には開く導線を描かない（押して断られる導線を置かない）。種類と大きさだけを出す。
//   ⑤ 🔴 `@ses/db` / `@ses/i18n` を値 import しない（語は props。`chat-props.ts`）。
//   ⑥ 別タブは `noopener` で開く（開いた先から元の画面を操作させない）。
import { Button, CHAT_ATTACHMENT_IMAGE_CLASS, CHAT_ATTACHMENT_PDF_CLASS, CHAT_BUBBLE_MAX_WIDTH_CLASS, Icon, cn } from '@ses/ui';
import { useEffect, useState } from 'react';
import { chatAttachmentListApiPath, chatAttachmentSummary, fetchChatAttachmentUrl, type ChatAttachmentFormatLabels } from '../../../lib/chat/attachment-client';
import type { ChatAttachmentListItem, ChatAttachmentView } from '../../../lib/chat/views';
import { formatDateTimeJst } from '../../../lib/format/datetime';

/** 添付の語（`chat-props.ts` の `chatAttachmentLabels`）。 */
export type ChatAttachmentLabels = ChatAttachmentFormatLabels & {
  readonly add: string;
  readonly note: string;
  readonly selected: string;
  readonly remove: string;
  readonly scanning: string;
  readonly blocked: string;
  /** 検査そのものができなかった（UNSCANNABLE / FAILED）。「問題が見つかった」（INFECTED）と書き分ける。 */
  readonly unscannable: string;
  readonly open: string;
  readonly openNewTab: string;
  readonly openFailed: string;
  readonly unsupported: string;
  readonly uploadFailed: string;
  readonly imageAlt: string;
  readonly pdfTitle: string;
  readonly filesHeading: string;
  readonly filesEmpty: string;
  readonly filesLoading: string;
  readonly filesFailed: string;
  readonly filesMore: string;
};

/** 「開く」（同じタブで保存）と「別タブで開く」。押すたびに URL を取り直す。 */
function ChatAttachmentOpenActions({
  threadId,
  messageId,
  labels,
  testIdPrefix,
}: {
  readonly threadId: string;
  readonly messageId: string;
  readonly labels: ChatAttachmentLabels;
  readonly testIdPrefix: 'chat-attachment' | 'chat-attachment-file';
}) {
  const [failed, setFailed] = useState(false);
  async function openHere(): Promise<void> {
    setFailed(false);
    const url = await fetchChatAttachmentUrl({ threadId, messageId, disposition: 'attachment' }, { fetch });
    if (url === null) {
      setFailed(true);
      return;
    }
    window.location.assign(url);
  }
  async function openInNewTab(): Promise<void> {
    setFailed(false);
    // 🔴 押した瞬間に空のタブを開いておく（URL を取ってから開くと、ポップアップとして止められる）。
    //    開いた先から元の画面を触らせない（opener を外す = noopener と同じ）。
    const tab = window.open('', '_blank');
    if (tab !== null) tab.opener = null;
    const url = await fetchChatAttachmentUrl({ threadId, messageId, disposition: 'inline' }, { fetch });
    if (url === null) {
      tab?.close();
      setFailed(true);
      return;
    }
    if (tab === null) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    tab.location.href = url;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" size="sm" className="min-h-11 md:min-h-8" onClick={() => void openHere()} data-testid={`${testIdPrefix}-open-${messageId}`}>
        {labels.open}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={() => void openInNewTab()} data-testid={`${testIdPrefix}-open-tab-${messageId}`}>
        {labels.openNewTab}
      </Button>
      {failed ? (
        <span className="text-xs text-danger" role="status" data-testid={`${testIdPrefix}-open-failed-${messageId}`}>
          {labels.openFailed}
        </span>
      ) : null}
    </div>
  );
}

/** 画像・PDF のプレビュー（表示している間だけ URL を使う）。 */
function ChatAttachmentPreview({
  threadId,
  messageId,
  attachment,
  labels,
}: {
  readonly threadId: string;
  readonly messageId: string;
  readonly attachment: ChatAttachmentView;
  readonly labels: ChatAttachmentLabels;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchChatAttachmentUrl({ threadId, messageId, disposition: 'inline' }, { fetch }).then((next) => {
      if (active) setUrl(next);
    });
    return () => {
      active = false;
    };
  }, [threadId, messageId]);
  const summary = chatAttachmentSummary(attachment, labels);
  return (
    <div className="flex w-full flex-col gap-1" data-testid={`chat-attachment-preview-${messageId}`}>
      {url === null ? null : attachment.kind === 'image' ? (
        // 🔴 縦 240px まで縮める（幅は吹き出しの上限まで）。
        <img src={url} alt={labels.imageAlt} className={cn('rounded-md border border-border', CHAT_ATTACHMENT_IMAGE_CLASS)} />
      ) : (
        // 🔴 PDF は埋め込み（高さ 320px）。読み込めない端末では中の札だけが出る。
        <object data={url} type="application/pdf" title={labels.pdfTitle} className={cn('rounded-md border border-border', CHAT_ATTACHMENT_PDF_CLASS)}>
          <span className="text-xs text-fg-muted">{summary}</span>
        </object>
      )}
    </div>
  );
}

/** 発言の下に出す添付（検査中・送れなかった・プレビュー・札）。 */
export function ChatMessageAttachment({
  threadId,
  messageId,
  attachment,
  labels,
  canOpen,
}: {
  readonly threadId: string;
  readonly messageId: string;
  readonly attachment: ChatAttachmentView;
  readonly labels: ChatAttachmentLabels;
  readonly canOpen: boolean;
}) {
  const summary = chatAttachmentSummary(attachment, labels);
  if (attachment.scanStatus === 'SCANNING') {
    return (
      <p className="m-0 flex items-center gap-1 text-xs text-fg-muted" role="status" data-testid={`chat-attachment-scanning-${messageId}`}>
        <Icon name="chat-attach" />
        {`${labels.scanning}（${summary}）`}
      </p>
    );
  }
  if (attachment.scanStatus !== 'CLEAN') {
    return (
      <p className="m-0 text-xs text-danger" role="status" data-testid={`chat-attachment-blocked-${messageId}`}>
        {attachment.scanStatus === 'INFECTED' ? labels.blocked : labels.unscannable}
      </p>
    );
  }
  const previewable = canOpen && (attachment.kind === 'image' || attachment.kind === 'pdf');
  return (
    <div className={cn('flex w-full flex-col gap-2 rounded-lg border border-border bg-bg p-3', CHAT_BUBBLE_MAX_WIDTH_CLASS)} data-testid={`chat-attachment-${messageId}`}>
      <p className="m-0 flex items-center gap-1 text-xs text-fg-muted" data-testid={`chat-attachment-summary-${messageId}`}>
        <Icon name="chat-attach" />
        {summary}
      </p>
      {previewable ? <ChatAttachmentPreview threadId={threadId} messageId={messageId} attachment={attachment} labels={labels} /> : null}
      {canOpen ? <ChatAttachmentOpenActions threadId={threadId} messageId={messageId} labels={labels} testIdPrefix="chat-attachment" /> : null}
    </div>
  );
}

/** 右の欄の「ファイル」の一覧（`CLEAN` だけ・新しい順。続きは #51r で読む）。 */
export function ChatAttachmentFiles({
  threadId,
  initialItems,
  initialNextCursor,
  labels,
  canOpen,
  unknownName,
}: {
  readonly threadId: string;
  readonly initialItems: readonly ChatAttachmentListItem[];
  readonly initialNextCursor: string | null;
  readonly labels: ChatAttachmentLabels;
  readonly canOpen: boolean;
  readonly unknownName: string;
}) {
  const [items, setItems] = useState<readonly ChatAttachmentListItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [state, setState] = useState<'IDLE' | 'LOADING' | 'FAILED'>('IDLE');
  async function loadMore(): Promise<void> {
    if (nextCursor === null || state === 'LOADING') return;
    setState('LOADING');
    const response = await fetch(chatAttachmentListApiPath(threadId, nextCursor), { cache: 'no-store' }).catch(() => null);
    if (response === null || !response.ok) {
      setState('FAILED');
      return;
    }
    const page = (await response.json()) as { readonly items: readonly ChatAttachmentListItem[]; readonly nextCursor: string | null };
    setItems((current) => [...current, ...page.items.filter((item) => !current.some((entry) => entry.messageId === item.messageId))]);
    setNextCursor(page.nextCursor);
    setState('IDLE');
  }
  return (
    <section className="flex flex-col gap-2 pt-4" data-testid="chat-panel-files">
      <h3 className="m-0 text-cell font-normal text-fg-muted">{labels.filesHeading}</h3>
      {items.length === 0 ? (
        <p className="m-0 text-xs text-fg-muted" data-testid="chat-panel-files-empty">
          {labels.filesEmpty}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((item) => (
            <li key={item.messageId} className="flex flex-col gap-1 border-t border-border-row pt-2" data-testid={`chat-attachment-file-${item.messageId}`}>
              <span className="flex items-center gap-1 text-body text-fg">
                <Icon name="chat-attach" />
                {chatAttachmentSummary(item, labels)}
              </span>
              <span className="text-xs text-fg-muted">{`${item.senderName ?? unknownName} ${formatDateTimeJst(item.sentAt)}`}</span>
              {canOpen ? <ChatAttachmentOpenActions threadId={threadId} messageId={item.messageId} labels={labels} testIdPrefix="chat-attachment-file" /> : null}
            </li>
          ))}
        </ul>
      )}
      {state === 'FAILED' ? (
        <p className="m-0 text-xs text-danger" role="status">
          {labels.filesFailed}
        </p>
      ) : null}
      {nextCursor === null ? null : (
        <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={() => void loadMore()} data-testid="chat-panel-files-more">
          {state === 'LOADING' ? labels.filesLoading : labels.filesMore}
        </Button>
      )}
    </section>
  );
}
