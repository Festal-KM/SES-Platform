// apps/web/app/admin/tenants/[id]/page.tsx
// `A-003` テナント詳細（docs/04 §A-003 / API-A3 / `F-056`）。T-03-09。
//
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。エンジニアの氏名・
//    スキルシートの内容・案件の内容・提案の本文・チャット本文への導線を持たない。
// 🔴 `PURGED` はライフサイクル状態のみを表示し、削除件数を出さない（docs/04 program-design
//    申し送り 15 / `F-062 AC-7`）。削除完了の確認は `A-010`（Phase 3）の 1 本のみ。
// 🔴 書き込み操作なし。画面タイトル右に「閲覧のみ」を常時表示する（`BR-37`）。
import { notFound, redirect } from 'next/navigation';
import { getPlatformTenantDetail } from '@ses/db/platform';
import { t } from '@ses/i18n';
import {
  readPlatformRequestMeta,
  resolvePlatformCtxOutcome,
} from '../../../../lib/auth/platform-session';
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

  const readOnlyBadge = (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
      {t('admin.readOnly.badge')}
    </span>
  );

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
    </main>
  );
}
