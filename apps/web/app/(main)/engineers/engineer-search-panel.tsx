'use client';

import { cloneElement, isValidElement, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@ses/i18n';
import { Button, DIALOG_PANEL_NARROW_CLASSES, Field, FILTER_BODY_CLASSES, Icon, IconButton, Input, SegmentedControl, cn } from '@ses/ui';
import { Dialog, Tooltip } from '@ses/ui/client';
import { SearchPanelTabs } from '../_shared/search-panel-tabs';
import { ActiveFilterBar } from '../projects/_search/active-filter-bar';
import { SavedSearchList } from '../projects/_search/saved-search-list';
import { FilterSelect } from '../projects/_search/filter-select';
import { KeywordGroups } from '../projects/_search/keyword-groups';
import { EMPTY_PROJECT_SEARCH_DRAFT, projectDraftKeywordGroups, type ProjectSearchDraft } from '../projects/_search/filters';
import type { EngineerActiveFilterView } from '../../../lib/engineers/list-rows';

type SavedSearch = { readonly id: string; readonly name: string; readonly query: string; readonly updatedAt: string; readonly lastUsedAt?: string };
type Scope = { readonly tenantId: string; readonly userId: string };

/** 単一選択を案件検索と同じ操作にし、GET フォームへ値を渡す。 */
export function EngineerFilterSelect({ name, initial, label, options, testId }: {
  readonly name: string; readonly initial: string; readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[]; readonly testId: string;
}) {
  const [value, setValue] = useState(initial);
  return <><input type="hidden" name={name} value={value} /><FilterSelect options={options} value={value} onChange={setValue} label={label} testId={`${testId}`}
    messages={{ searchLabel: t('projects.list.search.selectSearchLabel'), searchPlaceholder: t('projects.list.search.selectSearchPlaceholder'), noMatch: t('projects.list.search.selectNoMatch') }} /></>;
}

/** 詳細検索のキーワード操作は案件と同じ部品を使う。 */
export function EngineerKeywordGroups({ initialQ, initialGroups, children }: { readonly initialQ: string; readonly initialGroups: string; readonly children: ReactNode }) {
  const [draft, setDraft] = useState<ProjectSearchDraft>({ ...EMPTY_PROJECT_SEARCH_DRAFT, q: initialQ, keywordGroups: initialGroups });
  const groups = projectDraftKeywordGroups(draft);
  return <>
    <KeywordGroups draft={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} onComposingChange={() => {}} testIdPrefix="engineer-list-filter-" targetLabel={t('engineers.searchPanel.keywordTargets')}>
      {children}
    </KeywordGroups>
    {groups.length ? <input type="hidden" name="keywordGroups" value={JSON.stringify(groups)} /> : null}
  </>;
}

type Option = { readonly value: string; readonly label: string };
type SearchOptions = { readonly skills: readonly Option[]; readonly availability: readonly Option[]; readonly remote: readonly Option[]; readonly prefecture: readonly Option[]; readonly skillMode: readonly Option[] };

export function EngineerSearchPanel({ children, activeFilters, scope, options }: {
  readonly children: ReactNode; readonly activeFilters: readonly EngineerActiveFilterView[]; readonly scope?: Scope; readonly options: SearchOptions;
}) {
  if (!scope) return <>{children}</>;
  return <EngineerSearchPanelInner activeFilters={activeFilters} scope={scope} options={options}>{children}</EngineerSearchPanelInner>;
}

function EngineerSearchPanelInner({ children, activeFilters, scope, options }: {
  readonly children: ReactNode; readonly activeFilters: readonly EngineerActiveFilterView[]; readonly scope: Scope; readonly options: SearchOptions;
}) {
  const router = useRouter();
  const [tab, setTab] = useState('SEARCH');
  const [expanded, setExpanded] = useState(true);
  const [items, setItems] = useState<readonly SavedSearch[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<'SAVE' | 'RENAME' | 'OVERWRITE' | 'REMOVE'>('SAVE');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [savedQuery, setSavedQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [resetVersion, setResetVersion] = useState(0);
  const storageKey = `ses.engineers.savedSearches.v1.${scope.tenantId}.${scope.userId}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) { setItems([]); return; }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > 50 || parsed.some((item) =>
        !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.query !== 'string' || item.query.length > 5000)) throw new Error();
      setItems((parsed as Array<SavedSearch & { updatedAt?: string }>).map((item) => ({ ...item, updatedAt: item.updatedAt ?? '1970-01-01T00:00:00.000Z' })));
    } catch { setItems([]); setNotice(t('engineers.searchPanel.storageError')); }
  }, [storageKey]);

  function persist(next: readonly SavedSearch[]) {
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
    setSavedQuery(currentQuery(form)); setName(''); setTargetId(null); setDialogKind('SAVE'); setDialogOpen(true);
  }
  const openItemDialog = (kind: 'RENAME' | 'OVERWRITE' | 'REMOVE', item: SavedSearch) => {
    const form = document.querySelector<HTMLFormElement>('[data-testid="engineer-list-filters"]');
    setSavedQuery(form ? currentQuery(form) : ''); setName(item.name); setTargetId(item.id); setDialogKind(kind); setDialogOpen(true);
  };
  const chipsOf = (item: SavedSearch) => {
    const labels: Record<string, string> = { skills: t('engineers.list.search.skills'), availability: t('engineers.list.search.availability'), remote: t('engineers.searchPanel.workStyle'), prefecture: t('engineers.list.search.prefecture'), residencePrefecture: t('engineers.searchPanel.residence'), skillMode: t('engineers.list.search.skillMode'), yearsMin: t('engineers.list.search.yearsMin'), priceMin: t('engineers.list.search.priceMin'), priceMax: t('engineers.list.search.priceMax'), availableBy: t('engineers.list.search.availableBy'), q: t('engineers.list.search.q'), keywordGroups: t('projects.search.groups'), utilizationBand: t('projects.search.utilization'), onlyInTime: t('engineers.list.search.onlyInTime'), onlyCommutable: t('engineers.list.search.onlyCommutable') };
    const choices: Record<string, readonly Option[]> = { skills: options.skills, availability: options.availability, remote: options.remote, prefecture: options.prefecture, residencePrefecture: options.prefecture, skillMode: options.skillMode };
    return [...new URLSearchParams(item.query)].flatMap(([key, value], index) => {
      if (!value || !labels[key]) return [];
      const option = choices[key]?.find((entry) => entry.value === value);
      let display = key === 'skills' && !option ? t('engineers.searchPanel.unknownSkill') : option?.label ?? value;
      if (key === 'keywordGroups') {
        try { const groups = JSON.parse(value) as Array<{ terms?: string[] }>; display = groups.flatMap((group) => group.terms ?? []).join(' / '); } catch { return []; }
      }
      return [{ key: `${key}:${index}`, label: `${labels[key]}: ${display}` }];
    });
  };
  const savedBody = <div className={FILTER_BODY_CLASSES}><SavedSearchList items={items} activeId={activeId} broken={false} maxChips={3}
    chipsOf={chipsOf}
    onApply={(item) => { setActiveId(item.id); persist(items.map((entry) => entry.id === item.id ? { ...entry, lastUsedAt: new Date().toISOString() } : entry)); setTab('SEARCH'); setExpanded(true); router.push(item.query ? `/engineers?${item.query}` : '/engineers', { scroll: false }); }}
    onRename={(item) => openItemDialog('RENAME', item)} onOverwrite={(item) => openItemDialog('OVERWRITE', item)} onRemove={(item) => openItemDialog('REMOVE', item)} onSaveCurrent={openSave}
    messages={{ search: t('projects.list.search.savedTable.search'), sort: t('projects.list.search.savedTable.sort'), sortRecent: t('projects.list.search.savedTable.sortRecent'), sortUpdated: t('projects.list.search.savedTable.sortUpdated'), sortName: t('projects.list.search.savedTable.sortName'), columnName: t('projects.list.search.savedTable.columnName'), columnFilters: t('projects.list.search.savedTable.columnFilters'), columnActions: t('projects.list.search.savedTable.columnActions'), countSuffix: t('projects.list.search.savedTable.countSuffix'), range: t('projects.list.search.savedTable.range'), noResults: t('projects.list.search.savedTable.noResults'), previous: t('projects.list.search.savedTable.previous'), next: t('projects.list.search.savedTable.next'), apply: t('projects.list.search.savedApply'), menuLabel: t('projects.list.search.savedMenu'), rename: t('projects.list.search.savedRename'), overwrite: t('projects.list.search.savedOverwrite'), remove: t('projects.list.search.savedRemove'), emptyTitle: t('projects.list.search.savedEmpty'), emptyAction: t('projects.list.search.savedEmptyAction'), brokenNote: t('projects.list.search.savedBroken'), storageNote: t('projects.list.search.savedStorageNote'), noCondition: t('projects.list.search.savedNoCondition'), activeLabel: t('projects.list.search.savedActive') }} testIdPrefix="engineer-list-" /></div>;
  return <div onSubmitCapture={submit}>
    <SearchPanelTabs label={t('engineers.list.search.legend')} value={tab} onValueChange={(value) => { setTab(value); setExpanded(true); }}
      headerRight={<><Tooltip content={t('projects.search.save')}><IconButton type="button" variant="ghost" size="sm" icon={<Icon name="list-plus" />} aria-label={t('projects.search.save')} onClick={openSave} /></Tooltip>
        <Tooltip content={expanded ? t('engineers.searchPanel.collapse') : t('engineers.searchPanel.expand')}><IconButton type="button" variant="ghost" size="sm" icon={<Icon name="chevron-down" className={cn('transition-transform', expanded && 'rotate-180')} />} aria-label={expanded ? t('engineers.searchPanel.collapse') : t('engineers.searchPanel.expand')} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} /></Tooltip></>}
      items={[{ value: 'SEARCH', label: t('engineers.list.search.legend'), content: null }, { value: 'SAVED', label: t('projects.search.saved'), count: items.length, content: null }]} />
    <div className={cn(FILTER_BODY_CLASSES, (!expanded || tab !== 'SEARCH') && 'hidden')} hidden={!expanded || tab !== 'SEARCH'}>{isValidElement(children) ? cloneElement(children, { key: `${String(children.key)}-${resetVersion}` }) : children}</div>
    <div hidden={!expanded || tab !== 'SAVED'}>{savedBody}</div>
    <div data-testid="engineer-search-summary">
      <ActiveFilterBar chips={activeFilters} pending={false} formId="engineer-search-form" testIdPrefix="engineer-list-"
        onRemove={(key) => { const filter = activeFilters.find((item) => item.key === key); if (filter) router.push(filter.href, { scroll: false }); }}
        onClear={() => { setActiveId(null); setResetVersion((value) => value + 1); router.push('/engineers', { scroll: false }); }}
        messages={{ label: t('projects.list.search.selectedLabel'), empty: t('projects.list.search.selectedEmpty'), remove: t('projects.list.search.chipRemove'), overflowLabel: t('projects.list.search.chipOverflow'), clear: t('projects.list.search.clear'), submit: t('projects.list.search.submit'), pending: t('projects.list.search.pending'), pendingHint: t('projects.list.search.pendingHint') }} />
    </div>
    {notice ? <p role="status" className="text-xs text-danger">{notice}</p> : null}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title={t(dialogKind === 'SAVE' ? 'projects.search.save' : dialogKind === 'RENAME' ? 'projects.list.search.savedRename' : dialogKind === 'OVERWRITE' ? 'projects.list.search.savedOverwrite' : 'projects.list.search.savedRemove')} body={t('engineers.searchPanel.localNote')} panelClassName={DIALOG_PANEL_NARROW_CLASSES}
      field={dialogKind === 'SAVE' || dialogKind === 'RENAME' ? <Field label={t('engineers.searchPanel.name')}><Input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></Field> : undefined}
      cancelLabel={t('projects.search.cancel')} confirm={<Button type="button" onClick={() => {
        if ((dialogKind === 'SAVE' || dialogKind === 'RENAME') && (!name.trim() || (dialogKind === 'SAVE' && items.length >= 30))) { setNotice(t('engineers.searchPanel.saveError')); return; }
        const now = new Date().toISOString();
        const next = dialogKind === 'SAVE' ? [...items, { id: crypto.randomUUID(), name: name.trim(), query: savedQuery, updatedAt: now }] : dialogKind === 'REMOVE' ? items.filter((item) => item.id !== targetId) : items.map((item) => item.id !== targetId ? item : { ...item, ...(dialogKind === 'RENAME' ? { name: name.trim() } : { query: savedQuery }), updatedAt: now });
        if (persist(next)) { if (dialogKind === 'REMOVE' && activeId === targetId) setActiveId(null); setDialogOpen(false); setNotice(''); }
      }}>{t(dialogKind === 'SAVE' ? 'projects.search.save' : dialogKind === 'RENAME' ? 'projects.list.search.savedRename' : dialogKind === 'OVERWRITE' ? 'projects.list.search.savedOverwrite' : 'projects.list.search.savedRemove')}</Button>} />
  </div>;
}

/** 登録値の区分と一覧の検索条件を同じ人月表示で選ぶ。 */
export function EngineerUtilizationFilter({ initial }: { readonly initial: string }) {
  const [value, setValue] = useState(initial);
  return <>
    <input type="hidden" name="utilizationBand" value={value} data-testid="engineer-list-filter-utilization" />
    <SegmentedControl value={value} onChange={setValue} label={t('projects.search.utilization')}
      testIdPrefix="engineer-list-utilization-" options={[
        { value: '', label: t('projects.search.all') },
        { value: 'FULL', label: t('projects.search.band.FULL') },
        { value: 'HALF_TO_FULL', label: t('projects.search.band.HALF_TO_FULL') },
        { value: 'UNDER_HALF', label: t('projects.search.band.UNDER_HALF') },
      ]} />
  </>;
}
