'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@ses/i18n';
import { type ProjectKeywordGroup } from '@ses/domain';
import { Button, Field, Icon, IconButton, Input, Radio } from '@ses/ui';
import { projectDraftKeywordGroups, type ProjectSearchDraft } from './filters';

function readGroups(draft: ProjectSearchDraft): ProjectKeywordGroup[] {
  const groups = projectDraftKeywordGroups(draft);
  return groups.length ? groups : [{ mode: 'OR', terms: [] }];
}

export function KeywordGroups({ draft, onChange, onComposingChange, testIdPrefix }: {
  readonly draft: ProjectSearchDraft;
  readonly onChange: (patch: Partial<ProjectSearchDraft>) => void;
  readonly onComposingChange: (value: boolean) => void;
  readonly testIdPrefix: string;
}) {
  const [groups, setGroups] = useState<ProjectKeywordGroup[]>(() => readGroups(draft));
  const [pending, setPending] = useState<Readonly<Record<number, string>>>({});
  const [open, setOpen] = useState(Boolean(draft.q || draft.keywordGroups));
  const [error, setError] = useState('');
  const signature = `${draft.q}\n${draft.keywordGroups ?? ''}`;
  const lastWritten = useRef(signature);
  useEffect(() => {
    if (signature === lastWritten.current) return;
    lastWritten.current = signature;
    setGroups(readGroups(draft)); setPending({});
  }, [signature, draft]);

  function update(next: ProjectKeywordGroup[]): void {
    setGroups(next);
    const active = next.filter(group => group.terms.length);
    const keywordGroups = active.length ? JSON.stringify(active) : '';
    lastWritten.current = `\n${keywordGroups}`;
    onChange({ q: '', keywordGroups });
  }
  function addTerm(index: number): void {
    const value = pending[index]?.trim();
    if (!value) return;
    const group = groups[index];
    if (!group) return;
    const terms = [...new Set([...group.terms, ...value.split('|').map(term => term.trim()).filter(Boolean)])];
    if (terms.length > 10 || terms.some(term => term.length > 200)) { setError(t('projects.search.keywordLimit')); return; }
    update(groups.map((item, i) => i === index ? { ...item, terms } : item));
    setPending(current => ({ ...current, [index]: '' })); setError('');
  }
  const active = groups.filter(group => group.terms.length);
  const expression = active.map(group => group.terms.length > 1 ? `(${group.terms.join(` ${group.mode} `)})` : group.terms[0]).join(` ${t('projects.search.and')} `);
  return <details className="border-t border-border pt-3" open={open} onToggle={event => setOpen(event.currentTarget.open)} data-testid={`${testIdPrefix}advanced`}>
    <summary className="flex cursor-pointer flex-wrap items-center gap-3 bg-bg-subtle px-3 py-3 text-body text-fg">
      <span className="font-semibold">{t('projects.search.advanced')}</span>
      {active.length ? <span className="text-xs text-fg-muted">{active.length}{t('projects.search.groupCountSuffix')}</span> : null}
      {!open && expression ? <span className="min-w-0 flex-1 break-words text-xs text-fg-muted">{expression}</span> : null}
      <Icon name="chevron-down" className={open ? 'ml-auto rotate-180' : 'ml-auto'} />
    </summary>
    <div className="flex min-w-0 flex-col gap-3 py-3">
      <p className="m-0 text-xs text-fg-muted">{t('projects.search.advancedTargets')}<br />{t('projects.search.advancedHint')}</p>
      {groups.map((group, index) => <div key={index}>
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border p-3" data-testid={`${testIdPrefix}keyword-row-${index}`}>
          <strong className="shrink-0 text-cell">{t('projects.search.group')}{index + 1}</strong>
          <fieldset className="flex min-w-0 flex-wrap items-center gap-3">
            <legend className="sr-only">{t('projects.search.groupMode')}{index + 1}</legend>
            {(['OR', 'AND'] as const).map(mode => <label key={mode} className="flex cursor-pointer items-center gap-1 text-xs">
              <Radio form="" name={`${testIdPrefix}mode-${index}`} value={mode} checked={group.mode === mode}
                onChange={() => update(groups.map((item, i) => i === index ? { ...item, mode } : item))} data-testid={`${testIdPrefix}keyword-mode-${index}-${mode}`} />
              {t(mode === 'OR' ? 'projects.search.modeOR' : 'projects.search.modeAND')}
            </label>)}
          </fieldset>
          <Field as="div" className="min-w-0 flex-1" labelClassName="sr-only" label={`${t('projects.search.group')}${index + 1}`}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {group.terms.map((term, termIndex) => <span key={term} className="flex min-w-0 items-center gap-2">
                {termIndex > 0 ? <span className="text-xs text-brand">{group.mode}</span> : null}
                <Button type="button" variant="ghost" size="sm" className="min-w-0 bg-brand-bg text-brand" aria-label={`${term} ${t('projects.search.removeKeyword')}`}
                  onClick={() => update(groups.map((item, i) => i === index ? { ...item, terms: item.terms.filter(value => value !== term) } : item))}
                  data-testid={`${testIdPrefix}keyword-term-${index}-${termIndex}`}><span className="break-all">{term}</span><Icon name="x" /></Button>
              </span>)}
              <Input className="w-auto min-w-24 flex-1" name={index === 0 ? 'q' : undefined} value={pending[index] ?? ''} maxLength={200} placeholder={t('projects.search.addKeywordHint')}
                aria-label={`${t('projects.search.addKeyword')} ${index + 1}`} data-testid={index === 0 ? `${testIdPrefix}q` : `${testIdPrefix}keyword-group-${index}`}
                onChange={event => setPending(current => ({ ...current, [index]: event.currentTarget.value }))}
                onCompositionStart={() => onComposingChange(true)} onCompositionEnd={() => onComposingChange(false)}
                onBlur={() => addTerm(index)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTerm(index); } }} />
            </div>
          </Field>
          <IconButton type="button" variant="ghost" size="sm" icon={<Icon name="trash" />} aria-label={`${t('projects.search.removeGroup')} ${index + 1}`}
            onClick={() => { const next = groups.filter((_, i) => i !== index); update(next.length ? next : [{ mode: 'OR', terms: [] }]); setPending({}); }}
            data-testid={`${testIdPrefix}remove-group-${index}`} />
        </div>
      </div>)}
      {error ? <p role="alert" className="m-0 text-xs text-danger">{error}</p> : null}
      {groups.length < 10 ? <div><Button type="button" variant="secondary" size="sm" onClick={() => setGroups(current => [...current, { mode: 'OR', terms: [] }])} data-testid={`${testIdPrefix}add-group`}>{t('projects.search.addGroup')}</Button></div> : null}
      {expression ? <p className="m-0 break-words bg-bg-subtle p-3 text-xs text-fg" data-testid={`${testIdPrefix}expression`}>{t('projects.search.expression')}{t('projects.search.expressionSeparator')}{expression}</p> : null}
    </div>
  </details>;
}
