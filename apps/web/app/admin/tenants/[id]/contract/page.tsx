// apps/web/app/admin/tenants/[id]/contract/page.tsx
// `A-010` 契約管理（docs/04 §A-010 / `F-062` `F-064`）。T-10-10。
//
// 🔴 **Phase 1 の本画面は「削除完了の確認」（セクション 4）1 セクションだけの画面である**（docs/04 §A-010 の冒頭）。
//    セクション 1〜3（プラン・ライフサイクル操作・請求。`F-062`。Phase 3）はここに**存在しない**（「準備中」とも書かない）。
// 🔴 これが運営者にとっての削除確認の**唯一の経路**（`F-062 AC-7`）。読み取りは API-A12 と同じ `readDeletionStatus`
//    （`withPlatformRead` + `admin.deletion_status.view`）の 1 本であり、`A-003` / `A-013` / `A-005` に同じ確認を置かない。
// 🔴 `PLATFORM_SUPPORT` も閲覧できる（`F-062 AC-7`）。Phase 1 に書き込み操作は無く、ロールで描き分ける要素も無い。
// 🔴 表示は完了 / 未完了の別と件数のみ（`BR-40`）。削除された内容・返却データへの導線を持たない。
import { notFound, redirect } from 'next/navigation';
import { readDeletionStatus } from '@ses/db/platform';
import {
  readPlatformRequestMeta,
  resolvePlatformCtxOutcome,
} from '../../../../../lib/auth/platform-session';
import { isTenantIdLike } from '../../../../../lib/admin-tenants/schemas';
import { deletionStatusMessages } from './_lib/messages';
import { DeletionStatusScreen } from './deletion-status-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminTenantContractPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const { id } = await params;
  // 🔴 API ルート（`deletion-status/route.ts` の `paramsSchema`）と同じ形状検証。不正な形の ID は DB に触れず 404 に畳む。
  if (!isTenantIdLike(id)) notFound();

  const meta = await readPlatformRequestMeta();
  const view = await readDeletionStatus(outcome.ctx, id, { ipAddress: meta.ipAddress });
  if (view === null) notFound();

  return <DeletionStatusScreen view={view} messages={deletionStatusMessages(view.lifecycleState)} />;
}
