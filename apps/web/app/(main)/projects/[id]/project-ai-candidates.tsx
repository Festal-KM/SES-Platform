'use client';

import { useState, type FormEvent } from 'react';
import { Button, Icon, Input } from '@ses/ui';
import { t } from '@ses/i18n';

type Candidate = {
  readonly candidate: { readonly kind: 'OWN' | 'ANONYMOUS'; readonly key: string; readonly displayName?: string; readonly skills: readonly string[] };
  readonly reason: string;
};
type Entry = { readonly question: string; readonly candidates: readonly Candidate[] };

export function ProjectAiCandidates({ projectId }: { readonly projectId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function search(question: string) {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/ai-candidates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question }),
      });
      if (!response.ok) throw new Error();
      const { runId } = await response.json() as { runId: string };
      let completed = false;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const poll = await fetch(`/api/projects/${projectId}/ai-candidates?runId=${encodeURIComponent(runId)}`, { cache: 'no-store' });
        if (!poll.ok) throw new Error();
        const data = await poll.json() as { status: 'PENDING' | 'FAILED' | 'COMPLETED'; candidates?: readonly Candidate[] };
        if (data.status === 'FAILED') throw new Error();
        if (data.status === 'COMPLETED') {
          setEntries((previous) => [...previous, { question, candidates: data.candidates ?? [] }]);
          setMessage('');
          completed = true;
          break;
        }
      }
      if (!completed) throw new Error();
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(message);
  }

  return <>
    <Button variant="primary" data-testid="project-detail-candidates" onClick={() => { setOpen(true); if (entries.length === 0) void search(''); }}>
      <Icon name="ai-consult" size="sm" /> {t('projects.aiCandidates.open')}
    </Button>
    {open ? <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-bg p-4 sm:w-96" aria-label={t('projects.aiCandidates.title')} data-testid="project-ai-candidates-panel">
      <div className="flex items-center justify-between gap-3"><h2 className="m-0 text-body font-semibold">{t('projects.aiCandidates.title')}</h2><Button variant="ghost" onClick={() => setOpen(false)}>{t('projects.aiCandidates.close')}</Button></div>
      <p className="text-cell text-fg-muted">{t('projects.aiCandidates.hint')}</p>
      <div className="flex flex-1 flex-col gap-4 overflow-auto" aria-live="polite">
        {entries.map((entry, index) => <section key={index} className="flex flex-col gap-2">
          {entry.question ? <p className="m-0 text-body font-semibold">{entry.question}</p> : null}
          {entry.candidates.length === 0 ? <p>{t('projects.aiCandidates.empty')}</p> : entry.candidates.map(({ candidate, reason }) => <div key={candidate.key} className="border-b border-border py-2">
            <p className="m-0 font-semibold">{candidate.kind === 'OWN' ? candidate.displayName : t('projects.aiCandidates.shared')}</p>
            <p className="m-0 text-cell">{candidate.skills.join(' / ')}</p><p className="m-0 text-cell text-fg-muted">{reason}</p>
          </div>)}
        </section>)}
        {loading ? <p>{t('projects.aiCandidates.loading')}</p> : null}
        {failed ? <p role="alert">{t('projects.aiCandidates.error')}</p> : null}
      </div>
      <form method="post" onSubmit={submit} className="flex gap-2"><Input aria-label={t('projects.aiCandidates.prompt')} value={message} onChange={(event) => setMessage(event.target.value)} /><Button type="submit">{t('projects.aiCandidates.send')}</Button></form>
    </aside> : null}
  </>;
}
