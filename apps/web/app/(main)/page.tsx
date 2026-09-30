// apps/web/app/(main)/page.tsx
// 役割別ホーム（`S-003` ホスト / `S-004` 取引先。docs/05 §6.3 #9 / §6.11.1 / §6.11.2 / `F-006`）。T-03-06 → T-22-09。
//
// ============================================================================
// 🔴 T-22-09: 最上部の構成（`docs/04` §S-003 / §S-004 の改訂 16。**人間の決定**）
// ============================================================================
//   `PageHeader`（タイトル + アクション 2 つ / primary は 1 つ）
//     → `SummaryStrip`（1 行。件数。**初回空では出さず `EmptyState` に倒す**）
//     → 🔴 **セクション ✅ 0（共有できないスキルシート）**
//     → 🔴 **要対応キュー（Primary）**
//     → それ以外（Phase 2）
//
// 🔴 **✅ 0 をストリップより上に出さない。** ストリップは常時あり、✅ 0 は 0 件なら出ない ——
//    出たり消えたりするものを常時あるものより上に置くと、**画面の骨格が日によって変わって
//    走査の記憶が効かなくなる**（`docs/04` §S-003）。
// 🔴 **件数（ストリップ）を要対応キューより視覚的に強くしない**（`docs/04` §7.2 の禁止の本体）。
//    強さの規律は `@ses/ui` の `SummaryStrip` が持つ（`text-xs` / `--color-fg-muted` / 背景なし）。
//
// 🔴 `getHomeView` は純粋関数（DB を読まない）。初回描画は `GET /api/home` を自己 fetch せず
//    サーバコンポーネントから直接 `readHomeBlocks` を呼ぶ（API と**同じ関数**を通るので母集団・並び・型がずれない）。
//    ✅ T-12-15: 要対応キュー（`ActionQueueSection`。`'use client'`）だけがクライアント化され、60 秒ごとに
//    `GET /api/home?scope=&changedSince=` の**差分**で描き直す（docs/04 program-design 申し送り 6）。画面全体は再描画しない。
//    🔴 T-22-09: **`'use client'` を増やしていない**（ストリップ・✅ 0・空状態はサーバのまま）。
//    🔴 **ストリップと別の更新周期を作らない** —— 件数は同じ `#9` の応答に同梱され、同じ 60 秒で更新される。
// 🔴 T-12-15: `?scope=mine|all`（既定 `mine`。docs/04 §S-003「自分の担当のみ」トグル）は API と**同じスキーマ**
//    （`homeQuerySchema`）で検証する。壊れた条件は素の URL へ戻す（`S-005` / `S-017` と同じ判断）。
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
import { PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../lib/auth/session';
import { sendingDomainRuntime } from '../../lib/db/bootstrap';
import { isEngineerShareRole } from '../../lib/engineer-shares/policy';
import { readHomeBlocks } from '../../lib/home/blocks';
import { DEFAULT_HOME_SCOPE, homeQuerySchema, type HomeScope } from '../../lib/home/schemas';
import { getHomeView } from '../../lib/home/service';
import { isSummaryInitialEmpty, summaryStripItems } from '../../lib/home/summary-view';
import type { ActionQueueHomeBlock, SummaryHomeBlock } from '../../lib/home/types';
import { isProjectEditorRole } from '../../lib/projects/policy';
import { PROPOSAL_REQUESTS_PATH } from '../../lib/proposal-requests/list-rows';
import { isSendingDomainUnverified, resolveSendingDomainFact } from '../../lib/settings/sending-domain-fact';
import { readSendingDomainSettings } from '../../lib/settings/sending-domains';
import { actionQueueMessages } from './_home/action-queue-props';
import { ActionQueueSection } from './_home/action-queue-section';
import {
  ENGINEER_NEW_HREF,
  HostHeaderSecondaryAction,
  HostHomeSections,
  PartnerHomeSections,
  PROJECT_NEW_HREF,
  ScanQuarantineSection,
} from './_home/home-sections';
import { SendingDomainGuardBanner } from './_shared/sending-domain-guard-banner';
import { PageHeading } from './_shell/page-heading';
import { HOME_TRAIL, isPageActionRole, type PagePrimaryAction } from '../../lib/shell/page-trail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 要対応キューの再読込間隔（docs/04 §S-003 非同期処理の表現「ポーリングは 60 秒間隔」）。 */
const ACTION_QUEUE_POLL_INTERVAL_MS = 60_000;

/**
 * 🔴 `PageHeader` の primary（`docs/04` §S-003 / §S-004 改訂 16）。
 *
 * - ホスト = `案件を登録`。理由（§S-003）: **案件が 1 件も無いとマッチング以降が 1 つも動かない**のに対し、
 *   人材はスキルシート取込（`S-008`）という別の入口を持つ。
 * - 取引先 = `人材を登録`。理由（§S-004）: **台帳に人が居ないと提案依頼にも応諾できない**。
 *   ホストと違い**案件を作れない**（第二境界）ため、primary は台帳側になる。
 * 🔴 どちらも `kind: 'ACTION'`（作成系）であり、閲覧専用ロールには帯が描かない。
 */
const HOST_PRIMARY_ACTION: PagePrimaryAction = {
  labelKey: 'home.host.empty.registerProject',
  href: PROJECT_NEW_HREF,
  kind: 'ACTION',
};
const PARTNER_PRIMARY_ACTION: PagePrimaryAction = {
  labelKey: 'home.host.empty.registerEngineer',
  href: ENGINEER_NEW_HREF,
  kind: 'ACTION',
};

/** `S-003` / `S-004` の URL（`scope` だけ。既定値は URL に載せない）。 */
function homeHref(scope: HomeScope): string {
  return scope === DEFAULT_HOME_SCOPE ? '/' : `/?scope=${scope}`;
}

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  // 🔴 `changedSince` は初回描画では受けない（差分は `ActionQueueSection` が API に対して使う）。`scope` だけを読む。
  const parsed = homeQuerySchema.pick({ scope: true }).safeParse(await searchParams);
  if (!parsed.success) redirect('/');
  const scope: HomeScope = parsed.data.scope ?? DEFAULT_HOME_SCOPE;

  // 🔴 `changedSince` の基準は読み取りの**前**に取る（`getHomeView` の注記）。
  const readAt = new Date();
  const blocks = await readHomeBlocks(outcome.ctx, {
    scope,
    // 🔴 T-22-09: `操作` 列の不能条件 ④（送信ドメイン未検証）。起動時に確定した値を渡す。
    sendingDomainVerificationRequired: sendingDomainRuntime().verificationRequired,
  });
  const view = getHomeView(outcome.ctx, blocks, readAt);
  const actionQueue = view.blocks.find(
    (block): block is ActionQueueHomeBlock => block.kind === 'ACTION_QUEUE',
  );
  // 🔴 `readHomeBlocks` は要対応キューを 0 件でも必ず返す。無ければ「読むのを忘れたホーム」であり、黙って空として描かない。
  if (actionQueue === undefined) throw new Error('readHomeBlocks が ACTION_QUEUE を返しませんでした。');
  const summaryBlock = view.blocks.find((block): block is SummaryHomeBlock => block.kind === 'SUMMARY');
  // 🔴 同じ理由（0 件でも `count: 0` で必ず返る。無いのは「読むのを忘れた」であり、0 件と区別する）。
  if (summaryBlock === undefined) throw new Error('readHomeBlocks が SUMMARY を返しませんでした。');
  // 🔴 「描かない」判定と語の写像は `lib/home/summary-view.ts` の 2 関数だけが持つ（docs/05 §6.11.1）。
  const summary = {
    items: summaryStripItems(summaryBlock),
    initialEmpty: isSummaryInitialEmpty(summaryBlock),
  };

  // 🔴 パートナー所属・`SALES` / `VIEWER` には判定材料すら取りに行かない（不要な DB 往復を
  //    増やさない。パートナー所属は RLS（C2 HOST_ONLY）でどのみち 0 件になる）。
  const canActOnSendingDomain =
    view.audience === 'HOST' && (outcome.ctx.role === 'OWNER' || outcome.ctx.role === 'ADMIN');
  const showSendingDomainBanner = canActOnSendingDomain
    ? isSendingDomainUnverified(
        resolveSendingDomainFact(await readSendingDomainSettings(outcome.ctx, sendingDomainRuntime())),
      )
    : false;
  const host = view.audience === 'HOST';

  return (
    // 🔴 T-22-09: 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`）。`S-003` / `S-004` は
    //    **クラス B = 分割**である（§7.1 の表）。**画面ファイルに `max-w-*` を書かない**（検査 (c) / (k)）——
    //    旧 `max-w-3xl`（768px）では 7 列のキューが成立しない。
    //    ⚠️ **Phase 1 は副カラム（`aside`）を渡さない** —— 右カラムに入るのは §S-003 の
    //    セクション 3〔待機予定に戻った人材〕/ 4〔後任募集〕/ 5〔未読チャット〕であり、いずれも Phase 2 である。
    //    `lg` 未満で副カラムが下に落ちる挙動は Phase 2 で初めて意味を持つ。
    <main className="py-6">
      <PageBody widthClass="split">
        <SendingDomainGuardBanner
          visible={showSendingDomainBanner}
          messages={{
            text: t('settings.sendingDomain.guardBanner.text'),
            linkLabel: t('settings.sendingDomain.guardBanner.linkLabel'),
          }}
        />
        <PageHeading
          trail={HOME_TRAIL}
          title={t('home.title')}
          primaryAction={host ? HOST_PRIMARY_ACTION : PARTNER_PRIMARY_ACTION}
          // 🔴 ホストの primary（`案件を登録`）はホストの 3 ロールだけ（`PROJECT_EDITOR_ROLES`）。
          //    取引先の primary（`人材を登録`）は閲覧専用でない全ロール（`isPageActionRole`）。
          canAct={host ? isProjectEditorRole(outcome.ctx.role) : isPageActionRole(outcome.ctx.role)}
          testId={host ? 'home-host-register-project' : 'home-partner-register-engineer'}
        />
        {/* 🔴 `PageHeader` の secondary アクション（ホストのみ = `人材を登録`。§S-003 改訂 16）。
            取引先の secondary（`スキルシートを取り込む`）は Phase 2 である（§S-004）。 */}
        {host ? <HostHeaderSecondaryAction canRegisterEngineer={outcome.ctx.role !== 'VIEWER'} /> : null}
        {host ? (
          // 🔴 T-05-01 / T-06-01: `VIEWER` には `S-007` / `S-012` への導線を出さない
          //    （`docs/04` §S-007 / §S-012 権限差分「到達できない」）。判定材料は `role` だけで、
          //    `deriveMainCapabilities`（`GET /api/me` の応答契約）には足さない ——
          //    あれは承認 / 送信 / DL / エクスポートの 4 つに閉じた型である。
          // 🔴 **2 つのフラグを 1 つに畳まない**（案件の登録はホストの 3 ロール、人材の登録は
          //    パートナーロールも含む。`PROJECT_EDITOR_ROLES` と `role !== 'VIEWER'` は同じ集合ではない）。
          <HostHomeSections
            summary={summary}
            canRegisterEngineer={outcome.ctx.role !== 'VIEWER'}
            canRegisterProject={isProjectEditorRole(outcome.ctx.role)}
          />
        ) : (
          // 🔴 T-08-02: `S-015`（匿名共有の設定）の導線は `PARTNER_ADMIN` / `PARTNER_SALES`
          //    だけに出す（`docs/04` §S-015 権限差分 / docs/05 §6.4 #29 のロール一覧と同じ）。
          //    `role !== 'VIEWER'` で代用しない —— 共有の設定はパートナーロールに限られる。
          <PartnerHomeSections
            summary={summary}
            noticeText={t(view.visibilityNotice.messageKey)}
            canRegisterEngineer={outcome.ctx.role !== 'VIEWER'}
            canManageShares={isEngineerShareRole(outcome.ctx.role)}
          />
        )}
        {/* 🔴 T-05-08（`F-011` 処理④）: 隔離の周知は**宛先分類によらず必ず出す**。
            `sandbox` でメールがモックになるパートナー（分類 2）にとっては、ここが
            唯一の気づく場所である。ホスト / パートナーで同じ位置・同じ見せ方にする。
            🔴 T-22-09: 位置は**ストリップの下・要対応キューの上**（冒頭の 🔴）。 */}
        <ScanQuarantineSection blocks={view.blocks} />
        {/* 🔴 T-12-15: 要対応キュー（`S-003` セクション 1 / `S-004` セクション 1・2）。**この画面の Primary** である
            （`docs/04` §7.3「1 画面で最も強調する要素は 1 つ」）。
            ホストと取引先で同じ部品・同じ位置（取引先は 1 日 4〜5 時間の主利用者。`CLAUDE.md` §1.2）。
            中身の違い（種別・並び・`操作`・`状態`）はサーバが決めている。 */}
        <ActionQueueSection
          // 🔴 サーバが描き直したら（`scope` の切り替え / 再訪）クライアントの手元の行も捨てて作り直す（古い scope の行を残さない）。
          key={`${scope}:${view.changedSince}`}
          initial={actionQueue}
          initialChangedSince={view.changedSince}
          audience={view.audience}
          scope={scope}
          scopeHrefs={{ mine: homeHref('mine'), all: homeHref('all') }}
          requestListHref={PROPOSAL_REQUESTS_PATH}
          messages={actionQueueMessages()}
          pollIntervalMs={ACTION_QUEUE_POLL_INTERVAL_MS}
        />
      </PageBody>
    </main>
  );
}
