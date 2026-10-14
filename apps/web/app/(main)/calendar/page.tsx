// apps/web/app/(main)/calendar/page.tsx
// `カレンダー`（✅ 2026-10-14。人間の明示指示「チャットの下にカレンダーも入れる」）。
//
// ============================================================================
// 🔴 この画面は**準備中**である（中身をまだ持たない）
// ============================================================================
// 人間の指示は「**タブ内のコンテンツについては準備中という表記でよいです**」であり、
// **外枠と到達手段だけを先に作る**のがこの画面の責務である。
//
// 🔴 **「準備中の画面」と「`Phase N` の押せない項目」は別物である**（`lib/shell/nav.ts` 冒頭の 🔴）。
//    `お知らせ`（`S-032`）はリンクですらない —— 押しても行き先が無いからである。こちらは
//    **押せて、開けて、中身がまだ無い**。利用者が取るべき行動が違うので、印も別にする。
// 🔴 **「いつ使えるようになるか」を書かない**（`packages/i18n` の `shell.preparing.description`）。
//    Phase も日付も約束しない。
//
// 🔴 **データを 1 件も読まない。** 予定の出所（面談 `S-024` / 契約満了 `Assignment.endDate` /
//    稼働開始）が決まっていないため（Issue #102 の既定 = C「面談と契約満了の 2 つ」）、
//    **ここで仮に決めて読み始めると、後から情報境界の検討なしに開示項目が増える**。
//    🔴 取引先にも出す画面であり（サイドバーは所属で出し分けていない）、**何を出すかは
//    §3.1 の第二境界そのもの**である。読み取りは人間の判断の後に入れる。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { EmptyState, PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { CALENDAR_TRAIL } from '../../../lib/shell/page-trail';
import { PageHeading } from '../_shell/page-heading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('calendar.title') };

export default async function CalendarPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  // 🔴 **所属でもロールでも出し分けない。** 予定はどちらの側にも在る面であり、見える中身を
  //    決めるのは RLS である（`lib/shell/nav.ts` の `calendar` と同じ判断）。

  return (
    // 🔴 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`）。**読み幅 720px**（クラス C）
    //    —— いまここに在るのは 1 文だけである。表が入ったら幅クラスを見直す。
    <main className="py-6">
      <PageBody widthClass="prose">
        <PageHeading trail={CALENDAR_TRAIL} title={t('calendar.title')} />
        {/* 🔴 `EmptyState` にアクションを渡さない（`primary` / `secondary`）—— 準備中は
            「0 件が正常な画面」と同じで、押すものを置くと異常に見える（部品冒頭の 🔴）。 */}
        <EmptyState description={t('shell.preparing.description')} testIdPrefix="calendar-preparing-" />
      </PageBody>
    </main>
  );
}
