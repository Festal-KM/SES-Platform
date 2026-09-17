'use client';

// apps/web/app/admin/demo/admin-demo-view.tsx
// `A-012` の「現在の投入状況」と「投入」（docs/04 §A-012 セクション 2 / 3 / API-A16）。T-10-06。
//
// 🔴 開いた時点で API-A16 の `GET` を 1 回呼ぶ（投入状況は開いたら見る情報）。投入は `POST`。
// 🔴 **確認ステップを飛ばさない**（docs/04 §A-012「操作と結果」）。環境名を再掲してから実行する。モバイルでも折りたたまない。
// 🔴 投入元の選択肢は**合成データセットの 1 つだけ**であり、「本番からコピー」に相当するボタン・リンク・入力は存在しない（`BR-47`）。
// 🔴 `reset`（初期状態に戻す）は T-10-07。ここには導線を置かず、予告の 1 行だけを出す。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// 🔴 `@ses/db` / `@ses/db/platform` / `@ses/db/seed` を値 import しない（`tests/static/client-db-boundary.test.ts`）。
//    応答の型は `apps/web/lib/admin-demo/view.ts`（純粋な型）だけを参照する。
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ses/ui';
import type { DemoSeedResponseView, DemoSeedStatusView } from '../../../lib/admin-demo/view';

export type AdminDemoViewMessages = {
  readonly status: {
    readonly section: string;
    readonly notSeeded: string;
    readonly seededAt: string;
    readonly tenants: string;
    readonly columns: {
      readonly tenant: string;
      readonly partners: string;
      readonly engineers: string;
      readonly projects: string;
      readonly proposalsInProgress: string;
      readonly assignmentsExpiring: string;
      readonly gateFailed: string;
      readonly shared: string;
    };
    readonly syntheticNote: string;
  };
  readonly seed: {
    readonly section: string;
    readonly dataset: string;
    readonly datasetName: string;
    readonly lead: string;
    readonly submit: string;
    readonly confirmTitle: string;
    readonly confirmLead: string;
    readonly confirmEnvironment: string;
    readonly confirmSubmit: string;
    readonly confirmBack: string;
    readonly submitting: string;
    readonly done: string;
    readonly alreadySeeded: string;
    readonly failed: string;
    readonly retry: string;
    readonly notConfigured: string;
    readonly resetComingSoon: string;
  };
};

export type AdminDemoViewProps = {
  readonly messages: AdminDemoViewMessages;
  /** API-A16 の URL（`/api/admin/demo/seed`）。テストが差し替えられるように props で受ける。 */
  readonly endpoint: string;
  /** `APP_ENV`（確認ステップに再掲する。判定は済んでおり、ここでは表示するだけ）。 */
  readonly appEnv: string;
};

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly response: DemoSeedResponseView };

type SeedPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'done'; readonly outcome: 'SEEDED' | 'ALREADY_SEEDED' }
  | { readonly kind: 'failed' };

const SECTION_HEADING_CLASSES = 'mt-8 mb-2 text-base font-bold text-slate-900';

