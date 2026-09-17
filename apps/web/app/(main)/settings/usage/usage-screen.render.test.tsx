// apps/web/app/(main)/settings/usage/usage-screen.render.test.tsx
// `UsageScreen` / `UsageBlockedNoticeScreen`（`S-038`）の状態別描画テスト（T-10-04）。
//
// 🔴 何を固定するか（docs/02 `F-027 AC-1` / `AC-6` / `AC-7` / docs/04 §S-038）:
//   ① 停止バナーは停止中にだけ出る。理由・止まった機能（品質ゲート）・再開時刻・停止時刻を含み、
//      「修正して再実行」を促さない
//   ② 残量は 4 単位が「あと N 件 / M 件」の形で出る。接近（80%）と到達（従量）を区別して注記する
//   ③ メールは日次（停止）と分次（待機）を別に出す。ストレージは GB。席数は上限 `null` なら「プランで管理」
//   ④ 請求見込みは残量のブロックの外にあり、`null` なら「算出できません」。値があれば円で出る（金額の唯一の例外）
//   ⑤ 🔴 描画された HTML に金額の語（`$` / `USD` / `ドル`）が無い。「円」は請求見込みのブロックの中にだけ現れる
//   ⑥ 🔴 `gate-inspector` / 品質ゲートの名は残量のブロック（`usage-remaining`）の中に現れない（停止バナーの中だけ）
//   ⑦ パートナー向けは停止の事実と理由だけ（残量・上限値・リセット時刻・件数の単位が 1 つも無い）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` + `createElement`（`sending-domain-screen.render.test.tsx` と同じ理由で
//    JSX と `@testing-library/react` を使わない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BlockedNoticeView, UsageView } from '../../../../lib/usage/view';
import {
  UsageBlockedNoticeScreen,
  UsageScreen,
  type UsageBlockedNoticeMessages,
  type UsageScreenMessages,
} from './usage-screen';

const GIB = 1024n * 1024n * 1024n;

const messages: UsageScreenMessages = {
  lead: 'いま使える件数と利用状況です。',
  asOfLabel: '集計時刻',
  freshnessNote: '停止中の表示は最大 10 分遅れて反映されます。',
  readOnlyNote: '上限の変更はこの画面からはできません。',
  stop: {
    title: 'AI の 1 日の上限に達したため停止中',
    reason: 'AI の 1 日の利用上限に達したため、AI を使う機能を停止しています。',
    stoppedFeaturesLabel: '停止している機能',
    stoppedFeatureLabels: { reviewGate: '品質ゲート（提案・案件公開・スキルシート共有の検査）' },
    stoppedFeatureConsequences: { reviewGate: '品質ゲートが実行できないため、提案・案件の公開・スキルシートの外部共有を送れません。' },
    sinceLabel: '停止開始',
    resetAtLabel: '再開予定',
    noFixNote: '上限がリセットされると自動的に再開します。元データの修正は不要です。',
  },
  sectionRemaining: '残量',
  sectionAiUnits: 'AI の件数クォータ（当月）',
  aiUnitsMeteredNote: '使い切っても停止しません。超過分は従量課金になります。',
  aiUnitLabels: {
    sheetParse: 'スキルシート解析',
    matchRationale: 'マッチング候補の根拠文',
    proposalDraft: '提案ドラフト',
    renewalSummary: '延長論点の整理',
  },
  remainingPrefix: 'あと',
  unitCount: '件',
  unitMessages: '通',
  unitGb: 'GB',
  unitSeats: '人',
  percentUsedLabel: '使用率',
  levelNearingPrefix: '上限の',
  levelNearingSuffix: '% 以上に達しています',
  levelReached: '上限に達しました',
  overagePrefix: '超過',
  overageSuffix: '件は従量課金になります',
  sectionEmail: 'メール',
  emailTodayLabel: '本日の送信数',
  emailMinuteLabel: '直近 1 分の送信数',
  emailDeferNote: '1 分あたりの上限に達したため、送信を待機しています。',
  emailBlockNote: '本日の上限に達したため、メールの送信は停止しています。',
  sectionStorage: 'ストレージ',
  storageUsedLabel: '使用量',
  storageRemainingLabel: '残り',
  storageStopNote: '上限に達するとファイルのアップロードができなくなります。',
  storageReachedNote: '上限に達したため、ファイルのアップロードができません。',
  sectionSeats: '席数',
  seatsUsedLabel: '使用中',
  seatsLimitByPlan: '席数の上限はプランで管理しています。',
  billing: {
    title: '超過分の請求見込み',
    note: '残量とは別の情報です。',
    unavailable: '算出できません（契約条件が未登録）',
    unit: '円',
  },
};

