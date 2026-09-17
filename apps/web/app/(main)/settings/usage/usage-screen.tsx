// apps/web/app/(main)/settings/usage/usage-screen.tsx
// `S-038` 利用量と上限 — 純粋な描画（docs/04 §S-038 / `F-026` / `F-027 AC-1` `AC-6` `AC-7` / `BR-24`。Tier 2）。T-10-04。
//
// 🔴 状態を持たない（`'use client'` を宣言しない）。`page.tsx`（サーバ）が `readUsageView`（#69）/
//    `readBlockedNotice`（#70）の結果と文言を渡す。`*.render.test.tsx` はこの部品を状態ごとに描いて固定する。
//
// ============================================================================
// 🔴 金額（USD / 円）を 1 つも出さない（`F-027 AC-6` / Issue #12）。例外は請求見込みの 1 ブロックだけ
// ============================================================================
// 残量のブロック（セクション 2）は件数 / 通数 / GB / 人だけで組み立てる。金額を出してよいのは
// セクション 3「超過分の請求見込み」（`overageEstimateJpy`。円）だけであり、**残量のブロックの中に金額を
// 混ぜない**（混ぜた瞬間に「残量 = 金額」の画面に戻る。docs/04 §S-038 セクション 6）。
// `UsageView` 自体が金額の項目を持たない（`lib/usage/view.ts`）ため、ここで新たに金額を計算する経路も無い。
//
// 🔴 AI の 1 日のコスト上限は**遮断器**であり、メーターもゲージも置かない（docs/04 §S-038 の表）。
//    到達したときだけセクション 1 に「停止中」+ 理由 + 止まっている機能 + 再開時刻を出す。
// 🔴 `gate-inspector`（品質ゲート）を残量に出さない（`F-027 AC-7`）。**止まった理由としてだけ**
//    現れる（`stoppedFeatures` の `reviewGate`。docs/03 `ui-design` 申し送り 6）。
// 🔴 パートナー所属ロール向け（`UsageBlockedNoticeScreen`）は #70 の 2 キーだけを受け取り、
//    残量・上限値・リセット時刻・停止時刻を**型として受け取れない**（`F-027 AC-1` / `BR-04`）。
// 🔴 Tier 2: モバイルは縦積み。数値・注記を `hidden` にしない（`CLAUDE.md` §13.3）。
import { Alert, AlertDescription, AlertTitle, Badge, type BadgeVariant } from '@ses/ui';
import type { UsageLimitLevel } from '@ses/domain';
import { formatDateTimeJst } from '../../../../lib/format/datetime';
import { formatThousands } from '../../../../lib/format/number';
import {
  clampPercent,
  formatGigabytes,
  formatJpy,
  formatRemaining,
  formatUsedOfLimit,
  percentUsed,
} from '../../../../lib/usage/format';
import type {
  AiStoppedFeature,
  AiUnitKey,
  BlockedNoticeView,
  UsageView,
} from '../../../../lib/usage/view';

/** 🔴 4 単位の並び順（docs/04 §S-038 の表の順）。`Record<AiUnitKey, …>` で写像の漏れをコンパイルで落とす。 */
export const AI_UNIT_ORDER = ['sheetParse', 'matchRationale', 'proposalDraft', 'renewalSummary'] as const satisfies
  readonly AiUnitKey[];

export type UsageScreenMessages = {
  readonly lead: string;
  readonly asOfLabel: string;
  readonly freshnessNote: string;
  readonly readOnlyNote: string;

  readonly stop: {
    readonly title: string;
    /** `quota.aiDaily`（停止の理由。#70 と同じ文言）。 */
    readonly reason: string;
    readonly stoppedFeaturesLabel: string;
    readonly stoppedFeatureLabels: Readonly<Record<AiStoppedFeature, string>>;
    readonly stoppedFeatureConsequences: Readonly<Record<AiStoppedFeature, string>>;
    readonly sinceLabel: string;
    readonly resetAtLabel: string;
    readonly noFixNote: string;
  };

  readonly sectionRemaining: string;
  readonly sectionAiUnits: string;
  readonly aiUnitsMeteredNote: string;
  readonly aiUnitLabels: Readonly<Record<AiUnitKey, string>>;
  readonly remainingPrefix: string;
  readonly unitCount: string;
  readonly unitMessages: string;
  readonly unitGb: string;
  readonly unitSeats: string;
  readonly percentUsedLabel: string;
  readonly levelNearingPrefix: string;
  readonly levelNearingSuffix: string;
  readonly levelReached: string;
  readonly overagePrefix: string;
  readonly overageSuffix: string;

  readonly sectionEmail: string;
  readonly emailTodayLabel: string;
  readonly emailMinuteLabel: string;
  readonly emailDeferNote: string;
  readonly emailBlockNote: string;

  readonly sectionStorage: string;
  readonly storageUsedLabel: string;
  readonly storageRemainingLabel: string;
  readonly storageStopNote: string;
  readonly storageReachedNote: string;

  readonly sectionSeats: string;
  readonly seatsUsedLabel: string;
  readonly seatsLimitByPlan: string;

  readonly billing: {
    readonly title: string;
    readonly note: string;
    readonly unavailable: string;
    readonly unit: string;
  };
};

