import { requireHost, withTenant, type AuthenticatedTenantCtx } from "@ses/db";
import { t } from "@ses/i18n";
import { NotFoundError } from "../api/errors";
import { decimalToNumber, toDateOnlyString } from "../format/db-values";
import { formatDateTimeJst, toJstIsoDay } from "../format/datetime";
import { projectBasicInfoFields } from "./basic-info";
import {
  projectCopySummary,
  projectCopyRequirementFields,
} from "./copy-summary";
import { formatProjectLocation, formatProjectRemoteMode } from "./list-rows";
import { readProjectDetail, type ProjectDetailMeta } from "./service";
import type { CardRequirement, ProjectCardValues } from "./card-fields";

/** ホストだけの詳細用データ。監査に成功してから同じctxのRLS内で読む。公開APIの射影は増やさない。 */
export async function readHostProjectCards(
  ctx: AuthenticatedTenantCtx,
  id: string,
  meta: ProjectDetailMeta,
) {
  requireHost(ctx);
  const view = await readProjectDetail(ctx, id, meta);
  const data = await withTenant(ctx, async (db) => {
    const row = await db.project.findFirst({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        category: true,
        sourceKind: true,
        publicSummary: true,
        developmentPhases: true,
        developmentMethod: true,
        utilizationRate: true,
        remoteMode: true,
        prefecture: true,
        locationDetail: true,
        startDate: true,
        endDate: true,
        headcount: true,
        parallelOk: true,
        unitPriceMin: true,
        unitPriceMax: true,
        internalUnitPrice: true,
        settlementMinHours: true,
        settlementMaxHours: true,
        paymentSiteDays: true,
        distribution: true,
        distributionLimit: true,
        endClientName: true,
        upperCompanyName: true,
        assigneeUserId: true,
        publicMemo: true,
        remarks: true,
        copySummary: true,
        createdAt: true,
        updatedAt: true,
        originAssignmentId: true,
        assignee: { select: { displayName: true } },
      },
    });
    if (!row) throw new NotFoundError();
    const requirements: CardRequirement[] = view.requirements.map(
      (item, index) => ({
        key: String(index),
        kind: item.kind,
        skillId: item.skillId ?? "",
        freeText: item.freeText ?? "",
        requiredYears:
          item.requiredYears === null ? "" : String(item.requiredYears),
      }),
    );
    const values: ProjectCardValues = {};
    const text = (value: unknown) => (value === null ? "" : String(value));
    for (const key of [
      "name",
      "status",
      "category",
      "sourceKind",
      "publicSummary",
      "developmentMethod",
      "utilizationRate",
      "remoteMode",
      "prefecture",
      "locationDetail",
      "headcount",
      "settlementMinHours",
      "settlementMaxHours",
      "paymentSiteDays",
      "distribution",
      "distributionLimit",
      "endClientName",
      "upperCompanyName",
      "assigneeUserId",
      "publicMemo",
      "remarks",
      "copySummary",
    ] as const)
      values[key] = text(row[key]);
    values.developmentPhases = row.developmentPhases;
    values.startDate = toDateOnlyString(row.startDate) ?? "";
    values.endDate = toDateOnlyString(row.endDate) ?? "";
    values.parallelOk =
      row.parallelOk === null ? "" : row.parallelOk ? "1" : "0";
    values.unitPrice = text(
      decimalToNumber(row.unitPriceMin ?? row.unitPriceMax),
    );
    values.internalUnitPrice = text(decimalToNumber(row.internalUnitPrice));
    const fields = projectBasicInfoFields({
      category: row.category as Parameters<
        typeof projectBasicInfoFields
      >[0]["category"],
      publicSummary: row.publicSummary,
      remoteMode: formatProjectRemoteMode(
        row.remoteMode as Parameters<typeof formatProjectRemoteMode>[0],
      ),
      unitPriceMin: decimalToNumber(row.unitPriceMin),
      unitPriceMax: decimalToNumber(row.unitPriceMax),
      location: [
        formatProjectLocation(
          row.prefecture as Parameters<typeof formatProjectLocation>[0],
        ),
        row.locationDetail,
      ]
        .filter(Boolean)
        .join(" / "),
      startDate: toDateOnlyString(row.startDate),
      endDate: toDateOnlyString(row.endDate),
      headcount: row.headcount,
      distributionLimit: row.distributionLimit,
      publicMemo: row.publicMemo,
      updatedOn: toJstIsoDay(row.updatedAt),
      host: {
        endClientName: row.endClientName,
        upperCompanyName: row.upperCompanyName,
        internalUnitPrice: decimalToNumber(row.internalUnitPrice),
        remarks: row.remarks,
        assignee: row.assignee?.displayName ?? null,
      },
    });
    return {
      id: row.id,
      values,
      requirements,
      assigneeName: row.assignee?.displayName ?? null,
      autoSummary: projectCopySummary(row.name, [
        ...fields,
        ...projectCopyRequirementFields(view.requirements),
      ]),
      createdAt: formatDateTimeJst(row.createdAt.toISOString()),
      updatedAt: formatDateTimeJst(row.updatedAt.toISOString()),
      origin: row.originAssignmentId ?? t("projects.detail.valueNone"),
    };
  });
  return { view, data };
}
export type ProjectCardData = Awaited<
  ReturnType<typeof readHostProjectCards>
>["data"];
