// apps/web/app/(main)/chat/chat-message-markdown.tsx
// ✅ 2026-10-22（紺野「こういうチャット枠が必要だよね」）: 発言の本文を書式つきで描く（`lib/chat/markdown.ts`）。
// 🔴 React の要素として組むだけ（`dangerouslySetInnerHTML` を使わない）。リンクは http / https だけで、新しいタブ・
//    `noopener noreferrer nofollow`（既存の URL の扱いと同じ）。
// 🔴 `data-testid="chat-message-link-<発言 ID>"` は従来どおりリンクに付ける（E2E と凍結の対象）。
import type { ReactNode } from 'react';
import { cn } from '@ses/ui';
import { parseChatMarkdown, type ChatBlock, type ChatInline } from '../../../lib/chat/markdown';

export type ChatMessageMarkdownProps = {
  readonly text: string;
  /** リンクの testid に使う発言 ID（プレビューでは `null`）。 */
  readonly messageId: string | null;
  /** `@名前` として目立たせる名前（部屋の人）。 */
  readonly mentionNames: readonly string[];
};

function renderInline(nodes: readonly ChatInline[], messageId: string | null, key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const k = `${key}-${String(index)}`;
    switch (node.kind) {
      case 'text':
        return <span key={k}>{node.value}</span>;
      case 'bold':
        return (
          <strong key={k} className="font-semibold">
            {renderInline(node.children, messageId, k)}
          </strong>
        );
      case 'italic':
        return (
          <em key={k} className="italic">
            {renderInline(node.children, messageId, k)}
          </em>
        );
      case 'code':
        return (
          <code key={k} className="rounded-xs bg-bg-inset px-1 font-mono text-cell">
            {node.value}
          </code>
        );
      case 'mention':
        return (
          <span key={k} className="rounded-xs bg-brand-bg px-1 text-brand">
            {`@${node.name}`}
          </span>
        );
      case 'link':
        return messageId === null ? (
          <a key={k} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand underline">
            {node.label}
          </a>
        ) : (
          <a
            key={k}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-brand underline"
            data-testid={`chat-message-link-${messageId}`}
          >
            {node.label}
          </a>
        );
    }
  });
}

function renderLines(lines: readonly (readonly ChatInline[])[], messageId: string | null, key: string): ReactNode[] {
  return lines.flatMap((line, index) => {
    const parts = renderInline(line, messageId, `${key}-${String(index)}`);
    return index === lines.length - 1 ? parts : [...parts, <br key={`${key}-br-${String(index)}`} />];
  });
}

function renderBlock(block: ChatBlock, messageId: string | null, key: string): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p key={key} className="m-0">
          {renderLines(block.lines, messageId, key)}
        </p>
      );
    case 'quote':
      return (
        <blockquote key={key} className="m-0 border-l-2 border-border-strong pl-3 text-fg-muted">
          {renderLines(block.lines, messageId, key)}
        </blockquote>
      );
    case 'code':
      return (
        <pre key={key} className="m-0 overflow-x-auto rounded-md bg-bg-inset p-2 font-mono text-cell whitespace-pre">
          {block.value}
        </pre>
      );
    case 'list': {
      const items = block.items.map((item, index) => <li key={`${key}-${String(index)}`}>{renderInline(item, messageId, `${key}-${String(index)}`)}</li>);
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

export function ChatMessageMarkdown({ text, messageId, mentionNames }: ChatMessageMarkdownProps) {
  const blocks = parseChatMarkdown(text, mentionNames);
  return <>{blocks.map((block, index) => renderBlock(block, messageId, `b${String(index)}`))}</>;
}
