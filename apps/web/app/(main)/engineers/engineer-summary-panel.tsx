import Link from 'next/link';
import { t } from '@ses/i18n';
import { Card, PANEL_KEY_WIDTH_CLASS, PANEL_KV_ROW_HEIGHT_CLASS, SECONDARY_BUTTON_LINK_CLASSES, StatusBadge, cn } from '@ses/ui';
import type { EngineerListRowView } from '../../../lib/engineers/list-rows';

/** 一覧に表示済みの情報だけを使う。詳細情報は遷移先で閲覧監査を記録する。 */
export function EngineerSummaryPanel({ row }: { readonly row: EngineerListRowView | null }) {
  if (!row) return <Card className="p-4" data-testid="engineer-list-panel"><h2 className="m-0 text-body font-semibold">{t('engineers.list.panel.title')}</h2><p className="text-cell text-fg-muted">{t('engineers.list.panel.empty')}</p></Card>;
  const fields = [
    [t('engineers.list.column.skills'), row.skills.join('、')],
    [t('engineers.list.column.unitPrice'), row.unitPrice],
    [t('engineers.list.column.availableFrom'), row.availableFrom],
    [t('engineers.list.column.location'), row.location],
    [t('engineers.list.column.updatedOn'), row.updatedOn],
  ];
  return <Card className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="engineer-list-panel">
    <div className="flex flex-col gap-2 p-4"><h2 className="m-0 text-lg font-bold">{row.displayName}</h2><StatusBadge entity="engineer" state={row.availabilityState} label={row.availability} /></div>
    <div className="flex-1 overflow-auto px-4"><dl className="m-0">{fields.map(([label, value]) => <div key={label} className={cn(PANEL_KV_ROW_HEIGHT_CLASS, 'flex items-center gap-3 border-b border-border-row')}><dt className={cn(PANEL_KEY_WIDTH_CLASS, 'shrink-0 text-xs text-fg-muted')}>{label}</dt><dd className="m-0 min-w-0 text-cell">{value}</dd></div>)}</dl></div>
    <div className="border-t border-border p-4"><Link className={SECONDARY_BUTTON_LINK_CLASSES} href={`/engineers/${row.id}`} data-testid="engineer-list-panel-open">{t('projects.list.panel.open')}</Link></div>
  </Card>;
}
