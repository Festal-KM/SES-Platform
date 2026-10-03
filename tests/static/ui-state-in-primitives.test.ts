// tests/static/ui-state-in-primitives.test.ts
// 🔴 `docs/05` §17.7.1 **(j)**: **`docs/04` §7.10 の 8 状態を画面側で書かない。**
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// `docs/04` §7.10 の 🔴 が記録した着手前の状態は「**画面ごとに hover / focus の見え方が違い、
// 「押せるか」を毎回試すことになる**」である。8 状態（default / hover / active / focus-visible /
// disabled / loading / selected / error）は **プリミティブ単位**で定義されるものであり、
// 画面が `hover:bg-slate-100` を書いた時点で、その画面だけ別の押し心地になる。
//
// 🔴 **`focus-visible` のリングは全プリミティブで同一である**（`docs/04` §7.10 / `Q-04-6` 既定 ①）。
//    画面側に `focus-visible:ring-slate-400` が在ると、キーボード利用者から見た「いまどこに
//    いるか」の見え方が画面ごとに変わる —— これはアクセシビリティの後退である。
// 🔴 **「権限が無い」「代理閲覧中」を `disabled` で表さない**（`docs/04` `U-10`）。描画せず理由
//    テキストを置く。したがって画面側に `disabled:` が要る状況は原則として存在しない。
//
// 検査対象のバリアント（`docs/05` §17.7.1 (j)）:
//   `hover:` / `active:` / `focus:` / `focus-visible:` / `disabled:` / `data-[state=selected]:`
//   + `group-hover:` / `peer-focus:` 系（親・兄弟の状態に連動させる形も「画面が状態の見え方を
//     決めている」ことに変わりはない）
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  STATE_VARIANTS,
  classTokensOf,
  collectSourceFiles,
  readSource,
  repoRoot,
  stateVariantOf,
  variantsOf,
} from './support/ui-classes.js';
import {
  describeRatchetInvariants,
  scanClassViolations,
  scanClassFixtures,
  violationLinesByFile,
} from './support/ui-ratchet.js';
import { UI_RATCHET_ALLOWLIST_J } from './support/ui-ratchet-allowlist.js';
import { UI_RATCHET_BASELINE_J } from './support/ui-ratchet-baseline.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');

const findings = scanClassViolations([APP_ROOT], stateVariantOf);
const actual = violationLinesByFile(findings);

describeRatchetInvariants({
  label: '(j) 8 状態のバリアント',
  allowlist: UI_RATCHET_ALLOWLIST_J,
  baseline: UI_RATCHET_BASELINE_J,
  actual,
  scannedFileCount: 128,
});