const partnerMessages: UsageBlockedNoticeMessages = {
  title: 'AI 機能の利用状況',
  reason: messages.stop.reason,
  notBlocked: '現在、AI を使う機能の停止はありません。',
  scopeNote: '残量・上限値はこの画面には表示されません。',
};

function unit(used: number, quota: number): UsageView['aiUnits']['sheetParse'] {
  const remaining = Math.max(0, quota - used);
  const overageCount = Math.max(0, used - quota);
  const level = used >= quota ? 'REACHED' : used * 100 >= quota * 80 ? 'NEARING' : 'BELOW';
  return { used, quota, remaining, overageCount, level, onExceed: 'METERED' };
}

function view(overrides: Partial<UsageView> = {}): UsageView {
  return {
    asOf: '2026-09-17T03:00:00.000Z',
    warnPercent: 80,
    aiUnits: {
      sheetParse: unit(118, 180),
      matchRationale: unit(4_960, 6_200),
      proposalDraft: unit(150, 180), // 83% = 接近
      renewalSummary: unit(25, 20), // 超過（従量）
    },
    aiDailyStop: { stopped: false },
    overageEstimateJpy: null,
    storage: {
      usedBytes: (12n * GIB).toString(),
      limitBytes: (50n * GIB).toString(),
      level: 'BELOW',
      onExceed: 'STOP_UPLOAD',
    },
    email: {
      usedToday: 118,
      dailyLimit: 500,
      usedLastMinute: 3,
      minuteLimit: 30,
      level: 'BELOW',
      state: 'ALLOW',
      onExceed: 'STOP_DAILY_DEFER_MINUTE',
    },
    seats: { used: 7, limit: null },
    ...overrides,
  };
}

const STOPPED: UsageView['aiDailyStop'] = {
  stopped: true,
  reasonKey: 'quota.aiDaily',
  since: '2026-09-17T01:12:00.000Z',
  resetAt: '2026-09-17T15:00:00.000Z',
  stoppedFeatures: ['reviewGate'],
};

function render(v: UsageView): string {
  return renderToStaticMarkup(createElement(UsageScreen, { view: v, messages }));
}

function renderPartner(notice: BlockedNoticeView): string {
  return renderToStaticMarkup(createElement(UsageBlockedNoticeScreen, { notice, messages: partnerMessages }));
}

/** `data-testid="<id>"` の要素の開始位置から、次の同階層セクションまでを素朴に切り出す（HTML の並びで判定する）。 */
function sliceBetween(html: string, startTestId: string, endTestId: string): string {
  const start = html.indexOf(`data-testid="${startTestId}"`);
  const end = html.indexOf(`data-testid="${endTestId}"`);
  if (start < 0 || end < 0 || end <= start) throw new Error(`${startTestId} / ${endTestId} の並びが想定と違います。`);
  return html.slice(start, end);
}

const MONEY_WORDS = /\$|USD|usd|ドル/;