const LEVEL_BADGE_VARIANT: Readonly<Record<Exclude<UsageLimitLevel, 'BELOW'>, BadgeVariant>> = {
  NEARING: 'warning',
  REACHED: 'danger',
};

const METER_TRACK = 'h-2 w-full overflow-hidden rounded-full bg-slate-100';
const METER_FILL: Readonly<Record<UsageLimitLevel, string>> = {
  BELOW: 'h-2 rounded-full bg-slate-500',
  NEARING: 'h-2 rounded-full bg-amber-500',
  REACHED: 'h-2 rounded-full bg-red-600',
};

/** 水準の注記（`BELOW` は何も出さない。常時警告は無視される。docs/04 §3.2 上限インジケータ）。 */
type LevelBadgeModel = {
  readonly level: Exclude<UsageLimitLevel, 'BELOW'>;
  readonly variant: BadgeVariant;
  readonly note: string;
};

function levelBadge(level: UsageLimitLevel, warnPercent: number, messages: UsageScreenMessages): LevelBadgeModel | null {
  if (level === 'NEARING') {
    return {
      level,
      variant: LEVEL_BADGE_VARIANT.NEARING,
      note: `${messages.levelNearingPrefix} ${warnPercent}${messages.levelNearingSuffix}`,
    };
  }
  if (level === 'REACHED') return { level, variant: LEVEL_BADGE_VARIANT.REACHED, note: messages.levelReached };
  return null;
}

/**
 * 使用率のバー。🔴 `data-testid` は呼び出し側の包み要素に**文字列リテラルで**付ける
 * （`tests/static/testid-inventory.test.ts` が凍結できる形。`testId` の受け渡しをここに作らない）。
 */
function Meter({ percent, level, label }: { readonly percent: number; readonly level: UsageLimitLevel; readonly label: string }) {
  const width = clampPercent(percent);
  return (
    <div className="mt-1 flex items-center gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        className={METER_TRACK}
      >
        <div className={METER_FILL[level]} style={{ width: `${width}%` }} />
      </div>
      <span className="shrink-0 text-xs text-slate-500">
        {label} {percent}%
      </span>
    </div>
  );
}

/**
 * ホスト所属ロール向け（`OWNER` / `ADMIN` / `SALES` / `VIEWER`）。残量・上限値・リセット時刻・請求見込みを出す。
 */
