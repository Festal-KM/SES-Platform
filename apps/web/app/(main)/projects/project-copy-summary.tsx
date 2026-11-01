'use client';

import { useState } from 'react';
import { Icon, IconButton, Textarea } from '@ses/ui';
import { Tooltip } from '@ses/ui/client';

export type ProjectCopySummaryMessages = {
  readonly label: string;
  readonly hint: string;
  readonly copy: string;
  readonly copied: string;
  readonly failed: string;
};

export function ProjectCopySummary({ text, messages }: {
  readonly text: string;
  readonly messages: ProjectCopySummaryMessages;
}) {
  const [result, setResult] = useState<{ text: string; state: 'copying' | 'copied' | 'failed' } | null>(null);
  const state = result?.text === text ? result.state : 'idle';

  async function copy(): Promise<void> {
    if (state === 'copying') return;
    setResult({ text, state: 'copying' });
    try {
      await navigator.clipboard.writeText(text);
      setResult({ text, state: 'copied' });
    } catch {
      setResult({ text, state: 'failed' });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4" data-testid="project-list-panel-copy">
      <div className="flex items-center gap-2">
        <p className="m-0 flex-1 text-xs text-fg-muted">{messages.hint}</p>
        <Tooltip content={messages.copy}>
          <IconButton type="button" variant="ghost" size="sm" icon={<Icon name="copy" />}
            aria-label={messages.copy} disabled={state === 'copying'}
            onClick={() => void copy()} data-testid="project-list-panel-copy-button" />
        </Tooltip>
      </div>
      <Textarea readOnly rows={14} value={text} aria-label={messages.label}
        data-testid="project-list-panel-copy-text" />
      {state === 'copied' ? (
        <p role="status" className="m-0 text-xs text-success" data-testid="project-list-panel-copy-status">{messages.copied}</p>
      ) : state === 'failed' ? (
        <p role="alert" className="m-0 text-xs text-danger" data-testid="project-list-panel-copy-status">{messages.failed}</p>
      ) : null}
    </div>
  );
}
