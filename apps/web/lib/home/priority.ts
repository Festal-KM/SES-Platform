// apps/web/lib/home/priority.ts
// 🔴 ホームの行の**優先度**（人間の仕様 2026-10-11「優先度 高 = 赤系 / 中 = 黄系 / 低 = グレー」）。
//
// ============================================================================
// 🔴 なぜ「導出」なのか（スキーマを足さない）
// ============================================================================
// `CLAUDE.md` §4.1 のドメインモデルに**優先度の属性は無い**。足すには `docs/05` の改訂（= 人間の
// 承認事項）が要るうえ、**誰がいつ何を基準に付けたのかが残らない優先度は、監査の根拠にならない**。
// 一方、人間の仕様は 🔴 **「期限が近いほど上、優先度が高いほど上」**と書いており、これは
// **優先度が期限の関数であること**を意味している。したがって:
//
//   🔴 **優先度は `期限までの残り` と `放置時間` から決定的に導出する**（純粋関数）。
//   🔴 **サーバの応答に `priority` のキーを足さない。**
//      理由は 2 つある。①同じ値を 2 箇所（API とクライアント）で持つと、ポーリングの差分で
//      片方だけ古くなる ②要対応キューの行のキー集合は
//      `tests/isolation/home-action-queue.test.ts` と `tests/e2e/isolation.spec.ts` が
//      **完全一致で凍結**している（他社の件数・順位を運ぶキーを 1 つも足さないための検査であり、
//      優先度はその検査の趣旨に照らしても「行が自分で運ぶべき値」ではない）。
//   🔴 **この関数は時計を引数で受け取る**（`nowMs`）。基準はサーバの応答時刻
//      （`changedSince`）であり、端末時刻を混ぜない（`./action-queue-urgency.ts` と同じ分担）。
//
// ============================================================================
// 🔴 色との関係（§7.4 の意味を壊さない）
// ============================================================================
// §7.4 は赤（`danger`）を **`SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` の 3 状態専用**と
// 定めている。優先度の「高」を赤で描くと意味が重なるため、🔴 **優先度は `StatusBadge`
// （状態の写像）ではなく `Badge` の variant で描く**（`S-022` の失敗理由バッジと同じ扱い）。
// 🔴 **色の選択は 1 箇所**（`PRIORITY_BADGE_VARIANTS`）に閉じ、画面側で variant を書かない。
import type { BadgeVariant } from '@ses/ui';
import { ACTION_QUEUE_STALE_AFTER_MS } from './action-queue-urgency';

/** 🔴 3 段だけ（4 段目を作らない。段が増えるほど「どれから手を付けるか」が決まらなくなる）。 */
export const HOME_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type HomePriority = (typeof HOME_PRIORITIES)[number];

/**
 * 🔴 期限までの残りで「高」にする境界（**24 時間**）。
 *
 * 理由: 提案依頼は期限を過ぎると `EXPIRED` になり、**商談機会そのものが消える**
 * （`F-018` / `docs/04` §S-004「なぜこの構成か」）。SES の営業は当日中に返せるかで決まるため、
 * 「今日のうちに動かないと失う」= 残り 24 時間を「高」の境界にする。
 */
export const PRIORITY_DEADLINE_HIGH_MS = 86_400_000;

/**
 * 🔴 期限までの残りで「中」にする境界（**3 日**）。
 *
 * 🔴 **`ACTION_QUEUE_STALE_AFTER_MS`（色を付ける閾値）と同じ値を使う**（別の定数を作らない）。
 *    画面上で「橙の縦バーが付いた行」と「優先度 中 以上の行」がずれると、どちらの印も
 *    信用されなくなる。
 */
export const PRIORITY_DEADLINE_MEDIUM_MS = ACTION_QUEUE_STALE_AFTER_MS;

