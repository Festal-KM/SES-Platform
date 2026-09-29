// tests/static/ui-type-scale.test.ts
// 🔴 `docs/05` §17.7.1 **(g)①**: **文字サイズが `docs/04` §7.9 の 6 トークン以外を使っていない。**
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// 着手時の実測は **`text-sm` 81 行 / `text-xl` 39 行 / `text-base` 31 行 / `text-2xl` 1 行 /
// 任意値 `text-[0.8125rem]` 1 行**（`apps/web/app/**` の実装ファイルを AST で数えた値）。
// §7.3 の 6 段（20 / 16 / 14 / 13 / 12 / 11px）に名前が付いていないと、画面ごとに「見出しの
// 1 段下」の解釈が分かれ、**情報階層（§7.2）が画面ごとに違う**状態になる。
//
// ============================================================================
// 🔴 (g) の ②③ は本ファイルに書かない（`docs/05` §17.4）
// ============================================================================
// (g) は 3 つの検査の束である。②③ は **`@theme` の宣言**についての検査であり、
// `T-22-01` の `tests/static/design-tokens.test.ts` が既に持っている。
//
//   | (g) の項 | 内容 | どのファイルが見るか |
//   |---|---|---|
//   | ① | `text-{title,lg,body,cell,xs,micro}` 以外を使っていない | **本ファイル**（`apps/web/app/**`。`packages/ui` は `design-tokens.test.ts`） |
//   | ② | `@theme` に 6 トークンすべてが宣言されている（`--text-lg` = 16px / `--text-xs` = 12px の上書きが欠けると①だけでは緑になる） | `design-tokens.test.ts`「文字サイズが 6 トークンで、実寸と行間が §7.3 の表と一致する」 |
//   | ③ | `--text-sm` / `--text-base` / `--text-2xl` が宣言されていない（宣言すると使ってよい名前に見える） | `design-tokens.test.ts`「`@theme` に置いてはならないトークン…が無い」の `FORBIDDEN_TOKEN_PATTERNS` |
//
// 🔴 **②③ をここに写すと、`@theme` を変えたときに 2 箇所を直すことになり、片方だけ古くなる。**
//    許される名前の集合（`ALLOWED_TEXT_SIZES`）は `support/ui-classes.ts` の 1 箇所である。
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  ALLOWED_TEXT_SIZES,
  offScaleTextSizeValue,
  repoRoot,
} from './support/ui-classes.js';
import {
  describeRatchetInvariants,
  scanClassViolations,
  scanClassFixtures,
  violationLinesByFile,
} from './support/ui-ratchet.js';
import { UI_RATCHET_ALLOWLIST_G } from './support/ui-ratchet-allowlist.js';
import { UI_RATCHET_BASELINE_G } from './support/ui-ratchet-baseline.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');

const findings = scanClassViolations([APP_ROOT], offScaleTextSizeValue);
const actual = violationLinesByFile(findings);

describeRatchetInvariants({
  label: '(g) 文字サイズ 6 トークン',
  allowlist: UI_RATCHET_ALLOWLIST_G,
  baseline: UI_RATCHET_BASELINE_G,
  actual,
  scannedFileCount: 128,
});

describe('🔴 (g)① apps/web/app の文字サイズが §7.9 の 6 トークンだけである（許可リストの外）', () => {
  it('`text-{title,lg,body,cell,xs,micro}` 以外が 1 件も無い', () => {
    const violations = findings
      .filter((finding) => !UI_RATCHET_ALLOWLIST_G.has(finding.file))
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      violations,
      '🔴 §7.9 の 6 トークンは `text-title`（20px）/ `text-lg`（16px）/ `text-body`（14px）/ ' +
        '`text-cell`（13px）/ `text-xs`（12px）/ `text-micro`（11px）である。' +
        '`text-sm` は `text-body` へ、`text-xl` / `text-2xl` は `text-title` へ寄せる',
    ).toEqual([]);
  });

  it('走査が空振りしていない（移行中のファイルに現に違反が在る）', () => {
    expect(findings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (g) の検出器', () => {
  it('Tailwind 既定の段（6 トークンに無い名前）と任意値を拾う', () => {
    for (const token of ['text-sm', 'text-base', 'text-xl', 'text-2xl', 'text-3xl', 'text-[13px]', 'text-[0.8125rem]']) {
      expect(offScaleTextSizeValue(token), token).not.toBeNull();
    }
  });

  it('6 トークンは拾わない', () => {
    for (const token of ['text-title', 'text-lg', 'text-body', 'text-cell', 'text-xs', 'text-micro']) {
      expect(offScaleTextSizeValue(token), token).toBeNull();
    }
    expect([...ALLOWED_TEXT_SIZES].sort()).toEqual(['body', 'cell', 'lg', 'micro', 'title', 'xs']);
  });

  it('🔴 `text-` で始まる色・整列・装飾を拾わない（誤検知しない）', () => {
    for (const token of [
      'text-fg',
      'text-fg-muted',
      'text-slate-500',
      'text-left',
      'text-center',
      'text-right',
      'text-balance',
      'text-wrap',
      'text-nowrap',
      'text-ellipsis',
      'text-transparent',
      'text-[var(--color-fg)]',
    ]) {
      expect(offScaleTextSizeValue(token), token).toBeNull();
    }
  });

  it('バリアント接頭辞を剥がしてから照合する', () => {
    expect(offScaleTextSizeValue('lg:text-sm')).toBe('sm');
    expect(offScaleTextSizeValue('sm:text-body')).toBeNull();
  });
});

describe('対照: fixtures の合成ソースをファイルから走査する（ファイル収集 → AST → 検出器）', () => {
  const fixtures = scanClassFixtures(offScaleTextSizeValue);

  it('🔴 違反を仕込んだファイルで検出される（検査が「何も見ていない」状態で緑になっていない）', () => {
    expect([...fixtures.violationTokens].sort()).toEqual(['text-2xl', 'text-[13px]', 'text-sm']);
  });

  it('🔴 適合しているファイルでは 0 件である（誤検知しない。誤検知する検査はいずれ緩められる）', () => {
    expect(fixtures.cleanTokens).toEqual([]);
  });

  it('🔴 コメントの中に書いたクラス名を拾わない（規律を書き残した瞬間に落ちる検査にしない）', () => {
    // `violation.tsx` のコメントには同じ語が書いてある。拾っていたら件数が増える。
    expect(fixtures.violationTokens.length).toBe(3);
  });
});
