// 提出用の語彙と順序で本文を作る。内部備考や卸単価は参照しない。
import { t } from '@ses/i18n';
import type { ProjectBasicInfoField } from './basic-info';
import type { ProjectRequirementView } from './service';

export const COPY_SUMMARY_EXCLUDED_FIELDS = [
  'endClientName', 'upperCompanyName', 'unitPrice', 'remarks', 'assignee', 'updatedOn', 'category',
] as const;

function line(label: string, value: string): string {
  return `${t('projects.list.panel.copy.labelOpen')}${label}${t('projects.list.panel.copy.labelClose')}${value.includes('\n') ? '\n' : ''}${value}`;
}

/** 一覧用の件数制限を使わず、閲覧可能な要件を区分別にすべて載せる。 */
export function projectCopyRequirementFields(requirements: readonly ProjectRequirementView[]): readonly ProjectBasicInfoField[] {
  return (['MUST', 'NICE'] as const).map((kind) => ({
    key: kind === 'MUST' ? 'mustRequirements' : 'niceRequirements',
    label: t(kind === 'MUST' ? 'projects.copy.required' : 'projects.copy.preferred'),
    value: requirements.filter((item) => item.kind === kind).map((item) => {
      const text = item.skillName ?? item.freeText ?? '';
      const years = item.requiredYears === null ? '' : ` ${item.requiredYears} ${t('projects.list.requirements.yearsOrMore')}`;
      return `${t('projects.copy.bullet')}${text}${years}`;
    }).join('\n'),
  }));
}

export function projectCopySummary(name: string, fields: readonly ProjectBasicInfoField[]): string {
  const value = (key: string): string => {
    const text = fields.find((field) => field.key === key)?.value.trim() ?? '';
    return text === t('projects.detail.valueNone') ? '' : text;
  };
  const section = (label: Parameters<typeof t>[0], text: string): string => text ? line(t(label), text) : '';
  const skills = [
    value('mustRequirements') ? `${t('projects.copy.required')}\n${value('mustRequirements')}` : '',
    value('niceRequirements') ? `${t('projects.copy.preferred')}\n${value('niceRequirements')}` : '',
  ].filter(Boolean).join('\n');
  const period = [value('startDate'), value('endDate')].some(Boolean)
    ? `${value('startDate')}${t('projects.copy.periodSeparator')}${value('endDate')}` : '';
  const location = value('location');
  const remote = value('remoteMode');
  const place = location && remote ? `${location}${t('projects.copy.parenthesisOpen')}${remote}${t('projects.copy.parenthesisClose')}` : location || remote;
  return [
    section('projects.copy.project', name),
    section('projects.copy.content', value('businessOverview')),
    section('projects.copy.skills', skills),
    section('projects.copy.period', period),
    section('projects.copy.place', place),
    section('projects.list.panel.copy.label.unitPrice', value('purchaseUnitPrice')),
    section('projects.copy.recruitment', value('headcount')),
    section('projects.copy.distribution', value('distributionLimit')),
    section('projects.copy.notes', value('publicMemo')),
  ].filter(Boolean).join('\n\n');
}
