import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectCardData } from "../../../../lib/projects/card-data";
import { ProjectCardEditor } from "./project-card-editor";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const initial: ProjectCardData = {
  id: "own-project",
  relatedCounts: { proposals: 0, requests: 0, publishRequests: 0 },
  values: { name: "架空案件", utilizationRate: "80", copySummary: "" },
  requirements: [],
  autoSummary: "自動サマリ",
  assigneeName: null,
  createdAt: "2026-10-30",
  updatedAt: "2026-10-30",
  origin: "—",
  publishedToCount: 0,
};
describe("案件詳細カードの初期表示", () => {
  it("編集権限があっても最初は全カードを閲覧状態にする", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectCardEditor, { initial, options: {}, canEdit: true }),
    );
    expect(html).not.toMatch(/<(input|select)\b/);
    expect(html).toMatch(/<textarea[^>]*readonly/i);
    expect(html).not.toContain('data-editing="true"');
    // ✅ 2026-11-02: 4 タブ。最初は「概要」タブの 3 セクション（基本情報・業務概要・企業・担当）だけが描かれる。
    expect(html.match(/data-editing="false"/g)).toHaveLength(3);
    expect(html).toContain('data-testid="project-detail-summary-strip"');
    for (const tab of ["overview", "requirements", "working", "related"]) {
      expect(html).toContain(`data-testid="project-detail-tab-${tab}"`);
    }
    expect(renderToStaticMarkup(createElement(ProjectCardEditor, { initial, options: {}, canEdit: true, initialTab: "requirements" }))).toContain("80%");
    expect(renderToStaticMarkup(createElement(ProjectCardEditor, { initial, options: {}, canEdit: true, initialTab: "related" }))).toContain("自動サマリ");
    expect(html).toContain("project-detail-edit-link");
    expect(html).not.toContain("/edit");
  });
  it("サマリーを指定順に整形する", () => {
    const data: ProjectCardData = { ...initial, values: {
      ...initial.values, unitPrice: "990000", internalUnitPrice: "900000",
      prefecture: "13", locationDetail: "神田駅（徒歩5分）", remoteMode: "FULL_REMOTE",
      startDate: "2026-11-18", endDate: "2027-03-01", headcount: "2",
    } };
    const html = renderToStaticMarkup(createElement(ProjectCardEditor, {
      initial: data, canEdit: true,
      options: { prefecture: [{ value: "13", label: "東京都" }], remoteMode: [{ value: "FULL_REMOTE", label: "フルリモート可" }] },
    }));
    const keys = ["unitPrice", "internalUnitPrice", "location", "remoteMode", "startDate", "endDate", "headcount"];
    const positions = keys.map(key => html.indexOf(`data-testid="project-detail-summary-${key}"`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const value of ["990,000円/月", "東京都 神田駅（徒歩5分）", "フルリモート可", "2026/11/18", "900,000円/月", "2027/03/01", "2名"]) {
      expect(html).toContain(value);
    }
    expect(html).toContain("xl:grid-cols-7");
  });
  it("サマリーの未登録を未設定とし、勤務地の登録済み部分だけを表示する", () => {
    const data: ProjectCardData = { ...initial, values: { ...initial.values, locationDetail: "神田駅" } };
    const html = renderToStaticMarkup(createElement(ProjectCardEditor, { initial: data, options: {}, canEdit: true }));
    expect(html).toMatch(/data-testid="project-detail-summary-unitPrice"[^>]*>未設定</);
    expect(html).toMatch(/data-testid="project-detail-summary-location"[^>]*>神田駅</);
    expect(html).toMatch(/data-testid="project-detail-summary-startDate"[^>]*>未設定</);
  });
  it("主要条件と補足条件を順に表示し、空の要件に表を出さない", () => {
    const overview = renderToStaticMarkup(createElement(ProjectCardEditor, { initial, options: {}, canEdit: true }));
    const keys = ["unitPrice", "internalUnitPrice", "location", "remoteMode", "startDate", "endDate", "headcount"];
    const positions = keys.map(key => overview.indexOf(`data-testid="project-detail-summary-${key}"`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(overview).toContain("未設定");
    const requirements = renderToStaticMarkup(createElement(ProjectCardEditor, { initial, options: {}, canEdit: true, initialTab: "requirements" }));
    expect(requirements).not.toContain("<table");
    const related = renderToStaticMarkup(createElement(ProjectCardEditor, { initial, options: {}, canEdit: true, initialTab: "related" }));
    expect(related).toContain("全文を表示");
    expect(related).toContain('data-testid="project-detail-copy-summary-inline"');
  });
  it("関連情報に案件別の件数と導線を表示する", () => {
    const data = { ...initial, relatedCounts: { proposals: 3, requests: 2, publishRequests: 1 } };
    const html = renderToStaticMarkup(createElement(ProjectCardEditor, { initial: data, options: {}, canEdit: true, initialTab: "related", publishedToCount: 4 }));
    expect(html).toContain('/proposals?projectId=own-project');
    expect(html).toContain('3件');
    expect(html).toContain('2件');
    expect(html).toContain('4件');
    expect(html).toContain('1件');
    expect(html).toContain('data-testid="project-detail-copy-id"');
  });
  it("各タブの副カラムで手動サマリを優先し、未登録時は自動生成を表示する", () => {
    for (const initialTab of ["overview", "requirements", "working", "related"] as const) {
      const data = { ...initial, values: { ...initial.values, copySummary: "手動サマリ" } };
      const html = renderToStaticMarkup(createElement(ProjectCardEditor, { initial: data, options: {}, canEdit: true, initialTab }));
      expect(html).toContain('data-testid="project-detail-copy-panel"');
      expect(html).toContain('data-testid="project-list-panel-copy-text"');
      expect(html).toContain("手動サマリ");
    }
    const html = renderToStaticMarkup(createElement(ProjectCardEditor, { initial, options: {}, canEdit: true }));
    expect(html).toContain("自動サマリ");
  });
  it("閲覧専用では編集操作を出さない", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectCardEditor, {
        initial,
        options: {},
        canEdit: false,
        initialTab: "related",
      }),
    );
    expect(html).not.toContain("project-detail-edit-link");
    expect(html).not.toContain("project-card-edit-");
    expect(html).toContain("project-detail-card-management");
    expect(html).toContain("project-detail-card-related");
  });
  // 🔴 F-013 AC-2: 取引先に出ない項目のブロックには常に注記。凍結 testid の中身を金額の説明に入れ替えない。
  it("商流・企業・メモのカードに『取引先には表示されない』注記を常に出す", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectCardEditor, { initial, options: {}, canEdit: true, initialTab: "working" }),
    );
    const notice = /data-testid="project-detail-commerce-notice"[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
    expect(notice).toContain("公開範囲の相手には表示されません");
    expect(html).toContain('data-testid="project-card-money-hint"');
    // 企業・担当は「概要」、メモは「関連・履歴」のタブにある。
    const tabHtml = (initialTab: "overview" | "related") =>
      renderToStaticMarkup(createElement(ProjectCardEditor, { initial, options: {}, canEdit: true, initialTab }));
    expect(tabHtml("overview")).toContain('data-testid="project-card-host-only-notice-company"');
    expect(tabHtml("related")).toContain('data-testid="project-card-host-only-notice-notes"');
  });
});
