// apps/web/lib/home/summary-view.ts
// 🔴 **KPI カード 4 枚の表示値の組み立て**（`docs/04` §4.1 / §7.2 / §7.9 改訂 23 / docs/05 §6.11.1）。
//    T-22-09 → ✅ 2026-10-02（`SummaryStrip` → `KpiCardRow`）。
//
// ============================================================================
// 🔴 このファイルが持つ 3 つの「1 箇所」
// ============================================================================
//   ① 🔴 **`kind`（閉集合）→ 文言キーの写像**（docs/05 §6.11.1「API はラベルを返さない。写像は
//      画面側の 1 箇所に置く」）。`Record` で宣言してあるので、`kind` が増えたら**コンパイルが
//      落ちる**（語を足し忘れた指標が無名で出ることが起きない）。
//   ② 🔴 **`kind` → アイコンの写像**（`docs/04` §7.5 の許可⑤）。同じ理由で `Record` である。
//      🔴 **アイコンは印であって意味ではない**（意味は日本語ラベルが担う）。
//   ③ 🔴 **差分の文字列の組み立て**（`↑ +2（先週比）`）。🔴 **率・% を作れない形にする** ——
//      受け取るのは符号つきの整数 1 つと基準だけであり、**割り算をこのファイルに書かない**。
//
// 🔴 **`t()` を呼ばない。** 語は解決済みの束（`KpiCardMessages`）を受け取る ——
//    **ポーリング後の再描画はクライアント側で起きる**（`_home/home-screen.tsx`）ため、
//    `packages/i18n` のカタログをクライアントバンドルへ引き込まないようにする
//    （`_home/action-queue-props.ts` と同じ分担）。語の解決は `_home/kpi-props.ts` が行う。
// 🔴 **I/O を持たない**（`db` も `fetch` も触らない）。`app/**` はユニットテストの対象外なので、
//    ここに置くことで ①②③ を機械で固定できる（`./summary-view.test.ts`）。
import type { IconName, KpiCardItem } from '@ses/ui';
import type { MessageKey } from '@ses/i18n';
import { formatThousands } from '../format/number';
import type { DeltaBasis } from './periods';
import type {
  HostSummaryMetricKind,
  PartnerSummaryMetricKind,
  SummaryHomeBlock,
  SummaryMetric,
  SummaryMetricDelta,
} from './types';

/** 🔴 ホストの指標の語（`docs/04` §4.1 の表）。 */
export const HOST_SUMMARY_METRIC_MESSAGE_KEYS: Readonly<Record<HostSummaryMetricKind, MessageKey>> = {
  ACTION_QUEUE: 'home.kpi.host.ACTION_QUEUE',
  AWAITING_REPLY: 'home.kpi.host.AWAITING_REPLY',
  INTERVIEWS: 'home.kpi.host.INTERVIEWS',
  PROPOSALS_THIS_WEEK: 'home.kpi.host.PROPOSALS_THIS_WEEK',
};

/**
 * 🔴 取引先の指標の語。**すべて自社スコープの件数の語である** —— 自社の範囲を**肯定形**で書く
 *    （§5-10 / `F-004 AC-4`。「他社は…」という否定形は他社の存在を意識させる）。
 */
export const PARTNER_SUMMARY_METRIC_MESSAGE_KEYS: Readonly<
  Record<PartnerSummaryMetricKind, MessageKey>
> = {
  REQUESTS_TO_ANSWER: 'home.kpi.partner.REQUESTS_TO_ANSWER',
  AWAITING_REPLY: 'home.kpi.partner.AWAITING_REPLY',
  INTERVIEWS: 'home.kpi.partner.INTERVIEWS',
  PUBLISHED_THIS_WEEK: 'home.kpi.partner.PUBLISHED_THIS_WEEK',
};

/**
 * 🔴 `kind` → アイコン（`docs/04` §7.5 の許可⑤。写像に無い名前は**型エラー**）。
 * 🔴 **比喩アイコンを使わない**（稲妻 / 電球 / きらめき。§7.5 の「引き続き使わない場所」）。
 *    `list-checks` = 今日やること（`docs/04` §4.1 のセクションと同じ印）/ `clock` = 返信待ち（同）/
 *    `handshake` = 面談（ナビの `面談・結果` と同じ）/ `send` = 提案（同 `提案`）/
 *    `inbox` = 提案依頼（同 `提案依頼`）/ `briefcase` = 案件（同 `案件`）。
 */
