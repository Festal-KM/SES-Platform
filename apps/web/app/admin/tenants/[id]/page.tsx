// apps/web/app/admin/tenants/[id]/page.tsx
// `A-003` テナント詳細（docs/04 §A-003 / API-A3 / `F-056`）。T-03-09。
//
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。エンジニアの氏名・
//    スキルシートの内容・案件の内容・提案の本文・チャット本文への導線を持たない。
// 🔴 `PURGED` はライフサイクル状態のみを表示し、削除件数を出さない（docs/04 program-design
//    申し送り 15 / `F-062 AC-7`）。削除完了の確認は `A-010`（セクション 4 = Phase 1。T-10-10）の 1 本のみで、
//    本画面は `CLOSING` / `PURGED` のときにそこへの導線だけを置く。
// 🔴 書き込み操作なし。画面タイトル右に「閲覧のみ」を常時表示する（`BR-37`）。
//
// 🔴 T-21-05: 「閲覧のみ」バッジを `@ses/ui` の `Badge` へ移した。**定義リストの項目の集合は
//    1 つも変えていない**（`BR-40`。件数・状態・日時だけであり、エンジニアの氏名・連絡先・
//    スキルシート本文・チャット本文・トークン平文はここに 1 つも無い）。
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getPlatformTenantDetail } from '@ses/db/platform';
import { t } from '@ses/i18n';
import { Badge } from '@ses/ui';
import {
  readPlatformRequestMeta,
  resolvePlatformCtxOutcome,
} from '../../../../lib/auth/platform-session';
import { adminTenantContractHref, adminTenantQuotaHref } from '../../../../lib/admin-monitoring/hrefs';
import { isTenantIdLike } from '../../../../lib/admin-tenants/schemas';
import {
  TENANT_LIFECYCLE_STATE_MESSAGE_KEYS,
  tenantEnvironmentMessageKey,
} from '../_lib/labels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function DefinitionRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * セクション 6「監査ログへの導線」（docs/04 §A-003 / `A-006`。T-11-03）。
 * 🔴 `A-006` は `?targetTenantId=` を初期値に入れるだけで、開いただけでは検索（横断検索の監査行）を実行しない。
 * 🔴 `PURGED` でも出す（監査ログは法令上の保持義務がある範囲で残る。`CLAUDE.md` §4.2 `Tenant` の規則）。
 */
function AuditLogsSection({ tenantId }: { readonly tenantId: string }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        {t('admin.tenantDetail.section.auditLogs')}
      </h2>
      <Link
        className="text-sm text-slate-700 underline-offset-2 hover:underline"
        href={`/admin/audit-logs?targetTenantId=${encodeURIComponent(tenantId)}`}
        data-testid="admin-tenant-detail-audit-logs-link"
      >
        {t('admin.tenantDetail.auditLogs.link')}
      </Link>
    </section>
  );
}

/**
 * セクション 4「利用量とクォータ消化率」（docs/04 §A-003 → `A-004`。T-11-02）。
 * 🔴 本画面からは遷移のみ（書き込みは `A-004` で行う。docs/04 §A-003「操作と結果」）。`A-004` は対象テナントの行を先頭に出す。
 */
function UsageSection({ tenantId }: { readonly tenantId: string }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('admin.tenantDetail.section.usage')}</h2>
      <Link
        className="text-sm text-slate-700 underline-offset-2 hover:underline"
        href={adminTenantQuotaHref(tenantId)}
        data-testid="admin-tenant-detail-usage-link"
      >
        {t('admin.tenantDetail.usage.link')}
      </Link>
    </section>
  );
}

/**
 * `A-010` セクション 4「削除完了の確認」への導線（docs/04 §A-003「`PURGED` → ライフサイクル状態のみ + `A-010` へのリンク」。T-10-10）。
 * 🔴 `CLOSING` / `PURGED` のときだけ出す。本画面（API-A3）には削除の完了 / 未完了と件数を**出さない**
 *    （`F-062 AC-7` の「唯一の経路」を `A-010` に保つ。同じ確認を 2 経路で表現しない）。
 */
