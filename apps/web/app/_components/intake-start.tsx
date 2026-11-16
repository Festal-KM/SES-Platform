'use client';

import { useState } from 'react';
import { t } from '@ses/i18n';
import { Button, Field, Skeleton, Textarea } from '@ses/ui';
import { intakeDraftFromText, type IntakeDraft } from '../../lib/ai-intake/draft';
import { intakeSkillsForAi } from '../../lib/ai-intake/facts';

export function IntakeStart({ kind, skillDictionary, onApply }: {
  readonly kind: 'PROJECT' | 'ENGINEER';
  readonly skillDictionary: readonly { readonly id: string; readonly name: string }[];
  readonly onApply: (draft: IntakeDraft, skills: readonly { readonly id: string; readonly name: string }[]) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function analyze() {
    if (busy) return;
    const found = intakeSkillsForAi(text, skillDictionary.map((skill) => skill.name));
    if (!found.length) { setError(t('intake.ai.noSkills')); return; }
    const draft = intakeDraftFromText(text, kind);
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/ai-intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, skills: found }) });
      if (!response.ok) throw new Error();
      const { runId } = await response.json() as { runId: string };
      let completed = false;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const poll = await fetch(`/api/ai-intake?runId=${encodeURIComponent(runId)}`, { cache: 'no-store' });
        if (!poll.ok) throw new Error();
        const result = await poll.json() as { status: 'PENDING' | 'COMPLETED' | 'FAILED'; skills?: string[] };
        if (result.status === 'FAILED') throw new Error();
        if (result.status === 'COMPLETED') {
          const selected = new Set(result.skills ?? []);
          onApply(draft, skillDictionary.filter((skill) => selected.has(skill.name.normalize('NFKC').trim())));
          setNotice(t(kind === 'PROJECT' ? 'intake.ai.projectReview' : 'intake.ai.engineerReview')); completed = true; break;
        }
      }
      if (!completed) throw new Error();
    } catch { setError(t('intake.ai.error')); }
    finally { setBusy(false); }
  }

  return <section className="flex flex-col gap-3 border border-border bg-bg p-4" data-testid="intake-start">
    <h2 className="m-0 text-body font-semibold">{t(kind === 'PROJECT' ? 'intake.ai.projectTitle' : 'intake.ai.engineerTitle')}</h2>
    <p className="m-0 text-cell text-fg-muted">{t('intake.ai.description')}</p>
    <Field as="div" label={t('intake.ai.textLabel')}>
      <Textarea aria-label={t('intake.ai.textLabel')} value={text} onChange={(event) => setText(event.target.value)} rows={8} maxLength={20000} data-testid="intake-text" />
    </Field>
    <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void analyze()} data-testid="intake-analyze">{t('intake.ai.analyze')}</Button>
      <Button type="button" variant="secondary" onClick={() => document.getElementById('intake-manual-start')?.focus()} data-testid="intake-manual">{t('intake.ai.manual')}</Button></div>
    {busy ? <div role="status" className="flex flex-col gap-2"><span>{t('intake.ai.loading')}</span><Skeleton lines={2} className="motion-reduce:animate-none" /></div> : null}
    {error ? <p role="alert" className="m-0 text-danger">{error}</p> : null}
    {notice ? <p role="status" className="m-0 text-fg-muted">{notice}</p> : null}
  </section>;
}
