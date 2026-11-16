'use client';

import { cloneElement, isValidElement, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@ses/i18n';
import { Badge, Button, DIALOG_PANEL_NARROW_CLASSES, Field, Icon, IconButton, Input, FILTER_SUMMARY_BAR_CLASSES, cn } from '@ses/ui';
import { Dialog, Tabs, Tooltip } from '@ses/ui/client';
import type { EngineerActiveFilterView } from '../../../lib/engineers/list-rows';

type SavedSearch = { readonly id: string; readonly name: string; readonly query: string };
type Scope = { readonly tenantId: string; readonly userId: string };

export function EngineerSearchPanel({ children, activeFilters, scope }: {
  readonly children: ReactNode; readonly activeFilters: readonly EngineerActiveFilterView[]; readonly scope?: Scope;
}) {
  const router = useRouter();
  const [tab, setTab] = useState('SEARCH');
  const [expanded, setExpanded] = useState(true);
  const [items, setItems] = useState<readonly SavedSearch[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [savedQuery, setSavedQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [resetVersion, setResetVersion] = useState(0);
  const storageKey = scope ? `ses.engineers.savedSearches.v1.${scope.tenantId}.${scope.userId}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) { setItems([]); return; }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > 50 || parsed.some((item) =>
        !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.query !== 'string' || item.query.length > 5000)) throw new Error();
      setItems(parsed as SavedSearch[]);
    } catch { setItems([]); setNotice(t('engineers.searchPanel.storageError')); }
  }, [storageKey]);

  function persist(next: readonly SavedSearch[]) {
    if (!storageKey) return false;
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); setItems(next); return true; }
    catch { setNotice(t('engineers.searchPanel.storageError')); return false; }
  }
  function currentQuery(form: HTMLFormElement): string {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === 'string' && value !== '' && key !== 'cursor') params.append(key, value);
    }
    return params.toString();
  }
  function submit(event: FormEvent<HTMLDivElement>) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.testid !== 'engineer-list-filters') return;
    event.preventDefault();
    const query = currentQuery(form);
    router.push(query ? `/engineers?${query}` : '/engineers', { scroll: false });
  }
  function openSave() {
    const form = document.querySelector<HTMLFormElement>('[data-testid="engineer-list-filters"]');
    if (!form) return;
    setSavedQuery(currentQuery(form)); setName(''); setDialogOpen(true);
  }
  const savedBody = <div className="flex flex-col gap-3 p-4">
    <p className="m-0 text-xs text-fg-muted">{t('engineers.searchPanel.localNote')}</p>
    {items.length === 0 ? <p className="m-0 text-body">{t('engineers.searchPanel.empty')}</p> : items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border-row py-2">
      <Button type="button" variant="ghost" onClick={() => { setTab('SEARCH'); setExpanded(true); router.push(item.query ? `/engineers?${item.query}` : '/engineers', { scroll: false }); }}>{item.name}</Button>
      <Tooltip content={t('projects.search.remove')}><IconButton type="button" variant="ghost" size="sm" icon={<Icon name="trash" />} aria-label={`${item.name} ${t('projects.search.remove')}`} onClick={() => persist(items.filter((entry) => entry.id !== item.id))} /></Tooltip>
    </div>)}
  </div>;
  if (!scope) return <>{children}</>;
  return <div onSubmitCapture={submit}>
    <Tabs label={t('engineers.list.search.legend')} value={tab} onValueChange={(value) => { setTab(value); setExpanded(true); }}
      headerRight={<><Tooltip content={t('projects.search.save')}><IconButton type="button" variant="ghost" size="sm" icon={<Icon name="list-plus" />} aria-label={t('projects.search.save')} onClick={openSave} /></Tooltip>
        <Tooltip content={expanded ? t('engineers.searchPanel.collapse') : t('engineers.searchPanel.expand')}><IconButton type="button" variant="ghost" size="sm" icon={<Icon name="chevron-down" className={cn('transition-transform', expanded && 'rotate-180')} />} aria-label={expanded ? t('engineers.searchPanel.collapse') : t('engineers.searchPanel.expand')} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} /></Tooltip></>}
      items={[{ value: 'SEARCH', label: t('engineers.list.search.legend'), content: null }, { value: 'SAVED', label: t('projects.search.saved'), count: items.length, content: null }]} />
    <div hidden={!expanded || tab !== 'SEARCH'}>{isValidElement(children) ? cloneElement(children, { key: `${String(children.key)}-${resetVersion}` }) : children}</div>
    <div hidden={!expanded || tab !== 'SAVED'}>{savedBody}</div>
    <div className={cn(FILTER_SUMMARY_BAR_CLASSES, 'flex-wrap')}  data-testid="engineer-search-summary">
      <span className="text-xs text-fg-muted">{t('engineers.list.filtered.activeTitle')}</span>
      {activeFilters.length ? activeFilters.map((filter) => <Badge key={filter.key} variant="brand"><span>{filter.label}</span><Tooltip content={`${filter.label}${t('engineers.list.filtered.remove')}`}><IconButton type="button" variant="ghost" size="sm" icon={<Icon name="x" />} aria-label={`${filter.label}${t('engineers.list.filtered.remove')}`} onClick={() => router.push(filter.href, { scroll: false })} /></Tooltip></Badge>) : <span className="text-xs text-fg-muted">{t('engineers.searchPanel.noConditions')}</span>}
      <div className="ml-auto flex items-center gap-2">
        <Tooltip content={t('projects.search.clearAll')}><IconButton type="button" variant="ghost" aria-label={t('projects.search.clearAll')} icon={<Icon name="filter-x" />} onClick={() => { setResetVersion((value) => value + 1); router.push('/engineers', { scroll: false }); }} data-testid="engineer-list-clear" /></Tooltip>
        <Tooltip content={t('projects.search.submit')}><IconButton type="submit" form="engineer-search-form" variant="primary" aria-label={t('projects.search.submit')} icon={<Icon name="search" />} data-testid="engineer-list-search" /></Tooltip>
      </div>
    </div>
    {notice ? <p role="status" className="text-xs text-danger">{notice}</p> : null}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title={t('projects.search.save')} body={t('engineers.searchPanel.localNote')} panelClassName={DIALOG_PANEL_NARROW_CLASSES}
      field={<Field label={t('engineers.searchPanel.name')}><Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></Field>}
      cancelLabel={t('projects.search.cancel')} confirm={<Button type="button" onClick={() => { if (!name.trim() || items.length >= 50) { setNotice(t('engineers.searchPanel.saveError')); return; } if (persist([...items, { id: crypto.randomUUID(), name: name.trim(), query: savedQuery }])) { setDialogOpen(false); setNotice(''); } }}>{t('projects.search.save')}</Button>} />
  </div>;
}
