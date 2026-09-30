// apps/web/lib/home/summary-view.ts
// 🔴 `SummaryStrip` の表示値の組み立て（`docs/04` §4.1 改訂 16 / §5-13 / §7.2 / §7.9 /
//    docs/05 §6.11.1）。T-22-09。
//
// ============================================================================
// 🔴 このファイルが持つ 2 つの「1 箇所」
// ============================================================================
//   ① 🔴 **`kind`（閉集合）→ 文言キーの写像**（docs/05 §6.11.1「API はラベルを返さない。
//      写像は画面側の 1 箇所に置く」）。`Record` で宣言してあるので、Phase 2 が `kind` を足したら
//      **コンパイルが落ちる**（語を足し忘れた指標が無名で出ることが起きない）。
//   ② 🔴 **ストリップを描かないかどうかの判定**（同「描かない判断は画面側の 1 箇所。条件は
//      『全 metric の `count` が 0』= 初回空」）。🔴 **個々の 0 で項目を間引かない** ——
//      並びが日によって変わると走査の記憶が効かない。
//
// 🔴 **値は件数だけ**（`docs/04` §7.2: 前月比・達成率・グラフ・率を渡さない）。書式は
//    `formatThousands`（3 桁区切り。§10.3「大きい数値」）であり、単位の語は付けない ——
//    ラベルが「案件」「人材」なので「128」で読める（`S-003` の例示も `案件 128`）。
// 🔴 **I/O を持たない**（`db` も `fetch` も触らない）。`app/**` はユニットテストの対象外なので、
//    ここに置くことで ①② の 2 つを機械で固定できる（`./summary-view.test.ts`）。
import { t, type MessageKey } from '@ses/i18n';
import type { SummaryStripItem } from '@ses/ui';
import { formatThousands } from '../format/number';
import type { HostSummaryMetricKind, PartnerSummaryMetricKind, SummaryHomeBlock } from './types';

/** 🔴 ホストの指標の語（`Q-04-4`）。Phase 2 の 2 つも先に持つ（`kind` を足す側でだけ落ちる形にする）。 */
export const HOST_SUMMARY_METRIC_MESSAGE_KEYS: Readonly<Record<HostSummaryMetricKind, MessageKey>> = {
  PROJECTS: 'home.summary.host.PROJECTS',
  ENGINEERS: 'home.summary.host.ENGINEERS',
  PROPOSALS_IN_FLIGHT: 'home.summary.PROPOSALS_IN_FLIGHT',
  INTERVIEWS_SCHEDULED: 'home.summary.host.INTERVIEWS_SCHEDULED',
  ASSIGNMENTS_ACTIVE: 'home.summary.ASSIGNMENTS_ACTIVE',
};

/**
 * 🔴 取引先の指標の語（同）。**すべて自社スコープの件数の語である** ——
 *    「御社に公開された案件」「自社の人材」のように**自社の範囲を肯定形で書く**（§5-10 /
 *    `F-004 AC-4`。「他社は…」という否定形は他社の存在を意識させる）。
 */
export const PARTNER_SUMMARY_METRIC_MESSAGE_KEYS: Readonly<
  Record<PartnerSummaryMetricKind, MessageKey>
> = {
  PUBLISHED_PROJECTS: 'home.summary.partner.PUBLISHED_PROJECTS',
  OWN_ENGINEERS: 'home.summary.partner.OWN_ENGINEERS',
  SHARED_ENGINEERS: 'home.summary.partner.SHARED_ENGINEERS',
  PROPOSALS_IN_FLIGHT: 'home.summary.PROPOSALS_IN_FLIGHT',
  ASSIGNMENTS_ACTIVE: 'home.summary.ASSIGNMENTS_ACTIVE',
};

/**
 * 🔴 **ストリップを描かない条件（唯一の判定）**: 全 metric の `count` が 0（= 初回空）。
 *
 * 🔴 `items` が空のときも `true` を返す（`0` が 1 つも無いのではなく「まだ何も無い」であり、
 *    どちらもストリップを出す意味が無い）。**個々の 0 では `false` のまま**である。
 */
export function isSummaryInitialEmpty(block: SummaryHomeBlock): boolean {
  return block.items.every((item) => item.count === 0);
}

/**
 * `SummaryStrip` に渡す 3〜5 件。🔴 **0 の項目も残す**（間引かない）。
 * 🔴 `href` が `null` の指標はリンクにしない（`SummaryStripItem.href` を省く）。
 */
export function summaryStripItems(block: SummaryHomeBlock): readonly SummaryStripItem[] {
  // 🔴 `audience` で分岐して**型付きの写像をそのまま引く**（`Record<string, …>` に緩めて
  //    既定値で埋めると、語を足し忘れた指標が黙って別の語で出る）。
  if (block.audience === 'HOST') {
    return block.items.map((item) => toStripItem(t(HOST_SUMMARY_METRIC_MESSAGE_KEYS[item.kind]), item));
  }
  return block.items.map((item) => toStripItem(t(PARTNER_SUMMARY_METRIC_MESSAGE_KEYS[item.kind]), item));
}

function toStripItem(label: string, item: { readonly count: number; readonly href: string | null }): SummaryStripItem {
  return {
    label,
    value: formatThousands(item.count),
    ...(item.href === null ? {} : { href: item.href }),
  };
}
