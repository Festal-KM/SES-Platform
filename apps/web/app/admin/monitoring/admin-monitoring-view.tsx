'use client';

// apps/web/app/admin/monitoring/admin-monitoring-view.tsx
// `A-005` 運用監視 — 読み込みと再取得（docs/04 §A-005「項目ごとに独立して読み込み」「項目単位の再取得」/ API-A8）。T-11-04。
//
// 🔴 開いた時点で API-A8 を 1 回呼ぶ（監視画面は開いたら見る画面であり、`A-006` のように条件入力を待たない）。
//    項目ごとの独立性はサーバ側（`buildMonitoringSnapshot`）が担い、応答は常に全項目を含む（取れなかった項目は `ok: false`）。
//    「項目単位の再取得」は全体の再取得で実現する（各項目が独立して読み直されるため、再取得は他の項目を壊さない）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// 🔴 `@ses/db` / `@ses/db/platform` を値 import しない（`tests/static/client-db-boundary.test.ts`）。応答の型は
//    `apps/web/lib/admin-monitoring/view.ts`（純粋な型）だけを参照する。
// 🔴 操作導線（再送 / retry / 再実行）は無い。あるのは「再取得」だけである（読み取りの繰り返し）。
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, Button } from '@ses/ui';
import type { MonitoringSnapshotView } from '../../../lib/admin-monitoring/view';
import { AdminMonitoringItems, type AdminMonitoringMessages } from './admin-monitoring-items';

export type AdminMonitoringViewMessages = AdminMonitoringMessages & {
  readonly loading: string;
  readonly loadFailed: string;
  readonly reload: string;
  readonly reloading: string;
};

export type AdminMonitoringViewProps = {
  readonly messages: AdminMonitoringViewMessages;
  /** API-A8 の URL（`/api/admin/monitoring`）。テストが差し替えられるように props で受ける。 */
  readonly endpoint: string;
};

type LoadState =
  | { readonly kind: 'loading'; readonly previous: MonitoringSnapshotView | null }
  | { readonly kind: 'error'; readonly previous: MonitoringSnapshotView | null }
  | { readonly kind: 'ready'; readonly snapshot: MonitoringSnapshotView };

export function AdminMonitoringView({ messages, endpoint }: AdminMonitoringViewProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading', previous: null });

  const load = useCallback(async () => {
    setState((current) => ({
      kind: 'loading',
      previous: current.kind === 'ready' ? current.snapshot : current.previous,
    }));
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = (await response.json()) as MonitoringSnapshotView;
      setState({ kind: 'ready', snapshot });
    } catch {
      // 🔴 全体の取得に失敗した（認可・ネットワーク）。個々の項目の失敗は応答の `ok: false` として届く。
      setState((current) => ({ kind: 'error', previous: current.kind === 'ready' ? current.snapshot : current.previous }));
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const loading = state.kind === 'loading';
  const shown = state.kind === 'ready' ? state.snapshot : state.previous;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={loading} data-testid="admin-monitoring-reload">
          {loading ? messages.reloading : messages.reload}
        </Button>
        {loading && shown === null ? (
          <p className="text-sm text-slate-600" data-testid="admin-monitoring-loading">
            {messages.loading}
          </p>
        ) : null}
      </div>
      {state.kind === 'error' ? (
        <Alert variant="danger" className="mb-6" data-testid="admin-monitoring-load-failed">
          <AlertDescription>{messages.loadFailed}</AlertDescription>
        </Alert>
      ) : null}
      {shown === null ? null : <AdminMonitoringItems snapshot={shown} messages={messages} />}
    </div>
  );
}
