// apps/web/lib/home/hrefs.ts
// 🔴 ホーム（`S-003` / `S-004`）の **URL の唯一の出所**。✅ 2026-10-11。
//
// ============================================================================
// 🔴 なぜ画面から切り出したのか
// ============================================================================
// 人間の仕様（2026-10-11）は 🔴 **「KPI はクリックでタブ切替やフィルタに遷移できる」**と定めた。
// 遷移先は **ホーム自身の URL（`?tab=` + セクションのアンカー）**であり、
// `docs/05` §6.11.1 は 🔴 **「指標 → 遷移先は API の応答が持つ（数の意味を 2 箇所で決めない）」**
// と定めている。したがって `./summary.ts` が URL を組む必要があり、
// **画面（`app/(main)/page.tsx`）の中に `homeHref` を置いたままにはできない**
// （`lib/**` から `app/**` を参照しない）。
//
// 🔴 **既定値は URL に載せない**（`/?tab=actions` ではなく `/`）—— 同じ面に 2 つの URL が
//    できると、戻ったときにどちらに帰るかが読めない。
// 🔴 **スクロール先はフラグメント（`#...`）で表す**（`docs/04` §4.1 の操作表「KPI カード 2 →
//    `返信待ち` セクションへスクロール」）。**クライアント側の状態にしない** ——
//    URL に載っていれば、通知メールや社内チャットから「その行の在る場所」を共有できる。
import { DEFAULT_HOME_SCOPE, DEFAULT_HOME_TAB, type HomeScope, type HomeTab } from './schemas';

/** ホーム自身のパス（`S-003` / `S-004`）。 */
export const HOME_PATH = '/';

/**
 * 🔴 `要対応` タブのセクションの **DOM id の接頭辞**。
 *    `#home-section-awaiting-reply` のようなアンカーになる（`./sections.ts` が `id` を作る）。
 */
export const HOME_SECTION_ANCHOR_PREFIX = 'home-section-';

/** 🔴 セクションの `id`（**ここだけが作る**。画面側で文字列を組み立てない）。 */
export function homeSectionAnchorId(section: string): string {
  return `${HOME_SECTION_ANCHOR_PREFIX}${section.toLowerCase().replaceAll('_', '-')}`;
}

/**
 * ホームの URL（`?scope=` / `?tab=` と、任意のセクションのアンカー）。
 * 🔴 **既定値は載せない**（上の 🔴）。
 */
export function homeHref(
  scope: HomeScope,
  tab: HomeTab,
  options?: { readonly section?: string },
): string {
  const params = new URLSearchParams();
  if (scope !== DEFAULT_HOME_SCOPE) params.set('scope', scope);
  if (tab !== DEFAULT_HOME_TAB) params.set('tab', tab);
  const query = params.toString();
  const base = query === '' ? HOME_PATH : `${HOME_PATH}?${query}`;
  const section = options?.section;
  return section === undefined ? base : `${base}#${homeSectionAnchorId(section)}`;
}
