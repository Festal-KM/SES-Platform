// apps/web/app/admin/usage/admin-usage-table.tsx
// `A-004` 利用量・クォータ管理 — 環境全体の帯とテナント表の**純粋な描画**（docs/04 §A-004 / API-A6 / `F-057` / `F-063 AC-5`。T3）。T-11-02。
//
// 🔴 状態を持たない（`'use client'` を宣言しない）。`admin-usage-view.tsx`（クライアント）が API-A6 の応答と文言を渡す。
//    `*.render.test.tsx` はこの部品を状態ごとに描いて固定する（OWNER にだけ操作導線 / SUPPORT には無い / 抽出 0 件 / 環境全体の帯）。
// 🔴 件数と金額（USD）を**同一画面**に出す（`F-063 AC-5`）。各単位に 1 件あたり標準原価を添え、月次に「標準原価比」と
//    「基準ユニット比」の 2 つの倍率を出す（docs/03 §7.6.3-2「消費率だけでは異常の程度が分からない」）。
// 🔴 環境全体の帯（項目 17 の材料）はテナント表の**外**に別集計として描く。`REACHED` はテナント行の到達と同じ色・同じ行に混ぜず、
//    専用の帯（`danger`）で出す（docs/04 §A-005 項目 17 / T-11-08 の申し送り ①）。
// 🔴 `PLATFORM_SUPPORT` には「クォータを変更」の導線を**描かない**（グレーアウトではなく不在。`F-057 AC-2` / `BR-44`）。
// 🔴 表示するのはテナント名・件数・金額・比率・水準・日付だけ（`BR-40`）。横スクロールは `Table` の器の内側に閉じ、
//    T3 だがモバイルで列を `hidden` にしない（`CLAUDE.md` §13.3）。
import Link from 'next/link';
import type { AiRole, AiUnitMetric, ConsumptionBand, QuotaOverrideMetric, UsageLimitLevel } from '@ses/domain';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeVariant,
} from '@ses/ui';
import { adminTenantDetailHref } from '../../../lib/admin-monitoring/hrefs';
import type {
  AdminCountQuotaView,
  AdminQuotaSourceView,
  AdminUsageEnvironmentView,
  AdminUsageTenantRow,
  AdminUsageView,
} from '../../../lib/admin-usage/view';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { formatThousands } from '../../../lib/format/number';

export type AdminUsageTableMessages = {
  readonly observedAt: string;
  readonly periodDay: string;
  readonly periodMonth: string;
  readonly moneyNote: string;
  readonly env: {
    readonly title: string;
    readonly note: string;
    readonly spent: string;
    readonly cap: string;
    readonly rate: string;
    readonly over: string;
    readonly tenants: string;
    readonly byRole: string;
  };
  readonly emptyFiltered: string;
  readonly emptyNone: string;
  readonly columns: {
    readonly tenant: string;
    readonly state: string;
    readonly seats: string;
    readonly aiUnits: string;
    readonly aiDaily: string;
    readonly aiMonthly: string;
    readonly email: string;
    readonly storage: string;
    readonly band: string;
    readonly actions: string;
  };
  readonly metric: Readonly<Record<QuotaOverrideMetric, string>>;
  readonly unitCount: string;
  readonly unitMessages: string;
  readonly standardCost: string;
  readonly level: Readonly<Record<UsageLimitLevel, string>> & { readonly unknown: string };
  readonly band: Readonly<Record<ConsumptionBand, string>>;
  readonly quota: {
    readonly default: string;
    readonly override: string;
    readonly pending: string;
    readonly pendingLowering: string;
    readonly effectiveFrom: string;
  };
  readonly ratio: { readonly unitCost: string; readonly unitCostNote: string; readonly baseline: string; readonly na: string };
  readonly byRole: string;
  readonly roles: Readonly<Record<AiRole, string>>;
  readonly rowTenantDetail: string;
  readonly rowOpenQuota: string;
  readonly aiUnitMetrics: readonly AiUnitMetric[];
};

export type AdminUsageTableProps = {
  readonly view: AdminUsageView;
  readonly messages: AdminUsageTableMessages;
  /** 🔴 `PLATFORM_OWNER` だけ `true`。`false` のとき「クォータを変更」は**描かれない**（`F-057 AC-2`）。 */
  readonly canEditQuota: boolean;
  /** `A-005` からの導線（`?targetTenantId=`）。該当行を強調する。 */
  readonly highlightedTenantId?: string;
  /** OWNER が行の「クォータを変更」を押したとき（フォームへ対象を渡す）。 */
  readonly onSelectTenant?: (tenantId: string) => void;
};

const LEVEL_BADGE_VARIANTS: Readonly<Record<UsageLimitLevel, BadgeVariant>> = {
  BELOW: 'neutral',
  NEARING: 'warning',
  REACHED: 'danger',
};

const BAND_BADGE_VARIANTS: Readonly<Record<ConsumptionBand, BadgeVariant>> = {
  LOW: 'warning',
  MID: 'neutral',
  HIGH: 'danger',
};

