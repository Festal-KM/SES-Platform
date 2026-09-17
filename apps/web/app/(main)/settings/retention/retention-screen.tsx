'use client';

// apps/web/app/(main)/settings/retention/retention-screen.tsx
// `S-042` データの返却と保持期間 — 本体（docs/04 §S-042 / `F-064 AC-5`〜`AC-8`）。T-10-09。Tier 3。
//
// 🔴 Phase 1 の最小版 = セクション 2（削除予定）/ 3（返却）/ 4（実行履歴）。セクション 1（保持期間の設定 = `F-046`。Phase 2）は
//    **描かない**（「準備中」も置かない）。
// 🔴 削除を実行する導線を持たない（docs/04 §S-042「削除は `system` が実行し、利用者が任意に実行する導線を持たない」）。
// 🔴 返却の生成は #77（`POST /api/data-exports`）、ダウンロードは #78（`GET /api/data-exports/{id}/download-url`）。
//    生成中は `router.refresh()` で再読する（一覧 API を増やさない。状態は `DataExportRequest.status` の 1 出所）。
//    #78 は**ダウンロードの操作でだけ**呼ぶ（発行は監査に残る。ポーリングに #78 を使わない）。
// 🔴 文言は props で受ける（`packages/i18n`。コンポーネント内に直書きしない）。
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ses/ui';
import type { DataExportStatus } from '@ses/db';
import { formatDateTimeJst } from '../../../../lib/format/datetime';
import type { DataExportView, PurgeTargetTable, RetentionView } from '../../../../lib/retention/view';

export type RetentionScreenMessages = {
  readonly lead: string;
  readonly readOnlyNote: string;
  readonly bannerClosingPrefix: string;
  readonly bannerClosingSuffix: string;
  readonly bannerSuspended: string;

  readonly sectionSchedule: string;
  readonly scheduleEmpty: string;
  readonly scheduleLead: string;
  readonly scheduleColumnKind: string;
  readonly scheduleColumnCount: string;
  readonly scheduleColumnScheduledOn: string;
  readonly scheduleUnit: string;
  readonly scheduleKindLabels: Readonly<Record<PurgeTargetTable, string>>;

  readonly sectionExport: string;
  readonly exportLead: string;
  readonly exportNotClosing: string;
  readonly exportGenerate: string;
  readonly exportGenerating: string;
  readonly exportGenerated: string;
  readonly exportDownload: string;
  readonly exportDownloading: string;
  readonly exportFailed: string;
  readonly exportRetry: string;
  readonly exportRequestFailed: string;
  readonly exportDownloadFailed: string;
  readonly exportExpired: string;

  readonly sectionHistory: string;
  readonly historyEmpty: string;
  readonly historyColumnRequestedAt: string;
  readonly historyColumnStatus: string;
  readonly historyColumnExpiresAt: string;
  readonly historyColumnAction: string;
  readonly statusLabels: Readonly<Record<DataExportStatus, string>>;
};

/** 生成中とみなす状態（この間だけ再読する）。 */
const PENDING_STATUSES: readonly DataExportStatus[] = ['QUEUED', 'RUNNING'];
const REFRESH_INTERVAL_MS = 5_000;

type RequestPhase = 'idle' | 'submitting' | 'error';
type DownloadPhase = { readonly id: string; readonly kind: 'preparing' | 'error' | 'expired' } | null;

