'use client';

// 保存条件はブラウザー・ユーザーごとの既存ストアを使用する。
import { useState } from 'react';
import {
  Badge, Button, Field, Icon, IconButton, Input, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  MULTI_SELECT_BADGE_CLASSES, FOCUS_RING_CLASSES, cn,
} from '@ses/ui';
import { DropdownMenu } from '@ses/ui/client';
import type { ProjectSearchChip } from './filters';
import type { SavedSearch } from './saved-searches';

export type SavedSearchSort = 'RECENT' | 'UPDATED' | 'NAME';
export const SAVED_SEARCH_PAGE_SIZE = 10;

/** 保存名と条件の全文を対象にAND検索する。保存順・条件本体は書き換えない。 */
export function visibleSavedSearches(
  items: readonly SavedSearch[],
  query: string,
  sort: SavedSearchSort,
  chipsOf: (item: SavedSearch) => readonly ProjectSearchChip[],
): SavedSearch[] {
  const terms = query.toLocaleLowerCase('ja').trim().split(/\s+/u).filter(Boolean);
  return items.filter((item) => {
    const text = [item.name, ...chipsOf(item).map((chip) => chip.label)].join(' ').toLocaleLowerCase('ja');
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    if (sort === 'NAME') return a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id);
    const dateOf = (item: SavedSearch): string => sort === 'RECENT' ? item.lastUsedAt ?? item.updatedAt : item.updatedAt;
    return dateOf(b).localeCompare(dateOf(a)) || a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id);
  });
}

export type SavedSearchListMessages = {
  readonly apply: string;
  readonly menuLabel: string;
  readonly rename: string;
  readonly overwrite: string;
  readonly remove: string;
  readonly emptyTitle: string;
  readonly emptyAction: string;
  readonly brokenNote: string;
  readonly storageNote: string;
  readonly noCondition: string;
  readonly activeLabel: string;
  readonly search: string;
  readonly sort: string;
  readonly sortRecent: string;
  readonly sortUpdated: string;
  readonly sortName: string;
  readonly columnName: string;
  readonly columnFilters: string;
  readonly columnActions: string;
  readonly countSuffix: string;
  readonly range: string;
  readonly noResults: string;
  readonly previous: string;
  readonly next: string;
};

