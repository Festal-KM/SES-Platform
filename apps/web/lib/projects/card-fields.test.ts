import { describe, expect, it } from "vitest";
import {
  projectCardPatch,
  type CardRequirement,
  type ProjectCardValues,
} from "./card-fields";
const initial: ProjectCardValues = {
  name: "案件",
  status: "OPEN",
  sourceKind: "OWN",
  unitPrice: "950000",
  internalUnitPrice: "840000",
  utilizationRate: "80",
  startDate: "2026-11-01",
  endDate: "2027-01-31",
  settlementMinHours: "140",
  settlementMaxHours: "180",
  copySummary: "手動サマリ",
};
const patch = (
  card: Parameters<typeof projectCardPatch>[0],
  changes: ProjectCardValues,
) => projectCardPatch(card, initial, { ...initial, ...changes }, [], []);
describe("カードの差分保存", () => {
  it("他カードの入力を更新しない", () =>
    expect(
      patch("basic", {
        name: "更新案件",
        internalUnitPrice: "1",
        copySummary: "変更",
      }),
    ).toEqual({ name: "更新案件" }));
  it("未変更のカードは空の差分になる", () =>
    expect(patch("commercial", {})).toEqual({}));
  it("卸単価の変更時だけ上下限を同じ円額にする", () =>
    expect(patch("commercial", { unitPrice: "960000" })).toEqual({
      unitPriceMin: 960000,
      unitPriceMax: 960000,
    }));
  it("稼働率を具体的な整数％で保存し区分は送らない", () =>
    expect(patch("development", { utilizationRate: "75" })).toEqual({
      utilizationRate: 75,
    }));
  it.each(["0", "101", "0.8", "abc"])("不正な稼働率%sを拒否する", (value) =>
    expect(() => patch("development", { utilizationRate: value })).toThrow(
      "utilizationRate",
    ),
  );
  it("未設定の稼働率を維持し明示クリアはnullにする", () =>
    expect(patch("development", { utilizationRate: "" })).toEqual({
      utilizationRate: null,
    }));
  it("終了日の逆転を拒否する", () =>
    expect(() => patch("working", { endDate: "2026-10-01" })).toThrow(
      "endDate",
    ));
  it("精算幅の逆転を拒否する", () =>
    expect(() => patch("commercial", { settlementMinHours: "190" })).toThrow(
      "settlementMaxHours",
    ));
  it("空サマリはnullにして自動生成に戻す", () =>
    expect(patch("notes", { copySummary: "   " })).toEqual({
      copySummary: null,
    }));
  it("要件の画面用キーを送らず区分と詳細を維持する", () => {
    const rows: CardRequirement[] = [
      {
        key: "temporary",
        kind: "NICE",
        skillId: "java",
        freeText: "設計経験",
        requiredYears: "2.5",
      },
    ];
    expect(projectCardPatch("content", initial, initial, [], rows)).toEqual({
      requirements: [
        {
          kind: "NICE",
          skillId: "java",
          freeText: "設計経験",
          requiredYears: 2.5,
        },
      ],
    });
  });
  it("空の要件行を拒否する", () =>
    expect(() =>
      projectCardPatch(
        "content",
        initial,
        initial,
        [],
        [
          {
            key: "empty",
            kind: "MUST",
            skillId: "",
            freeText: " ",
            requiredYears: "",
          },
        ],
      ),
    ).toThrow("requirements"));
});
