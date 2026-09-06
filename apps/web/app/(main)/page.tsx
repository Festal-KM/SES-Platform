// apps/web/app/(main)/page.tsx
// 役割別ホーム（`S-003` ホスト / `S-004` 取引先。docs/05 §6.3 #9 / `F-006`）。T-03-06。
//
// 🔴 Phase 0 は**空のダッシュボード**(CLAUDE.md §5)。要対応キュー等のセクションは Phase 1 /
//    Phase 2 が追加する（`apps/web/app/(main)/_home/home-sections.tsx`）。
// 🔴 `getHomeView` は純粋関数（DB を読まない）。Phase 0 は静的な内容のため、`GET /api/home` を
//    自己 fetch せずサーバコンポーネントから直接呼ぶ（Phase 1 が 60 秒ポーリングを足す時点で
//    クライアント化する。docs/04 program-design 申し送り 6）。
//
// 🔴 T-03-02: 2 要素認証が未充足なら `S-001` の 2 段階目へ送る(docs/05 §6.2 の
//    「画面遷移だけを担う」部分)。**遷移は UI の都合であり、境界の強制ではない** ——
//    強制は `resolveTenantCtx` が毎リクエスト行う(ここで redirect を消しても、
//    業務データが漏れることはない)。Edge の middleware に置かないのは DB を読めないため。
//
// 🔴 T-04-06: 最上部の送信ドメイン未検証バナー（`docs/04` §S-036 1298 行「`S-035` と `S-003` の
//    最上部に...帯を出す」）。`getHomeView` 自体は純粋関数のままにし（Phase 1 のポーリング化に
//    影響させない）、この帯のためだけに追加で `TenantSendingDomain` を読む（対象はホスト所属の
//    `OWNER` / `ADMIN` のみ。理由は `_shared/sending-domain-guard-banner.tsx` 冒頭コメント）。
import { redirect } from 'next/navigation';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../lib/auth/session';
import { sendingDomainRuntime } from '../../lib/db/bootstrap';
import { readHomeBlocks } from '../../lib/home/blocks';
import { getHomeView } from '../../lib/home/service';
import { isProjectEditorRole } from '../../lib/projects/policy';
import { isSendingDomainUnverified, resolveSendingDomainFact } from '../../lib/settings/sending-domain-fact';
import { readSendingDomainSettings } from '../../lib/settings/sending-domains';
import {
  HostHomeSections,
  PartnerHomeSections,
  ScanQuarantineSection,
} from './_home/home-sections';
import { SendingDomainGuardBanner } from './_shared/sending-domain-guard-banner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const view = getHomeView(outcome.ctx, await readHomeBlocks(outcome.ctx));

  // 🔴 パートナー所属・`SALES` / `VIEWER` には判定材料すら取りに行かない（不要な DB 往復を
  //    増やさない。パートナー所属は RLS（C2 HOST_ONLY）でどのみち 0 件になる）。
  const canActOnSendingDomain =
    view.audience === 'HOST' && (outcome.ctx.role === 'OWNER' || outcome.ctx.role === 'ADMIN');
  const showSendingDomainBanner = canActOnSendingDomain
    ? isSendingDomainUnverified(
        resolveSendingDomainFact(await readSendingDomainSettings(outcome.ctx, sendingDomainRuntime())),
      )
    : false;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <SendingDomainGuardBanner
        visible={showSendingDomainBanner}
        messages={{
          text: t('settings.sendingDomain.guardBanner.text'),
          linkLabel: t('settings.sendingDomain.guardBanner.linkLabel'),
        }}
      />
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('home.title')}</h1>
      {/* 🔴 T-05-08（`F-011` 処理④）: 隔離の周知は**宛先分類によらず必ず出す**。
          `sandbox` でメールがモックになるパートナー（分類 2）にとっては、ここが
          唯一の気づく場所である。ホスト / パートナーで同じ位置・同じ見せ方にする。 */}
      <ScanQuarantineSection blocks={view.blocks} />
      {view.audience === 'HOST' ? (
        // 🔴 T-05-01: `VIEWER` には `S-007`（人材の登録）への導線を出さない
        //    （`docs/04` §S-007 権限差分「`VIEWER` は到達できない」）。判定材料は `role` だけで、
        //    `deriveMainCapabilities`（`GET /api/me` の応答契約）には足さない ——
        //    あれは承認 / 送信 / DL / エクスポートの 4 つに閉じた型であり、
        //    「作成できるか」を混ぜると `#8` の応答の意味が変わる。
        // 🔴 T-06-01: `S-012`（案件の登録）の導線を有効化した。判定は `#26` と同じ定数
        //    （`PROJECT_EDITOR_ROLES`）を見る `isProjectEditorRole` であり、
        //    `role !== 'VIEWER'` で代用しない —— 案件の登録はホストの 3 ロールに限られ、
        //    人材の登録（パートナーロールも可）とは母集団が違う。
        <HostHomeSections
          canRegisterEngineer={outcome.ctx.role !== 'VIEWER'}
          canRegisterProject={isProjectEditorRole(outcome.ctx.role)}
        />
      ) : (
        <PartnerHomeSections noticeText={t(view.visibilityNotice.messageKey)} />
      )}
    </main>
  );
}