export function SavedSearchList({
  items, activeId, broken, maxChips, chipsOf, onApply, onRename, onOverwrite, onRemove,
  onSaveCurrent, messages, testIdPrefix,
}: {
  readonly items: readonly SavedSearch[];
  /** 編集中も適用元の保存条件のIDを維持する。 */
  readonly activeId: string | null;
  readonly broken: boolean;
  readonly maxChips: number;
  readonly chipsOf: (item: SavedSearch) => readonly ProjectSearchChip[];
  readonly onApply: (item: SavedSearch) => void;
  readonly onRename: (item: SavedSearch) => void;
  readonly onOverwrite: (item: SavedSearch) => void;
  readonly onRemove: (item: SavedSearch) => void;
  readonly onSaveCurrent: () => void;
  readonly messages: SavedSearchListMessages;
  readonly testIdPrefix: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SavedSearchSort>('RECENT');
  const [page, setPage] = useState(0);
  const filtered = visibleSavedSearches(items, query, sort, chipsOf);
  const lastPage = Math.max(0, Math.ceil(filtered.length / SAVED_SEARCH_PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * SAVED_SEARCH_PAGE_SIZE;
  const rows = filtered.slice(start, start + SAVED_SEARCH_PAGE_SIZE);
  const range = messages.range.replace('{total}', String(filtered.length))
    .replace('{from}', String(filtered.length === 0 ? 0 : start + 1))
    .replace('{to}', String(start + rows.length));

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2" data-testid={`${testIdPrefix}saved-empty`}>
        <p className="m-0 text-body text-fg-muted">{messages.emptyTitle}</p>
        {broken ? <p className="m-0 text-xs text-danger">{messages.brokenNote}</p> : null}
        <Button type="button" variant="secondary" onClick={onSaveCurrent} data-testid={`${testIdPrefix}saved-empty-save`}>
          {messages.emptyAction}
        </Button>
        <p className="m-0 text-xs text-fg-muted">{messages.storageNote}</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Field label={messages.search} labelClassName="sr-only" className="min-w-0 flex-1">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
            <Input type="search" className="pl-8" value={query} placeholder={messages.search}
              data-testid={`${testIdPrefix}saved-search`}
              onChange={(event) => { setQuery(event.currentTarget.value); setPage(0); }} />
          </div>
        </Field>
        <span className="shrink-0 text-xs text-fg-muted" aria-live="polite">{filtered.length}{messages.countSuffix}</span>
        <Field label={messages.sort} labelClassName="sr-only" width="auto">
          <Select value={sort} data-testid={`${testIdPrefix}saved-sort`}
            onChange={(event) => { setSort(event.currentTarget.value as SavedSearchSort); setPage(0); }}>
            <option value="RECENT">{messages.sortRecent}</option>
            <option value="UPDATED">{messages.sortUpdated}</option>
            <option value="NAME">{messages.sortName}</option>
          </Select>
        </Field>
      </div>
      <div data-testid={`${testIdPrefix}saved-list`}>
        <Table className="[&_td]:py-1 [&_thead]:bg-table-header-bg" containerClassName="max-h-96 rounded-none border-x-0" data-testid={`${testIdPrefix}saved-table`}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/4" whitespace="normal">{messages.columnName}</TableHead>
              <TableHead whitespace="normal">{messages.columnFilters}</TableHead>
              <TableHead>{messages.columnActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => {
              const active = item.id === activeId;
              const chips = chipsOf(item);
              const shown = chips.slice(0, maxChips);
              const hidden = chips.slice(maxChips);
              return (
                <TableRow key={item.id} className="cursor-pointer border-b border-border-row" onClick={() => { onApply(item); }} data-state={active ? 'selected' : undefined}
                  data-testid={`${testIdPrefix}saved-card`}>
                  <TableCell whitespace="normal">
                    <button type="button" className={cn('cursor-pointer break-words text-left text-cell font-medium', FOCUS_RING_CLASSES)}
                      title={item.name} aria-label={`${item.name} ${messages.apply}`} data-testid={`${testIdPrefix}saved-apply`}>
                      {item.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1" title={chips.map((chip) => chip.label).join('、')}>
                      {shown.map((chip) => (
                        <Badge key={chip.key} variant={active ? 'brand' : 'neutral'} className={cn(MULTI_SELECT_BADGE_CLASSES, 'text-xs')}>
                          <span className="truncate">{chip.label}</span>
                        </Badge>
                      ))}
                      {hidden.length === 0 ? null : (
                        <Badge variant={active ? 'brand' : 'neutral'} title={hidden.map((chip) => chip.label).join('、')}>
                          +{hidden.length}
                        </Badge>
                      )}
                      {chips.length === 0 ? <span className="text-xs text-fg-muted">{messages.noCondition}</span> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {active ? <span className="text-xs font-medium text-brand">{messages.activeLabel}</span> : null}
                      <div onClick={(event) => { event.stopPropagation(); }}>
                      <DropdownMenu align="end" trigger={
                        <IconButton type="button" variant="ghost" size="sm" icon={<Icon name="more-horizontal" size="sm" />}
                          aria-label={`${item.name} ${messages.menuLabel}`} data-testid={`${testIdPrefix}saved-menu`} />
                      } items={[
                        { kind: 'action', label: messages.rename, onSelect: () => { onRename(item); } },
                        { kind: 'action', label: messages.overwrite, onSelect: () => { onOverwrite(item); } },
                        { kind: 'action', label: messages.remove, onSelect: () => { onRemove(item); } },
                      ]} />
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length > 0 ? null : (
              <TableRow><TableCell colSpan={3} whitespace="normal">{messages.noResults}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span data-testid={`${testIdPrefix}saved-range`}>{range}</span>
        {lastPage === 0 ? null : (
          <div className="flex items-center gap-2">
            {currentPage === 0 ? null : <Button type="button" variant="ghost" size="sm"
              onClick={() => { setPage(currentPage - 1); }}>{messages.previous}</Button>}
            {currentPage === lastPage ? null : <Button type="button" variant="ghost" size="sm"
              onClick={() => { setPage(currentPage + 1); }}>{messages.next}</Button>}
          </div>
        )}
        <span>{messages.storageNote}</span>
      </div>
      {broken ? <p className="m-0 text-xs text-danger">{messages.brokenNote}</p> : null}
    </div>
  );
}