export const HOST_SUMMARY_METRIC_ICONS: Readonly<Record<HostSummaryMetricKind, IconName>> = {
  ACTION_QUEUE: 'list-checks',
  AWAITING_REPLY: 'clock',
  INTERVIEWS: 'handshake',
  PROPOSALS_THIS_WEEK: 'send',
};

export const PARTNER_SUMMARY_METRIC_ICONS: Readonly<Record<PartnerSummaryMetricKind, IconName>> = {
  REQUESTS_TO_ANSWER: 'inbox',
  AWAITING_REPLY: 'clock',
  INTERVIEWS: 'handshake',
  PUBLISHED_THIS_WEEK: 'briefcase',
};

/** 差分の語（🔴 **記号と括弧書きまでカタログが持つ**。絵文字を使わない。§7.5）。 */
export type KpiDeltaMessages = {
  readonly increase: string;
  readonly decrease: string;
  readonly unchanged: string;
  readonly basis: Readonly<Record<DeltaBasis, string>>;
};

export type KpiCardMessages = {
  /** 指標の語（**ホスト / 取引先のどちらかの写像を解決したもの**）。 */
  readonly labels: Readonly<Record<string, string>>;
  readonly unit: string;
  readonly delta: KpiDeltaMessages;
};

/**
 * 🔴 **KPI カードを描かない条件（唯一の判定）**: サーバが返した `initialEmpty`
 *    （= 案件も人材も 0 件 / 取引先は公開案件も自社人材も 0 件）。
 *
 * 🔴 **`items` の `count` から判定しない。** 改訂 23 の 4 指標は「いま対応が要るものの数」であり、
 *    運用中のテナントでも平常日には全部 0 になる —— 旧 `SummaryStrip` の判定（全 metric が 0）を
 *    そのまま使うと、**案件と人材が揃っているのに「まだ登録されていません」と出る**（`./types.ts`）。
 */
export function isHomeInitialEmpty(block: SummaryHomeBlock): boolean {
  return block.initialEmpty;
}

/**
 * 差分の 1 行（`↑ +2（先週比）`）。🔴 **比較できないときは `null`**（欄ごと描かない。
 * `±0` と「比較できない」は別物である。`docs/04` §4.1）。
 */
export function formatKpiDelta(delta: SummaryMetricDelta | null, messages: KpiDeltaMessages): string | null {
  if (delta === null) return null;
  const basis = messages.basis[delta.basis];
  if (delta.count === 0) return `${messages.unchanged}${basis}`;
  // 🔴 符号は**語の側**が持つ（`-` をそのまま出さない。`↓ −3` の `−` は U+2212 の全角相当であり、
  //    ハイフンと見分けが付く。`packages/i18n` の `home.kpi.delta.decrease`）。
  const sign = delta.count > 0 ? messages.increase : messages.decrease;
  return `${sign}${formatThousands(Math.abs(delta.count))}${basis}`;
}

/**
 * `KpiCardRow` に渡す 4 件。🔴 **0 の項目も残す**（間引かない —— 並びが日によって変わると
 * 走査の記憶が効かない。`docs/05` §6.11.1）。
 *
 * 🔴 `id` は `kind` を小文字の kebab にしたもので、`data-testid` の接尾辞になる
 *    （`home-host-kpi-action-queue` など。**値は呼び出し側が組む**という部品の規約に従い、
 *    接頭辞は画面が渡す）。
 */
export function kpiCardItems(block: SummaryHomeBlock, messages: KpiCardMessages): readonly KpiCardItem[] {
  const icons: Readonly<Record<string, IconName>> =
    block.audience === 'HOST' ? HOST_SUMMARY_METRIC_ICONS : PARTNER_SUMMARY_METRIC_ICONS;
  const items: readonly SummaryMetric<string>[] = block.items;
  return items.map((item) => ({
    id: kpiCardId(item.kind),
    // 🔴 写像に無い `kind` は `undefined` にならない（`Record` が全キーを要求する）。
    icon: icons[item.kind] ?? 'list-checks',
    label: messages.labels[item.kind] ?? item.kind,
    value: formatThousands(item.count),
    unit: messages.unit,
    delta: formatKpiDelta(item.delta, messages.delta),
  }));
}

/** 🔴 `ACTION_QUEUE` → `action-queue`（testid の接尾辞）。**写像を別に持たない**（機械変換）。 */
export function kpiCardId(kind: string): string {
  return kind.toLowerCase().replaceAll('_', '-');
}
