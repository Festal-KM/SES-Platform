'use client';

// apps/web/app/admin/demo/admin-demo-view.tsx
// `A-012` の「現在の投入状況」「投入」「リセット」（docs/04 §A-012 セクション 2 / 3 / API-A16）。T-10-06 / T-10-07。
//
// 🔴 開いた時点で API-A16 の `GET` を 1 回呼ぶ（投入状況は開いたら見る情報）。投入は `POST …/seed`、リセットは `POST …/reset`。
// 🔴 **確認ステップを飛ばさない**（docs/04 §A-012「操作と結果」）。投入は環境名を再掲してから実行する。
//    ✅ T-10-07 リセットは **環境名 + テナント名の入力**が一致するまで実行ボタンを無効にする（判定は
//    `lib/admin-demo/reset-confirmation.ts` の純粋関数 = サーバ側の 400 判定と同じ 1 関数）。モバイルでも折りたたまない。
// 🔴 画面の無効化は確認の UX であって統制ではない。サーバ側（`runDemoResetForAdmin`）が同じ照合を必ずやり直す。
// 🔴 投入元の選択肢は**合成データセットの 1 つだけ**であり、「本番からコピー」に相当するボタン・リンク・入力は存在しない（`BR-47`）。
// 🔴 リセット後に自動で再投入しない（削除と投入は別操作。実演者が「空の状態」を見せたいこともある）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// 🔴 `@ses/db` / `@ses/db/platform` / `@ses/db/seed` を値 import しない（`tests/static/client-db-boundary.test.ts`）。
//    応答の型は `apps/web/lib/admin-demo/view.ts`（純粋な型）、照合は `reset-confirmation.ts`（import 無しの純粋関数）だけを参照する。
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, Field, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ses/ui';
import {
  matchesDemoResetConfirmation,
  matchesDemoResetEnv,
  matchesDemoResetTenantName,
} from '../../../lib/admin-demo/reset-confirmation';
import type { DemoResetResponseView, DemoSeedResponseView, DemoSeedStatusView } from '../../../lib/admin-demo/view';

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
  };
  readonly reset: {
    readonly section: string;
    readonly lead: string;
    readonly targets: string;
    readonly submit: string;
    readonly confirmTitle: string;
    readonly confirmLead: string;
    readonly confirmEnvironment: string;
    readonly confirmEnvInput: string;
    readonly confirmTenantInput: string;
    readonly confirmMismatch: string;
    readonly confirmSubmit: string;
    readonly confirmBack: string;
    readonly submitting: string;
    readonly done: string;
    readonly nothingToReset: string;
    readonly failed: string;
    readonly retry: string;
  };
};

export type AdminDemoViewProps = {
  readonly messages: AdminDemoViewMessages;
  /** API-A16 の URL（`/api/admin/demo/seed`）。テストが差し替えられるように props で受ける。 */
  readonly endpoint: string;
  /** API-A16 `reset` の URL（`/api/admin/demo/reset`）。 */
  readonly resetEndpoint: string;
  /** `APP_ENV`（確認ステップに再掲する。判定は済んでおり、ここでは表示するだけ）。 */
  readonly appEnv: string;
  /**
   * 🔴 リセットの対象 = `demo` プリセットのテナント名（サーバ側 `lib/admin-demo/reset-targets.ts` が唯一の出所。props で受ける）。
   *    確認入力の照合先であり、未投入・途中で止まった状態でも要る（回復手段はリセットだけ）。
   */
  readonly resetTenantNames: readonly string[];
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

type ResetPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'done'; readonly outcome: DemoResetResponseView['outcome'] }
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

/**
 * リセットの確認ステップ（docs/04 §A-012「確認ステップ」= 環境名の表示 + テナント名の入力。T-10-07 で環境名も入力させる）。
 * 🔴 両方が一致するまで実行ボタンは `disabled`。判定はサーバと同じ純粋関数。
 */
function ResetConfirm({
  messages,
  appEnv,
  tenantNames,
  busy,
  onSubmit,
  onBack,
}: {
  readonly messages: AdminDemoViewMessages['reset'];
  readonly appEnv: string;
  readonly tenantNames: readonly string[];
  readonly busy: boolean;
  readonly onSubmit: (input: { readonly confirmEnv: string; readonly confirmTenantName: string }) => void;
  readonly onBack: () => void;
}) {
  const [confirmEnv, setConfirmEnv] = useState('');
  const [confirmTenantName, setConfirmTenantName] = useState('');
  const target = { appEnv, tenantNames };
  const envOk = matchesDemoResetEnv(target, confirmEnv);
  const tenantOk = matchesDemoResetTenantName(target, confirmTenantName);
  const matched = matchesDemoResetConfirmation(target, { confirmEnv, confirmTenantName });

  return (
    <div className="border border-slate-400 p-4" data-testid="admin-demo-reset-confirm">
      <p className="mb-1 text-base font-bold text-slate-900">{messages.confirmTitle}</p>
      <p className="mb-3 text-sm text-slate-700">{messages.confirmLead}</p>
      <dl className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-600">{messages.confirmEnvironment}</dt>
        <dd className="font-mono font-medium text-slate-900" data-testid="admin-demo-reset-confirm-env">
          {appEnv}
        </dd>
        <dt className="text-slate-600">{messages.targets}</dt>
        <dd className="font-medium text-slate-900" data-testid="admin-demo-reset-confirm-targets">
          {tenantNames.join(' / ')}
        </dd>
      </dl>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:max-w-md">
        <Field label={messages.confirmEnvInput}>
          <Input
            type="text"
            value={confirmEnv}
            autoComplete="off"
            disabled={busy}
            aria-invalid={confirmEnv !== '' && !envOk}
            data-testid="admin-demo-reset-confirm-env-input"
            onChange={(event) => setConfirmEnv(event.target.value)}
          />
        </Field>
        <Field label={messages.confirmTenantInput}>
          <Input
            type="text"
            value={confirmTenantName}
            autoComplete="off"
            disabled={busy}
            aria-invalid={confirmTenantName !== '' && !tenantOk}
            data-testid="admin-demo-reset-confirm-tenant-input"
            onChange={(event) => setConfirmTenantName(event.target.value)}
          />
        </Field>
      </div>
      {!matched ? (
        <p className="mb-3 text-sm text-slate-600" data-testid="admin-demo-reset-confirm-mismatch" aria-live="polite">
          {messages.confirmMismatch}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!matched || busy}
          onClick={() => onSubmit({ confirmEnv, confirmTenantName })}
          data-testid="admin-demo-reset-submit"
        >
          {messages.confirmSubmit}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onBack} data-testid="admin-demo-reset-back">
          {messages.confirmBack}
        </Button>
      </div>
    </div>
  );
}

