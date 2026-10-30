'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, StatusBadge } from '@ses/ui';
import { Tooltip } from '@ses/ui/client';
import type { ProjectStatus } from '@ses/db';

export type ProjectStatusControlMessages = {
  readonly open: string;
  readonly closed: string;
  readonly changeToOpen: string;
  readonly changeToClosed: string;
  readonly saved: string;
  readonly failed: string;
};

export function ProjectStatusControl({ id, status, messages }: {
  readonly id: string;
  readonly status: ProjectStatus;
  readonly messages: ProjectStatusControlMessages;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [result, setResult] = useState<'saved' | 'failed' | null>(null);
  const next = status === 'OPEN' ? 'CLOSED' : 'OPEN';
  const action = status === 'OPEN' ? messages.changeToClosed : messages.changeToOpen;

  async function change(): Promise<void> {
    if (pending || refreshing) return;
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error('Status update failed');
      setResult('saved');
      startTransition(() => router.refresh());
    } catch {
      setResult('failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip content={action}>
        <Button type="button" variant="ghost" size="sm" className="px-0" aria-label={action}
          disabled={pending || refreshing} onClick={() => void change()}
          data-testid="project-list-panel-status-toggle">
          <StatusBadge entity="project" state={status} label={status === 'OPEN' ? messages.open : messages.closed} />
        </Button>
      </Tooltip>
      {result === null ? null : (
        <span role={result === 'failed' ? 'alert' : 'status'}
          className={result === 'failed' ? 'text-xs text-danger' : 'text-xs text-fg-muted'}>
          {result === 'failed' ? messages.failed : messages.saved}
        </span>
      )}
    </div>
  );
}
