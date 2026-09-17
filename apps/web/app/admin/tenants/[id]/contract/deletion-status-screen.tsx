// apps/web/app/admin/tenants/[id]/contract/deletion-status-screen.tsx
// `A-010` 契約管理 — **Phase 1 はセクション 4「削除完了の確認」だけの画面**（docs/04 §A-010 / `F-062 AC-7` / `F-064 AC-2`）。T-10-10。
// 純粋な描画部品（props だけ。`*.render.test.tsx` が状態表を固定する）。
//
// 🔴 表示するのは**完了 / 未完了の別と件数**だけ（`BR-40` / `CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラー」）。
//    削除された内容・返却データ（`S-042` / `#78`）へ到達する導線を置かない。`failureReason` は props の型に無い。
// 🔴 セクション 1〜3（プラン・ライフサイクル操作・請求。Phase 3）は**描かない**（「準備中」とも書かない。docs/04 §A-010）。
//    書き込み UI が無いのは Phase 1 の実装範囲であり、`閲覧のみ` バッジは付けない（docs/04 §4.9 の共通前提: `A-010` は
//    書き込みが許される 6 画面の 1 つで、バッジの対象は「それ以外の画面」）。
// 🔴 最新の実行（`purgeRuns[0]`）で見出しを決める: 無し →「削除は実行されていません」/ `RUNNING` →「削除処理中」（未完了）/
//    `COMPLETED` →「削除完了（YYYY-MM-DD、対象 N 件）」/ `FAILED` →「削除処理に失敗しています」+ `A-005` への導線
//    （失敗の詳細は `A-005` 項目 7 の役割。確認と監視で役割が違う）。
// 🔴 T3（デスクトップ主体）。モバイルでは劣化を許容するが遮断しない（`CLAUDE.md` §13.3）。
import Link from 'next/link';
import type { DeletionStatusRunView, DeletionStatusView } from '@ses/db/platform';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ses/ui';
import { formatDateTimeJst, toJstIsoDay } from '../../../../../lib/format/datetime';
import { ADMIN_MONITORING_HREF, adminTenantDetailHref } from '../../../../../lib/admin-monitoring/hrefs';

export type DeletionStatusScreenMessages = {
  readonly eyebrow: string;
  readonly title: string;
  readonly lead: string;
  readonly lifecycleStateLabel: string;
  readonly lifecycleState: string;
  readonly none: string;
  readonly noneClosing: string;
  readonly running: string;
  readonly runningNote: string;
  readonly completedPrefix: string;
  readonly completedCountPrefix: string;
  readonly completedCountSuffix: string;
  readonly failed: string;
  readonly failedNote: string;
  readonly failedLink: string;
  readonly breakdown: { readonly section: string; readonly kind: string; readonly count: string };
  readonly history: {
    readonly section: string;
    readonly startedAt: string;
    readonly status: string;
    readonly completedAt: string;
    readonly count: string;
  };
  readonly status: Readonly<Record<DeletionStatusRunView['status'], string>>;
  readonly cause: Readonly<Record<DeletionStatusRunView['cause'], string>>;
  readonly backToTenant: string;
};

export type DeletionStatusScreenProps = {
  readonly view: DeletionStatusView;
  readonly messages: DeletionStatusScreenMessages;
};

const SECTION_HEADING_CLASSES = 'mb-2 text-sm font-semibold text-slate-700';
const NOTE_CLASSES = 'mt-2 text-sm text-slate-600';
const LINK_CLASSES = 'text-sm text-slate-700 underline-offset-2 hover:underline';