export function AdminDemoView({ messages, endpoint, resetEndpoint, appEnv, resetTenantNames }: AdminDemoViewProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [phase, setPhase] = useState<SeedPhase>({ kind: 'idle' });
  const [resetPhase, setResetPhase] = useState<ResetPhase>({ kind: 'idle' });

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
      // 投入で状況が変わったので、リセットの前回結果は消す（古い「完了」を残さない）。
      setResetPhase({ kind: 'idle' });
    } catch {
      setPhase({ kind: 'failed' });
    }
  }, [endpoint]);

  const reset = useCallback(
    async (input: { readonly confirmEnv: string; readonly confirmTenantName: string }) => {
      setResetPhase({ kind: 'submitting' });
      try {
        const response = await fetch(resetEndpoint, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as DemoResetResponseView;
        // 🔴 `status` は `GET` と同じ形（直後は `seeded: false`）。再取得せずそのまま状況に反映する。
        setState({
          kind: 'ready',
          response: { appEnv: body.appEnv, available: true, configured: body.configured, outcome: null, status: body.status },
        });
        setResetPhase({ kind: 'done', outcome: body.outcome });
        setPhase({ kind: 'idle' });
      } catch {
        setResetPhase({ kind: 'failed' });
      }
    },
    [resetEndpoint],
  );

  const ready = state.kind === 'ready' ? state.response : null;
  const configured = ready?.configured ?? false;
  const busy = phase.kind === 'submitting';
  const resetBusy = resetPhase.kind === 'submitting';

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
          <Button type="button" disabled={resetBusy} onClick={() => setPhase({ kind: 'confirm' })} data-testid="admin-demo-seed-open-confirm">
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
      </section>

      {/* ✅ T-10-07: リセット（docs/04 §A-012 セクション 3「投入 / リセット」の後半。F-053 AC-2）。
          🔴 対象環境でのみこの部品自体が描かれる（`AdminDemoScreen` が `available` で切る）。新しい APP_ENV 分岐をここに足さない。 */}
      <section aria-labelledby="admin-demo-reset-heading" data-testid="admin-demo-reset">
        <h2 id="admin-demo-reset-heading" className={SECTION_HEADING_CLASSES}>
          {messages.reset.section}
        </h2>
        <p className="mb-2 text-sm text-slate-600">{messages.reset.lead}</p>
        <dl className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-600">{messages.reset.targets}</dt>
          <dd className="font-medium text-slate-900" data-testid="admin-demo-reset-targets">
            {resetTenantNames.join(' / ')}
          </dd>
        </dl>

        {ready !== null && configured && resetPhase.kind === 'idle' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setResetPhase({ kind: 'confirm' })}
            data-testid="admin-demo-reset-open-confirm"
          >
            {messages.reset.submit}
          </Button>
        ) : null}

        {resetPhase.kind === 'confirm' ? (
          <ResetConfirm
            messages={messages.reset}
            appEnv={appEnv}
            tenantNames={resetTenantNames}
            busy={false}
            onSubmit={(input) => void reset(input)}
            onBack={() => setResetPhase({ kind: 'idle' })}
          />
        ) : null}

        {resetBusy ? (
          <p className="border border-dashed border-slate-400 p-3 text-sm text-slate-700" data-testid="admin-demo-reset-submitting" aria-live="polite">
            {messages.reset.submitting}
          </p>
        ) : null}

        {resetPhase.kind === 'done' ? (
          <Alert variant="success" data-testid="admin-demo-reset-done">
            <AlertDescription>
              {resetPhase.outcome === 'NOTHING_TO_RESET' ? messages.reset.nothingToReset : messages.reset.done}
            </AlertDescription>
          </Alert>
        ) : null}

        {resetPhase.kind === 'failed' ? (
          <Alert variant="danger" data-testid="admin-demo-reset-failed">
            <AlertDescription>
              <p>{messages.reset.failed}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setResetPhase({ kind: 'confirm' })}
                data-testid="admin-demo-reset-retry"
              >
                {messages.reset.retry}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </section>
    </div>
  );
}
