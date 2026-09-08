// tests/e2e/support/assertions.ts
// 「1 件も現れない」を**どこに何が現れたか**まで言える形で確かめる。
//
// 🔴 `expect(text).not.toContain(x)` を並べると、落ちたときに「何が漏れたか」は分かるが
//    「どの応答か」が分からない。分離の失敗は原因追跡が最重要なので、経路名を必ず添える。
import { expect, type Page } from '@playwright/test';

export type Sighting = { readonly source: string; readonly marker: string };

/** `haystack` に `markers` が 1 つも現れないこと。 */
export function expectNoMarkers(
  source: string,
  haystack: string,
  markers: readonly string[],
): void {
  const sightings: Sighting[] = markers
    .filter((marker) => marker !== '' && haystack.includes(marker))
    .map((marker) => ({ source, marker }));
  expect(sightings, `${source} に境界外の値が現れました`).toEqual([]);
}

/**
 * 🔴 「件数バッジ・並び順の変化・『他 N 件』も無い」（`F-004 AC-3` / `AC-4`）。
 *    件数の**示唆**は文字列としてしか観測できないため、日本語の常套句を明示的に禁止する。
 */
const COUNT_HINT_PATTERNS: readonly RegExp[] = [
  /他\s*[0-9０-９]+\s*件/,
  /ほか\s*[0-9０-９]+\s*件/,
  /全体\s*[0-9０-９]+\s*件/,
  /[0-9０-９]+\s*件中/,
  /[0-9０-９]+\s*番目/,
];

export function expectNoHiddenCountHints(source: string, haystack: string): void {
  const hits = COUNT_HINT_PATTERNS.filter((pattern) => pattern.test(haystack)).map(String);
  expect(hits, `${source} に「見えない件数」を示唆する表現が現れました`).toEqual([]);
}

/**
 * 🔴 狭い画面で**横スクロールが出ていない**こと（`CLAUDE.md` §13.3。破綻の代表的な症状）。
 *
 * 🔴 T-06-09 で `home.mobile.spec.ts` / `settings.mobile.spec.ts` の同一実装をここへ集約した
 *    （3 本目〔`projects.mobile.spec.ts`〕を足すにあたり、同じ判定が 3 箇所に散ると
 *    「1 箇所だけ緩い閾値に直された」ことに気づけなくなるため）。**判定は変えていない。**
 * ⚠️ 1px の許容は、`scrollWidth` / `clientWidth` が端数を丸めるため（元実装と同じ）。
 */
export async function expectNoHorizontalOverflow(source: string, page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    overflow,
    `${source}: 横スクロールが発生しています（モバイルで破綻している）`,
  ).toBeLessThanOrEqual(1);
}