function DeletionStatusSection({ tenantId }: { readonly tenantId: string }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        {t('admin.tenantDetail.section.deletionStatus')}
      </h2>
      <Link
        className="text-sm text-slate-700 underline-offset-2 hover:underline"
        href={adminTenantContractHref(tenantId)}
        data-testid="admin-tenant-detail-deletion-status-link"
      >
        {t('admin.tenantDetail.deletionStatus.link')}
      </Link>
    </section>
  );
}

export default async function AdminTenantDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const { id } = await params;
  // 🔴 API ルート（`[id]/route.ts` の `paramsSchema`）と同じ形状検証。不正な形の ID は
  //    DB に触れず 404 に畳む（`uuid` 型キャストの Postgres エラーで 500 にしない）。
  if (!isTenantIdLike(id)) notFound();

  const meta = await readPlatformRequestMeta();
  const detail = await getPlatformTenantDetail(outcome.ctx, id, { ipAddress: meta.ipAddress });
  if (detail === null) notFound();

  const readOnlyBadge = <Badge>{t('admin.readOnly.badge')}</Badge>;

  if (detail.lifecycleState === 'PURGED') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">{t('admin.tenantDetail.eyebrow')}</p>
            <h1 className="text-xl font-bold text-slate-900">{detail.name}</h1>
          </div>
          {readOnlyBadge}
        </div>
        <p className="text-sm text-slate-700">{t('admin.tenantDetail.purged.notice')}</p>
        <dl className="mt-4">
          <DefinitionRow
            label={t('admin.tenantDetail.field.lifecycleState')}
            value={t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[detail.lifecycleState])}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.lifecycleChangedAt')}
            value={detail.lifecycleChangedAt}
          />
        </dl>
        <DeletionStatusSection tenantId={detail.id} />
        <AuditLogsSection tenantId={detail.id} />
      </main>
    );
  }

  const environmentKey = tenantEnvironmentMessageKey(detail.environment);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{t('admin.tenantDetail.eyebrow')}</p>
          <h1 className="text-xl font-bold text-slate-900">{detail.name}</h1>
        </div>
        {readOnlyBadge}
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {t('admin.tenantDetail.section.contract')}
        </h2>
        <dl>
          <DefinitionRow
            label={t('admin.tenantDetail.field.lifecycleState')}
            value={t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[detail.lifecycleState])}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.environment')}
            value={environmentKey === null ? detail.environment : t(environmentKey)}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.createdAt')}
            value={detail.createdAt}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.lifecycleChangedAt')}
            value={detail.lifecycleChangedAt}
          />
          {detail.sandboxExpiresAt === null ? null : (
            <DefinitionRow
              label={t('admin.tenantDetail.field.sandboxExpiresAt')}
              value={detail.sandboxExpiresAt}
            />
          )}
          {detail.closingEnteredAt === null ? null : (
            <DefinitionRow
              label={t('admin.tenantDetail.field.closingEnteredAt')}
              value={detail.closingEnteredAt}
            />
          )}
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {t('admin.tenantDetail.section.scale')}
        </h2>
        <dl>
          <DefinitionRow
            label={t('admin.tenantDetail.field.seats')}
            value={String(detail.seatCount)}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.partners')}
            value={String(detail.partnerCompanyCount)}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.engineers')}
            value={String(detail.engineerCount)}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.projects')}
            value={String(detail.projectCount)}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.proposals')}
            value={String(detail.proposalCount)}
          />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {t('admin.tenantDetail.section.activity')}
        </h2>
        <dl>
          <DefinitionRow
            label={t('admin.tenantDetail.field.lastActivity')}
            value={detail.lastActivityAt ?? t('admin.tenants.lastActivity.none')}
          />
          <DefinitionRow
            label={t('admin.tenantDetail.field.recentActivity')}
            value={String(detail.recentActivityCount30d)}
          />
        </dl>
      </section>

      <UsageSection tenantId={detail.id} />
      {detail.lifecycleState === 'CLOSING' ? <DeletionStatusSection tenantId={detail.id} /> : null}
      <AuditLogsSection tenantId={detail.id} />
    </main>
  );
}