/** 十進の USD 文字列（小数 6 桁）を表示用に丸める（小数 3 桁。請求根拠ではなく表示）。 */
export function formatUsd(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `$${formatThousands(Number(whole))}.${fraction.padEnd(3, '0').slice(0, 3)}`;
}

/** バイト数を GiB に丸めて表示（小数 2 桁）。上限の比較は API 側が整数で済ませている。 */
export function formatGib(bytes: string): string {
  const value = Number(BigInt(bytes) / 1_048_576n) / 1024;
  return `${value.toFixed(2)} GiB`;
}

function formatRatio(value: number | null, na: string): string {
  return value === null ? na : `×${value.toFixed(2)}`;
}

function formatPercent(percent: number): string {
  return `${percent}%`;
}

function LevelBadge({ level, messages }: { level: UsageLimitLevel | null; messages: AdminUsageTableMessages }) {
  if (level === null) return <span className="text-xs text-slate-500">{messages.level.unknown}</span>;
  return <Badge variant={LEVEL_BADGE_VARIANTS[level]}>{messages.level[level]}</Badge>;
}

/** 出所と予定。🔴 6 計測すべてが同じ表示（T-12-12 でメール / ストレージも上書きの対象に戻し、専用文言を撤去した）。 */
function QuotaSource({ quota, messages }: { quota: AdminQuotaSourceView; messages: AdminUsageTableMessages }) {
  return (
    <span className="text-xs text-slate-500">
      {quota.source === 'OVERRIDE' ? `${messages.quota.override} ${quota.effectiveFrom ?? ''}` : messages.quota.default}
      {quota.pending === null ? null : (
        <>
          {' / '}
          <span className={quota.pending.lowering ? 'font-medium text-amber-700' : undefined}>
            {quota.pending.lowering ? messages.quota.pendingLowering : messages.quota.pending} {quota.pending.effectiveFrom} → {quota.pending.limit}
          </span>
        </>
      )}
    </span>
  );
}

function CountQuota({ value, unit, messages }: { value: AdminCountQuotaView; unit: string; messages: AdminUsageTableMessages }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>
        {formatThousands(value.used)} / {formatThousands(value.limit)} {unit}（{formatPercent(value.consumptionPercent)}）
      </span>
      <span className="flex items-center gap-1">
        <LevelBadge level={value.level} messages={messages} />
        <QuotaSource quota={value.quota} messages={messages} />
      </span>
    </div>
  );
}

