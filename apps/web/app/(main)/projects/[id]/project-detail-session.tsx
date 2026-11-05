"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ProjectStatus } from "@ses/db";
import { t } from "@ses/i18n";

// セクション編集とヘッダーは同じ更新 API を使う。
export async function patchProject(id: string, patch: Record<string, unknown>) {
  const response = await fetch(`/api/projects/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json().catch(() => null)) as { recheck?: { queued?: boolean } } | null;
}

type Context = {
  status: ProjectStatus;
  busy: boolean;
  error: string;
  changeStatus: (status: ProjectStatus) => Promise<void>;
  setStatus: (status: ProjectStatus) => void;
  setEditing: (editing: boolean) => void;
};
const ProjectDetailContext = createContext<Context | null>(null);
export function useProjectDetailSession() { return useContext(ProjectDetailContext); }

export function ProjectDetailSession({ id, initialStatus, children }: { readonly id: string; readonly initialStatus: ProjectStatus; readonly children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const editing = useRef(false);
  const sending = useRef(false);
  const setEditing = useCallback((value: boolean) => { editing.current = value; }, []);
  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);
  async function changeStatus(next: ProjectStatus) {
    if (next === status || sending.current || refreshing) return;
    if (editing.current) { setError(t("projects.detail.status.busy")); return; }
    sending.current = true; setBusy(true); setError("");
    try { await patchProject(id, { status: next }); setStatus(next); startRefresh(() => router.refresh()); }
    catch { setError(t("projects.detail.status.failed")); }
    finally { sending.current = false; setBusy(false); }
  }
  return <ProjectDetailContext.Provider value={{status, busy: busy || refreshing, error, changeStatus, setStatus, setEditing}}>{children}</ProjectDetailContext.Provider>;
}
