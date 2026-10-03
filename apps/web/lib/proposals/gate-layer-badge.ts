// apps/web/lib/proposals/gate-layer-badge.ts
// 🔴 **ゲート結果の層バッジの見え方**（`docs/04` §5-3 / §S-020 / §S-021 ③ / `CLAUDE.md` §3.3）。
//    SP-22 段④（提案まわりの刷新。2026-10-03）。
//
// ============================================================================
// 🔴 なぜ 1 ファイルに切るのか（**着手時に実際に食い違っていた**）
// ============================================================================
// 層バッジの `BadgeVariant` への写像は **`S-020` / `S-021` / `S-023` の 3 画面がそれぞれ持って**おり、
// `RUNNING` が `S-020` / `S-021` では `warning`（橙）、`S-023` では `outline`（無彩色）だった。
// `docs/04` §5-3 は 🔴 **「5 種すべてで同じ見せ方を使う —— 画面ごとに層の並びや語を変えない
// （承認者が画面をまたいで同じ読み方をできることが、ゲートが機能する条件）」** と定めており、
// 写像が画面ごとに在る形はその条文を構造的に守れない。**出所をここ 1 つにする。**
//
// ⚠️ **`@ses/ui` の `STATUS_BADGE_APPEARANCES` には入れない。** あちらは `docs/04` §5-1 の
//    **5 エンティティ・36 状態 + 公開の状態 + `Phase N`** の表であり、🔴 その表には
//    「**赤（`danger`）は `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` の 3 つだけ**」という
//    不変条件（§7.4 / `BR-23`。`apps/web/app/_components/ui-display.render.test.tsx` が凍結）がある。
//    **ゲートの層の合否はエンティティの状態ではなく**、かつ `docs/04` §S-020 / §S-021 ③ が
//    「不合格は**赤**の指摘リスト / 警告は**琥珀**の別リスト」と明示的に赤を割り当てている。
//    同じ表に入れると、どちらかの条文を曲げることになる。
//
// ============================================================================
// 🔴 割り当ての根拠（`docs/04` §5-3 / §5-1 / §7.4）
// ============================================================================
// | 層の状態 | 見え方 | 根拠 |
// |---|---|---|
// | `RUNNING`（検査中） | 無彩色 / **点線枠** | §5-1「点線枠 = 進行中・保留」。`GATE_RUNNING` が無彩色 / 点線枠であることに揃える |
// | `HELD`（AI の日次コスト上限で停止） | 🔴 **`RUNNING` と同じ** | §5-3 / `F-027 AC-5`: **上限到達は FAIL ではない。層は `検査中` のまま保持する。** 区別を運ぶのは**停止理由と再開条件の注記**であって色ではない（色を変えると `GATE_FAILED` と読み違える） |
// | `PASS` | 緑 / 塗り | §7.4「成果（緑）= 成立・完了」 |
// | `FAIL`（不合格） | **赤** / 塗り | §S-020 / §S-021 ③「不合格は層のブロック全体を FAIL 表示 + **赤**の指摘リスト、警告は**琥珀**の別リスト。**同じ色・同じ形で並べない**」 |
//
// 🔴 **`WARN`（AI の警告）はここに無い。** 警告は層の合否ではなく、**層は `PASS` のまま**
//    指摘リストの中に「警告」ラベルで併記する（§5-3 / `F-020 AC-4` / `CLAUDE.md` §3.3 第 3 層
//    「AI の指摘のみで FAIL にしてはならない」）。層バッジに警告色を持たせると、
//    **合否が揺れているように見える。**
//
// 🔴 I/O を持たない / 文言を持たない（語は `packages/i18n` から画面が渡す。`CLAUDE.md` §3.5）。
import type { GateLayerState } from '@ses/domain';
import type { BadgeShape, BadgeVariant } from '@ses/ui';

/** 1 つの層の見え方（色 = §7.4 の意味 / 形状 = §5-1 の塗り・枠線・点線枠）。 */
export type GateLayerBadgeAppearance = {
  readonly variant: BadgeVariant;
  readonly shape: BadgeShape;
};

/**
 * 🔴 **層バッジの見え方の唯一の出所**（`S-020` / `S-021` / `S-023` が同じ表を読む）。
 *    `Record` で 4 状態の漏れをコンパイラに強制させる。
 */
export const GATE_LAYER_BADGE_APPEARANCE = {
  RUNNING: { variant: 'neutral', shape: 'dashed' },
  // 🔴 `RUNNING` と同じ（§5-3: 上限到達は FAIL ではなく「検査中のまま」）。
  HELD: { variant: 'neutral', shape: 'dashed' },
  PASS: { variant: 'success', shape: 'solid' },
  FAIL: { variant: 'danger', shape: 'solid' },
} as const satisfies Record<GateLayerState, GateLayerBadgeAppearance>;

/** その層の見え方。🔴 **画面は色を選べない**（状態から引くだけ）。 */
export function gateLayerBadgeAppearance(state: GateLayerState): GateLayerBadgeAppearance {
  return GATE_LAYER_BADGE_APPEARANCE[state];
}
