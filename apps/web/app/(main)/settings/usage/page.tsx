// apps/web/app/(main)/settings/usage/page.tsx
// `S-038` 利用量と上限（docs/04 §S-038 / `F-026` / `F-027` / docs/05 §6.7 #69 #70 / §5.8.1）。T-10-04。Tier 2。
//
// 🔴 権限差分（`F-027 AC-1` / `BR-04` の第二境界）:
//    - ホスト所属（`OWNER` / `ADMIN` / `SALES` / `VIEWER`）: `readUsageView`（#69）を読み、残量・上限値・
//      リセット時刻・請求見込みを出す。`VIEWER` も閲覧できる（閲覧のみの画面。実行系の操作は無い）。
//    - パートナー所属（`partnerCompanyId !== null`）: ホームへ戻さず、`readBlockedNotice`（#70）だけを読んで
//      **停止の事実と理由だけ**を出す。残量・上限値・リセット時刻は `BlockedNoticeView` に**型として無い**。
//      判定は `requireHost` と同じ `partnerCompanyId`（ロール名ではなく所属で決める。`memberships` の CHECK と 1 対 1）。
//      ⚠️ 導線はホスト側にしか置かない（`docs/04` §S-038「パートナーには操作の場所で示す」）。ここは
//      URL を直接開いた場合の受け皿であり、`#69` を呼ぶ経路ではない。
// 🔴 `readUsageView` / `readBlockedNotice` を直接呼ぶ（自己 fetch しない。`S-035` / `S-036` と同じ方針）。
//    API ルート（#69 / #70）と**同じ 1 実装**を通るため、画面と API で数値がずれない。
// 🔴 金額（USD / 円）の文言は `usage.billing.*` 以外に無い（`packages/i18n`。静的テスト #18 が走査する）。
// 🔴 閲覧のみの画面であり、`CLOSING` でも残量は見られる（実行系ガードを掛けない。#69 と同じ）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SECONDARY_LINK_CLASSES } from '@ses/ui';
import { t, type MessageKey } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import {
  AI_STOPPED_FEATURES,
  readBlockedNotice,
  readUsageView,
  type AiStoppedFeature,
  type AiUnitKey,
} from '../../../../lib/usage/view';
import {
  AI_UNIT_ORDER,
  UsageBlockedNoticeScreen,
  UsageScreen,
  type UsageBlockedNoticeMessages,
  type UsageScreenMessages,
} from './usage-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('usage.title') };

/** 🔴 4 単位の表示名。`Record<AiUnitKey, MessageKey>` なので単位が増えれば写像の書き忘れがコンパイルで落ちる。`gate-inspector` は無い。 */
const AI_UNIT_MESSAGE_KEYS = {
  sheetParse: 'usage.aiUnit.sheetParse',
  matchRationale: 'usage.aiUnit.matchRationale',
  proposalDraft: 'usage.aiUnit.proposalDraft',
  renewalSummary: 'usage.aiUnit.renewalSummary',
} as const satisfies Readonly<Record<AiUnitKey, MessageKey>>;

/** 🔴 止まった機能の表示名（停止理由としてだけ現れる。残量には出さない。`F-027 AC-7`）。 */
const STOPPED_FEATURE_MESSAGE_KEYS = {
  reviewGate: 'usage.stoppedFeature.reviewGate',
} as const satisfies Readonly<Record<AiStoppedFeature, MessageKey>>;

const STOPPED_FEATURE_CONSEQUENCE_KEYS = {
  reviewGate: 'usage.stoppedFeature.reviewGate.consequence',
} as const satisfies Readonly<Record<AiStoppedFeature, MessageKey>>;

function labelsOf<K extends string>(order: readonly K[], keys: Readonly<Record<K, MessageKey>>): Readonly<Record<K, string>> {
  const labels = {} as Record<K, string>;
  for (const key of order) labels[key] = t(keys[key]);
  return labels;
}