export function AdminUsageEnvironment({ env, messages }: { env: AdminUsageEnvironmentView; messages: AdminUsageTableMessages }) {
  const variant = env.level === 'REACHED' ? 'danger' : env.level === 'NEARING' ? 'warning' : 'info';
  const percent = Math.floor(env.consumptionRate * 100);
  return (
    <Alert variant={variant} className="mb-6" data-testid="admin-usage-environment" data-level={env.level}>
      <AlertTitle>
        {messages.env.title}（{env.periodKey}）
      </AlertTitle>
      <AlertDescription>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-600">{messages.env.spent}</dt>
            <dd className="font-medium" data-testid="admin-usage-environment-spent">
              {formatUsd(env.spentUsd)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">{messages.env.cap}</dt>
            <dd className="font-medium">{formatUsd(env.capUsd)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">{messages.env.rate}</dt>
            <dd className="font-medium" data-testid="admin-usage-environment-rate">
              {formatPercent(percent)}
              {env.consumptionRate > 1 ? ` ${messages.env.over}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">{messages.env.tenants}</dt>
            <dd className="font-medium">{env.tenantCount}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-slate-600">{messages.env.byRole}</p>
        <ul className="grid grid-cols-2 gap-x-6 text-xs sm:grid-cols-3" data-testid="admin-usage-environment-by-role">
          {(Object.entries(env.byRole) as [AiRole, string][]).map(([role, usd]) => (
            <li key={role}>
              {messages.roles[role]}: {formatUsd(usd)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-600">{messages.env.note}</p>
      </AlertDescription>
    </Alert>
  );
}

function TenantRow({
  row,
  messages,
  canEditQuota,
  highlighted,
  onSelectTenant,
}: {
  row: AdminUsageTenantRow;
  messages: AdminUsageTableMessages;
  canEditQuota: boolean;
  highlighted: boolean;
  onSelectTenant?: (tenantId: string) => void;
}) {
  return (
    <TableRow
      data-testid={`admin-usage-row-${row.tenantId}`}
      data-band={row.band}
      className={highlighted ? 'bg-amber-50' : undefined}
    >
      <TableCell className="align-top">
        <div className="font-medium text-slate-900">{row.name}</div>
        <Link className="text-xs text-slate-700 underline-offset-2 hover:underline" href={adminTenantDetailHref(row.tenantId)}>
          {messages.rowTenantDetail}
        </Link>
      </TableCell>
      <TableCell className="align-top">{row.lifecycleState}</TableCell>
      <TableCell className="align-top">{formatThousands(row.seatsUsed)}</TableCell>
      <TableCell className="align-top">
        <ul className="flex flex-col gap-1" data-testid={`admin-usage-ai-units-${row.tenantId}`}>
          {messages.aiUnitMetrics.map((metric) => {
            const unit = row.aiUnits[metric];
            return (
              <li key={metric}>
                <span className="text-xs text-slate-600">
                  {messages.metric[metric]}（{messages.standardCost} {formatUsd(unit.standardCostUsd)}）
                </span>
                <CountQuota value={unit} unit={messages.unitCount} messages={messages} />
              </li>
            );
          })}
        </ul>
      </TableCell>
      <TableCell className="align-top">
        <div data-testid={`admin-usage-ai-daily-${row.tenantId}`}>
          {formatUsd(row.aiDaily.costUsd)} / {formatUsd(row.aiDaily.limitUsd)}（{formatPercent(row.aiDaily.consumptionPercent)}）
        </div>
        <LevelBadge level={row.aiDaily.level} messages={messages} />
      </TableCell>
      <TableCell className="align-top">
        <div data-testid={`admin-usage-ai-monthly-${row.tenantId}`}>
          {formatUsd(row.aiMonthly.costUsd)} / {formatUsd(row.aiMonthly.capUsd)}（{formatPercent(row.aiMonthly.consumptionPercent)}）
        </div>
        <dl className="mt-1 text-xs text-slate-600">
          <div className="flex gap-1">
            <dt>{messages.ratio.unitCost}</dt>
            <dd title={messages.ratio.unitCostNote} data-testid={`admin-usage-unit-cost-ratio-${row.tenantId}`}>
              {formatRatio(row.aiMonthly.unitCostRatio, messages.ratio.na)}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{messages.ratio.baseline}</dt>
            <dd>{formatRatio(row.aiMonthly.baselineRatio, messages.ratio.na)}</dd>
          </div>
        </dl>
        <details className="mt-1 text-xs text-slate-600">
          <summary>{messages.byRole}</summary>
          <ul>
            {(Object.entries(row.aiMonthly.byRole) as [AiRole, string][]).map(([role, usd]) => (
              <li key={role}>
                {messages.roles[role]}: {formatUsd(usd)}
              </li>
            ))}
          </ul>
        </details>
      </TableCell>
      <TableCell className="align-top">
        <CountQuota value={row.email} unit={messages.unitMessages} messages={messages} />
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-0.5">
          <span>
            {formatGib(row.storage.usedBytes)} / {formatGib(row.storage.limitBytes)}（{formatPercent(row.storage.consumptionPercent)}）
          </span>
          <span className="flex items-center gap-1">
            <LevelBadge level={row.storage.level} messages={messages} />
            <QuotaSource quota={row.storage.quota} messages={messages} />
          </span>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant={BAND_BADGE_VARIANTS[row.band]}>{messages.band[row.band]}</Badge>
      </TableCell>
      {/* 🔴 SUPPORT にはこのセルの中身が無い（列は残す = 表の形は同じ、導線だけが不在）。 */}
      <TableCell className="align-top">
        {canEditQuota ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid={`admin-usage-quota-open-${row.tenantId}`}
            onClick={onSelectTenant === undefined ? undefined : () => onSelectTenant(row.tenantId)}
          >
            {messages.rowOpenQuota}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function AdminUsageTable({ view, messages, canEditQuota, highlightedTenantId, onSelectTenant }: AdminUsageTableProps) {
  // 🔴 `A-005` から来た対象テナントを先頭に出す（並びは API の順のまま、対象だけ前へ）。
  const rows =
    highlightedTenantId === undefined
      ? view.items
      : [...view.items.filter((row) => row.tenantId === highlightedTenantId), ...view.items.filter((row) => row.tenantId !== highlightedTenantId)];

  return (
    <div>
      <p className="mb-2 text-xs text-slate-600" data-testid="admin-usage-observed-at">
        {messages.observedAt}: {formatDateTimeJst(view.observedAt)}（{messages.periodDay} {view.dayKey} / {messages.periodMonth} {view.monthKey}）
      </p>
      <p className="mb-4 text-xs text-slate-600" data-testid="admin-usage-money-note">
        {messages.moneyNote}
      </p>
      <AdminUsageEnvironment env={view.environment} messages={messages} />
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid="admin-usage-empty">
          {view.totalTenants === 0 ? messages.emptyNone : messages.emptyFiltered}
        </p>
      ) : (
        <Table data-testid="admin-usage-table">
          <TableHeader>
            <TableRow>
              <TableHead>{messages.columns.tenant}</TableHead>
              <TableHead>{messages.columns.state}</TableHead>
              <TableHead>{messages.columns.seats}</TableHead>
              <TableHead>{messages.columns.aiUnits}</TableHead>
              <TableHead>{messages.columns.aiDaily}</TableHead>
              <TableHead>{messages.columns.aiMonthly}</TableHead>
              <TableHead>{messages.columns.email}</TableHead>
              <TableHead>{messages.columns.storage}</TableHead>
              <TableHead>{messages.columns.band}</TableHead>
              <TableHead>{messages.columns.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TenantRow
                key={row.tenantId}
                row={row}
                messages={messages}
                canEditQuota={canEditQuota}
                highlighted={row.tenantId === highlightedTenantId}
                onSelectTenant={onSelectTenant}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
