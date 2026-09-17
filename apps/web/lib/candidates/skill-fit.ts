// apps/web/lib/candidates/skill-fit.ts
// `S-016` のスキル列（1 行固定）に何件のバッジを描くかを決める純粋関数。T-11-12。
//
// docs/04 §S-016「デスクトップの列幅配分」: スキル列は唯一の伸縮列で**常に 1 行**、描く件数は
// **上位 3 + `+N` を上限とし、幅が足りなければ件数を減らす（下限 = 1 件 + `+N`）**。`+N` の N は
// 開示された残り件数（隠した件数を含む）。
//
// 🔴 計測（幅の実測）は画面側（`candidate-screen.tsx` の `SkillBadges`）が行い、ここは数だけを扱う ——
//    `app/**` はユニットテストの対象外であり、「下限 1 件」「N が隠した分を含む」を固定できる場所が要る。
// 🔴 コンテナクエリで描く件数を決める方式を採らなかった理由: 画面幅の分岐は Tailwind の既定ブレークポイント
//    に限る（`CLAUDE.md` §13.3）が、コンテナクエリの導入方針は決まっていない（`tests/static/tailwind-breakpoints.test.ts`
//    冒頭）。加えて閾値をコンテナ幅に置くとバッジの幅（スキル名の長さ）で外れる。実測に基づく判定なら
//    「収まるか」を直接答えられる。

export type SkillFitInput = {
  /** 器（バッジを並べる 1 行）の内側の幅（px）。 */
  readonly available: number;
  /** 描いているバッジの幅（px）。上位 3 件まで。順序は表示順。 */
  readonly badgeWidths: readonly number[];
  /** `+N` の幅（px）。 */
  readonly moreWidth: number;
  /** バッジ同士・バッジと `+N` の間隔（px）。 */
  readonly gap: number;
  /** 開示されたスキルの総数（`skillCount`）。 */
  readonly total: number;
};

export type SkillFit = {
  /** 描くバッジの件数（1 以上。`badgeWidths` が空なら 0）。 */
  readonly shown: number;
  /** `+N` の N（0 なら `+N` を描かない）。 */
  readonly more: number;
};

/**
 * 収まる最大の件数を返す。🔴 **1 件は必ず描く**（下限）。`+N` は「total − shown」で、隠した分を含む。
 * 幅が足りずに 1 件 + `+N` すら収まらない場合も 1 件 + `+N` を返す（器の `overflow-hidden` が閉じ込める。
 * 表の最小幅〔`lg:min-w-*`〕がこの状態を作らないことは画面側の責務）。
 */
export function fitSkillBadges(input: SkillFitInput): SkillFit {
  const count = input.badgeWidths.length;
  if (count === 0) return { shown: 0, more: Math.max(input.total, 0) };
  let used = 0;
  let shown = 0;
  for (let index = 0; index < count; index += 1) {
    const width = input.badgeWidths[index] ?? 0;
    const next = used + (index === 0 ? 0 : input.gap) + width;
    const remaining = input.total - (index + 1);
    const need = next + (remaining > 0 ? input.gap + input.moreWidth : 0);
    if (need > input.available && index > 0) break;
    used = next;
    shown = index + 1;
  }
  return { shown, more: Math.max(input.total - shown, 0) };
}