function StatusTable({ status, messages }: { readonly status: DemoSeedStatusView; readonly messages: AdminDemoViewMessages['status'] }) {
  if (!status.seeded) {
    return (
      <p className="text-sm text-slate-700" data-testid="admin-demo-status-not-seeded">
        {messages.notSeeded}
      </p>
    );
  }
  return (
    <div data-testid="admin-demo-status-seeded">
      <dl className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-600">{messages.seededAt}</dt>
        <dd className="font-medium text-slate-900" data-testid="admin-demo-status-seeded-at">
          {status.seededAt}
        </dd>
      </dl>
      <p className="mb-2 text-sm text-slate-600">{messages.tenants}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{messages.columns.tenant}</TableHead>
            <TableHead>{messages.columns.partners}</TableHead>
            <TableHead>{messages.columns.engineers}</TableHead>
            <TableHead>{messages.columns.projects}</TableHead>
            <TableHead>{messages.columns.proposalsInProgress}</TableHead>
            <TableHead>{messages.columns.assignmentsExpiring}</TableHead>
            <TableHead>{messages.columns.gateFailed}</TableHead>
            <TableHead>{messages.columns.shared}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {status.tenants.map((tenant) => (
            <TableRow key={tenant.tenantId} data-testid={`admin-demo-status-tenant-${tenant.tenantId}`}>
              <TableCell>{tenant.name}</TableCell>
              <TableCell>{tenant.partnerCompanyCount}</TableCell>
              <TableCell>{tenant.engineerCount}</TableCell>
              <TableCell>{tenant.projectCount}</TableCell>
              <TableCell>{tenant.proposalInProgressCount}</TableCell>
              <TableCell>{tenant.assignmentExpiringCount}</TableCell>
              <TableCell>{tenant.gateFailedProposalCount}</TableCell>
              <TableCell>{tenant.sharedEngineerCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 text-sm text-slate-600">{messages.syntheticNote}</p>
    </div>
  );
}

export function AdminDemoView({ messages, endpoint, appEnv }: AdminDemoViewProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [phase, setPhase] = useState<SeedPhase>({ kind: 'idle' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setState({ kind: 'ready', response: (await response.json()) as DemoSeedResponseView });
    } catch {
      setState({ kind: 'error' });
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const seed = useCallback(async () => {
    setPhase({ kind: 'submitting' });
    try {
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as DemoSeedResponseView;
      setState({ kind: 'ready', response: body });
      setPhase({ kind: 'done', outcome: body.outcome === 'ALREADY_SEEDED' ? 'ALREADY_SEEDED' : 'SEEDED' });
    } catch {
      setPhase({ kind: 'failed' });
    }
  }, [endpoint]);

  const ready = state.kind === 'ready' ? state.response : null;
  const configured = ready?.configured ?? false;
  const busy = phase.kind === 'submitting';

  return (
    <div>
      <section aria-labelledby="admin-demo-status-heading">
        <h2 id="admin-demo-status-heading" className={SECTION_HEADING_CLASSES}>
          {messages.status.section}
        </h2>
        {state.kind === 'loading' ? (
          <p className="text-sm text-slate-600" data-testid="admin-demo-status-loading" aria-live="polite">
            …
          </p>
        ) : null}
        {state.kind === 'error' ? (
          <Alert variant="danger" data-testid="admin-demo-status-error">
            <AlertDescription>{messages.seed.failed}</AlertDescription>
          </Alert>
        ) : null}
        {ready !== null ? <StatusTable status={ready.status} messages={messages.status} /> : null}
      </section>

      <section aria-labelledby="admin-demo-seed-heading">
        <h2 id="admin-demo-seed-heading" className={SECTION_HEADING_CLASSES}>
          {messages.seed.section}
        </h2>
        <dl className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
          <dt className="text-slate-600">{messages.seed.dataset}</dt>
          {/* 🔴 選択肢は合成データセットの 1 つだけ（BR-47）。ドロップダウンにしない。 */}
          <dd className="font-medium text-slate-900" data-testid="admin-demo-seed-dataset">
            {messages.seed.datasetName}
          </dd>
        </dl>
        <p className="mb-4 text-sm text-slate-600">{messages.seed.lead}</p>

        {ready !== null && !configured ? (
          <Alert variant="warning" data-testid="admin-demo-seed-not-configured">
            <AlertDescription>{messages.seed.notConfigured}</AlertDescription>
          </Alert>
        ) : null}

        {ready !== null && configured && phase.kind === 'idle' ? (
          <Button type="button" onClick={() => setPhase({ kind: 'confirm' })} data-testid="admin-demo-seed-open-confirm">
            {messages.seed.submit}
          </Button>
        ) : null}

        {phase.kind === 'confirm' ? (
          <div className="border border-slate-300 p-4" data-testid="admin-demo-seed-confirm">
            <p className="mb-1 text-base font-bold text-slate-900">{messages.seed.confirmTitle}</p>
            <p className="mb-3 text-sm text-slate-700">{messages.seed.confirmLead}</p>
            <dl className="mb-4 flex items-baseline gap-3 text-sm">
              <dt className="text-slate-600">{messages.seed.confirmEnvironment}</dt>
              <dd className="font-mono font-medium text-slate-900" data-testid="admin-demo-seed-confirm-env">
                {appEnv}
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void seed()} data-testid="admin-demo-seed-submit">
                {messages.seed.confirmSubmit}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPhase({ kind: 'idle' })} data-testid="admin-demo-seed-back">
                {messages.seed.confirmBack}
              </Button>
            </div>
          </div>
        ) : null}

        {busy ? (
          <p className="border border-dashed border-slate-400 p-3 text-sm text-slate-700" data-testid="admin-demo-seed-submitting" aria-live="polite">
            {messages.seed.submitting}
          </p>
        ) : null}

        {phase.kind === 'done' ? (
          <Alert variant="success" data-testid="admin-demo-seed-done">
            <AlertDescription>{phase.outcome === 'ALREADY_SEEDED' ? messages.seed.alreadySeeded : messages.seed.done}</AlertDescription>
          </Alert>
        ) : null}

        {phase.kind === 'failed' ? (
          <Alert variant="danger" data-testid="admin-demo-seed-failed">
            <AlertDescription>
              <p>{messages.seed.failed}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => setPhase({ kind: 'confirm' })} data-testid="admin-demo-seed-retry">
                {messages.seed.retry}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <p className="mt-4 text-sm text-slate-600" data-testid="admin-demo-reset-coming-soon">
          {messages.seed.resetComingSoon}
        </p>
      </section>
    </div>
  );
}
