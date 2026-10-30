// カードが所有する項目だけを差分更新する。金額はAPIと同じ円、稼働率は整数％。
export const PROJECT_CARD_FIELDS = {
  basic: ["name", "status", "category", "sourceKind"],
  content: ["publicSummary"],
  development: ["developmentPhases", "developmentMethod", "utilizationRate"],
  working: [
    "remoteMode",
    "prefecture",
    "locationDetail",
    "startDate",
    "endDate",
    "headcount",
    "parallelOk",
  ],
  commercial: [
    "unitPrice",
    "internalUnitPrice",
    "settlementMinHours",
    "settlementMaxHours",
    "paymentSiteDays",
    "distribution",
    "distributionLimit",
  ],
  company: ["endClientName", "upperCompanyName", "assigneeUserId"],
  notes: ["publicMemo", "remarks", "copySummary"],
} as const;
export type ProjectCardId = keyof typeof PROJECT_CARD_FIELDS;
export type ProjectCardValues = Record<string, string | readonly string[]>;
export type CardRequirement = {
  key: string;
  kind: "MUST" | "NICE";
  skillId: string;
  freeText: string;
  requiredYears: string;
};
const numeric = new Set([
  "unitPrice",
  "internalUnitPrice",
  "settlementMinHours",
  "settlementMaxHours",
  "paymentSiteDays",
  "utilizationRate",
  "headcount",
]);
const nonnullable = new Set(["name", "status", "sourceKind", "headcount"]);
export function projectCardPatch(
  card: ProjectCardId,
  before: ProjectCardValues,
  after: ProjectCardValues,
  oldRequirements: readonly CardRequirement[],
  requirements: readonly CardRequirement[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of PROJECT_CARD_FIELDS[card]) {
    const value = after[key] ?? "";
    if (JSON.stringify(before[key] ?? "") === JSON.stringify(value)) continue;
    if (key === "developmentPhases") {
      patch[key] = value;
      continue;
    }
    if (typeof value !== "string") throw new Error(key);
    const text = value.trim();
    if (nonnullable.has(key) && !text) throw new Error(key);
    if (numeric.has(key)) {
      const number = text === "" ? null : Number(text);
      if (number !== null && (!Number.isSafeInteger(number) || number < 0))
        throw new Error(key);
      if (key === "headcount" && (number === null || number < 1))
        throw new Error(key);
      if (
        key === "utilizationRate" &&
        number !== null &&
        (number < 1 || number > 100)
      )
        throw new Error(key);
      if (key === "unitPrice") {
        patch.unitPriceMin = number;
        patch.unitPriceMax = number;
      } else patch[key] = number;
    } else if (key === "parallelOk")
      patch[key] = text === "" ? null : text === "1";
    else patch[key] = text === "" ? null : text;
  }
  if (
    card === "content" &&
    JSON.stringify(oldRequirements) !== JSON.stringify(requirements)
  ) {
    if (requirements.length > 100) throw new Error("requirements");
    patch.requirements = requirements.map((row) => {
      const years =
        row.requiredYears.trim() === "" ? null : Number(row.requiredYears);
      if (
        (!row.skillId && !row.freeText.trim()) ||
        (years !== null && (!Number.isFinite(years) || years < 0 || years > 99))
      )
        throw new Error("requirements");
      return {
        kind: row.kind,
        skillId: row.skillId || null,
        freeText: row.freeText.trim() || null,
        requiredYears: years,
      };
    });
  }
  const start = String(after.startDate ?? "");
  const end = String(after.endDate ?? "");
  if (card === "working" && start && end && end < start)
    throw new Error("endDate");
  if (
    card === "commercial" &&
    after.settlementMinHours &&
    after.settlementMaxHours &&
    Number(after.settlementMinHours) > Number(after.settlementMaxHours)
  )
    throw new Error("settlementMaxHours");
  return patch;
}