function hostMessages(): UsageScreenMessages {
  return {
    lead: t('usage.lead'),
    asOfLabel: t('usage.asOf'),
    freshnessNote: t('usage.freshnessNote'),
    readOnlyNote: t('usage.readOnlyNote'),
    stop: {
      title: t('usage.stop.title'),
      reason: t('quota.aiDaily'),
      stoppedFeaturesLabel: t('usage.stop.stoppedFeaturesLabel'),
      stoppedFeatureLabels: labelsOf(AI_STOPPED_FEATURES, STOPPED_FEATURE_MESSAGE_KEYS),
      stoppedFeatureConsequences: labelsOf(AI_STOPPED_FEATURES, STOPPED_FEATURE_CONSEQUENCE_KEYS),
      sinceLabel: t('usage.stop.sinceLabel'),
      resetAtLabel: t('usage.stop.resetAtLabel'),
      noFixNote: t('usage.stop.noFixNote'),
    },
    sectionRemaining: t('usage.section.remaining'),
    sectionAiUnits: t('usage.section.aiUnits'),
    aiUnitsMeteredNote: t('usage.aiUnits.meteredNote'),
    aiUnitLabels: labelsOf(AI_UNIT_ORDER, AI_UNIT_MESSAGE_KEYS),
    remainingPrefix: t('usage.remaining.prefix'),
    unitCount: t('usage.unit.count'),
    unitMessages: t('usage.unit.messages'),
    unitGb: t('usage.unit.gb'),
    unitSeats: t('usage.unit.seats'),
    percentUsedLabel: t('usage.percentUsedLabel'),
    levelNearingPrefix: t('usage.level.nearing.prefix'),
    levelNearingSuffix: t('usage.level.nearing.suffix'),
    levelReached: t('usage.level.reached'),
    overagePrefix: t('usage.aiUnit.overage.prefix'),
    overageSuffix: t('usage.aiUnit.overage.suffix'),
    sectionEmail: t('usage.section.email'),
    emailTodayLabel: t('usage.email.todayLabel'),
    emailMinuteLabel: t('usage.email.minuteLabel'),
    emailDeferNote: t('usage.email.deferNote'),
    emailBlockNote: t('usage.email.blockNote'),
    sectionStorage: t('usage.section.storage'),
    storageUsedLabel: t('usage.storage.usedLabel'),
    storageRemainingLabel: t('usage.storage.remainingLabel'),
    storageStopNote: t('usage.storage.stopNote'),
    storageReachedNote: t('usage.storage.reachedNote'),
    sectionSeats: t('usage.section.seats'),
    seatsUsedLabel: t('usage.seats.usedLabel'),
    seatsLimitByPlan: t('usage.seats.limitByPlan'),
    billing: {
      title: t('usage.billing.title'),
      note: t('usage.billing.note'),
      unavailable: t('usage.billing.unavailable'),
      unit: t('usage.billing.unit'),
    },
  };
}

function partnerMessages(): UsageBlockedNoticeMessages {
  return {
    title: t('usage.partner.title'),
    reason: t('quota.aiDaily'),
    notBlocked: t('usage.partner.notBlocked'),
    scopeNote: t('usage.partner.scopeNote'),
  };
}

export default async function UsageSettingsPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;
  const now = new Date();

  const body =
    ctx.partnerCompanyId !== null ? (
      <UsageBlockedNoticeScreen notice={await readBlockedNotice(ctx, now)} messages={partnerMessages()} />
    ) : (
      <UsageScreen view={await readUsageView(ctx, now)} messages={hostMessages()} />
    );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        <Link className={SECONDARY_LINK_CLASSES} href="/" data-testid="usage-breadcrumb-home">
          {t('usage.breadcrumb.home')}
        </Link>{' '}
        / {t('usage.breadcrumb.settings')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('usage.title')}</h1>
      {body}
    </main>
  );
}
