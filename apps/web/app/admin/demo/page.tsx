// apps/web/app/admin/demo/page.tsx
// `A-012` デモ環境の合成データ管理（docs/04 §A-012 / API-A16 / `F-053`）。T-10-06。Tier 3。
//
// 🔴 **`APP_ENV` が `demo` / `development` のときだけ画面の中身が存在する**（`F-053 AC-6`）。それ以外で URL を直打ちすると
//    「この環境では利用できません」の 1 文だけを返す（フォームも導線も無い。docs/04 §A-012）。判定は `packages/config` の
//    `isSeedableAppEnv`（API-A16 の 1 枚目のガードと同じ 1 関数）で行い、環境名の比較をここに書かない。
// 🔴 権限: `PLATFORM_OWNER` / `PLATFORM_SUPPORT` とも到達できる（docs/04 §A-012 権限差分）。
// 🔴 画面の閲覧・投入の記録は API-A16（`readDemoSeedStatus` = `withPlatformRead`）が残す。ページ自身は DB に触れない
//    （投入状況の読み取りは client 部品が `GET /api/admin/demo/seed` で行う。`A-005` と同じ形）。
// 🔴 「本番からコピー」に相当する操作を 1 つも置かない（`BR-47`）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { isSeedableAppEnv } from '@ses/config';
import { t } from '@ses/i18n';
import { demoScenarioStartPoints } from '../../../lib/admin-demo/scenarios';
import { resolvePlatformCtxOutcome } from '../../../lib/auth/platform-session';
import { currentAppEnv } from '../../../lib/db/bootstrap';
import { AdminDemoScreen } from './admin-demo-screen';
import { adminDemoMessages } from './_lib/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('admin.demo.title') };

/** API-A16 の URL（docs/05 §6.9）。ページは任意の名前を export できないため非公開の定数にする。 */
const DEMO_SEED_ENDPOINT = '/api/admin/demo/seed';

export default async function AdminDemoPage() {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const appEnv = currentAppEnv();
  return (
    <AdminDemoScreen
      messages={adminDemoMessages()}
      appEnv={appEnv}
      available={isSeedableAppEnv(appEnv)}
      endpoint={DEMO_SEED_ENDPOINT}
      scenarios={demoScenarioStartPoints(1)}
    />
  );
}
