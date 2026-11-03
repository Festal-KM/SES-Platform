import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectDetailSession } from "./project-detail-session";
import { ProjectDetailStatus } from "./project-detail-status";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const options = [{ value: "OPEN", label: "募集中" }, { value: "CLOSED", label: "終了" }];
function render(canEdit: boolean) {
  return renderToStaticMarkup(createElement(ProjectDetailSession, { id: "project", initialStatus: "OPEN", children: createElement(ProjectDetailStatus, { status: "OPEN", label: "募集中", options, canEdit }) }));
}
describe("案件詳細の状態", () => {
  it("編集権限があるとメニューを表示する", () => { expect(render(true)).toContain('data-testid="project-detail-status-trigger"'); });
  it("閲覧権限だけなら操作を表示しない", () => { const html = render(false); expect(html).toContain("募集中"); expect(html).not.toContain('data-testid="project-detail-status-trigger"'); });
});
