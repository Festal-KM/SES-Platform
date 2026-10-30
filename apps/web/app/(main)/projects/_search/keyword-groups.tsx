'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@ses/i18n';
import { type ProjectKeywordGroup } from '@ses/domain';
import { Button, Field, Icon, IconButton, Input, Radio, SEARCH_KEYWORD_CHIP_CLASSES, cn } from '@ses/ui';
import { projectDraftKeywordGroups, type ProjectSearchDraft } from './filters';

function readGroups(draft: ProjectSearchDraft): ProjectKeywordGroup[] {
  const groups = projectDraftKeywordGroups(draft);
  return groups.length ? groups : [{ mode: 'OR', terms: [] }];
}

export function KeywordGroups({ compact = false, openRequest = 0, draft, onChange, onComposingChange, testIdPrefix }: {
  readonly compact?: boolean;
  readonly openRequest?: number;
  readonly draft: ProjectSearchDraft;
  readonly onChange: (patch: Partial<ProjectSearchDraft>) => void;
  readonly onComposingChange: (value: boolean) => void;
  readonly testIdPrefix: string;
}) {
  const [groups, setGroups] = useState<ProjectKeywordGroup[]>(() => readGroups(draft));
  const [pending, setPending] = useState<Readonly<Record<number, string>>>({});
  const [open, setOpen] = useState(Boolean(draft.q || draft.keywordGroups));
  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);
  const [error, setError] = useState('');
  const root = useRef<HTMLDetailsElement>(null);
  const focusRequest = useRef<number | null>(null);
  function focusInput(index: number, scroll = false): void {
    const input = root.current?.querySelectorAll<HTMLInputElement>('input[data-keyword-input]')[index];
    input?.focus({ preventScroll: true });
    if (scroll) input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  useEffect(() => {
    if (focusRequest.current === null) return;
    focusInput(focusRequest.current, true); focusRequest.current = null;
  }, [groups.length]);
  const signature = `${draft.q}\n${draft.keywordGroups ?? ''}`;
  const lastWritten = useRef(signature);
  useEffect(() => {
    if (signature === lastWritten.current) return;
    lastWritten.current = signature;
    setGroups(readGroups(draft)); setPending({});
  }, [signature, draft]);

  function update(next: ProjectKeywordGroup[]): boolean {
    const active = next.filter(group => group.terms.length);
    const keywordGroups = active.length ? JSON.stringify(active) : '';
    if (keywordGroups.length > 4000) { setError(t('projects.search.keywordTotalLimit')); return false; }
    setGroups(next); setError('');
    lastWritten.current = `\n${keywordGroups}`;
    onChange({ q: '', keywordGroups });
    return true;
  }
  function addTerm(index: number): void {
    const value = pending[index]?.trim();
    if (!value) return;
    const group = groups[index];
    if (!group) return;
    const terms = [...new Set([...group.terms, ...value.split('|').map(term => term.trim()).filter(Boolean)])];
    if (terms.length > 10 || terms.some(term => term.length > 200)) { setError(t('projects.search.keywordLimit')); return; }
    if (!update(groups.map((item, i) => i === index ? { ...item, terms } : item))) return;
    setPending(current => ({ ...current, [index]: '' })); setError(''); focusInput(index);
  }
  const active = groups.filter(group => group.terms.length);
  const expression = active.map(group => group.terms.length > 1 ? `(${group.terms.join(` ${group.mode} `)})` : group.terms[0]).join(` ${t('projects.search.and')} `);
  return <details ref={root} className="border-t border-border pt-3" open={open} onToggle={event => setOpen(event.currentTarget.open)} data-testid={`${testIdPrefix}advanced`}>
    <summary className="flex cursor-pointer flex-wrap items-center gap-3 bg-bg-subtle px-3 py-3 text-body text-fg" title={t('projects.search.advancedTargets')}>
      <span className="font-semibold">{t('projects.search.advanced')}</span>
      <span className="rounded-sm bg-brand-bg px-2 py-1 text-xs text-brand">{groups.length}{t('projects.search.groupCountSuffix')}</span>
      {open ? <span className="min-w-0 flex-1 text-xs text-fg-muted">{t('projects.search.advancedLead')}</span> : null}
      {!open && expression ? <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={expression}>{expression}</span> : null}
      <Icon name="chevron-down" className={open ? 'ml-auto rotate-180' : 'ml-auto'} />
    </summary>
    <div className="flex min-w-0 flex-col gap-3 py-3">
      <p className="m-0 rounded-md bg-brand-bg px-4 py-3 text-cell text-fg-muted" data-testid={`${testIdPrefix}keyword-guide`}>{t('projects.search.keywordGuide')}</p>
      {groups.map((group, index) => <div key={index}>
        {index > 0 ? <div className="mb-3 flex items-center gap-4" data-testid={`${testIdPrefix}keyword-connector-${index}`}><span className="h-px flex-1 bg-border" /><span className="rounded-lg bg-bg-subtle px-3 py-1 text-cell text-fg">{t('projects.search.and')}</span><span className="h-px flex-1 bg-border" /></div> : null}
        <div className={cn('min-w-0 gap-3 rounded-md border border-border px-4 py-4', compact ? 'grid grid-cols-2 items-center' : 'flex flex-wrap items-center')} data-testid={`${testIdPrefix}keyword-row-${index}`}>
          <strong className="shrink-0 text-cell">{t('projects.search.group')}{index + 1}</strong>
          <fieldset className={cn('flex min-w-0 flex-wrap items-center gap-3', compact ? 'order-2 col-span-2' : null)}>
            <legend className="sr-only">{t('projects.search.groupMode')}{index + 1}</legend>
            {(['OR', 'AND'] as const).map(mode => <label key={mode} className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-xs">
              <Radio form="" name={`${testIdPrefix}mode-${index}`} value={mode} checked={group.mode === mode}
                onChange={() => update(groups.map((item, i) => i === index ? { ...item, mode } : item))} data-testid={`${testIdPrefix}keyword-mode-${index}-${mode}`} />
              {t(mode === 'OR' ? 'projects.search.modeOR' : 'projects.search.modeAND')}
            </label>)}
          </fieldset>
          <Field as="div" className={cn('min-w-0 flex-1', compact ? 'order-3 col-span-2' : null)} labelClassName="sr-only" label={`${t('projects.search.group')}${index + 1}`}>
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2">
              {group.terms.map((term, termIndex) => <span key={term} className="flex min-w-0 items-center gap-2">
                {termIndex > 0 ? <span className="text-xs text-brand">{group.mode}</span> : null}
                <Button type="button" variant="ghost" size="sm" className={cn(SEARCH_KEYWORD_CHIP_CLASSES, 'bg-brand-bg text-brand')} aria-label={`${term} ${t('projects.search.removeKeyword')}`}
                  onClick={() => update(groups.map((item, i) => i === index ? { ...item, terms: item.terms.filter(value => value !== term) } : item))}
                  data-testid={`${testIdPrefix}keyword-term-${index}-${termIndex}`}><span className="whitespace-normal break-all">{term}</span><Icon name="x" /></Button>
              </span>)}
              {!group.terms.length ? <Button type="button" variant="ghost" size="sm" className="border border-dashed border-brand text-brand" onClick={() => focusInput(index)} data-testid={`${testIdPrefix}keyword-empty-${index}`}><Icon name="plus" />{t('projects.search.firstKeyword')}</Button> : null}
              <Input data-keyword-input className="w-auto min-w-24 flex-1" name={index === 0 ? 'q' : undefined} value={pending[index] ?? ''} maxLength={200} placeholder={t('projects.search.keywordInput')}
                aria-label={`${t('projects.search.addKeyword')} ${index + 1}`} data-testid={index === 0 ? `project-list-filter-q` : `${testIdPrefix}keyword-group-${index}`}
                onChange={event => { const value = event.currentTarget.value; setPending(current => ({ ...current, [index]: value })); }}
                onCompositionStart={() => onComposingChange(true)} onCompositionEnd={() => onComposingChange(false)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTerm(index); } }} />
              <span className="rounded-sm bg-brand-bg px-2 py-1 text-xs text-fg-muted">{t('projects.search.addKeywordHint')}</span>
              <Button type="button" variant="ghost" size="sm" className="bg-brand-bg text-brand" disabled={!pending[index]?.trim()} onClick={() => addTerm(index)} data-testid={`${testIdPrefix}keyword-add-${index}`}>{t('projects.search.addTerm')}</Button>
            </div>
          </Field>
          <IconButton type="button" variant="ghost" size="sm" className={compact ? 'order-1 justify-self-end' : undefined} icon={<Icon name="trash" />} aria-label={`${t('projects.search.removeGroup')} ${index + 1}`}
            onClick={() => { const next = groups.filter((_, i) => i !== index); update(next.length ? next : [{ mode: 'OR', terms: [] }]); setPending({}); }}
            data-testid={`${testIdPrefix}remove-group-${index}`} />
        </div>
      </div>)}
      {groups.length < 10 ? <Button type="button" variant="secondary" className="w-full justify-start gap-2 border-dashed border-brand text-brand" onClick={() => { focusRequest.current = groups.length; setGroups(current => [...current, { mode: 'OR', terms: [] }]); }} data-testid={`${testIdPrefix}add-group`}><Icon name="plus" />{t('projects.search.addGroup')}</Button> : null}
      {error ? <p role="alert" className="m-0 text-xs text-danger">{error}</p> : null}

      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-md bg-brand-bg p-3 text-cell text-fg" data-testid={`${testIdPrefix}expression`}>
        <strong>{t('projects.search.conditionPreview')}</strong>
        {active.length ? active.map((group, index) => <span key={index} className="flex min-w-0 flex-wrap items-center gap-2">
          {index > 0 ? <strong className="text-brand">{t('projects.search.and')}</strong> : null}
          <span className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface px-2 py-1">
            <span aria-hidden>{t('projects.search.openParenthesis')}</span>
            {group.terms.map((term, termIndex) => <span key={term} className="flex min-w-0 items-center gap-2">{termIndex > 0 ? <strong className="text-brand">{group.mode}</strong> : null}<span className="min-w-0 break-all rounded-sm bg-brand-bg px-2 py-1 text-brand">{term}</span></span>)}
            <span aria-hidden>{t('projects.search.closeParenthesis')}</span>
          </span>
        </span>) : <span className="text-fg-muted">{t('projects.search.noKeywords')}</span>}
      </div>
    </div>
  </details>;
}
