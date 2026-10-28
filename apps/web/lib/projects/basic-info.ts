import { withTenant, type AuthenticatedTenantCtx, type ProjectCategory } from '@ses/db';
import { t } from '@ses/i18n';
import { NotFoundError } from '../api/errors';
import { decimalToNumber, toDateOnlyString } from '../format/db-values';
import { toJstIsoDay } from '../format/datetime';
import { formatManYen } from '../format/number';
import { PROJECT_CATEGORY_MESSAGE_KEYS } from './labels';
import { formatProjectLocation, formatProjectRemoteMode, formatProjectListUnitPriceRange } from './list-rows';
import { recordProjectView, PROJECT_VIEW_VIA, type ProjectViewMeta } from './service';

export type ProjectBasicInfoField = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

export type ProjectBasicInfo = {
  readonly category: ProjectCategory | null;
  readonly publicSummary: string | null;
  readonly remoteMode: string | null;
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly location: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly headcount: number;
  readonly distributionLimit: string | null;
  readonly publicMemo: string | null;
  readonly updatedOn: string;
  readonly host: null | {
    readonly endClientName: string | null;
    readonly upperCompanyName: string | null;
    readonly internalUnitPrice: number | null;
    readonly remarks: string | null;
    readonly assignee: string | null;
  };
};

export function projectBasicInfoFields(info: ProjectBasicInfo): readonly ProjectBasicInfoField[] {
  const none = t('projects.detail.valueNone');
  const text = (value: string | null): string => value ?? none;
  const price = (value: number | null): string => value === null
    ? none : `${formatManYen(value)} ${t('projects.list.unitPrice.manYen')}`;
  const field = (key: string, value: string): ProjectBasicInfoField => ({
    key, label: t(`projects.basic.${key}` as Parameters<typeof t>[0]), value,
  });
  const host = info.host;
  const legacyRange = info.unitPriceMin !== null && info.unitPriceMax !== null && info.unitPriceMin !== info.unitPriceMax
    ? `${t('projects.basic.legacyPriceRange')}：${formatProjectListUnitPriceRange(info.unitPriceMin, info.unitPriceMax)}`
    : null;
  return [
    ...(host === null ? [] : [field('endClientName', text(host.endClientName)), field('upperCompanyName', text(host.upperCompanyName))]),
    field('category', info.category === null ? none : t(PROJECT_CATEGORY_MESSAGE_KEYS[info.category])),
    field('businessOverview', text(info.publicSummary)),
    field('remoteMode', text(info.remoteMode)),
    field('unitPrice', price(info.unitPriceMin ?? info.unitPriceMax)),
    ...(host === null ? [] : [field('purchaseUnitPrice', price(host.internalUnitPrice))]),
    field('location', info.location),
    field('startDate', text(info.startDate)),
    field('endDate', text(info.endDate)),
    field('headcount', `${String(info.headcount)} ${t('projects.headcount.unit')}`),
    field('distributionLimit', text(info.distributionLimit)),
    field('publicMemo', text(info.publicMemo)),
    ...(host === null ? [] : [
      field('remarks', [host.remarks, legacyRange].filter(Boolean).join('\n') || none),
      field('assignee', text(host.assignee)),
    ]),
    field('updatedOn', info.updatedOn),
  ];
}

const SHARED_SELECT = {
  id: true, category: true, publicSummary: true, remoteMode: true,
  unitPriceMin: true, unitPriceMax: true, prefecture: true, locationDetail: true,
  startDate: true, endDate: true, headcount: true, distributionLimit: true,
  publicMemo: true, updatedAt: true,
} as const;
const HOST_SELECT = {
  ...SHARED_SELECT, endClientName: true, upperCompanyName: true,
  internalUnitPrice: true, remarks: true,
  assignee: { select: { displayName: true } },
} as const;

/** 選択された1件だけを読み、商流を含む閲覧は既存の監査経路へ記録する。 */
export async function readProjectBasicInfo(
  ctx: AuthenticatedTenantCtx, id: string, meta: ProjectViewMeta,
): Promise<readonly ProjectBasicInfoField[]> {
  return withTenant(ctx, async (db) => {
    const result = ctx.partnerCompanyId === null
      ? { audience: 'HOST' as const, row: await db.project.findFirst({ where: { id }, select: HOST_SELECT }) }
      : { audience: 'PARTNER' as const, row: await db.project.findFirst({ where: { id }, select: SHARED_SELECT }) };
    const row = result.row;
    if (row === null) throw new NotFoundError();
    await recordProjectView(db, ctx, id, PROJECT_VIEW_VIA.detail, meta);
    const hostRow = result.audience === 'HOST' ? result.row : null;
    const host = hostRow !== null ? {
      endClientName: hostRow.endClientName,
      upperCompanyName: hostRow.upperCompanyName,
      internalUnitPrice: decimalToNumber(hostRow.internalUnitPrice),
      remarks: hostRow.remarks,
      assignee: hostRow.assignee?.displayName ?? null,
    } : null;
    return projectBasicInfoFields({
      category: row.category as ProjectCategory | null,
      publicSummary: row.publicSummary,
      remoteMode: formatProjectRemoteMode(row.remoteMode as Parameters<typeof formatProjectRemoteMode>[0]),
      unitPriceMin: decimalToNumber(row.unitPriceMin), unitPriceMax: decimalToNumber(row.unitPriceMax),
      location: [row.prefecture === null ? null : formatProjectLocation(row.prefecture as Parameters<typeof formatProjectLocation>[0]), row.locationDetail].filter(Boolean).join(' / ') || t('projects.detail.valueNone'),
      startDate: toDateOnlyString(row.startDate), endDate: toDateOnlyString(row.endDate),
      headcount: row.headcount, distributionLimit: row.distributionLimit,
      publicMemo: row.publicMemo, updatedOn: toJstIsoDay(row.updatedAt), host,
    });
  });
}
