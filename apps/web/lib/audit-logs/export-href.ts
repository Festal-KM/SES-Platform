// apps/web/lib/audit-logs/export-href.ts
// `S-041` セクション 4 のエクスポート導線（`<a href>` の GET）の URL + 応答の分類。純粋関数。T-12-18 ⑪。
//
// 🔴 `'use client'` の `AuditLogsView` から import するため `@ses/db` に依存しない（`tests/static/client-db-boundary.test.ts`）。
//    ファイル名生成（`auditLogCsvFileName`）を本ファイルに置くのもこのため —— `apps/web/lib/audit-logs/csv.ts` は
//    `encodeCsv`（`@ses/domain`）を持ち CSV 本文の生成に閉じるので、client からは import しない（レビュー指摘 NG-1）。
// 🔴 渡すのは #10b の query（`from` / `to` / `action` / `actorId`）だけ。`cursor` / `limit` は渡さない（エクスポート側が #10 を追う）。
import type { AuditLogCategoryKey } from './categories';

export const AUDIT_LOG_EXPORT_PATH = '/api/audit-logs/export';

export type AuditLogExportCondition = {
  readonly from: string;
  readonly to: string;
  readonly action?: AuditLogCategoryKey | undefined;
  readonly actorId?: string | undefined;
};

export function auditLogExportHref(condition: AuditLogExportCondition): string {
  const params = new URLSearchParams({ from: condition.from, to: condition.to });
  if (condition.action !== undefined) params.set('action', condition.action);
  if (condition.actorId !== undefined && condition.actorId !== '') params.set('actorId', condition.actorId);
  return `${AUDIT_LOG_EXPORT_PATH}?${params.toString()}`;
}

/**
 * `Content-Disposition` のファイル名（ASCII のみ。docs/05 §6.3 #10b `audit-logs-{from}-{to}.csv`）。
 * 日時の `:` `.` は Windows のファイル名に使えないため落とし、それ以外の英数字と `-` だけを残す。
 * 🔴 #10b の route（`lib/audit-logs/csv.ts`）と画面（本ファイル）の両方から同じ実装を呼ぶ（2 実装にしない）。
 */
export function auditLogCsvFileName(period: { readonly from: string; readonly to: string }): string {
  const compact = (iso: string): string => iso.replace(/[^0-9A-Za-z]/g, '');
  return `audit-logs-${compact(period.from)}-${compact(period.to)}.csv`;
}

export type AuditLogExportErrorReason = 'TOO_LARGE' | 'FAILED';

/**
 * 🔴 NG-1: エクスポートの 400 応答を分類する（`AUDIT_LOG_EXPORT_TOO_LARGE` = 上限超過 / それ以外は汎用失敗）。
 *    `fetch` の返り値（`Response`）をそのまま受け取るので、テストは応答本文を持つ `Response` を組み立てて渡すだけでよい
 *    （`fetch` 自体をモックする必要がない。`export-href.test.ts`）。応答の `messageKey` は解釈しない
 *    （`error.code` で判定する。`proposal-approval-screen.tsx` などと同じ規律）。
 */
export async function classifyAuditLogExportError(response: Response): Promise<AuditLogExportErrorReason> {
  const body = (await response.json().catch(() => null)) as { readonly error?: { readonly code?: string } } | null;
  return body?.error?.code === 'AUDIT_LOG_EXPORT_TOO_LARGE' ? 'TOO_LARGE' : 'FAILED';
}
