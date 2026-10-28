// 基本情報から貼り付け用の本文を作る。人間指示で想定仕入単価は含め、卸単価は除外する。
import { t } from '@ses/i18n';
import type { ProjectBasicInfoField } from './basic-info';

export const COPY_SUMMARY_EXCLUDED_FIELDS = [
  'endClientName', 'upperCompanyName', 'unitPrice', 'remarks', 'assignee', 'updatedOn',
] as const;

const COPY_SUMMARY_INCLUDED_FIELDS = new Set([
  'category', 'businessOverview', 'remoteMode', 'purchaseUnitPrice', 'location',
  'startDate', 'endDate', 'headcount', 'distributionLimit', 'publicMemo',
]);

function line(label: string, value: string): string {
  return `${t('projects.list.panel.copy.labelOpen')}${label}${t('projects.list.panel.copy.labelClose')}${value.includes('\n') ? '\n' : ''}${value}`;
}

export function projectCopySummary(name: string, fields: readonly ProjectBasicInfoField[]): string {
  return [
    line(t('projects.list.panel.copy.label.name'), name),
    ...fields
      .filter((field) => COPY_SUMMARY_INCLUDED_FIELDS.has(field.key))
      .filter((field) => field.value.trim() !== '' && field.value !== t('projects.detail.valueNone'))
      .map((field) => line(field.label, field.value)),
  ].join('\n');
}