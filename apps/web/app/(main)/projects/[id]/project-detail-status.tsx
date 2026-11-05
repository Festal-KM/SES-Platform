"use client";
import { Button, Icon, StatusBadge } from "@ses/ui";
import { DropdownMenu, type DropdownMenuItems } from "@ses/ui/client";
import type { ProjectStatus } from "@ses/db";
import { t } from "@ses/i18n";
import { useProjectDetailSession } from "./project-detail-session";

export function ProjectDetailStatus({ status, label, options, canEdit }: { readonly status: ProjectStatus; readonly label: string; readonly options: readonly { value: string; label: string }[]; readonly canEdit: boolean }) {
  const session = useProjectDetailSession();
  const current = session?.status ?? status;
  const currentLabel = options.find(item => item.value === current)?.label ?? label;
  if (!canEdit || !session || options.length === 0) return <StatusBadge entity="project" state={current} label={currentLabel} />;
  const items = options.map(option => ({ kind: "action" as const, label: option.label, projectStatus: option.value as ProjectStatus, selected: option.value === current, onSelect: () => void session.changeStatus(option.value as ProjectStatus) })) as unknown as DropdownMenuItems;
  return <div className="flex flex-wrap items-center gap-2"><DropdownMenu align="start" items={items} trigger={<Button type="button" variant="ghost" size="sm" className="gap-1 px-0" aria-label={t("projects.detail.status.change")} aria-busy={session.busy} data-testid="project-detail-status-trigger"><StatusBadge entity="project" state={current} label={currentLabel}/><Icon name="chevron-down" size="sm"/></Button>} data-testid="project-detail-status-menu" />{session.error ? <span role="alert" className="text-xs text-danger">{session.error}</span> : null}</div>;
}
