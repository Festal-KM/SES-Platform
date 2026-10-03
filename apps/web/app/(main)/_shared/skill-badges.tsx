'use client';

// apps/web/app/(main)/_shared/skill-badges.tsx
// 一覧のスキル列（🔴 **1 行固定**）。✅ 2026-10-03 に `S-016`（候補検索）から切り出した。
//
// ============================================================================
// 🔴 なぜ 1 実装にするのか（`HANDOFF.md` §6-1 / §6-14）
// ============================================================================
// `S-016`（候補検索）のスキル列は `T-22-07` で **1 行固定**に直った。理由は情報境界である ——
// 🔴 **行の高さが内容量で変わると、それ自体が「経歴の量」という 6 つ目の開示項目になる**
// （`docs/04` §10.3 画面固有 `S-016`「スキルが 1 件だけの候補と 8 件の候補で行の高さが変わらない」。
// `CLAUDE.md` §3.1 経路 4 の匿名 5 項目）。
//
// 🔴 **ところが同じ写像のもう 1 人の消費者（`S-005` 人材台帳）が取り残されていた。**
//    実測（2026-10-03 / デモ環境 / 1280px）: スキル列は約 150px しか無く、3 件のバッジが
//    2 段に折り返して **10 行中 4 行だけ行の高さが 70px（他は 42px）** になっていた。
//    `S-005` は実名の自社台帳なので経路 4 の開示の話ではないが、**一覧の走査性**
//    （`docs/04` §7.1「50 行を縦に走査する」/ §10.3「行の高さは揃う」）の問題は同じである。
//    🔴 **`HANDOFF.md` §6-14 の教訓（1 箇所直したら同じ写像の他の消費者を全部洗う）**に従い、
//    **`S-016` の実装をここへ出して両方が同じ 1 実装を使う**（2 つ目の実装を生やさない）。
//
// ============================================================================
// 🔴 描き方（`S-016` から 1 行も変えていない）
// ============================================================================
// 🔴 描く件数は **CSS が決めた描き方に JS が追随する**形で決める: 器の `flex-wrap` が `nowrap`
//    （= 1 行固定）のとき、器の幅とバッジの実測幅から `fitSkillBadges` で件数を決め、
//    `+N` を隠した分を含めて描き直す。`wrap` のときは全件を描く（折り返しは CSS が決める）。
//    **ブレークポイントを JS に重複して持たない。**
// 🔴 バッジの幅は**全件が描かれている間に 1 度だけ**測って保持する（隠した後は測れない。
//    スキル名は行ごとに不変）。
// 🔴 サーバ描画（初期 HTML）は渡された件数 + `+N` のまま（測れないため）。マウント後に幅が
//    足りなければ減る。
// 🔴 `'use client'` は `ResizeObserver` のためだけである。**`@ses/db` に辿れる値 import を
//    持たない**（`tests/static/client-db-boundary.test.ts`）。**文言は props で受け取る。**
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@ses/ui';
import { fitSkillBadges } from '../../../lib/candidates/skill-fit';

/** `+N` の幅の見込み（まだ描かれていないときの推定値。実測できたら実測値を使う）。 */
const MORE_WIDTH_FALLBACK_PX = 40;

export type SkillBadgesProps = {
  /** 表示するスキル名（上位 N 件。並びは呼び出し側が決める）。 */
  readonly skills: readonly string[];
  /** 🔴 **開示されたスキルの総数**（`+N` の N は `total − 描いた件数`）。 */
  readonly skillCount: number;
  /** 0 件のときに出す語（`—` など。解決済み）。 */
  readonly valueNone: string;
  /**
   * `+N` の `data-testid` の接頭辞（`candidate-list-` / `engineer-list-`）。
   * 🔴 **`DataTable` と同じ形**（`${testIdPrefix}more-skills-${rowKey}`）にする ——
   *    凍結済みの接頭辞（`tests/static/support/testid-baseline.ts`）を
   *    **静的に解ける形**で保つための規約である（`testid-inventory.test.ts` の `composeTestIds`）。
   *    🔴 素の `data-testid={someProp}` にすると凍結の射程から抜ける。
   */
  readonly testIdPrefix: string;
  /** 行を一意にする値（testid の接尾辞になる）。 */
  readonly rowKey: string;
  /**
   * 🔴 **モバイル（`sm` 未満）で隠し始める位置**。`S-016` は `docs/04` §S-016「モバイル =
   * スキル 2 件」に従って `2` を渡す。**省略すると幅に収まるだけ描く**（`S-005` は
   * §S-005 にモバイルの件数の定めが無く、器の実測に任せるのが正しい）。
   */
  readonly mobileLimit?: number;
};