/** 合計の削除件数（「対象 N 件」の N）。純粋な描画部品は `@ses/db/platform` から型だけを受ける（render テストが Prisma を要らないように）。 */
function sumCounts(counts: DeletionStatusRunView['counts']): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function Headline({ latest, lifecycleState, messages }: {
  readonly latest: DeletionStatusRunView | null;
  readonly lifecycleState: DeletionStatusView['lifecycleState'];
  readonly messages: DeletionStatusScreenMessages;
}) {
  if (latest === null) {
    return (
      <div data-testid="admin-deletion-status-none">
        <p className="text-base font-bold text-slate-900">{messages.none}</p>
        {lifecycleState === 'CLOSING' ? <p className={NOTE_CLASSES}>{messages.noneClosing}</p> : null}
      </div>
    );
  }
  switch (latest.status) {
    case 'RUNNING':
      return (
        <div data-testid="admin-deletion-status-running">
          <p className="text-base font-bold text-slate-900">{messages.running}</p>
          <p className={NOTE_CLASSES}>{messages.runningNote}</p>
        </div>
      );
    case 'COMPLETED':
      return (
        <div data-testid="admin-deletion-status-completed">
          <p className="text-base font-bold text-slate-900">
            {messages.completedPrefix}
            {latest.completedAt === null ? '—' : toJstIsoDay(new Date(latest.completedAt))}
            {messages.completedCountPrefix}
            <span data-testid="admin-deletion-status-total">{sumCounts(latest.counts)}</span>
            {messages.completedCountSuffix}
          </p>
        </div>
      );
    case 'FAILED':
      return (
        <div data-testid="admin-deletion-status-failed">
          <p className="text-base font-bold text-red-700">{messages.failed}</p>
          <p className={NOTE_CLASSES}>{messages.failedNote}</p>
          <Link className={LINK_CLASSES} href={ADMIN_MONITORING_HREF} data-testid="admin-deletion-status-monitoring-link">
            {messages.failedLink}
          </Link>
        </div>
      );
    default:
      return null;
  }
}

export function DeletionStatusScreen({ view, messages }: DeletionStatusScreenProps) {
  const latest = view.purgeRuns[0] ?? null;
  const breakdown = latest?.status === 'COMPLETED' ? Object.entries(latest.counts) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8" data-testid="admin-deletion-status-screen">
      <div className="mb-6">
        <p className="text-sm text-slate-500">{messages.eyebrow}</p>
        <h1 className="text-xl font-bold text-slate-900">{messages.title}</h1>
      </div>
      <p className="mb-6 text-sm text-slate-700">{messages.lead}</p>

      <dl className="mb-6">
        <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm">
          <dt className="text-slate-500">{messages.lifecycleStateLabel}</dt>
          <dd className="text-slate-900" data-testid="admin-deletion-status-lifecycle">
            {messages.lifecycleState}
          </dd>
        </div>
      </dl>

      <section className="mb-6" data-testid="admin-deletion-status-headline">
        <Headline latest={latest} lifecycleState={view.lifecycleState} messages={messages} />
      </section>

      {breakdown.length === 0 ? null : (
        <section className="mb-6">
          <h2 className={SECTION_HEADING_CLASSES}>{messages.breakdown.section}</h2>
          <Table data-testid="admin-deletion-status-breakdown">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.breakdown.kind}</TableHead>
                <TableHead>{messages.breakdown.count}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {breakdown.map(([table, count]) => (
                <TableRow key={table} data-testid={`admin-deletion-status-count-${table}`}>
                  <TableCell>
                    <code className="text-xs">{table}</code>
                  </TableCell>
                  <TableCell>{count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {view.purgeRuns.length === 0 ? null : (
        <section className="mb-6">
          <h2 className={SECTION_HEADING_CLASSES}>{messages.history.section}</h2>
          <Table data-testid="admin-deletion-status-history">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.history.startedAt}</TableHead>
                <TableHead>{messages.history.status}</TableHead>
                <TableHead>{messages.history.completedAt}</TableHead>
                <TableHead>{messages.history.count}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.purgeRuns.map((run) => (
                <TableRow key={`${run.cause}/${run.startedAt}`} data-testid={`admin-deletion-status-run-${run.status}`}>
                  <TableCell>{formatDateTimeJst(run.startedAt)}</TableCell>
                  <TableCell>
                    {messages.cause[run.cause]}
                    {' / '}
                    {messages.status[run.status]}
                  </TableCell>
                  <TableCell>{run.completedAt === null ? '—' : formatDateTimeJst(run.completedAt)}</TableCell>
                  <TableCell>{run.status === 'COMPLETED' ? sumCounts(run.counts) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <Link className={LINK_CLASSES} href={adminTenantDetailHref(view.tenantId)} data-testid="admin-deletion-status-back">
        {messages.backToTenant}
      </Link>
    </main>
  );
}
