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
//
// ============================================================================
// 🔴 T-22-14（段⑤）: 幅クラスと semantic トークンへの寄せ
// ============================================================================
// - 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`。検査 (c) / (k)）。本画面は
//   **定義リストだけの読み物**なので **クラス C = 読み幅**である（旧 `max-w-3xl` + `mx-auto`）。
// - 🔴 **`widthClass` は 1 ファイルに 1 回**（検査 (k) は 2 回を「条件で幅が変わる画面」として落とす）。
//   旧実装は `PURGED` と通常で `<main>` を 2 つ持っていたため、**器を 1 つに畳み、分岐は
//   中身だけにした**（`PURGED` で出す項目・順序・testid は 1 つも変えていない）。
// - 色・文字サイズ・8 状態は §7.9 / §7.10 のトークンと `packages/ui` の共通語に寄せた
//   （リンクは `SECONDARY_LINK_CLASSES`。画面側に `hover:` を書かない = 検査 (j)）。
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getPlatformTenantDetail } from '@ses/db/platform';
import { t } from '@ses/i18n';
import { Badge, PageBody, SECONDARY_LINK_CLASSES } from '@ses/ui';
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

/** 節の見出し（§7.3 の補助テキスト。`A-005` / `A-006` と同じ語に揃えた）。 */
const SECTION_HEADING_CLASSES = 'mb-2 text-body font-semibold text-fg';

function DefinitionRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-body">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{value}</dd>
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
      <h2 className={SECTION_HEADING_CLASSES}>
        {t('admin.tenantDetail.section.auditLogs')}
      </h2>
      <Link
        className={SECONDARY_LINK_CLASSES}
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
      <h2 className={SECTION_HEADING_CLASSES}>{t('admin.tenantDetail.section.usage')}</h2>
      <Link
        className={SECONDARY_LINK_CLASSES}
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
      <h2 className={SECTION_HEADING_CLASSES}>
        {t('admin.tenantDetail.section.deletionStatus')}
      </h2>
      <Link
        className={SECONDARY_LINK_CLASSES}
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

  // 🔴 `PlatformTenantDetailView` は **`PURGED` を型として分離した判別共用体**である
  //    （`packages/db/src/serializers/platform/tenants.ts`。件数フィールドを持てない）。
  //    器を 1 つに畳んだぶん、**narrowing を JSX の外で済ませる** —— `null` に落とした
  //    `active` を使うことで、`PURGED` の枝で `environment` / 件数に触れない保証が
  //    **コンパイルの時点で**残る（`detail` を直接使うと、JSX の中では narrowing が効かない）。
  const active = detail.lifecycleState === 'PURGED' ? null : detail;
  const environmentKey = active === null ? null : tenantEnvironmentMessageKey(active.environment);

  return (
    // 🔴 器は 1 つ（`widthClass` は 1 画面に 1 回。検査 (k)）。分岐するのは中身だけである。
    <main className="py-6">
      <PageBody widthClass="prose">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-body text-fg-muted">{t('admin.tenantDetail.eyebrow')}</p>
            <h1 className="text-title font-bold text-fg">{detail.name}</h1>
          </div>
          {/* 🔴 `BR-37`: 書き込み操作なしを常時明示する。 */}
          <Badge>{t('admin.readOnly.badge')}</Badge>
        </div>

        {/* 🔴 `PURGED` はライフサイクル状態と変更日時だけを出す（削除件数を出さない。`F-062 AC-7`）。
            確認の唯一の経路は `A-010` であり、ここはその導線だけを置く。 */}
        {active === null ? (
          <>
            <p className="text-body text-fg">{t('admin.tenantDetail.purged.notice')}</p>
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
          </>
        ) : (
          <>
            <section className="mb-6">
              <h2 className={SECTION_HEADING_CLASSES}>
                {t('admin.tenantDetail.section.contract')}
              </h2>
              <dl>
                <DefinitionRow
                  label={t('admin.tenantDetail.field.lifecycleState')}
                  value={t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[active.lifecycleState])}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.environment')}
                  value={environmentKey === null ? active.environment : t(environmentKey)}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.createdAt')}
                  value={active.createdAt}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.lifecycleChangedAt')}
                  value={active.lifecycleChangedAt}
                />
                {active.sandboxExpiresAt === null ? null : (
                  <DefinitionRow
                    label={t('admin.tenantDetail.field.sandboxExpiresAt')}
                    value={active.sandboxExpiresAt}
                  />
                )}
                {active.closingEnteredAt === null ? null : (
                  <DefinitionRow
                    label={t('admin.tenantDetail.field.closingEnteredAt')}
                    value={active.closingEnteredAt}
                  />
                )}
              </dl>
            </section>

            <section className="mb-6">
              <h2 className={SECTION_HEADING_CLASSES}>
                {t('admin.tenantDetail.section.scale')}
              </h2>
              <dl>
                <DefinitionRow
                  label={t('admin.tenantDetail.field.seats')}
                  value={String(active.seatCount)}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.partners')}
                  value={String(active.partnerCompanyCount)}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.engineers')}
                  value={String(active.engineerCount)}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.projects')}
                  value={String(active.projectCount)}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.proposals')}
                  value={String(active.proposalCount)}
                />
              </dl>
            </section>

            <section>
              <h2 className={SECTION_HEADING_CLASSES}>
                {t('admin.tenantDetail.section.activity')}
              </h2>
              <dl>
                <DefinitionRow
                  label={t('admin.tenantDetail.field.lastActivity')}
                  value={active.lastActivityAt ?? t('admin.tenants.lastActivity.none')}
                />
                <DefinitionRow
                  label={t('admin.tenantDetail.field.recentActivity')}
                  value={String(active.recentActivityCount30d)}
                />
              </dl>
            </section>

            <UsageSection tenantId={active.id} />
            {active.lifecycleState === 'CLOSING' ? <DeletionStatusSection tenantId={active.id} /> : null}
            <AuditLogsSection tenantId={active.id} />
          </>
        )}
      </PageBody>
    </main>
  );
}