/**
 * 🔴 放置時間で「高」にする境界（**7 日**）。
 *
 * 期限を持たない行（承認待ち・ゲート差し戻し・送信失敗・返信待ち）は、**放置時間だけが
 * 危険度の尺度**である。`ACTION_QUEUE_STALE_AFTER_MS`（3 日）を超えた行に色が付くので、
 * その**さらに倍以上**放置されたものを「高」にする（1 週間動いていない = 誰も見ていない）。
 */
export const PRIORITY_ELAPSED_HIGH_MS = 7 * 86_400_000;

/** 🔴 放置時間で「中」にする境界（色が付くのと同じ 3 日。上の 🔴 と同じ理由）。 */
export const PRIORITY_ELAPSED_MEDIUM_MS = ACTION_QUEUE_STALE_AFTER_MS;

/** 判定に使う行の形（`ActionQueueRow` の部分集合。他の列で優先度を決めないことを型で示す）。 */
export type HomePriorityInput = {
  readonly since: string;
  readonly deadline: string | null;
};

/**
 * 🔴 行の優先度（**期限 → 放置時間**の順に見る）。
 *
 * 🔴 **種別・状態・ロール・金額で優先度を決めない。** 種別の重みはサーバの並び
 *    （`sortActionQueueRows` の「放置時間 × 取り返しのつかなさ」）が既に表現しており、
 *    ここで二重に重み付けすると**並びとバッジが食い違う**。
 * ⚠️ 解析できない時刻は `LOW` に倒す（表示の印であり、判断そのものには使わない。
 *    `isActionQueueRowUrgent` と同じ倒し方）。
 */
export function homeRowPriority(row: HomePriorityInput, nowMs: number): HomePriority {
  if (!Number.isFinite(nowMs)) return 'LOW';
  if (row.deadline !== null) {
    const deadline = Date.parse(row.deadline);
    if (!Number.isNaN(deadline)) {
      const remaining = deadline - nowMs;
      // 🔴 期限超過は残りが負になるので、ここで必ず `HIGH` になる。
      if (remaining < PRIORITY_DEADLINE_HIGH_MS) return 'HIGH';
      if (remaining < PRIORITY_DEADLINE_MEDIUM_MS) return 'MEDIUM';
      return 'LOW';
    }
  }
  const since = Date.parse(row.since);
  if (Number.isNaN(since)) return 'LOW';
  const elapsed = nowMs - since;
  if (elapsed > PRIORITY_ELAPSED_HIGH_MS) return 'HIGH';
  if (elapsed > PRIORITY_ELAPSED_MEDIUM_MS) return 'MEDIUM';
  return 'LOW';
}

/**
 * 🔴 優先度 → `Badge` の variant（**唯一の写像**）。人間の仕様「高 = 赤系 / 中 = 黄系 /
 *    低 = グレー」をそのまま実装する。
 *
 * 🔴🔴 **これは「状態」ではなく「優先度」である。**
 *    `docs/04` §7.4 は赤（`danger`）を **`SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` の
 *    3 状態専用**と定めており、優先度の「高」に赤を当てると**意味が重なる**。そこで
 *    🔴 **`StatusBadge`（状態名 → 色の写像）を使わず、`Badge` の variant を直接当てる** ——
 *    `S-022`（送信失敗一覧）の**失敗理由バッジと同じ扱い**である（あちらも「状態ではない値」を
 *    `Badge` で描いている）。**状態の色の単一経路
 *    （`tests/static/proposal-state-color-single-path.test.ts`）はこれで影響を受けない** ——
 *    あの検査が禁じているのは「**状態**の色を画面が決めること」であり、ここで色が付くのは
 *    状態ではなく**期限から導出した優先度**である。
 * 🔴 **語の側でも区別する**（`home.priority.label.*` = 「優先度 高」。状態の語と混ざらない）。
 */
export const PRIORITY_BADGE_VARIANTS: Readonly<Record<HomePriority, BadgeVariant>> = {
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
};
