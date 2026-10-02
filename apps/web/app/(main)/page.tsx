// apps/web/app/(main)/page.tsx
// 役割別ホーム（`S-003` ホスト / `S-004` 取引先。docs/05 §6.3 #9 / §6.11.1 / §6.11.2 / `F-006`）。
// T-03-06 → T-22-09 → ✅ 2026-10-02（`docs/04` 改訂 23 / `U-24`。人間のモックアップ）。
//
// ============================================================================
// 🔴 改訂 23 の構成（`docs/04` §4.1 の図。**人間の決定**）
// ============================================================================
//   帯（`PageHeader`。タイトル + アクション 2 つ / primary は 1 つ）
//   挨拶行（おはようございます、◯◯さん / 日付 / 一文 / 右端に「◯時◯分 時点」）
//   KPI カード 4 枚（+ 直下の 1 行 = 利用量 / 見える範囲の説明）
//   セクション ✅ 0（共有できないスキルシート。**0 件なら出さない**）
//   タブ（要対応 / 案件 / 人材）→ 主カラムのセクション群 ┃ 右レール 3 ブロック
//
// 🔴 **器は `_home/home-screen.tsx`（`'use client'`）が描く。** この画面の責務は
//    **①境界の解決（`resolveTenantCtxOutcome`）②読み取り（`readHomeBlocks`）③語と URL の組み立て
//    ④サーバ描画の断片（帯 / ✅ 0 / タブの面 / 空状態）を要素として渡すこと**である。
// 🔴 **幅クラスは `widthClass` を 1 回だけ渡す**（検査 (k)。`S-003` / `S-004` は **B = 分割**）。
//    薄いラッパ（`HomeScreen`）に素通しさせる形は検査が明示的に許している。
// 🔴 `getHomeView` は純粋関数（DB を読まない）。初回描画は `GET /api/home` を自己 fetch せず
//    サーバコンポーネントから直接 `readHomeBlocks` を呼ぶ（API と**同じ関数**を通るので母集団・並び・型がずれない）。
// 🔴 **ポーリングの口は 1 つだけ**（`HomeScreen`）。KPI カード / タブの件数 / セクションの行 /
//    右レールの「先に動くもの」は**同じ応答から同時に更新される**（`docs/04` §4.1 の非同期処理の表現）。
// 🔴 T-12-15: `?scope=mine|all`（既定 `mine`）と ✅ `?tab=`（既定 `actions`）は API と**同じスキーマ**
//    （`homeQuerySchema`）で検証する。壊れた条件は素の URL へ戻す（`S-005` / `S-017` と同じ判断）。
//
// 🔴 T-03-02: 2 要素認証が未充足なら `S-001` の 2 段階目へ送る(docs/05 §6.2 の
//    「画面遷移だけを担う」部分)。**遷移は UI の都合であり、境界の強制ではない** ——
//    強制は `resolveTenantCtx` が毎リクエスト行う。
// 🔴 T-04-06: 最上部の送信ドメイン未検証バナー（`docs/04` §S-036）。`getHomeView` 自体は純粋関数の
//    ままにし、この帯のためだけに追加で `TenantSendingDomain` を読む（対象はホスト所属の
//    `OWNER` / `ADMIN` のみ。理由は `_shared/sending-domain-guard-banner.tsx` 冒頭コメント）。
import { redirect } from 'next/navigation';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../lib/auth/session';
import { sendingDomainRuntime } from '../../lib/db/bootstrap';
import { isEngineerShareRole } from '../../lib/engineer-shares/policy';
import { readHomeBlocks } from '../../lib/home/blocks';
import { formatJstDateWithWeekday } from '../../lib/home/periods';
import {
  DEFAULT_HOME_SCOPE,
  DEFAULT_HOME_TAB,
  homeQuerySchema,
  type HomeScope,
  type HomeTab,
} from '../../lib/home/schemas';
import { getHomeView } from '../../lib/home/service';
import { readShellIdentity } from '../../lib/shell/identity';
import type { ActionQueueHomeBlock, SummaryHomeBlock } from '../../lib/home/types';
import { isProjectEditorRole } from '../../lib/projects/policy';
import { PROPOSAL_REQUESTS_PATH } from '../../lib/proposal-requests/list-rows';
import { PROPOSALS_PATH } from '../../lib/proposals/hrefs';
import { isSendingDomainUnverified, resolveSendingDomainFact } from '../../lib/settings/sending-domain-fact';
import { readSendingDomainSettings } from '../../lib/settings/sending-domains';
import { actionQueueMessages } from './_home/action-queue-props';
import { homeScreenMessages } from './_home/home-props';
import { HomeScreen } from './_home/home-screen';
import {
  ENGINEER_NEW_HREF,
  EngineersTabPanel,
  HostHeaderSecondaryAction,
  HostHomeEmptyState,
  HostUsageLine,
  PartnerHomeEmptyState,
  PartnerVisibilityNoticeLine,
  ProjectsTabPanel,
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
 * 🔴 `PageHeader` の primary（`docs/04` §4.1）。
 *
 * - ホスト = `案件を登録`。理由: **案件が 1 件も無いとマッチング以降が 1 つも動かない**のに対し、
 *   人材はスキルシート取込（`S-008`）という別の入口を持つ。
 * - 取引先 = `人材を登録`。理由: **台帳に人が居ないと提案依頼にも応諾できない**（案件は作れない）。
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

/** `S-003` / `S-004` の URL（既定値は URL に載せない）。 */
function homeHref(scope: HomeScope, tab: HomeTab): string {
  const params = new URLSearchParams();
  if (scope !== DEFAULT_HOME_SCOPE) params.set('scope', scope);
  if (tab !== DEFAULT_HOME_TAB) params.set('tab', tab);
  const query = params.toString();
  return query === '' ? '/' : `/?${query}`;
}

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  // 🔴 `changedSince` は初回描画では受けない（差分は `HomeScreen` が API に対して使う）。
  const parsed = homeQuerySchema.pick({ scope: true, tab: true }).safeParse(await searchParams);
  if (!parsed.success) redirect('/');
  const scope: HomeScope = parsed.data.scope ?? DEFAULT_HOME_SCOPE;
  const tab: HomeTab = parsed.data.tab ?? DEFAULT_HOME_TAB;

  // 🔴 `changedSince` と KPI の差分の基準は読み取りの**前**に取る（`getHomeView` / `periods.ts` の注記）。
  //    **1 リクエストに「いま」を 2 つ作らない。**
  const readAt = new Date();
  const blocks = await readHomeBlocks(outcome.ctx, {
    scope,
    // 🔴 T-22-09: `操作` 列の不能条件 ④（送信ドメイン未検証）。起動時に確定した値を渡す。
    sendingDomainVerificationRequired: sendingDomainRuntime().verificationRequired,
    now: readAt,
  });
  const view = getHomeView(outcome.ctx, blocks, readAt);
  const actionQueue = view.blocks.find(
    (block): block is ActionQueueHomeBlock => block.kind === 'ACTION_QUEUE',
  );
  // 🔴 `readHomeBlocks` は要対応キューを 0 件でも必ず返す。無ければ「読むのを忘れたホーム」であり、黙って空として描かない。
  if (actionQueue === undefined) throw new Error('readHomeBlocks が ACTION_QUEUE を返しませんでした。');
  const summary = view.blocks.find((block): block is SummaryHomeBlock => block.kind === 'SUMMARY');
  // 🔴 同じ理由（0 件でも `count: 0` で必ず返る。無いのは「読むのを忘れた」であり、0 件と区別する）。
  if (summary === undefined) throw new Error('readHomeBlocks が SUMMARY を返しませんでした。');

  // 🔴 パートナー所属・`SALES` / `VIEWER` には判定材料すら取りに行かない（不要な DB 往復を
  //    増やさない。パートナー所属は RLS（C2 HOST_ONLY）でどのみち 0 件になる）。
  const host = view.audience === 'HOST';
  const canActOnSendingDomain = host && (outcome.ctx.role === 'OWNER' || outcome.ctx.role === 'ADMIN');
  const showSendingDomainBanner = canActOnSendingDomain
    ? isSendingDomainUnverified(
        resolveSendingDomainFact(await readSendingDomainSettings(outcome.ctx, sendingDomainRuntime())),
      )
    : false;
  // 🔴 挨拶に差し込むのは**サインインしている本人の氏名**である（エンジニアの氏名ではない。`BR-27`）。
  //    ⚠️ 外枠（`layout.tsx`）と同じ `readShellIdentity` を呼ぶが、`cache()` は掛かっていないため
  //    **トランザクションが 1 本増える**（ホスト 3 本 / 取引先 3 本）。挨拶に氏名を出すのは
  //    改訂 23 の人間の決定であり、氏名はこの経路以外に無い（`GET /api/me` も同じ表を読む）。
  const identity = await readShellIdentity(outcome.ctx);
  const canRegisterEngineer = outcome.ctx.role !== 'VIEWER';
  const canManageShares = isEngineerShareRole(outcome.ctx.role);

  return (
    <main className="py-6">
      <HomeScreen
        // 🔴 幅クラス（検査 (k) が見るのはこの 1 回の受け渡しである）。
        widthClass="split"
        audience={host ? 'HOST' : 'PARTNER'}
        userName={identity.userName}
        dateLabel={formatJstDateWithWeekday(readAt)}
        initialQueue={actionQueue}
        initialSummary={summary}
        initialChangedSince={view.changedSince}
        scope={scope}
        scopeHrefs={{ mine: homeHref('mine', tab), all: homeHref('all', tab) }}
        requestListHref={PROPOSAL_REQUESTS_PATH}
        // 🔴 `すべて見る` は `S-019`（提案の一覧）—— セクションの母集団をそのまま開く 1 画面である。
        //    凍結済みの `home-*-proposals` はこの導線が持つ（`_home/home-sections.tsx` の表）。
        queueListHref={PROPOSALS_PATH}
        initialTab={tab}
        tabHrefs={{
          actions: homeHref(scope, 'actions'),
          projects: homeHref(scope, 'projects'),
          engineers: homeHref(scope, 'engineers'),
        }}
        // 🔴 今日の予定は**面談予定のみ**（`docs/04` §4.1 の右レール ①）。Phase 1 は面談の日時を持つ
        //    属性が無いため**常に空**である（`F-041` は Phase 2）。🔴 **架空の予定で埋めない。**
        schedule={[]}
        messages={homeScreenMessages(host ? 'HOST' : 'PARTNER')}
        queueMessages={actionQueueMessages()}
        pollIntervalMs={ACTION_QUEUE_POLL_INTERVAL_MS}
        banner={
          <SendingDomainGuardBanner
            visible={showSendingDomainBanner}
            messages={{
              text: t('settings.sendingDomain.guardBanner.text'),
              linkLabel: t('settings.sendingDomain.guardBanner.linkLabel'),
            }}
          />
        }
        heading={
          <>
            <PageHeading
              trail={HOME_TRAIL}
              title={t('home.title')}
              primaryAction={host ? HOST_PRIMARY_ACTION : PARTNER_PRIMARY_ACTION}
              // 🔴 ホストの primary（`案件を登録`）はホストの 3 ロールだけ（`PROJECT_EDITOR_ROLES`）。
              //    取引先の primary（`人材を登録`）は閲覧専用でない全ロール（`isPageActionRole`）。
              canAct={host ? isProjectEditorRole(outcome.ctx.role) : isPageActionRole(outcome.ctx.role)}
              testId={host ? 'home-host-register-project' : 'home-partner-register-engineer'}
            />
            {/* 🔴 `PageHeader` の secondary（ホストのみ = `人材を登録`）。取引先の secondary
                （`スキルシートを取り込む`）は Phase 2 である（§S-004）。 */}
            {host ? <HostHeaderSecondaryAction canRegisterEngineer={canRegisterEngineer} /> : null}
          </>
        }
        // 🔴 KPI カード直下の 1 行（ホスト = 残量〔件数〕/ 取引先 = 見える範囲の説明）。
        belowKpi={
          host ? (
            <HostUsageLine />
          ) : (
            <PartnerVisibilityNoticeLine
              noticeText={view.audience === 'PARTNER' ? t(view.visibilityNotice.messageKey) : ''}
            />
          )
        }
        // 🔴 T-05-08（`F-011` 処理④）: 隔離の周知は**宛先分類によらず必ず出す**。
        //    `sandbox` でメールがモックになるパートナー（分類 2）にとっては、ここが唯一の気づく場所である。
        //    🔴 位置は **KPI カードの下・タブの上**（どのタブに居ても見える）。
        quarantine={<ScanQuarantineSection blocks={view.blocks} />}
        projectsPanel={<ProjectsTabPanel audience={host ? 'HOST' : 'PARTNER'} />}
        engineersPanel={
          <EngineersTabPanel
            audience={host ? 'HOST' : 'PARTNER'}
            // 🔴 T-08-02: `S-015`（匿名共有の設定）の導線は `PARTNER_ADMIN` / `PARTNER_SALES` だけ。
            canManageShares={canManageShares}
          />
        }
        emptyState={
          host ? (
            <HostHomeEmptyState
              canRegisterEngineer={canRegisterEngineer}
              // 🔴 **2 つのフラグを 1 つに畳まない**（案件の登録はホストの 3 ロール、人材の登録は
              //    パートナーロールも含む。`PROJECT_EDITOR_ROLES` と `role !== 'VIEWER'` は別の集合）。
              canRegisterProject={isProjectEditorRole(outcome.ctx.role)}
            />
          ) : (
            <PartnerHomeEmptyState
              canRegisterEngineer={canRegisterEngineer}
              canManageShares={canManageShares}
            />
          )
        }
      />
    </main>
  );
}