export function SkillBadges({
  skills,
  skillCount,
  valueNone,
  testIdPrefix,
  rowKey,
  mobileLimit,
}: SkillBadgesProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const widthsRef = useRef<{ readonly badges: readonly number[]; more: number | null } | null>(null);
  const [shown, setShown] = useState(skills.length);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null || skills.length === 0 || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const style = getComputedStyle(box);
      if (style.flexWrap !== 'nowrap') {
        setShown(skills.length);
        return;
      }
      const moreElement = box.querySelector<HTMLElement>('[data-skill-more]');
      const moreWidth = moreElement === null ? 0 : moreElement.getBoundingClientRect().width;
      if (widthsRef.current === null) {
        const badges = Array.from(box.querySelectorAll<HTMLElement>('[data-skill-badge]')).map(
          (element) => element.getBoundingClientRect().width,
        );
        // 隠したバッジ（幅 0）が混ざっているなら、この描画では測れない（次の描画で測る）。
        if (badges.length !== skills.length || badges.some((width) => width === 0)) return;
        widthsRef.current = { badges, more: moreWidth > 0 ? moreWidth : null };
      } else if (moreWidth > 0 && widthsRef.current.more === null) {
        widthsRef.current = { ...widthsRef.current, more: moreWidth };
      }
      const fit = fitSkillBadges({
        available: box.clientWidth,
        badgeWidths: widthsRef.current.badges,
        moreWidth: widthsRef.current.more ?? MORE_WIDTH_FALLBACK_PX,
        gap: Number.parseFloat(style.columnGap) || 0,
        total: skillCount,
      });
      setShown(fit.shown);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
    // 🔴 `shown` を依存に入れない —— 減らした後の描画で測り直すと隠したバッジの幅が 0 になる。
  }, [skills.length, skillCount]);

  if (skills.length === 0) return <>{valueNone}</>;
  const hidden = Math.max(skillCount - shown, 0);
  return (
    // ========================================================================
    // 🔴 スキル列は**どのブレークポイントでも 1 行固定**である（`flex-nowrap` + `overflow-hidden`）
    // ========================================================================
    // ⚠️ 溢れの扱い: 器の幅を実測して描く件数を減らし（`fitSkillBadges`）、隠した分は `+N` に載る。
    //    器の祖先（`Table` の `overflow-x-auto`）があるので、E2E の `unreachable-overflow`
    //    （到達できない溢れ）にはならない。全件は行の遷移先（`S-006` / 右パネル）で読める。
    <span ref={boxRef} className="flex flex-nowrap items-center gap-1 overflow-hidden">
      {skills.map((skill, index) => (
        // 🔴 `Badge` 自身の `inline-flex` と display を競わせないよう、外側の `<span>` で包んで隠す
        //    （`cn` は単純な連結であり、後勝ちの解決をしない）。
        <span
          key={skill}
          className={
            index >= shown
              ? 'hidden'
              : mobileLimit !== undefined && index >= mobileLimit
                ? 'hidden sm:inline'
                : undefined
          }
          data-skill-badge=""
        >
          <Badge variant="outline">{skill}</Badge>
        </span>
      ))}
      {hidden === 0 ? null : (
        <span
          className={
            mobileLimit === undefined
              ? 'shrink-0 px-1 text-xs text-fg-muted'
              : 'hidden shrink-0 px-1 text-xs text-fg-muted sm:inline'
          }
          data-skill-more=""
          data-testid={`${testIdPrefix}more-skills-${rowKey}`}
        >
          {`+${String(hidden)}`}
        </span>
      )}
    </span>
  );
}