export function UsageScreen({ view, messages }: { readonly view: UsageView; readonly messages: UsageScreenMessages }) {
  const stop = view.aiDailyStop;
  const storageUsed = BigInt(view.storage.usedBytes);
  const storageLimit = BigInt(view.storage.limitBytes);
  const storageRemaining = storageLimit > storageUsed ? storageLimit - storageUsed : 0n;
  const emailBadge = levelBadge(view.email.level, view.warnPercent, messages);
  const storageBadge = levelBadge(view.storage.level, view.warnPercent, messages);

  return (
    <div data-testid="usage-screen" data-ai-stopped={stop.stopped ? 'true' : 'false'}>
      {/* セクション 1: 停止中（あるときだけ最上部）。🔴 遮断器 —— 平常時は何も描かない。 */}
      {stop.stopped ? (
        <Alert variant="danger" className="mb-6" data-testid="usage-stop-banner">
          <AlertTitle>{messages.stop.title}</AlertTitle>
          <AlertDescription>
            <p data-testid="usage-stop-reason">{messages.stop.reason}</p>
            <div data-testid="usage-stop-features">
              <p className="font-medium">{messages.stop.stoppedFeaturesLabel}</p>
              <ul className="list-disc pl-5">
                {stop.stoppedFeatures.map((feature) => (
                  <li key={feature} data-testid={`usage-stop-feature-${feature}`}>
                    <span>{messages.stop.stoppedFeatureLabels[feature]}</span>
                    <span className="block text-xs">{messages.stop.stoppedFeatureConsequences[feature]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p>
              <span>{messages.stop.sinceLabel}: </span>
              <span data-testid="usage-stop-since">{formatDateTimeJst(stop.since)}</span>
            </p>
            <p>
              <span>{messages.stop.resetAtLabel}: </span>
              <span className="font-medium" data-testid="usage-stop-reset-at">
                {formatDateTimeJst(stop.resetAt)}
              </span>
            </p>
            <p className="text-xs">{messages.stop.noFixNote}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="mb-2 text-sm text-slate-600">{messages.lead}</p>
      <p className="mb-6 text-xs text-slate-500" data-testid="usage-as-of">
        {messages.asOfLabel}: {formatDateTimeJst(view.asOf)}
        <br />
        {messages.freshnessNote}
      </p>

      {/* セクション 2: 残量（件数 / 通数 / GB / 人）。🔴 金額を混ぜない。 */}
      <section className="mb-8" data-testid="usage-remaining">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionRemaining}</h2>

        <section className="mb-6" data-testid="usage-ai-units">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">{messages.sectionAiUnits}</h3>
          <p className="mb-3 text-xs text-slate-500">{messages.aiUnitsMeteredNote}</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {AI_UNIT_ORDER.map((key) => {
              const unit = view.aiUnits[key];
              const percent = percentUsed(unit.used, unit.quota);
              const badge = levelBadge(unit.level, view.warnPercent, messages);
              return (
                <li
                  key={key}
                  className="rounded-md border border-slate-200 p-3"
                  data-testid={`usage-ai-unit-${key}`}
                  data-level={unit.level}
                >
                  <p className="text-sm font-medium text-slate-900">{messages.aiUnitLabels[key]}</p>
                  <p className="text-sm text-slate-700" data-testid={`usage-ai-unit-remaining-${key}`}>
                    {formatRemaining(unit.remaining, unit.quota, {
                      prefix: messages.remainingPrefix,
                      unit: messages.unitCount,
                    })}
                  </p>
                  <div data-testid={`usage-ai-unit-meter-${key}`} data-level={unit.level}>
                    <Meter percent={percent} level={unit.level} label={messages.percentUsedLabel} />
                  </div>
                  {badge === null ? null : (
                    <p className="mt-1" data-testid={`usage-ai-unit-level-${key}`} data-level={badge.level}>
                      <Badge variant={badge.variant}>{badge.note}</Badge>
                    </p>
                  )}
                  {unit.overageCount > 0 ? (
                    <p className="mt-1 text-xs text-slate-700" data-testid={`usage-ai-unit-overage-${key}`}>
                      {messages.overagePrefix} {formatThousands(unit.overageCount)} {messages.overageSuffix}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <section className="rounded-md border border-slate-200 p-3" data-testid="usage-email" data-state={view.email.state}>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">{messages.sectionEmail}</h3>
            <p className="text-sm text-slate-700">
              <span>{messages.emailTodayLabel}: </span>
              <span data-testid="usage-email-today">
                {formatUsedOfLimit(view.email.usedToday, view.email.dailyLimit, messages.unitMessages)}
              </span>
            </p>
            <div data-testid="usage-email-meter" data-level={view.email.level}>
              <Meter
                percent={percentUsed(view.email.usedToday, view.email.dailyLimit)}
                level={view.email.level}
                label={messages.percentUsedLabel}
              />
            </div>
            {emailBadge === null ? null : (
              <p className="mt-1" data-testid="usage-email-level" data-level={emailBadge.level}>
                <Badge variant={emailBadge.variant}>{emailBadge.note}</Badge>
              </p>
            )}
            {/* 🔴 分次と日次を別に表示する（`F-027 AC-2`）。 */}
            <p className="mt-2 text-sm text-slate-700">
              <span>{messages.emailMinuteLabel}: </span>
              <span data-testid="usage-email-minute">
                {formatUsedOfLimit(view.email.usedLastMinute, view.email.minuteLimit, messages.unitMessages)}
              </span>
            </p>
            {view.email.state === 'DEFER' ? (
              <p className="mt-1 text-xs text-amber-800" data-testid="usage-email-defer-note">
                {messages.emailDeferNote}
              </p>
            ) : null}
            {view.email.state === 'BLOCK' ? (
              <p className="mt-1 text-xs text-red-800" data-testid="usage-email-block-note">
                {messages.emailBlockNote}
              </p>
            ) : null}
          </section>

          <section
            className="rounded-md border border-slate-200 p-3"
            data-testid="usage-storage"
            data-level={view.storage.level}
          >
            <h3 className="mb-1 text-sm font-semibold text-slate-700">{messages.sectionStorage}</h3>
            <p className="text-sm text-slate-700">
              <span>{messages.storageUsedLabel}: </span>
              <span data-testid="usage-storage-used">
                {formatGigabytes(storageUsed)} / {formatGigabytes(storageLimit)} {messages.unitGb}
              </span>
            </p>
            <p className="text-sm text-slate-700">
              <span>{messages.storageRemainingLabel}: </span>
              <span data-testid="usage-storage-remaining">
                {formatGigabytes(storageRemaining)} {messages.unitGb}
              </span>
            </p>
            <div data-testid="usage-storage-meter" data-level={view.storage.level}>
              <Meter
                percent={percentUsed(storageUsed, storageLimit)}
                level={view.storage.level}
                label={messages.percentUsedLabel}
              />
            </div>
            {storageBadge === null ? null : (
              <p className="mt-1" data-testid="usage-storage-level" data-level={storageBadge.level}>
                <Badge variant={storageBadge.variant}>{storageBadge.note}</Badge>
              </p>
            )}
            {/* 🔴 超過でアップロードが止まる（従量に移行しない）。件数クォータと同じ見た目にしない。 */}
            <p className="mt-1 text-xs text-slate-500">{messages.storageStopNote}</p>
            {view.storage.level === 'REACHED' ? (
              <p className="mt-1 text-xs text-red-800" data-testid="usage-storage-reached-note">
                {messages.storageReachedNote}
              </p>
            ) : null}
          </section>

          <section className="rounded-md border border-slate-200 p-3" data-testid="usage-seats">
            <h3 className="mb-1 text-sm font-semibold text-slate-700">{messages.sectionSeats}</h3>
            <p className="text-sm text-slate-700">
              <span>{messages.seatsUsedLabel}: </span>
              <span data-testid="usage-seats-used">
                {view.seats.limit === null
                  ? `${formatThousands(view.seats.used)} ${messages.unitSeats}`
                  : formatUsedOfLimit(view.seats.used, view.seats.limit, messages.unitSeats)}
              </span>
            </p>
            {view.seats.limit === null ? (
              <p className="mt-1 text-xs text-slate-500" data-testid="usage-seats-limit-by-plan">
                {messages.seatsLimitByPlan}
              </p>
            ) : null}
          </section>
        </div>
      </section>

      {/* セクション 3: 超過分の請求見込み。🔴 金額を出してよい唯一の場所（残量とは別ブロック）。 */}
      <section className="mb-6 rounded-md border border-slate-200 bg-slate-50 p-4" data-testid="usage-billing">
        <h2 className="mb-1 text-base font-bold text-slate-900">{messages.billing.title}</h2>
        <p className="mb-2 text-xs text-slate-500">{messages.billing.note}</p>
        {view.overageEstimateJpy === null ? (
          <p className="text-sm text-slate-700" data-testid="usage-billing-unavailable">
            {messages.billing.unavailable}
          </p>
        ) : (
          <p className="text-sm font-medium text-slate-900" data-testid="usage-billing-estimate">
            {formatJpy(view.overageEstimateJpy, messages.billing.unit)}
          </p>
        )}
      </section>

      <p className="text-xs text-slate-500">{messages.readOnlyNote}</p>
    </div>
  );
}

export type UsageBlockedNoticeMessages = {
  readonly title: string;
  /** `quota.aiDaily`。#70 の `reasonKey` が指す文言。 */
  readonly reason: string;
  readonly notBlocked: string;
  readonly scopeNote: string;
};

/**
 * 🔴 パートナー所属ロール向け（`F-027 AC-1` / `BR-04`）。受け取るのは #70 の `{ blocked, reasonKey }` だけであり、
 *    残量・上限値・リセット時刻・停止時刻は**型として渡せない**（`BlockedNoticeView` にキーが無い）。
 */
export function UsageBlockedNoticeScreen({
  notice,
  messages,
}: {
  readonly notice: BlockedNoticeView;
  readonly messages: UsageBlockedNoticeMessages;
}) {
  return (
    <div data-testid="usage-partner-screen" data-blocked={notice.blocked ? 'true' : 'false'}>
      <h2 className="mb-3 text-base font-bold text-slate-900">{messages.title}</h2>
      {notice.blocked ? (
        <Alert variant="danger" className="mb-4" data-testid="usage-partner-blocked">
          <AlertDescription>
            <p>{messages.reason}</p>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="mb-4 text-sm text-slate-700" data-testid="usage-partner-not-blocked">
          {messages.notBlocked}
        </p>
      )}
      <p className="text-xs text-slate-500">{messages.scopeNote}</p>
    </div>
  );
}
