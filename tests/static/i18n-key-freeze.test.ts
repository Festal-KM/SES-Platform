// tests/static/i18n-key-freeze.test.ts
// 🔴 **`packages/i18n` のキー名の凍結**（`docs/05` §17.7.3 / `docs/04` `U-22` / `SP-22` §3.2）。
//
// ============================================================================
// なぜキー名を凍結するのか
// ============================================================================
// `no-hardcoded-copy.test.ts` は「画面に日本語を直書きしていないこと」を守るが、**キー集合は
// 固定していない**。刷新は文言の**値**を大きく動かす（`docs/04` §7.8 / `U-20`: ①〜⑥ の接頭辞の
// 除去 / 群名の追加 / `内容を見る` の追加）。そのついでにキー名を整理したくなるのが自然だが——
//
//   🔴 **キーは画面 / `*.render.test.tsx` / E2E の 3 層が同じ名で参照している。**
//      改名すると「画面とテストを同時に直す」ことになり、**そのときテストの期待値を
//      『とりあえず直した』と気づけない**（`SP-22` §4 の ②③ がそのまま起きる）。
//      その 1 件が `CLAUDE.md` §7 の「0 件」を破る回帰でも、緑のまま通る。
//
// 🔴 **追加は可、改名と削除は不可。値（表示文字列）は変えてよい。**
//
// ============================================================================
// 🔴 値は比較しない
// ============================================================================
// 値を固定すると、文言の改訂ごとにベースラインを書き換えることになり、**「書き換えるのが普通の
// ファイル」になる。** そうなった凍結は凍結として働かない（`support/i18n-key-baseline.ts` 冒頭）。
// 値の側の規律は別の検査が持つ:
//   - `no-hardcoded-copy.test.ts` … 画面に直書きしていない
//   - `product-name-single-key.test.ts` … 製品名の出所が 1 トークン
//   - `packages/i18n/src/glossary.test.ts` … 境界と責任に関わる語の統一
import { describe, expect, it } from 'vitest';
import { catalog } from '../../packages/i18n/src/index.js';
import { I18N_KEY_BASELINE } from './support/i18n-key-baseline.js';

const presentKeys = Object.keys(catalog('ja'));
const present = new Set(presentKeys);

describe('🔴 packages/i18n のキー名の凍結（docs/05 §17.7.3 / docs/04 U-22）', () => {
  it('走査が空振りしていない（カタログを現に読めている）', () => {
    expect(presentKeys.length).toBeGreaterThanOrEqual(2500);
    expect(present.has('product.name')).toBe(true);
  });

  it('ベースライン自体が重複を持たず昇順である（差分を読める形に保つ）', () => {
    expect(new Set(I18N_KEY_BASELINE).size).toBe(I18N_KEY_BASELINE.length);
    expect([...I18N_KEY_BASELINE]).toEqual([...I18N_KEY_BASELINE].sort());
    expect(I18N_KEY_BASELINE.length).toBeGreaterThanOrEqual(2500);
  });

  it('🔴 2026-09-30 のキーが 1 つも消えていない（改名・削除 0 件）', () => {
    const missing = I18N_KEY_BASELINE.filter((key) => !present.has(key));
    expect(
      missing,
      `2026-09-30 に在った文言キーが ${missing.length} 件消えています: ${missing.slice(0, 40).join(', ')}\n` +
        '🔴 追加は可、改名と削除は不可（docs/04 U-22）。値（表示文字列）は変えてよいので、' +
        '①〜⑥ の接頭辞の除去・群名の追加・`内容を見る` の追加はキーを動かさずに行うこと。\n' +
        '意図して外すなら SP-22 §3.2 の 4 点を完了記録に残すこと（記録が無ければタスクを完了にしない）。',
    ).toEqual([]);
  });

  it('🔴 値は比較していない（値の変更で落ちないことを、実際に値を書き換えて確かめる）', () => {
    // 🔴 「値を比較しない」は書かれていないことなので、**比較していたら落ちる形**で示す。
    //    ベースラインは文字列の配列であり、値の情報を 1 つも持たない。
    expect(I18N_KEY_BASELINE.every((key) => typeof key === 'string' && !key.includes('：'))).toBe(true);
    // 現在の値を差し替えた写しを作っても、判定（キー集合の包含）は変わらない。
    const mutated = Object.fromEntries(presentKeys.map((key) => [key, '（差し替えた値）']));
    const missingAfterMutation = I18N_KEY_BASELINE.filter((key) => !(key in mutated));
    expect(missingAfterMutation).toEqual([]);
  });

  it('🔴 刷新で値が変わるキーが、キーとしては残っている（docs/04 §7.8 / U-20 の対象）', () => {
    // ①〜⑥ の接頭辞を外すのは**値の変更**である。キーは動かない。
    for (const key of [
      'shell.nav.home',
      'shell.nav.host.engineers',
      'shell.nav.host.projects',
      'shell.nav.host.candidates',
      'shell.nav.proposals',
      'shell.nav.proposalRequests',
    ]) {
      expect(I18N_KEY_BASELINE, `${key} がベースラインにありません`).toContain(key);
      expect(present.has(key), `${key} が実装から消えています`).toBe(true);
    }
  });

  it('対照: ベースラインに無い架空のキーは現在のカタログにも無い（走査が何でも真にしていない）', () => {
    expect(present.has('this.key.does.not.exist')).toBe(false);
    expect(I18N_KEY_BASELINE.includes('this.key.does.not.exist')).toBe(false);
  });
});
