// apps/web/app/(main)/chat/chat-message-markdown.tsx
// ✅ 2026-10-22（紺野「こういうチャット枠が必要だよね」）: 発言の本文を書式つきで描く（`lib/chat/markdown.ts`）。
// 🔴 React の要素として組むだけ（`dangerouslySetInnerHTML` を使わない）。リンクは http / https だけで、新しいタブ・
//    `noopener noreferrer nofollow`（既存の URL の扱いと同じ）。
// 🔴 `data-testid="chat-message-link-<発言 ID>"` は従来どおりリンクに付ける（E2E と凍結の対象）。
import type { ReactNode } from 'react';
import { Button, cn } from '@ses/ui';
import { parseChatMarkdown, type ChatBlock, type ChatInline } from '../../../lib/chat/markdown';

export type ChatMessageMarkdownProps = {
  readonly text: string;
  /** リンクの testid に使う発言 ID（プレビューでは `null`）。 */
  readonly messageId: string | null;
  /** `@名前` として目立たせる名前（部屋の人）。 */
  readonly mentionNames: readonly string[];
  /** ✅ 2026-10-27: 濃い青の吹き出し（自分の発言）では `inverse`。 */
  readonly tone?: Tone;
  /**
   * ✅ 2026-10-27（F-038 ⑬）: 引用の帯の語と、引用元へ移る操作。`onJump` が無ければ名前は文字のまま（プレビュー）。
   * 🔴 移る先は開いている部屋の中だけ（呼び出し側の `jumpToQuoted`）。
   */
  readonly quote?: {
    readonly labels: { readonly label: string; readonly jump: string; readonly unavailable: string };
    readonly missing: boolean;
    readonly onJump?: (targetMessageId: string) => void;
  };
};

/**
 * ✅ 2026-10-27（F-038 ⑬）: 引用の帯。吹き出しの色に関わらず明るい面に置く（名前の操作の文字色を吹き出しに合わせない）。
 * 左の線は 2px（左端の強調だけ）。
 */
const QUOTE_BAND_CLASSES: Readonly<Record<Tone, string>> = {
  normal: 'm-0 flex flex-col gap-1 rounded-md border-l-2 border-brand bg-bg-subtle px-2 py-1 text-fg',
  inverse: 'm-0 flex flex-col gap-1 rounded-md border-l-2 border-brand-fg bg-bg px-2 py-1 text-fg',
};

/**
 * ✅ 2026-10-27（紺野「区別しにくい」）: 自分の発言は濃い青の吹き出しに白い文字で描くので、
 * リンク・メンション・コード・引用の色を反転させる（青の上に青の文字を置かない）。
 */
type Tone = 'normal' | 'inverse';
const TONE: Readonly<Record<Tone, { readonly code: string; readonly mention: string; readonly link: string; readonly quote: string; readonly pre: string }>> = {
  normal: {
    code: 'rounded-xs bg-bg-inset px-1 font-mono text-cell',
    mention: 'rounded-xs bg-brand-bg px-1 text-brand',
    link: 'break-all text-brand underline',
    quote: 'm-0 border-l-2 border-border-strong pl-3 text-fg-muted',
    pre: 'm-0 overflow-x-auto rounded-md bg-bg-inset p-2 font-mono text-cell whitespace-pre',
  },
  inverse: {
    code: 'rounded-xs bg-brand-active px-1 font-mono text-cell',
    mention: 'rounded-xs bg-brand-active px-1 font-semibold text-brand-fg',
    link: 'break-all text-brand-fg underline',
    quote: 'm-0 border-l-2 border-brand-fg pl-3 text-brand-fg',
    pre: 'm-0 overflow-x-auto rounded-md bg-brand-active p-2 font-mono text-cell whitespace-pre',
  },
};

