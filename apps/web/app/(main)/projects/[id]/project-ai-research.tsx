'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@ses/i18n';
import { Button, Icon, Input } from '@ses/ui';

/** 案件を離れずに相談画面を開く。AIへの送信はまだ接続しない。 */
export function ProjectAiResearch() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return <>
    <Button ref={triggerRef} type="button" aria-expanded={open} aria-controls={panelId} data-testid="project-detail-candidates" onClick={() => setOpen(true)}>
      <Icon name="search" /><span>{t('projects.detail.aiResearch.open')}</span>
    </Button>
    {open ? <aside id={panelId} aria-label={t('projects.detail.aiResearch.title')} className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface sm:w-[388px]">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div><h2 className="text-lg font-semibold text-fg">{t('projects.detail.aiResearch.title')}</h2><p className="text-body text-fg-muted">{t('projects.detail.aiResearch.subtitle')}</p></div>
        <Button ref={closeRef} type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>{t('projects.detail.aiResearch.close')}</Button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className="rounded-lg bg-bg-subtle p-4 text-body text-fg">{t('projects.detail.aiResearch.intro')}</p>
        <p className="text-body text-fg-muted">{t('projects.detail.aiResearch.preparing')}</p>
      </div>
      <div className="border-t border-border p-4"><Input aria-label={t('projects.detail.aiResearch.placeholder')} placeholder={t('projects.detail.aiResearch.placeholder')} disabled /></div>
    </aside> : null}
  </>;
}
