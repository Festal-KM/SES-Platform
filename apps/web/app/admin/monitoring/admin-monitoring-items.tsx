// apps/web/app/admin/monitoring/admin-monitoring-items.tsx
// `A-005` 運用監視 — 監視項目の**純粋な描画**（docs/04 §A-005 / API-A8 / `F-059`。T3 = デスクトップ主体）。T-11-04。
//
// 🔴 状態を持たない（`'use client'` を宣言しない）。読み込み中 / エラー / 結果は `AdminMonitoringView` が決めて渡す。
//    `*.render.test.tsx` はこの部品を状態ごとに描いて固定する（docs/04 §A-005 の状態表: 全項目 0 件 / 項目単位のエラー /
//    項目 13 は消費率で成立 / 項目 14 「保留中の送信はありません」 / 項目 15 「削除待ちのテナントはありません」）。
// 🔴 色分け（`severityOf`）: 障害 = `danger`、保留・注意 = `warning`、成立 = `success`。保留を障害の色にしない
//    （`CLAUDE.md` §4.2 / `F-059 AC-6` / `AC-7`）。
// 🔴 表示するのは件数・状態・エラー種別・日時・不透明な ID だけ（`F-059 AC-3` / `BR-40`）。`targetId` は文字列として出すが
//    **リンクにしない**（管理平面に ID から内容を引く API は無い）。行から遷移できるのは `A-003` / `A-004`（`hrefs.ts`）だけで、
//    項目 13 / 14 の `PROVIDER_QUOTA` / 16 / 17 は導線を持たない。
// 🔴 操作導線（再送 / retry / 再実行 / 削除）を 1 つも置かない（運営者コンソールは read-only。`BR-37`）。
// 🔴 モバイルでは各項目が縦に積まれ、表は `Table` の器の中で横スクロールする（列を隠さない。`CLAUDE.md` §13.3 / docs/04 §5-8）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import Link from 'next/link';
import { Alert, AlertDescription, Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ses/ui';
import type { BadgeVariant } from '@ses/ui';
import { adminTenantDetailHref, adminTenantQuotaHref } from '../../../lib/admin-monitoring/hrefs';
import { isAllClear, isGateFailRateSpike, severityOf } from '../../../lib/admin-monitoring/severity';
import {
  GATE_STALL_REASONS_VIEW,
  MONITORING_KINDS,
  SEND_HOLD_REASONS_VIEW,
  USAGE_MEASUREMENT_FINDING_KINDS,
  type GateStallReasonView,
  type MonitoringErrorKind,
  type MonitoringItemView,
  type MonitoringKind,
  type MonitoringSeverity,
  type MonitoringSnapshotView,
  type SendHoldReasonView,
  type SendingDomainStatusView,
  type UsageMeasurementFindingKind,
} from '../../../lib/admin-monitoring/view';
import { formatDateTimeJst } from '../../../lib/format/datetime';

const SECTION_CLASSES = 'mb-8 rounded-lg border border-slate-200 bg-white p-4';
const SECTION_HEAD_CLASSES = 'mb-2 flex flex-wrap items-center justify-between gap-2';
const TITLE_CLASSES = 'text-base font-bold text-slate-900';
const SUMMARY_CLASSES = 'mb-2 text-sm text-slate-800';
const NOTE_CLASSES = 'mt-3 text-xs text-slate-600';
/** 項目の中の区分見出し（T-12-17 ⑱。項目 7 の `RUNNING` 滞留）。 */
const SUBTITLE_CLASSES = 'mt-4 mb-2 text-sm font-bold text-slate-900';
const EMPTY_CLASSES = 'text-sm text-slate-600';
const LINK_CLASSES = 'text-slate-700 underline-offset-2 hover:underline';
/** 折り返して全文を出す（監視画面では切り詰めない。docs/04 §5-8 `A-005`）。 */
const ID_CLASSES = 'break-all font-mono text-xs text-slate-600';

const SEVERITY_BADGE: Readonly<Record<MonitoringSeverity, BadgeVariant>> = {
  failure: 'danger',
  hold: 'warning',
  ok: 'success',
};

export type AdminMonitoringMessages = {
  readonly allClear: string;
  readonly observedAt: string;
  readonly unavailable: string;
  readonly unavailableByKind: Readonly<Record<MonitoringErrorKind, string>>;
  readonly severity: Readonly<Record<MonitoringSeverity, string>>;
  readonly unitCount: string;
  readonly unitMinutes: string;
  readonly unitHours: string;
  readonly unitDays: string;
  readonly unitMessages: string;
  readonly unitTenants: string;
  readonly more: string;
  readonly threshold: string;
  readonly checkedToday: string;
  readonly envScope: string;
  readonly tenantDetail: string;
  readonly tenantQuota: string;
  readonly columns: {
    readonly tenant: string;
    readonly count: string;
    readonly oldest: string;
    readonly longest: string;
    readonly status: string;
    readonly reason: string;
    readonly queue: string;
    readonly lastFailedAt: string;
    readonly kind: string;
    readonly metric: string;
    readonly period: string;
    readonly cause: string;
    readonly overdueDays: string;
    readonly target: string;
    readonly since: string;
    readonly recent: string;
    readonly baseline: string;
    readonly domain: string;
    readonly lifecycle: string;
    readonly daysSinceStarted: string;
    readonly lastCheckedAt: string;
    readonly revoked: string;
    readonly expectedRecords: string;
    readonly proposals: string;
    readonly contracts: string;
    readonly link: string;
  };
  readonly titles: Readonly<Record<MonitoringKind, string>>;
  readonly submitFailed: { readonly empty: string; readonly note: string };
  readonly submittingStall: { readonly empty: string; readonly note: string };
  readonly failedJobs: { readonly empty: string; readonly note: string };
  readonly scanFailed: {
    readonly empty: string;
    readonly scanning: string;
    readonly status: Readonly<Record<'INFECTED' | 'UNSCANNABLE' | 'FAILED', string>>;
  };
  readonly gateFailRate: { readonly recent: string; readonly baseline: string; readonly noRuns: string; readonly spike: string; readonly note: string };
  readonly usageMeasurement: { readonly empty: string; readonly kind: Readonly<Record<UsageMeasurementFindingKind, string>>; readonly note: string };
  readonly purgeJobFailed: {
    readonly empty: string;
    readonly cause: Readonly<Record<string, string>>;
    readonly note: string;
    /** T-12-17 ⑱: `RUNNING` の滞留（別区分）。 */
    readonly runningOverdue: {
      readonly title: string;
      readonly empty: string;
      readonly note: string;
      readonly runningCount: string;
      readonly oldestStartedAt: string;
      readonly longestRunning: string;
    };
  };
  readonly sendingDomain: {
    readonly empty: string;
    readonly status: Readonly<Record<SendingDomainStatusView, string>>;
    readonly lifecycle: Readonly<Record<'SANDBOX' | 'ACTIVE', string>>;
    readonly reconfiguring: string;
    readonly revokedDaysAgo: string;
    readonly daysAgo: string;
    readonly note: string;
  };
  readonly gateStall: {
    readonly empty: string;
    readonly reason: Readonly<Record<GateStallReasonView, string>>;
    readonly failedJobsUnavailable: string;
    readonly note: string;
    readonly overdueNote: string;
  };
  readonly mailProviderQuota: {
    readonly sentToday: string;
    readonly limit: string;
    readonly held: string;
    readonly unavailable: string;
    readonly localCounter: string;
    readonly lastObservedAt: string;
    readonly never: string;
    readonly reachedAt: string;
    readonly nearingSince: string;
    readonly note: string;
  };
  readonly sendHold: { readonly empty: string; readonly reason: Readonly<Record<SendHoldReasonView, string>>; readonly note: string };
  readonly purgeNotice: { readonly empty: string; readonly cause: Readonly<Record<'NOTICE_PENDING' | 'NOTICE_UNDELIVERED', string>>; readonly note: string };
  readonly mailDispatchStuck: { readonly empty: string; readonly lowerBound: string; readonly note: string };
  readonly providerSpend: {
    readonly thisMonth: string;
    readonly cap: string;
    readonly exceeded: string;
    readonly level: Readonly<Record<'BELOW' | 'NEARING' | 'REACHED', string>>;
    readonly note: string;
  };
  readonly scheduler: { readonly lastRunAt: string; readonly running: string; readonly stalled: string; readonly never: string };
};

export type AdminMonitoringItemsProps = {
  readonly snapshot: MonitoringSnapshotView;
  readonly messages: AdminMonitoringMessages;
};

const percent = (rate: number): string => `${Math.round(rate * 100)}%`;
const dateTime = (iso: string | null): string => (iso === null ? '—' : formatDateTimeJst(iso));

function TenantLink({ tenantId, label, quota = false }: { readonly tenantId: string; readonly label: string; readonly quota?: boolean }) {
  return (
    <Link className={LINK_CLASSES} href={quota ? adminTenantQuotaHref(tenantId) : adminTenantDetailHref(tenantId)}>
      {label}
    </Link>
  );
}

function TenantCell({ tenantId, messages, quota = false }: { readonly tenantId: string; readonly messages: AdminMonitoringMessages; readonly quota?: boolean }) {
  return (
    <TableCell>
      <span className={ID_CLASSES}>{tenantId}</span>{' '}
      <TenantLink tenantId={tenantId} label={quota ? messages.tenantQuota : messages.tenantDetail} quota={quota} />
    </TableCell>
  );
}

function Section({
  kind,
  severity,
  messages,
  children,
}: {
  readonly kind: MonitoringKind;
  readonly severity: MonitoringSeverity | 'unavailable';
  readonly messages: AdminMonitoringMessages;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={SECTION_CLASSES} data-testid={`admin-monitoring-item-${kind}`} data-severity={severity}>
      <div className={SECTION_HEAD_CLASSES}>
        <h2 className={TITLE_CLASSES}>{messages.titles[kind]}</h2>
        {severity === 'unavailable' ? (
          <Badge variant="outline" data-testid={`admin-monitoring-item-${kind}-severity`}>
            {messages.unavailable}
          </Badge>
        ) : (
          <Badge variant={SEVERITY_BADGE[severity]} data-testid={`admin-monitoring-item-${kind}-severity`}>
            {messages.severity[severity]}
          </Badge>
        )}
      </div>
      {children}
    </section>
  );
}

function Unavailable({ kind, errorKind, messages }: { readonly kind: MonitoringKind; readonly errorKind: MonitoringErrorKind; readonly messages: AdminMonitoringMessages }) {
  return (
    <Alert variant="warning" data-testid={`admin-monitoring-item-${kind}-unavailable`}>
      <AlertDescription>
        <p>{messages.unavailable}</p>
        <p>{messages.unavailableByKind[errorKind]}</p>
      </AlertDescription>
    </Alert>
  );
}

function Empty({ kind, text }: { readonly kind: MonitoringKind; readonly text: string }) {
  return (
    <p className={EMPTY_CLASSES} data-testid={`admin-monitoring-item-${kind}-empty`}>
      {text}
    </p>
  );
}

function Remainder({ shown, total, messages }: { readonly shown: number; readonly total: number; readonly messages: AdminMonitoringMessages }) {
  if (total <= shown) return null;
  return (
    <p className={NOTE_CLASSES}>
      {messages.more} {total - shown} {messages.unitCount}
    </p>
  );
}

function Body({ item, messages }: { readonly item: MonitoringItemView; readonly messages: AdminMonitoringMessages }) {
  if (!item.ok) return <Unavailable kind={item.kind} errorKind={item.errorKind} messages={messages} />;
  const c = messages.columns;
  switch (item.kind) {
    case 'SUBMIT_FAILED_UNATTENDED':
    case 'SUBMITTING_STALL': {
      const m = item.kind === 'SUBMIT_FAILED_UNATTENDED' ? messages.submitFailed : messages.submittingStall;
      const isStall = item.kind === 'SUBMITTING_STALL';
      return (
        <>
          {isStall ? (
            <p className={SUMMARY_CLASSES}>
              {messages.threshold}: {item.stallThresholdMinutes} {messages.unitMinutes}
            </p>
          ) : null}
          {item.total === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${m.empty}`} />
          ) : (
            <>
              <p className={SUMMARY_CLASSES}>
                {item.total} {messages.unitCount}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.tenant}</TableHead>
                    <TableHead>{c.count}</TableHead>
                    <TableHead>{c.oldest}</TableHead>
                    {isStall ? <TableHead>{c.longest}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.rows.map((row) => (
                    <TableRow key={row.tenantId}>
                      <TenantCell tenantId={row.tenantId} messages={messages} />
                      <TableCell>{row.count}</TableCell>
                      <TableCell>{dateTime(row.oldestSince)}</TableCell>
                      {isStall && 'longestStalledMinutes' in row ? (
                        <TableCell>
                          {row.longestStalledMinutes} {messages.unitMinutes}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          <p className={NOTE_CLASSES}>{m.note}</p>
        </>
      );
    }
    case 'FAILED_JOBS': {
      const failing = item.byQueue.filter((entry) => entry.count > 0);
      return (
        <>
          {item.total === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${messages.failedJobs.empty}`} />
          ) : (
            <>
              <p className={SUMMARY_CLASSES}>
                {item.total} {messages.unitCount}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.queue}</TableHead>
                    <TableHead>{c.count}</TableHead>
                    <TableHead>{c.lastFailedAt}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failing.map((entry) => (
                    <TableRow key={entry.queueName}>
                      <TableCell>
                        <span className="font-mono text-xs">{entry.queueName}</span>
                      </TableCell>
                      <TableCell>{entry.count}</TableCell>
                      <TableCell>{dateTime(entry.lastFailedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          <p className={NOTE_CLASSES}>{messages.failedJobs.note}</p>
        </>
      );
    }
    case 'SCAN_FAILED':
      return (
        <>
          {item.total === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${messages.scanFailed.empty}`} />
          ) : (
            <>
              <p className={SUMMARY_CLASSES}>
                {item.total} {messages.unitCount}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.tenant}</TableHead>
                    <TableHead>{c.count}</TableHead>
                    <TableHead>{c.status}</TableHead>
                    <TableHead>{c.oldest}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.rows.map((row) => (
                    <TableRow key={row.tenantId}>
                      <TenantCell tenantId={row.tenantId} messages={messages} />
                      <TableCell>{row.count}</TableCell>
                      <TableCell>
                        {(['INFECTED', 'UNSCANNABLE', 'FAILED'] as const)
                          .filter((status) => row.countsByStatus[status] > 0)
                          .map((status) => `${messages.scanFailed.status[status]} ${row.countsByStatus[status]}`)
                          .join(' / ')}
                      </TableCell>
                      <TableCell>{dateTime(row.oldestSince)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          <p className={NOTE_CLASSES}>
            {messages.scanFailed.scanning}（{messages.threshold}: {item.scanStallThresholdMinutes} {messages.unitMinutes}）: {item.scanningStalled.count}{' '}
            {messages.unitCount}
            {item.scanningStalled.oldestUploadedAt === null ? '' : ` / ${c.oldest}: ${dateTime(item.scanningStalled.oldestUploadedAt)}`}
          </p>
        </>
      );
    case 'GATE_FAIL_RATE': {
      const rate = (window: { readonly done: number; readonly failed: number; readonly rate: number | null }): string =>
        window.rate === null ? messages.gateFailRate.noRuns : `${percent(window.rate)}（${window.failed} / ${window.done}）`;
      return (
        <>
          <p className={SUMMARY_CLASSES} data-testid="admin-monitoring-gate-fail-rate-summary">
            {messages.gateFailRate.recent} {item.windowHours} {messages.unitHours}: {rate(item.recent)} / {messages.gateFailRate.baseline}{' '}
            {item.baselineDays} {messages.unitDays}: {rate(item.baseline)}
          </p>
          {item.rows.length === 0 ? null : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.tenant}</TableHead>
                  <TableHead>{c.recent}</TableHead>
                  <TableHead>{c.baseline}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.rows.map((row) => (
                  <TableRow key={row.tenantId}>
                    <TenantCell tenantId={row.tenantId} messages={messages} />
                    <TableCell>
                      {rate(row.recent)}
                      {isGateFailRateSpike(row) ? (
                        <>
                          {' '}
                          <Badge variant="danger">{messages.gateFailRate.spike}</Badge>
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell>{rate(row.baseline)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className={NOTE_CLASSES}>{messages.gateFailRate.note}</p>
        </>
      );
    }
    case 'USAGE_MEASUREMENT': {
      const total = USAGE_MEASUREMENT_FINDING_KINDS.reduce((sum, kind) => sum + item.countsByKind[kind], 0);
      return (
        <>
          {total === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${messages.usageMeasurement.empty}`} />
          ) : (
            <>
              <p className={SUMMARY_CLASSES}>
                {USAGE_MEASUREMENT_FINDING_KINDS.map((kind) => `${messages.usageMeasurement.kind[kind]} ${item.countsByKind[kind]} ${messages.unitCount}`).join(' / ')}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.tenant}</TableHead>
                    <TableHead>{c.kind}</TableHead>
                    <TableHead>{c.metric}</TableHead>
                    <TableHead>{c.period}</TableHead>
                    <TableHead>{c.oldest}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.items.map((finding) => (
                    <TableRow key={`${finding.tenantId}/${finding.kind}/${finding.metric}/${finding.periodKey}`}>
                      <TenantCell tenantId={finding.tenantId} messages={messages} />
                      <TableCell>{messages.usageMeasurement.kind[finding.kind]}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{finding.metric}</span>
                      </TableCell>
                      <TableCell>{finding.periodKey}</TableCell>
                      <TableCell>{dateTime(finding.detectedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Remainder shown={item.items.length} total={total} messages={messages} />
            </>
          )}
          <p className={NOTE_CLASSES}>{messages.usageMeasurement.note}</p>
        </>
      );
    }
    case 'PURGE_JOB_FAILED':
      return (
        <>
          {item.total === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${messages.purgeJobFailed.empty}`} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.tenant}</TableHead>
                  <TableHead>{c.cause}</TableHead>
                  <TableHead>{c.count}</TableHead>
                  <TableHead>{c.lastFailedAt}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.rows.map((row) => (
                  <TableRow key={`${row.tenantId}/${row.cause}`}>
                    <TenantCell tenantId={row.tenantId} messages={messages} />
                    <TableCell>{messages.purgeJobFailed.cause[row.cause] ?? row.cause}</TableCell>
                    <TableCell>{row.failedCount}</TableCell>
                    <TableCell>{dateTime(row.lastFailedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className={NOTE_CLASSES}>{messages.purgeJobFailed.note}</p>
          {/* 🔴 T-12-17 ⑱: `RUNNING` の滞留は同じ項目の**別区分**（`FAILED` の表・件数に混ぜない）。完了の事実は出さない。 */}
          <h3 className={SUBTITLE_CLASSES} data-testid="admin-monitoring-purge-running-overdue-title">
            {messages.purgeJobFailed.runningOverdue.title}（{messages.threshold}: {item.runningOverdue.stallThresholdMinutes} {messages.unitMinutes}）
          </h3>
          {item.runningOverdue.total === 0 ? (
            <p className={SUMMARY_CLASSES} data-testid="admin-monitoring-purge-running-overdue-empty">
              {messages.purgeJobFailed.runningOverdue.empty}
            </p>
          ) : (
            <Table data-testid="admin-monitoring-purge-running-overdue-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{c.tenant}</TableHead>
                  <TableHead>{c.cause}</TableHead>
                  <TableHead>{messages.purgeJobFailed.runningOverdue.runningCount}</TableHead>
                  <TableHead>{messages.purgeJobFailed.runningOverdue.oldestStartedAt}</TableHead>
                  <TableHead>{messages.purgeJobFailed.runningOverdue.longestRunning}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.runningOverdue.rows.map((row) => (
                  <TableRow key={`${row.tenantId}/${row.cause}`} data-testid={`admin-monitoring-purge-running-overdue-row-${row.tenantId}`}>
                    <TenantCell tenantId={row.tenantId} messages={messages} />
                    <TableCell>{messages.purgeJobFailed.cause[row.cause] ?? row.cause}</TableCell>
                    <TableCell>{row.runningCount}</TableCell>
                    <TableCell>{dateTime(row.oldestStartedAt)}</TableCell>
                    <TableCell>{row.longestRunningMinutes} {messages.unitMinutes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className={NOTE_CLASSES}>{messages.purgeJobFailed.runningOverdue.note}</p>
        </>
      );
    case 'SENDING_DOMAIN_UNVERIFIED': {
      const m = messages.sendingDomain;
      return (
        <>
          {item.total === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${m.empty}`} />
          ) : (
            <>
              <p className={SUMMARY_CLASSES}>
                {item.total} {messages.unitCount}（
                {(Object.keys(item.countsByStatus) as SendingDomainStatusView[])
                  .filter((status) => item.countsByStatus[status] > 0)
                  .map((status) => `${m.status[status]} ${item.countsByStatus[status]}`)
                  .join(' / ')}
                ）
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.tenant}</TableHead>
                    <TableHead>{c.lifecycle}</TableHead>
                    <TableHead>{c.domain}</TableHead>
                    <TableHead>{c.status}</TableHead>
                    <TableHead>{c.daysSinceStarted}</TableHead>
                    <TableHead>{c.lastCheckedAt}</TableHead>
                    <TableHead>{c.revoked}</TableHead>
                    <TableHead>{c.expectedRecords}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.items.map((row) => (
                    <TableRow key={row.tenantId}>
                      <TableCell>
                        {row.tenantName} <TenantLink tenantId={row.tenantId} label={messages.tenantDetail} />
                      </TableCell>
                      <TableCell>{m.lifecycle[row.lifecycleState]}</TableCell>
                      <TableCell>{row.domain ?? m.status.NOT_REGISTERED}</TableCell>
                      <TableCell>
                        {m.status[row.status]}
                        {row.revokedAt !== null && (row.status === 'REGISTERED' || row.status === 'PENDING') ? `（${m.reconfiguring}）` : ''}
                      </TableCell>
                      <TableCell>
                        {row.daysSinceStarted} {messages.unitDays}
                      </TableCell>
                      <TableCell>{dateTime(row.lastCheckedAt)}</TableCell>
                      <TableCell>{row.daysSinceRevoked === null ? '—' : `${m.revokedDaysAgo} ${row.daysSinceRevoked} ${m.daysAgo}`}</TableCell>
                      <TableCell>{row.expectedRecords}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Remainder shown={item.items.length} total={item.total} messages={messages} />
            </>
          )}
          <p className={NOTE_CLASSES}>{m.note}</p>
        </>
      );
    }
    case 'GATE_STALL': {
      const m = messages.gateStall;
      // 🔴 行は tenantId × reason に畳む（件数 / 最長の滞留 / 最古の起点。docs/sprints/SP-11 T-11-05 ③）。
      const grouped = new Map<string, { tenantId: string; reason: GateStallReasonView; count: number; longest: number; oldest: string }>();
      for (const row of item.rows) {
        const key = `${row.tenantId}/${row.reason}`;
        const entry = grouped.get(key) ?? { tenantId: row.tenantId, reason: row.reason, count: 0, longest: 0, oldest: row.since };
        entry.count += 1;
        entry.longest = Math.max(entry.longest, row.stalledMinutes);
        if (row.since < entry.oldest) entry.oldest = row.since;
        grouped.set(key, entry);
      }
      const reasonBadge: Readonly<Record<GateStallReasonView, BadgeVariant>> = {
        AI_COST_LIMIT_HELD: 'warning',
        JOB_FAILED: 'danger',
        RUNNING_OVERDUE: 'danger',
      };
      return (
        <>
          <p className={SUMMARY_CLASSES}>
            {messages.threshold}: {item.stallThresholdMinutes} {messages.unitMinutes} /{' '}
            {GATE_STALL_REASONS_VIEW.map((reason) => `${m.reason[reason]} ${item.countsByReason[reason]}`).join(' / ')}
          </p>
          {item.failedJobsAvailable ? null : (
            <Alert variant="warning" data-testid="admin-monitoring-gate-stall-failed-jobs-unavailable">
              <AlertDescription>
                {m.failedJobsUnavailable} {item.unclassifiedOverdue} {messages.unitCount}
              </AlertDescription>
            </Alert>
          )}
          {item.total === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${m.empty}`} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.tenant}</TableHead>
                  <TableHead>{c.reason}</TableHead>
                  <TableHead>{c.count}</TableHead>
                  <TableHead>{c.longest}</TableHead>
                  <TableHead>{c.oldest}</TableHead>
                  <TableHead>{c.target}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...grouped.values()].map((entry) => (
                  <TableRow key={`${entry.tenantId}/${entry.reason}`} data-testid={`admin-monitoring-gate-stall-${entry.reason}`}>
                    <TenantCell tenantId={entry.tenantId} messages={messages} quota={entry.reason === 'AI_COST_LIMIT_HELD'} />
                    <TableCell>
                      <Badge variant={reasonBadge[entry.reason]}>{m.reason[entry.reason]}</Badge>
                    </TableCell>
                    <TableCell>{entry.count}</TableCell>
                    <TableCell>
                      {entry.longest} {messages.unitMinutes}
                    </TableCell>
                    <TableCell>{dateTime(entry.oldest)}</TableCell>
                    <TableCell>
                      {/* 🔴 対象 ID は文字列として出すだけ。リンクにしない（内容を引く API は無い）。 */}
                      {item.rows
                        .filter((row) => row.tenantId === entry.tenantId && row.reason === entry.reason)
                        .map((row) => (
                          <span key={row.targetId} className={`${ID_CLASSES} mr-2`}>
                            {row.targetType}:{row.targetId}
                          </span>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Remainder shown={item.rows.length} total={item.total} messages={messages} />
          <p className={NOTE_CLASSES}>{m.note}</p>
          {item.countsByReason.RUNNING_OVERDUE > 0 ? <p className={NOTE_CLASSES}>{m.overdueNote}</p> : null}
        </>
      );
    }
    case 'MAIL_PROVIDER_QUOTA': {
      const m = messages.mailProviderQuota;
      return (
        <>
          <p className={SUMMARY_CLASSES}>{messages.envScope}</p>
          {item.providerReading.available ? (
            <p className={SUMMARY_CLASSES} data-testid="admin-monitoring-mail-provider-summary">
              {/* 🔴 0 件ではなく消費率で成立を示す（docs/04 §A-005）。 */}
              {m.sentToday}: {item.providerReading.sentLast24h} / {m.limit} {item.envLimit} {messages.unitMessages}（{percent(item.providerReading.consumptionRate)}）— {m.held}{' '}
              {item.heldCount} {messages.unitCount}
            </p>
          ) : (
            <Alert variant="warning" data-testid="admin-monitoring-mail-provider-unavailable">
              <AlertDescription>
                <p>{m.unavailable}</p>
                <p>
                  {m.localCounter}: {item.providerReading.localSentLast24h} {messages.unitMessages} / {m.limit} {item.envLimit} {messages.unitMessages} — {m.held} {item.heldCount}{' '}
                  {messages.unitCount}
                </p>
                <p>
                  {m.lastObservedAt}: {item.providerReading.lastObservedAt === null ? m.never : formatDateTimeJst(item.providerReading.lastObservedAt)}
                </p>
              </AlertDescription>
            </Alert>
          )}
          <p className={SUMMARY_CLASSES}>
            {m.reachedAt}: {dateTime(item.reachedAt)} / {m.nearingSince}: {dateTime(item.nearingSince)}
          </p>
          <p className={NOTE_CLASSES}>{m.note}</p>
        </>
      );
    }
    case 'SEND_HOLD': {
      const m = messages.sendHold;
      const env = item.byReason.PROVIDER_QUOTA;
      return (
        <>
          {item.total === 0 ? (
            <Empty kind={item.kind} text={m.empty} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.reason}</TableHead>
                  <TableHead>{c.tenant}</TableHead>
                  <TableHead>{c.proposals}</TableHead>
                  <TableHead>{c.contracts}</TableHead>
                  <TableHead>{c.oldest}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SEND_HOLD_REASONS_VIEW.flatMap((reason) => {
                  const entry = item.byReason[reason];
                  if (entry.scope === 'ENVIRONMENT') {
                    if (entry.proposals + entry.contracts === 0) return [];
                    // 🔴 環境全体の 1 行。対象テナント欄は「−（環境全体）」で導線を持たない。
                    return [
                      <TableRow key={reason} data-testid="admin-monitoring-send-hold-PROVIDER_QUOTA">
                        <TableCell>
                          <Badge variant="warning">{m.reason[reason]}</Badge>
                        </TableCell>
                        <TableCell>{messages.envScope}</TableCell>
                        <TableCell>{entry.proposals}</TableCell>
                        <TableCell>{entry.contracts}</TableCell>
                        <TableCell>{dateTime(entry.oldestSince)}</TableCell>
                      </TableRow>,
                    ];
                  }
                  return entry.rows.map((row) => (
                    <TableRow key={`${reason}/${row.tenantId}`} data-testid={`admin-monitoring-send-hold-${reason}`}>
                      <TableCell>
                        <Badge variant="warning">{m.reason[reason]}</Badge>
                      </TableCell>
                      <TenantCell tenantId={row.tenantId} messages={messages} quota={reason === 'RATE_LIMIT'} />
                      <TableCell>{row.proposals}</TableCell>
                      <TableCell>{row.contracts}</TableCell>
                      <TableCell>{dateTime(row.oldestSince)}</TableCell>
                    </TableRow>
                  ));
                })}
              </TableBody>
            </Table>
          )}
          {env.scope === 'ENVIRONMENT' && env.proposals + env.contracts > 0 ? <p className={NOTE_CLASSES}>{messages.envScope}</p> : null}
          <p className={NOTE_CLASSES}>{m.note}</p>
        </>
      );
    }
    case 'PURGE_NOTICE_PENDING': {
      const m = messages.purgeNotice;
      return (
        <>
          {item.total === 0 ? (
            <Empty kind={item.kind} text={m.empty} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.tenant}</TableHead>
                  <TableHead>{c.cause}</TableHead>
                  <TableHead>{c.overdueDays}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.rows.map((row) => (
                  <TableRow key={row.tenantId}>
                    <TenantCell tenantId={row.tenantId} messages={messages} />
                    <TableCell>
                      <Badge variant="warning">{m.cause[row.cause]}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.overdueDays} {messages.unitDays}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className={NOTE_CLASSES}>{m.note}</p>
        </>
      );
    }
    case 'MAIL_DISPATCH_STUCK': {
      const m = messages.mailDispatchStuck;
      return (
        <>
          <p className={SUMMARY_CLASSES}>
            {messages.threshold}: {item.stallThresholdMinutes} {messages.unitMinutes}
          </p>
          {item.count === 0 ? (
            <Empty kind={item.kind} text={`${messages.checkedToday}: ${m.empty}`} />
          ) : (
            <p className={SUMMARY_CLASSES} data-testid="admin-monitoring-mail-dispatch-stuck-summary">
              {item.count} {messages.unitCount}
              {item.countIsLowerBound ? m.lowerBound : ''} / {c.oldest}: {dateTime(item.oldestSince)}
            </p>
          )}
          <p className={NOTE_CLASSES}>{m.note}</p>
        </>
      );
    }
    case 'PROVIDER_SPEND': {
      const m = messages.providerSpend;
      const rateText = item.consumptionRate > 1 ? `${m.exceeded} ${percent(item.consumptionRate)}` : percent(item.consumptionRate);
      return (
        <>
          <p className={SUMMARY_CLASSES}>{messages.envScope}</p>
          {/* 🔴 REACHED は単一テナントの上限到達と同じ行・色に混ぜない（専用の帯）。 */}
          {item.level === 'REACHED' ? (
            <Alert variant="danger" data-testid="admin-monitoring-provider-spend-reached">
              <AlertDescription>{m.level.REACHED}</AlertDescription>
            </Alert>
          ) : null}
          <p className={SUMMARY_CLASSES} data-testid="admin-monitoring-provider-spend-summary">
            {m.thisMonth} ${item.spentUsd} / {m.cap} ${item.capUsd}（{rateText}）— {item.tenantCount} {messages.unitTenants} / {item.periodKey} /{' '}
            {m.level[item.level]}
          </p>
          <p className={NOTE_CLASSES}>{m.note}</p>
        </>
      );
    }
    case 'SCHEDULER_HEARTBEAT': {
      const m = messages.scheduler;
      return (
        <p className={SUMMARY_CLASSES} data-testid="admin-monitoring-scheduler-summary">
          {m.lastRunAt}: {item.lastRunAt === null ? m.never : formatDateTimeJst(item.lastRunAt)} — {item.stalled ? m.stalled : m.running}（{messages.threshold}:{' '}
          {item.staleHours} {messages.unitHours}）
        </p>
      );
    }
  }
}

export function AdminMonitoringItems({ snapshot, messages }: AdminMonitoringItemsProps) {
  const byKind = new Map(snapshot.items.map((item) => [item.kind, item]));
  return (
    <div>
      <p className="mb-4 text-sm text-slate-600" data-testid="admin-monitoring-observed-at">
        {messages.observedAt}: {formatDateTimeJst(snapshot.observedAt)}
      </p>
      {isAllClear(snapshot.items) ? (
        <Alert variant="success" className="mb-6" data-testid="admin-monitoring-all-clear">
          <AlertDescription>{messages.allClear}</AlertDescription>
        </Alert>
      ) : null}
      {MONITORING_KINDS.map((kind) => {
        const item = byKind.get(kind);
        if (item === undefined) return null;
        return (
          <Section key={kind} kind={kind} severity={severityOf(item)} messages={messages}>
            <Body item={item} messages={messages} />
          </Section>
        );
      })}
    </div>
  );
}