function renderInline(nodes: readonly ChatInline[], messageId: string | null, key: string, tone: Tone = 'normal'): ReactNode[] {
  return nodes.map((node, index) => {
    const k = `${key}-${String(index)}`;
    switch (node.kind) {
      case 'text':
        return <span key={k}>{node.value}</span>;
      case 'bold':
        return (
          <strong key={k} className="font-semibold">
            {renderInline(node.children, messageId, k, tone)}
          </strong>
        );
      case 'italic':
        return (
          <em key={k} className="italic">
            {renderInline(node.children, messageId, k, tone)}
          </em>
        );
      case 'code':
        return (
          <code key={k} className={TONE[tone].code}>
            {node.value}
          </code>
        );
      case 'mention':
        return (
          <span key={k} className={TONE[tone].mention}>
            {`@${node.name}`}
          </span>
        );
      case 'link':
        return messageId === null ? (
          <a key={k} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className={TONE[tone].link}>
            {node.label}
          </a>
        ) : (
          <a
            key={k}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={TONE[tone].link}
            data-testid={`chat-message-link-${messageId}`}
          >
            {node.label}
          </a>
        );
    }
  });
}

function renderLines(lines: readonly (readonly ChatInline[])[], messageId: string | null, key: string, tone: Tone): ReactNode[] {
  return lines.flatMap((line, index) => {
    const parts = renderInline(line, messageId, `${key}-${String(index)}`, tone);
    return index === lines.length - 1 ? parts : [...parts, <br key={`${key}-br-${String(index)}`} />];
  });
}

function renderBlock(block: ChatBlock, messageId: string | null, key: string, tone: Tone, quote: ChatMessageMarkdownProps['quote']): ReactNode {
  switch (block.kind) {
    case 'messageQuote': {
      const labels = quote?.labels;
      const onJump = quote?.onJump;
      return (
        <blockquote
          key={key}
          aria-label={labels?.label}
          className={QUOTE_BAND_CLASSES[tone]}
          data-testid={messageId === null ? 'chat-compose-preview-quote' : `chat-message-quote-${messageId}`}
        >
          {onJump === undefined || messageId === null || labels === undefined ? (
            <strong className="text-cell font-bold">{block.name}</strong>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 w-fit px-1 font-bold md:min-h-8"
              title={labels.jump}
              aria-label={`${block.name} ${labels.jump}`}
              onClick={() => onJump(block.messageId)}
              data-testid={`chat-message-quote-jump-${messageId}`}
            >
              {block.name}
            </Button>
          )}
          <span className="text-cell text-fg-muted">{block.lines.join(' ')}</span>
          {quote?.missing === true && labels !== undefined ? (
            <span role="status" className="text-xs text-fg-muted" data-testid={`chat-message-quote-missing-${messageId ?? 'preview'}`}>
              {labels.unavailable}
            </span>
          ) : null}
        </blockquote>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="m-0">
          {renderLines(block.lines, messageId, key, tone)}
        </p>
      );
    case 'quote':
      return (
        <blockquote key={key} className={TONE[tone].quote}>
          {renderLines(block.lines, messageId, key, tone)}
        </blockquote>
      );
    case 'code':
      return (
        <pre key={key} className={TONE[tone].pre}>
          {block.value}
        </pre>
      );
    case 'list': {
      const items = block.items.map((item, index) => <li key={`${key}-${String(index)}`}>{renderInline(item, messageId, `${key}-${String(index)}`, tone)}</li>);
      return block.ordered ? (
        <ol key={key} className={cn('m-0 list-decimal pl-6')}>
          {items}
        </ol>
      ) : (
        <ul key={key} className={cn('m-0 list-disc pl-6')}>
          {items}
        </ul>
      );
    }
  }
}

export function ChatMessageMarkdown({ text, messageId, mentionNames, tone = 'normal', quote }: ChatMessageMarkdownProps) {
  const blocks = parseChatMarkdown(text, mentionNames);
  return <>{blocks.map((block, index) => renderBlock(block, messageId, `b${String(index)}`, tone, quote))}</>;
}
