'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Checkbox, PAGE_BODY_PROSE_MAX_WIDTH_CLASS, SECONDARY_LINK_CLASSES } from '@ses/ui';
import { Dialog } from '@ses/ui/client';
import { t } from '@ses/i18n';
import type { ProjectVisibilityChoice } from '../../../../lib/projects/visibility';
import { VISIBILITY_PARTNER_COMPANIES_MAX } from '../../../../lib/projects/visibility-limits';

export function ProjectVisibilityPopup({ projectId, choices, denialMessage }: {
  readonly projectId: string;
  readonly choices: readonly ProjectVisibilityChoice[];
  readonly denialMessage: string | null;
}) {
  const router = useRouter();
  const saved = choices.filter((choice) => choice.publishedOn !== null).map((choice) => choice.partnerCompanyId);
  const [selected, setSelected] = useState<readonly string[]>(saved);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const dirty = saved.length !== selected.length || saved.some((id) => !selected.includes(id));

  async function save(next: readonly string[]) {
    if (saving) return;
    if (denialMessage !== null) { setNotice(denialMessage); return; }
    if (next.length > VISIBILITY_PARTNER_COMPANIES_MAX) { setNotice(t('projects.visibilitySettings.popup.tooMany')); return; }
    if (saved.some((id) => !next.includes(id)) && !window.confirm(t('projects.visibilitySettings.revoke.confirm.lead'))) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/visibility`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partnerCompanyIds: next }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { verdict: 'PENDING_GATE' | 'NO_PUBLISH_REQUESTED' };
      setSelected(next);
      setNotice(t(result.verdict === 'PENDING_GATE' ? 'projects.visibilitySettings.result.pendingGate' : 'projects.visibilitySettings.result.noPublish'));
      setOpen(false);
      router.refresh();
    } catch {
      setNotice(t('projects.visibilitySettings.error.save'));
    } finally { setSaving(false); }
  }

  return <>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={() => {
        if (choices.length === 0) { setNotice(t('projects.visibilitySettings.select.empty.title')); return; }
        void save(choices.map((choice) => choice.partnerCompanyId));
      }} data-testid="project-visibility-publish-all">
        {t('projects.visibilitySettings.popup.all')}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => { setNotice(''); setSelected(saved); setOpen(true); }} data-testid="project-detail-visibility-settings">
        {t('projects.visibilitySettings.popup.partial')}
      </Button>
      {saved.length > 0 ? <Button type="button" variant="secondary" size="sm" onClick={() => void save([])} data-testid="project-visibility-unpublish">
        {t('projects.visibilitySettings.popup.private')}
      </Button> : null}
    </div>
    <p className="mt-2 text-xs text-fg-muted">{t('projects.visibilitySettings.popup.allScope')}</p>
    <Link className={SECONDARY_LINK_CLASSES} href={`/projects/${projectId}/visibility`} data-testid="project-detail-visibility-manage">{t('projects.visibilitySettings.popup.details')}</Link>
    {!open && notice ? <p role="status" className="mt-2 text-cell text-fg-muted" data-testid="project-visibility-popup-notice">{notice}</p> : null}
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && dirty && !window.confirm(t('projects.visibilitySettings.leaveConfirm'))) return;
      setOpen(next);
    }} title={t('projects.visibilitySettings.title')} body={t('projects.visibilitySettings.popup.description')} panelClassName={PAGE_BODY_PROSE_MAX_WIDTH_CLASS}
      field={<div>
        {choices.length === 0 ? <p className="m-0 text-body text-fg-muted">{t('projects.visibilitySettings.select.empty.title')}</p> : (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border sm:max-h-80" data-testid="project-visibility-partner-list">
            {choices.map((choice) => (
              <label key={choice.partnerCompanyId} className="flex min-h-12 items-center gap-3 border-b border-border px-3 py-2 text-body last:border-b-0">
                <Checkbox checked={selected.includes(choice.partnerCompanyId)} onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected((current) => checked
                    ? [...current, choice.partnerCompanyId]
                    : current.filter((id) => id !== choice.partnerCompanyId));
                }} data-testid={`project-visibility-partner-${choice.partnerCompanyId}`} />
                <span className="min-w-0 break-words">{choice.name}</span>
                {choice.suspended ? <span className="text-xs text-fg-muted">{t('projects.visibilitySettings.select.suspendedBadge')}</span> : null}
              </label>
            ))}
          </div>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])} data-testid="project-visibility-clear">{t('projects.visibilitySettings.popup.clear')}</Button>
        {notice ? <p role="alert" className="mt-2 text-cell text-danger">{notice}</p> : null}</div>}
      confirm={<Button type="button" onClick={() => void save(selected)}>{saving ? t('projects.visibilitySettings.submitting') : t('projects.visibilitySettings.submit')}</Button>}
      cancelLabel={t('projects.visibilitySettings.revoke.confirm.cancel')} />
  </>;
}
