// apps/web/app/(main)/_home/home-props.ts
// ホーム（`S-003` / `S-004`）の**語の組み立て**（`docs/04` §4.1 / §7.2 改訂 23）。2026-10-02。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`./home-screen.tsx`）は
//    `'use client'` であり `t()` を呼ばせない（`./action-queue-props.ts` と同じ規律）——
//    カタログをクライアントバンドルへ引き込まないため。
// 🔴 **写像は `Record<..., ...>` で受ける**（`kind` が増えたとき割り当て漏れがコンパイルエラーになる）。
// 🔴 **件数・氏名・日付を含む文はここで「組み立てない」** —— `t()` は差し込みを持たないので、
//    断片（`prefix` / `suffix`）のまま渡し、**組み立ては描画側**が行う（`shell.header.scope.ownCompanySuffix`
//    と同じ形）。理由: 件数はポーリングで変わるため、サーバで 1 度組むと更新できない。
import { t, type MessageKey } from '@ses/i18n';
import { GREETING_SLOTS, type GreetingSlot } from '@ses/ui';
import {
  HOST_SUMMARY_METRIC_MESSAGE_KEYS,
  PARTNER_SUMMARY_METRIC_MESSAGE_KEYS,
  type KpiCardMessages,
} from '../../../lib/home/summary-view';
import type { DeltaBasis } from '../../../lib/home/periods';

/** 挨拶の時間帯 → 語（🔴 **3 区分だけ**。`greetingSlotOf` の区分と 1 対 1）。 */
const GREETING_MESSAGE_KEYS: Readonly<Record<GreetingSlot, MessageKey>> = {
  MORNING: 'home.greeting.MORNING',
  AFTERNOON: 'home.greeting.AFTERNOON',
  EVENING: 'home.greeting.EVENING',
};

/** 差分の基準 → 語（🔴 **2 つだけ**。前月比・前年比の語を持たない。§7.2 改訂 23 ②）。 */
const DELTA_BASIS_MESSAGE_KEYS: Readonly<Record<DeltaBasis, MessageKey>> = {
  PREVIOUS_DAY: 'home.kpi.delta.basis.PREVIOUS_DAY',
  PREVIOUS_WEEK: 'home.kpi.delta.basis.PREVIOUS_WEEK',
};

export type HomeGreetingMessages = {
  /** 時間帯ごとの挨拶の頭（`おはようございます、`）。🔴 氏名は描画側が足す。 */
  readonly slots: Readonly<Record<GreetingSlot, string>>;
  readonly nameSuffix: string;
  /** 一文（🔴 件数で選ぶ。`none` / `prefix` + 件数 + `suffix`）。 */
  readonly leadNone: string;
  readonly leadPrefix: string;
  readonly leadSuffix: string;
  /** 基準時刻の行（`10:42 時点 / 差分の起点は本日 0:00（JST）`）。 */
  readonly asOfSuffix: string;
  readonly asOfNote: string;
  readonly asOfSeparator: string;
};

export type HomeTabMessages = {
  readonly label: string;
  readonly actions: string;
  readonly projects: string;
  readonly engineers: string;
};

export type HomeRailMessages = {
  readonly scheduleTitle: string;
  readonly scheduleEmpty: string;
  readonly priorityTitle: string;
  readonly priorityEmpty: string;
  readonly onePointTitle: string;
  /** 🔴 **静的な文言集**（日替わりで 1 つ選ぶ。AI でも業務データでも生成しない。§4.1 の ③）。 */
  readonly onePointLines: readonly string[];
};

export type HomeScreenMessages = {
  readonly greeting: HomeGreetingMessages;
  readonly kpi: KpiCardMessages;
  readonly tabs: HomeTabMessages;
  readonly rail: HomeRailMessages;
  readonly seeAll: string;
};

/**
 * 🔴 ホスト向け / 取引先向けの**ワンポイントの文言集を分ける**（§4.1 の ③）——
 *    ホスト向けの案内（公開範囲の設定など）を取引先に出すと、**自社に無い機能の説明が届く**。
 */
const HOST_ONE_POINT_KEYS: readonly MessageKey[] = [
  'home.onePoint.host.1',
  'home.onePoint.host.2',
  'home.onePoint.host.3',
];
const PARTNER_ONE_POINT_KEYS: readonly MessageKey[] = [
  'home.onePoint.partner.1',
  'home.onePoint.partner.2',
  'home.onePoint.partner.3',
];

function resolved<K extends string>(entries: readonly (readonly [K, MessageKey])[]): Readonly<Record<K, string>> {
  return Object.fromEntries(entries.map(([key, messageKey]) => [key, t(messageKey)])) as Readonly<Record<K, string>>;
}

/** KPI カードの語（🔴 **所属ごとに写像を切り替える**。緩い `Record<string, …>` に落とさない）。 */
function kpiMessages(audience: 'HOST' | 'PARTNER'): KpiCardMessages {
  const keys: Readonly<Record<string, MessageKey>> =
    audience === 'HOST' ? HOST_SUMMARY_METRIC_MESSAGE_KEYS : PARTNER_SUMMARY_METRIC_MESSAGE_KEYS;
  return {
    labels: resolved(Object.entries(keys).map(([kind, key]) => [kind, key] as const)),
    unit: t('home.kpi.unit'),
    // 🔴 ✅ 2026-10-03: 4 指標がすべて 0 の日の 1 行（`lib/home/summary-view.ts` の 🔴）。
    allZero: t('home.kpi.allZero'),
    delta: {
      increase: t('home.kpi.delta.increase'),
      decrease: t('home.kpi.delta.decrease'),
      unchanged: t('home.kpi.delta.unchanged'),
      basis: resolved(
        (Object.entries(DELTA_BASIS_MESSAGE_KEYS) as [DeltaBasis, MessageKey][]).map(
          ([basis, key]) => [basis, key] as const,
        ),
      ),
    },
  };
}

export function homeScreenMessages(audience: 'HOST' | 'PARTNER'): HomeScreenMessages {
  return {
    greeting: {
      slots: resolved(GREETING_SLOTS.map((slot) => [slot, GREETING_MESSAGE_KEYS[slot]] as const)),
      nameSuffix: t('home.greeting.nameSuffix'),
      leadNone: t('home.greeting.lead.none'),
      leadPrefix: t('home.greeting.lead.prefix'),
      leadSuffix: t('home.greeting.lead.suffix'),
      asOfSuffix: t('home.greeting.asOf.suffix'),
      asOfNote: t('home.greeting.asOf.note'),
      asOfSeparator: t('home.greeting.asOf.separator'),
    },
    kpi: kpiMessages(audience),
    tabs: {
      label: t('home.tab.label'),
      actions: t('home.tab.actions'),
      projects: t('home.tab.projects'),
      engineers: t('home.tab.engineers'),
    },
    rail: {
      scheduleTitle: t('home.schedule.title'),
      scheduleEmpty: t('home.schedule.empty'),
      priorityTitle: t('home.priority.title'),
      priorityEmpty: t('home.priority.empty'),
      onePointTitle: t('home.onePoint.title'),
      onePointLines: (audience === 'HOST' ? HOST_ONE_POINT_KEYS : PARTNER_ONE_POINT_KEYS).map((key) =>
        t(key),
      ),
    },
    seeAll: t('ui.seeAll'),
  };
}