export function RetentionScreen({ view, messages }: { readonly view: RetentionView; readonly messages: RetentionScreenMessages }) {
  const router = useRouter();
  const [requestPhase, setRequestPhase] = useState<RequestPhase>('idle');
  const [download, setDownload] = useState<DownloadPhase>(null);

  const latest = view.exports[0] ?? null;
  const generating = latest !== null && PENDING_STATUSES.includes(latest.status);
  const isClosing = view.lifecycleState === 'CLOSING';

  // 🔴 生成中だけ再読する（完了 / 失敗で止まる）。一覧 API を増やさず、状態の出所を 1 つに保つ。
  useEffect(() => {
    if (!generating) return undefined;
    const timer = window.setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [generating, router]);

  async function onGenerate(): Promise<void> {
    if (requestPhase === 'submitting' || generating) return;
    setRequestPhase('submitting');
    try {
      const response = await fetch('/api/data-exports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'CLOSING_RETURN' }),
      });
      if (!response.ok) {
        setRequestPhase('error');
        return;
      }
      setRequestPhase('idle');
      router.refresh();
    } catch {
      setRequestPhase('error');
    }
  }

  async function onDownload(id: string): Promise<void> {
    if (download?.kind === 'preparing') return;
    setDownload({ id, kind: 'preparing' });
    try {
      const response = await fetch(`/api/data-exports/${id}/download-url`);
      if (response.status === 410) {
        setDownload({ id, kind: 'expired' });
        router.refresh();
        return;
      }
      if (!response.ok) {
        setDownload({ id, kind: 'error' });
        return;
      }
      const ticket = (await response.json()) as { readonly url: string };
      setDownload(null);
      window.location.assign(ticket.url);
    } catch {
      setDownload({ id, kind: 'error' });
    }
  }

  return (
    <div className="space-y-8">
      {isClosing && view.purge !== null ? (
        <Alert variant="warning" data-testid="retention-banner-closing">
          <AlertDescription>
            {messages.bannerClosingPrefix}
            <span data-testid="retention-banner-days">{view.purge.daysUntil}</span>
            {messages.bannerClosingSuffix}
          </AlertDescription>
        </Alert>
      ) : null}
      {view.lifecycleState === 'SUSPENDED' ? (
        <Alert variant="warning" data-testid="retention-banner-suspended">
          <AlertDescription>{messages.bannerSuspended}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-slate-600">{messages.lead}</p>

      <section data-testid="retention-schedule">
        <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionSchedule}</h2>
        {view.purge === null ? (
          <p className="text-sm text-slate-600" data-testid="retention-schedule-empty">
            {messages.scheduleEmpty}
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600">{messages.scheduleLead}</p>
            <Table data-testid="retention-schedule-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.scheduleColumnKind}</TableHead>
                  <TableHead className="text-right">{messages.scheduleColumnCount}</TableHead>
                  <TableHead>{messages.scheduleColumnScheduledOn}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.targets.map((target) => (
                  <TableRow key={target.table} data-testid={`retention-schedule-row-${target.table}`}>
                    <TableCell>{messages.scheduleKindLabels[target.table]}</TableCell>
                    <TableCell className="text-right">
                      {target.count}
                      {messages.scheduleUnit}
                    </TableCell>
                    <TableCell>{view.purge?.scheduledOn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        <p className="mt-2 text-xs text-slate-500">{messages.readOnlyNote}</p>
      </section>

      <section data-testid="retention-export">
        <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionExport}</h2>
        <p className="mb-3 text-sm text-slate-600">{messages.exportLead}</p>
        {!isClosing ? (
          <p className="text-sm text-slate-600" data-testid="retention-export-not-closing">
            {messages.exportNotClosing}
          </p>
        ) : generating ? (
          <p className="text-sm text-slate-700" data-testid="retention-export-generating" aria-live="polite">
            {messages.exportGenerating}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={onGenerate} disabled={requestPhase === 'submitting'} data-testid="retention-export-generate">
              {latest?.status === 'FAILED' ? messages.exportRetry : messages.exportGenerate}
            </Button>
            {latest?.status === 'READY' ? (
              <span className="text-sm text-slate-700" data-testid="retention-export-generated">
                {messages.exportGenerated}
              </span>
            ) : null}
            {latest?.status === 'FAILED' ? (
              <span className="text-sm text-red-700" data-testid="retention-export-failed">
                {messages.exportFailed}
              </span>
            ) : null}
          </div>
        )}
        {requestPhase === 'error' ? (
          <p className="mt-2 text-sm text-red-700" role="alert" data-testid="retention-export-request-error">
            {messages.exportRequestFailed}
          </p>
        ) : null}
      </section>

      <section data-testid="retention-history">
        <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionHistory}</h2>
        {view.exports.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="retention-history-empty">
            {messages.historyEmpty}
          </p>
        ) : (
          <Table data-testid="retention-history-table">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.historyColumnRequestedAt}</TableHead>
                <TableHead>{messages.historyColumnStatus}</TableHead>
                <TableHead>{messages.historyColumnExpiresAt}</TableHead>
                <TableHead>{messages.historyColumnAction}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.exports.map((row) => (
                <HistoryRow
                  key={row.id}
                  row={row}
                  messages={messages}
                  download={download?.id === row.id ? download : null}
                  onDownload={onDownload}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function HistoryRow({
  row,
  messages,
  download,
  onDownload,
}: {
  readonly row: DataExportView;
  readonly messages: RetentionScreenMessages;
  readonly download: DownloadPhase;
  readonly onDownload: (id: string) => Promise<void>;
}) {
  return (
    <TableRow data-testid={`retention-history-row-${row.id}`}>
      <TableCell>{formatDateTimeJst(row.requestedAt)}</TableCell>
      <TableCell data-testid={`retention-history-status-${row.id}`}>{messages.statusLabels[row.status]}</TableCell>
      <TableCell>{row.expiresAt === null ? '' : formatDateTimeJst(row.expiresAt)}</TableCell>
      <TableCell>
        {row.status === 'READY' ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onDownload(row.id)}
            disabled={download?.kind === 'preparing'}
            data-testid={`retention-history-download-${row.id}`}
          >
            {download?.kind === 'preparing' ? messages.exportDownloading : messages.exportDownload}
          </Button>
        ) : null}
        {download?.kind === 'error' ? (
          <span className="ml-2 text-sm text-red-700" role="alert">
            {messages.exportDownloadFailed}
          </span>
        ) : null}
        {download?.kind === 'expired' ? (
          <span className="ml-2 text-sm text-slate-600" role="alert">
            {messages.exportExpired}
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
