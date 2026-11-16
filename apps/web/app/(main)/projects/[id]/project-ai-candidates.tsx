'use client';

import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, IconButton, Icon, Input, Skeleton, SECONDARY_LINK_CLASSES, AI_CANDIDATE_PANEL_VIEWPORT_CLASSES, AI_CANDIDATE_PANEL_MOTION_CLASSES, cn } from '@ses/ui';
import { Tooltip } from '@ses/ui/client';
import { t } from '@ses/i18n';

type Candidate = {
  readonly candidate: { readonly kind: 'OWN' | 'ANONYMOUS'; readonly key: string; readonly displayName?: string; readonly id?: string; readonly skills: readonly string[] };
  readonly reason: string;
};
type Entry = { readonly question: string; readonly candidates: readonly Candidate[] };

const OpenCandidatePanel = createContext<(() => void) | null>(null);

export function ProjectAiLayout({ projectId, children }: { readonly projectId: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [message, setMessage] = useState('');
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollIntoView({ block: 'nearest' });
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setVisible(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [open]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  function openPanel() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (open) setVisible(true); else setOpen(true);
    if (entries.length === 0) void search('');
  }
  function closePanel() {
    setVisible(false);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setOpen(false);
    else closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

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

  return <OpenCandidatePanel.Provider value={openPanel}>
    <div className="flex flex-col gap-4 2xl:flex-row">
    {open ? <div ref={panelRef} className={cn('w-full overflow-hidden 2xl:self-start', AI_CANDIDATE_PANEL_VIEWPORT_CLASSES)}><aside className={cn('flex h-full min-h-80 w-full flex-col rounded-md border border-border bg-bg p-4', AI_CANDIDATE_PANEL_MOTION_CLASSES, visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0')} aria-hidden={!visible} inert={!visible} aria-label={t('projects.aiCandidates.title')} data-testid="project-ai-candidates-panel">
      <div className="flex items-center justify-between gap-3"><h2 className="m-0 text-body font-semibold">{t('projects.aiCandidates.title')}</h2><Tooltip content={t('projects.aiCandidates.close')}><IconButton variant="ghost" size="sm" icon={<Icon name="x" />} aria-label={t('projects.aiCandidates.close')} onClick={closePanel} /></Tooltip></div>
      <p className="text-cell text-fg-muted">{t('projects.aiCandidates.hint')}</p>
      <Link href={`/projects/${projectId}/candidates`} className={SECONDARY_LINK_CLASSES}>{t('projects.aiCandidates.openList')}</Link>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto" aria-live="polite">
        {entries.map((entry, index) => <section key={index} className="flex flex-col gap-2">
          {entry.question ? <p className="m-0 text-body font-semibold">{entry.question}</p> : null}
          {entry.candidates.length === 0 ? <p>{t('projects.aiCandidates.empty')}</p> : entry.candidates.map(({ candidate, reason }) => <div key={candidate.key} className="border-b border-border py-2">
            <p className="m-0 font-semibold">{candidate.kind === 'OWN' && candidate.id ? <Link href={`/engineers/${candidate.id}`}>{candidate.displayName}</Link> : candidate.kind === 'OWN' ? candidate.displayName : t('projects.aiCandidates.shared')}</p>
            <p className="m-0 text-cell">{candidate.skills.join(' / ')}</p><p className="m-0 text-cell text-fg-muted">{reason}</p>
          </div>)}
        </section>)}
        {loading ? <div role="status" className="flex flex-col gap-3"><p className="m-0 text-body">{t('projects.aiCandidates.loading')}</p><Skeleton lines={3} className="motion-reduce:animate-none" /></div> : null}
        {failed ? <p role="alert">{t('projects.aiCandidates.error')}</p> : null}
      </div>
      <form method="post" onSubmit={submit} className="flex gap-2"><Input aria-label={t('projects.aiCandidates.prompt')} value={message} onChange={(event) => setMessage(event.target.value)} /><Button type="submit">{t('projects.aiCandidates.send')}</Button></form>
    </aside></div> : null}
    <div className="min-w-0 flex-1 2xl:order-first">{children}</div>
    </div>
  </OpenCandidatePanel.Provider>;
}

export function ProjectAiCandidates() {
  const openPanel = useContext(OpenCandidatePanel);
  if (!openPanel) throw new Error('候補パネルの配置がありません');
  return <Button variant="primary" data-testid="project-detail-candidates" onClick={openPanel}>{t('projects.aiCandidates.open')}</Button>;
}