describe('S-038 UsageScreen（ホスト向け）', () => {
  it('① 平常時は停止バナーを描かない（遮断器。メーターもゲージも無い）', () => {
    const html = render(view());
    expect(html).toContain('data-testid="usage-screen"');
    expect(html).toContain('data-ai-stopped="false"');
    expect(html).not.toContain('data-testid="usage-stop-banner"');
    // 🔴 平常時に品質ゲートの名が画面に 1 つも出ない（残量にも、止まった理由にも）。
    expect(html).not.toContain('品質ゲート');
  });

  it('① 停止中は最上部に理由・止まった機能（品質ゲート）・停止開始・再開予定を出し、修正を促さない', () => {
    const html = render(view({ aiDailyStop: STOPPED }));
    expect(html).toContain('data-ai-stopped="true"');
    const banner = sliceBetween(html, 'usage-stop-banner', 'usage-as-of');
    expect(banner).toContain(messages.stop.title);
    expect(banner).toContain(messages.stop.reason);
    expect(banner).toContain('data-testid="usage-stop-feature-reviewGate"');
    expect(banner).toContain(messages.stop.stoppedFeatureLabels.reviewGate);
    expect(banner).toContain(messages.stop.stoppedFeatureConsequences.reviewGate);
    expect(banner).toContain('data-testid="usage-stop-since"');
    expect(banner).toContain('2026-09-17 10:12 JST');
    expect(banner).toContain('data-testid="usage-stop-reset-at"');
    expect(banner).toContain('2026-09-18 00:00 JST');
    expect(banner).toContain(messages.stop.noFixNote);
    expect(banner).not.toContain('修正して');
    // 🔴 バナーは残量のブロックより前（最上部）。
    expect(html.indexOf('data-testid="usage-stop-banner"')).toBeLessThan(html.indexOf('data-testid="usage-remaining"'));
  });

  it('② 4 単位が「あと N 件 / M 件」の形で出る。接近と到達（従量）を区別して注記する', () => {
    const html = render(view());
    expect(html).toContain('あと 62 件 / 180 件');
    expect(html).toContain('あと 1,240 件 / 6,200 件');
    expect(html).toContain('あと 30 件 / 180 件');
    expect(html).toContain('あと 0 件 / 20 件');
    for (const key of ['sheetParse', 'matchRationale', 'proposalDraft', 'renewalSummary']) {
      expect(html).toContain(`data-testid="usage-ai-unit-${key}"`);
      expect(html).toContain(`data-testid="usage-ai-unit-remaining-${key}"`);
    }
    // 接近（83%）: 「上限の 80% 以上に達しています」。閾値は view.warnPercent から組み立てる。
    expect(html).toContain('data-testid="usage-ai-unit-level-proposalDraft"');
    expect(html).toContain('上限の 80% 以上に達しています');
    // 到達（従量）: 「上限に達しました」+ 超過 5 件は従量課金。停止とは書かない。
    expect(html).toContain('data-testid="usage-ai-unit-level-renewalSummary"');
    expect(html).toContain('data-testid="usage-ai-unit-overage-renewalSummary"');
    expect(html).toContain('超過 5 件は従量課金になります');
    // 平常（65%）には注記が無い（常時警告は無視される）。
    expect(html).not.toContain('data-testid="usage-ai-unit-level-sheetParse"');
    expect(html).not.toContain('data-testid="usage-ai-unit-overage-sheetParse"');
    // 🔴 4 単位だけ（5 つ目のメーターが無い）。
    expect(html.match(/data-testid="usage-ai-unit-meter-/g)).toHaveLength(4);
  });

  it('③ メールは日次と分次を別に出す。ストレージは GB。席数は上限 null なら「プランで管理」', () => {
    const html = render(view());
    expect(html).toContain('data-testid="usage-email-today"');
    expect(html).toContain('118 / 500 通');
    expect(html).toContain('data-testid="usage-email-minute"');
    expect(html).toContain('3 / 30 通');
    expect(html).not.toContain('data-testid="usage-email-defer-note"');
    expect(html).not.toContain('data-testid="usage-email-block-note"');
    expect(html).toContain('12.0 / 50.0 GB');
    expect(html).toContain('38.0 GB');
    expect(html).toContain(messages.storageStopNote);
    expect(html).toContain('7 人');
    expect(html).toContain('data-testid="usage-seats-limit-by-plan"');
  });

  it('③ 分次超過 = 待機の注記、日次超過 = 停止の注記（同じ表示にしない）', () => {
    const defer = render(
      view({
        email: { usedToday: 40, dailyLimit: 500, usedLastMinute: 30, minuteLimit: 30, level: 'BELOW', state: 'DEFER', onExceed: 'STOP_DAILY_DEFER_MINUTE' },
      }),
    );
    expect(defer).toContain('data-testid="usage-email-defer-note"');
    expect(defer).not.toContain('data-testid="usage-email-block-note"');

    const block = render(
      view({
        email: { usedToday: 500, dailyLimit: 500, usedLastMinute: 0, minuteLimit: 30, level: 'REACHED', state: 'BLOCK', onExceed: 'STOP_DAILY_DEFER_MINUTE' },
      }),
    );
    expect(block).toContain('data-testid="usage-email-block-note"');
    expect(block).not.toContain('data-testid="usage-email-defer-note"');
    expect(block).toContain('data-testid="usage-email-level"');
  });

  it('③ ストレージ到達はアップロード停止の注記（従量とは書かない）', () => {
    const html = render(
      view({ storage: { usedBytes: (50n * GIB).toString(), limitBytes: (50n * GIB).toString(), level: 'REACHED', onExceed: 'STOP_UPLOAD' } }),
    );
    expect(html).toContain('data-testid="usage-storage-reached-note"');
    expect(html).toContain('0.0 GB');
    const storage = sliceBetween(html, 'usage-storage', 'usage-seats');
    expect(storage).not.toContain('従量');
  });

  it('④ 請求見込みは残量のブロックの外。null なら「算出できません」、値があれば円', () => {
    const unavailable = render(view());
    expect(unavailable).toContain('data-testid="usage-billing-unavailable"');
    expect(unavailable).toContain(messages.billing.unavailable);
    expect(unavailable).not.toContain('data-testid="usage-billing-estimate"');
    // 残量のブロックが請求見込みより前に閉じている（残量の中に金額が無い）。
    expect(unavailable.indexOf('data-testid="usage-remaining"')).toBeLessThan(unavailable.indexOf('data-testid="usage-billing"'));

    const estimated = render(view({ overageEstimateJpy: '12400' }));
    expect(estimated).toContain('data-testid="usage-billing-estimate"');
    expect(estimated).toContain('12,400 円');
  });

  it('⑤ 🔴 HTML に金額の語（$ / USD / ドル）が無い。「円」は請求見込みのブロックの中にだけ現れる', () => {
    for (const html of [render(view()), render(view({ aiDailyStop: STOPPED })), render(view({ overageEstimateJpy: '12400' }))]) {
      expect(html).not.toMatch(MONEY_WORDS);
      const beforeBilling = html.slice(0, html.indexOf('data-testid="usage-billing"'));
      expect(beforeBilling).not.toContain('円');
    }
  });

  it('⑥ 🔴 残量のブロックに品質ゲート / gate-inspector の名が現れない（停止バナーの中だけ）', () => {
    const html = render(view({ aiDailyStop: STOPPED }));
    const remaining = sliceBetween(html, 'usage-remaining', 'usage-billing');
    expect(remaining).not.toContain('品質ゲート');
    expect(remaining).not.toMatch(/gate|inspector/i);
    expect(html).toContain('品質ゲート'); // 対照: 停止バナーには出ている
  });
});

describe('S-038 UsageBlockedNoticeScreen（パートナー向け。F-027 AC-1 / BR-04）', () => {
  it('⑦ 停止中: 事実と理由だけ。残量・上限値・リセット時刻・件数の単位が 1 つも無い', () => {
    const html = renderPartner({ blocked: true, reasonKey: 'quota.aiDaily' });
    expect(html).toContain('data-testid="usage-partner-screen"');
    expect(html).toContain('data-blocked="true"');
    expect(html).toContain('data-testid="usage-partner-blocked"');
    expect(html).toContain(partnerMessages.reason);
    expect(html).not.toContain('data-testid="usage-remaining"');
    expect(html).not.toContain('data-testid="usage-billing"');
    expect(html).not.toContain('data-testid="usage-stop-reset-at"');
    expect(html).not.toContain('JST');
    expect(html).not.toMatch(/\d+ (件|通|GB|人)/);
    expect(html).not.toMatch(MONEY_WORDS);
    expect(html).not.toContain('円');
  });

  it('⑦ 停止していない: 停止が無い旨だけ', () => {
    const html = renderPartner({ blocked: false, reasonKey: null });
    expect(html).toContain('data-blocked="false"');
    expect(html).toContain('data-testid="usage-partner-not-blocked"');
    expect(html).not.toContain('data-testid="usage-partner-blocked"');
    expect(html).not.toMatch(/\d+ (件|通|GB|人)/);
  });
});