describe('🔴 (j) apps/web/app に 8 状態のバリアントが無い（許可リストの外）', () => {
  it('`hover:` / `active:` / `focus:` / `focus-visible:` / `disabled:` / `data-[state=…]:` が 1 件も無い', () => {
    const violations = findings
      .filter((finding) => !UI_RATCHET_ALLOWLIST_J.has(finding.file))
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      violations,
      '🔴 8 状態は `packages/ui` のプリミティブが持つ（docs/04 §7.10 / `state-classes.ts`）。' +
        '画面側に書くと、その画面だけ押し心地と focus リングが違う状態になる。' +
        'リンクの下線は `link-classes.ts`、行の hover は `DataTable` が出す',
    ).toEqual([]);
  });

  // ============================================================================
  // 🔴 段⑤（`T-22-14`）で違反が 0 件になった。**ここが「空振り」に化けないようにする**
  // ============================================================================
  // 旧実装は対照として **「移行中のファイルに現に違反が在る」**（= 本番の走査が非空）を見て
  // いた。許可リストが空になった以上その条件は成立しないが、🔴 **代わりに何も見ないと、
  // 検出器が壊れて 0 件になったときも「違反 0 件」が自明に真**になる（`testid-freeze.test.ts`
  // の「抽出器が 0 件になれば削除が無いも自明に真になる」と同じ穴）。
  // そこで対照を **2 つに置き換えた**:
  //   ① **走査が現にファイルを読み、クラス名候補を取り出している**（件数の下限）。
  //   ② **検出器が合成ソース（`__fixtures__/ui-classes/`）では現に違反を拾う**
  //      （このファイル下部の「対照」ブロック。**0 件の根拠はそこに在る**）。
  it('🔴 違反が 0 件である（段⑤ で許可リストが空になり、本検査は無条件 green である）', () => {
    expect(findings).toEqual([]);
    expect(actual.size).toBe(0);
  });

  it('① 走査が現にファイルを読み、クラス名候補を取り出している（空振りの対照）', () => {
    const scanned = collectSourceFiles(APP_ROOT, ['.tsx']);
    expect(scanned.length).toBeGreaterThan(80);
    const tokens = scanned.flatMap((absolute) => classTokensOf(readSource(absolute), absolute));
    expect(tokens.length).toBeGreaterThan(1000);
    // 🔴 状態ではないバリアント（`sm:` / `odd:`）は現に使われている ——
    //    つまり「`:` を含む語を 1 つも拾えていない」わけではない。
    expect(tokens.some(({ token }) => token.startsWith('sm:'))).toBe(true);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (j) の検出器', () => {
  it('8 状態のバリアントを拾う', () => {
    for (const token of [
      'hover:underline',
      'hover:bg-slate-100',
      'active:bg-brand-active',
      'focus:outline-none',
      'focus-visible:ring-2',
      'focus-within:border-border-strong',
      'disabled:opacity-60',
      'data-[state=selected]:bg-brand-bg',
    ]) {
      expect(stateVariantOf(token), token).not.toBeNull();
    }
  });

  it('親・兄弟の状態に連動させる形も拾う（`group-hover:` / `peer-focus:`）', () => {
    expect(stateVariantOf('group-hover:text-brand')).toBe('group-hover');
    expect(stateVariantOf('peer-focus-visible:ring-2')).toBe('peer-focus-visible');
    expect(stateVariantOf('peer-disabled:text-fg-placeholder')).toBe('peer-disabled');
  });

  it('バリアントが複数あっても、状態のものを見つける', () => {
    expect(variantsOf('lg:hover:bg-bg-subtle')).toEqual(['lg', 'hover']);
    expect(stateVariantOf('lg:hover:bg-bg-subtle')).toBe('hover');
  });

  it('🔴 画面幅バリアント・構造バリアント・状態でない `data-*` を拾わない（誤検知しない）', () => {
    for (const token of [
      'sm:grid-cols-2',
      'md:hidden',
      'lg:table-cell',
      'xl:flex',
      '2xl:gap-8',
      'first:border-t-0',
      'last:pb-0',
      'odd:bg-bg-subtle',
      'print:hidden',
      'motion-reduce:transition-none',
      'data-[open]:block',
      'aria-expanded:rotate-180',
      'bg-bg',
      'text-body',
    ]) {
      expect(stateVariantOf(token), token).toBeNull();
    }
  });

  it('🔴 `hover` を含む語（クラス名の一部）をバリアントと誤認しない', () => {
    expect(stateVariantOf('bg-row-hover-bg')).toBeNull();
    expect(stateVariantOf('hover-card')).toBeNull();
    expect((STATE_VARIANTS as readonly string[]).includes('hover')).toBe(true);
  });
});

describe('対照: fixtures の合成ソースをファイルから走査する（ファイル収集 → AST → 検出器）', () => {
  const fixtures = scanClassFixtures(stateVariantOf);

  it('🔴 違反を仕込んだファイルで検出される（検査が「何も見ていない」状態で緑になっていない）', () => {
    expect([...fixtures.violationTokens].sort()).toEqual([
      'data-[state=selected]:bg-brand-bg',
      'disabled:opacity-60',
      'focus-visible:ring-2',
      'hover:underline',
    ]);
  });

  it('🔴 適合しているファイルでは 0 件である（誤検知しない。誤検知する検査はいずれ緩められる）', () => {
    expect(fixtures.cleanTokens).toEqual([]);
  });

  it('🔴 コメントの中に書いたクラス名を拾わない（規律を書き残した瞬間に落ちる検査にしない）', () => {
    // `violation.tsx` のコメントには同じ語が書いてある。拾っていたら件数が増える。
    expect(fixtures.violationTokens.length).toBe(4);
  });
});
