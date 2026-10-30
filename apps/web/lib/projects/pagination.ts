import { t } from '@ses/i18n';
import { formatThousands } from '../format/number';
import { projectListHref, type ProjectHideableColumnId, type ProjectPanelTab } from './list-rows';
import type { ProjectListQuery } from './schemas';

export function projectPageHref(query: ProjectListQuery, page: number, hidden: readonly ProjectHideableColumnId[] = [], tab: ProjectPanelTab = 'BASIC'): string {
  return projectListHref({...query,cursor:undefined,page:page > 1 ? page : undefined},null,hidden,null,tab);
}

export function pageNumbers(current: number, last: number): readonly (number | null)[] {
  if(last <= 7) return Array.from({length:last},(_,i)=>i+1);
  const values = [...new Set([1,last,...Array.from({length:5},(_,i)=>Math.min(last-1,Math.max(2,current-2+i)))])].sort((a,b)=>a-b);
  return values.flatMap((value,index)=>index > 0 && value-values[index-1]! > 1 ? [null,value] : [value]);
}

export function projectPagination(query: ProjectListQuery, total: number, displayed: number, hidden: readonly ProjectHideableColumnId[] = [], tab: ProjectPanelTab = 'BASIC') {
  const last = Math.max(1,Math.ceil(total/query.limit));
  const current = Math.min(query.page ?? 1,last);
  const from = displayed === 0 ? 0 : (current-1)*query.limit+1;
  const to = displayed === 0 ? 0 : Math.min(total,from+displayed-1);
  const href = (page:number) => projectPageHref(query,page,hidden,tab);
  return {
    current, last, limit:query.limit,
    range:t('projects.list.pagination.range').replace('{total}',formatThousands(total)).replace('{from}',formatThousands(from)).replace('{to}',formatThousands(to)),
    sizeLabel:t('projects.list.pagination.size'),
    sizes:[...new Set([25,50,100,query.limit])].sort((a,b)=>a-b).map(value=>({value,label:t('projects.list.pagination.sizeValue').replace('{count}',String(value)),href:projectPageHref({...query,limit:value},1,hidden,tab)})),
    pages:pageNumbers(current,last).map(value=>value === null ? null : ({value,href:href(value)})),
    first:current > 1 ? href(1) : null, previous:current > 1 ? href(current-1) : null,
    next:current < last ? href(current+1) : null, final:current < last ? href(last) : null,
    labels:{nav:t('projects.list.pagination.nav'),first:t('projects.list.pagination.first'),previous:t('projects.list.pagination.previous'),next:t('projects.list.nextPage'),last:t('projects.list.pagination.last'),page:t('projects.list.pagination.page'),ellipsis:t('projects.list.pagination.ellipsis')},
    loading:t('projects.list.pagination.loading'),failed:t('projects.list.pagination.failed'),
  };
}
export type ProjectPaginationModel = ReturnType<typeof projectPagination>;
