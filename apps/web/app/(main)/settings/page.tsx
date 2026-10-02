// apps/web/app/(main)/settings/page.tsx
// `設定` の**索引**（`/settings`）。2026-10-03（人間の明示指示 + モックアップ）。
//
// ============================================================================
// 🔴 なぜこの画面が新設されたのか
// ============================================================================
// サイドバーを**モックアップどおり 6 項目のフラット**に畳んだことで、それまで `設定` 群に
// 並んでいた 7 項目（`S-035` 組織設定 / `S-014` 取引先企業 / `S-036` 送信ドメイン /
// `S-038` 利用量と上限 / `S-042` データの返却 / `S-041` 監査ログ / `S-009` スキル辞書）の
// 置き場所が無くなった。🔴 **このうち `S-036` / `S-041` / `S-042` はナビが唯一の入口である**
// （`lib/shell/nav.ts` の `buildSettingsIndex` の 🔴）ため、畳んだだけでは**到達不能になり、
// 機能が消える**（`CLAUDE.md` §13.3「遮断しない」にも反する）。
//
// 🔴 **新しい機能は 1 つも足していない。** この画面が持つのは既存 7 画面への遷移だけである。
// 🔴 **ロール条件は `lib/shell/nav.ts` の `buildSettingsIndex` が 1 箇所で持つ。**
//    **この画面にロール判定を書かない**（2 つ目のロール表を作らない。`capabilities.ts` と
//    `page-trail.ts` が食い違った前例がある）。
// 🔴 **到達できない画面は項目ごと出さない**（グレーアウトで見せない = `BR-44`）。
//
// 🔴 **ロールで到達を止めない。** どのロールにも最低 2 項目（`S-014` / `S-009`）が在るので、
//    空の索引にはならない。各画面の拒否は従来どおり各 `page.tsx` の redirect と API の
//    `requireRole` が行う（この索引は UI の配慮にすぎない）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@ses/i18n';
import { NavIndex, PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { buildSettingsIndex } from '../../../lib/shell/nav';
import { resolveNavIndexItems } from '../../../lib/shell/nav-view';
import { SETTINGS_INDEX_TRAIL } from '../../../lib/shell/page-trail';
import { PageHeading } from '../_shell/page-heading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('settings.index.title') };

export default async function SettingsIndexPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const ctx = outcome.ctx;
  // 🔴 所属（`partnerCompanyId`）で決める。ロール名で代用しない（`memberships` の CHECK と 1 対 1。
  //    `app/(main)/layout.tsx` と同じ判定）。
  const items = buildSettingsIndex({
    audience: ctx.partnerCompanyId === null ? 'HOST' : 'PARTNER',
    role: ctx.role,
  });

  return (
    // 🔴 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`）。索引は語の列なので
    //    **クラス C = 読み幅 720px** である（**画面ファイルに `max-w-*` を書かない**。
    //    `tests/static/ui-screen-width.test.ts` (c) / `ui-width-class-coverage.test.ts` (k)）。
    <main className="py-6">
      <PageBody widthClass="prose">
        <PageHeading trail={SETTINGS_INDEX_TRAIL} title={t('settings.index.title')} />
        <p className="mb-4 text-body text-fg-muted">{t('settings.index.description')}</p>
        <NavIndex
          items={resolveNavIndexItems(items)}
          label={t('settings.index.label')}
          // 🔴 `packages/ui` は `next/*` に依存しない（`docs/05` §2.3.1）。ここで渡す。
          linkComponent={Link}
        />
      </PageBody>
    </main>
  );
}
