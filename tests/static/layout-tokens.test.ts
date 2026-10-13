// tests/static/layout-tokens.test.ts
// 🔴 **外枠の寸法を画面側で決め直していない**（`docs/design-system.md` §7）。
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// 人間のデザインシステム定義 v1.0 §4-1 は「Sidebar / Header / Content Padding / 2 カラム幅は
// **全画面で同一**。画面側で上書き禁止」と定めている。守られないときの壊れ方は、
// **サイドバーがホームでは 208px、人材管理では 220px、案件管理では 240px** という形であり、
// 🔴 **1 画面ずつ見ても気づけない**（画面を行き来して初めて「何かずれている」と分かる）。
//
// この検査は 2 つのことを見る。
//
//   ① **px とクラスが一致している** —— `SIDEBAR_WIDTH_PX = 208` と `SIDEBAR_WIDTH_CLASS = 'w-52'`
//      が食い違うと、レイアウトの算数（`pageBodySplitGeometry`）と実際の見た目がずれる。
//      Tailwind の spacing は 1 単位 = 4px なので、`w-52` → 208px は機械で確かめられる。
//   ② **同じ寸法のクラスが `layout-tokens.ts` の外に生えていない** —— 画面が `w-52` と直接書くと、
//      このファイルを変えても追随しない箇所が生まれる。
//
// 🔴 **例外（`EXPECTED_LITERAL_OWNERS`）は「変種付きのクラスは文字列リテラルで書くしかない」ため
//    に在る。** Tailwind の走査は `` `lg:${定数}` `` のような組み立てを候補として拾えず、
//    **CSS が生成されない**（テストは緑のまま見た目だけ壊れる）。したがってその 2 箇所だけは
//    リテラルで書き、**代わりにこの検査が値の一致を固定する。**
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  COLUMN_GAP_CLASS,
  COLUMN_GAP_PX,
  CONTENT_PADDING_LEFT_PX,
  CONTENT_PADDING_RIGHT_PX,
  CONTENT_PADDING_X_CLASSES,
  CONTENT_PADDING_Y_CLASS,
  CONTENT_PADDING_Y_PX,
  ENV_BANNER_HEIGHT_CLASS,
  ENV_BANNER_HEIGHT_PX,
  ENV_BANNER_HEIGHT_VAR,
  HEADER_HEIGHT_CLASS,
  HEADER_HEIGHT_PX,
  KPI_CARD_HEIGHT_CLASS,
  KPI_CARD_HEIGHT_PX,
  KPI_ICON_TILE_CLASSES,
  KPI_ICON_TILE_PX,
  RAIL_WIDTH_CLASS,
  RAIL_WIDTH_PX,
  ROW_HEIGHT_CLASS,
  ROW_HEIGHT_PX,
  SECTION_GAP_CLASS,
  SECTION_GAP_PX,
  SECTION_HEADER_HEIGHT_CLASS,
  SECTION_HEADER_HEIGHT_PX,
  SIDEBAR_NAV_ITEM_HEIGHT_CLASS,
  SIDEBAR_NAV_ITEM_HEIGHT_PX,
  SIDEBAR_RAIL_WIDTH_CLASS,
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_WIDTH_CLASS,
  SIDEBAR_WIDTH_PX,
  TAB_BAR_HEIGHT_CLASS,
  TAB_BAR_HEIGHT_PX,
} from '../../packages/ui/src/lib/layout-tokens.js';
import {
  collectSourceFiles,
  classTokensOf,
  readSource,
  repoRoot,
  toRepoRelative,
  utilityOf,
} from './support/ui-classes.js';

/** Tailwind の spacing は 1 単位 = 4px（`--spacing` の基底）。 */
function scaleToPx(utility: string): number {
  const match = /-(\d+(?:\.\d+)?)$/.exec(utility);
  expect(match, `${utility}: 既定スケールの数値が読めない`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]) * 4;
}

/** `[定数の名前, px, クラス]`。🔴 **ここが 1 本の表である。** */
const PAIRS: ReadonlyArray<readonly [name: string, px: number, utility: string]> = [
  ['SIDEBAR_WIDTH', SIDEBAR_WIDTH_PX, SIDEBAR_WIDTH_CLASS],
  ['SIDEBAR_RAIL_WIDTH', SIDEBAR_RAIL_WIDTH_PX, SIDEBAR_RAIL_WIDTH_CLASS],
  ['SIDEBAR_NAV_ITEM_HEIGHT', SIDEBAR_NAV_ITEM_HEIGHT_PX, SIDEBAR_NAV_ITEM_HEIGHT_CLASS],
  ['HEADER_HEIGHT', HEADER_HEIGHT_PX, HEADER_HEIGHT_CLASS],
  ['RAIL_WIDTH', RAIL_WIDTH_PX, RAIL_WIDTH_CLASS],
  ['COLUMN_GAP', COLUMN_GAP_PX, COLUMN_GAP_CLASS],
  ['SECTION_GAP', SECTION_GAP_PX, SECTION_GAP_CLASS],
  ['CONTENT_PADDING_Y', CONTENT_PADDING_Y_PX, CONTENT_PADDING_Y_CLASS],
  ['ROW_HEIGHT', ROW_HEIGHT_PX, ROW_HEIGHT_CLASS],
  ['SECTION_HEADER_HEIGHT', SECTION_HEADER_HEIGHT_PX, SECTION_HEADER_HEIGHT_CLASS],
  ['TAB_BAR_HEIGHT', TAB_BAR_HEIGHT_PX, TAB_BAR_HEIGHT_CLASS],
  ['KPI_CARD_HEIGHT', KPI_CARD_HEIGHT_PX, KPI_CARD_HEIGHT_CLASS],
  // 🔴 環境バナーの高さ（`md` 以上で固定。サイドバーが viewport から引く値）。
  ['ENV_BANNER_HEIGHT', ENV_BANNER_HEIGHT_PX, ENV_BANNER_HEIGHT_CLASS],
];

describe('🔴 レイアウトの寸法: px とクラスが一致している', () => {
  it('対照: 表が空でない（この検査が何も見ていない状態になっていない）', () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(PAIRS)('%s = %i px', (name, px, utility) => {
    expect(scaleToPx(utility), `${name}: ${utility} と ${String(px)}px が食い違う`).toBe(px);
  });

  it('本文の左右 gutter（左 28 / 右 16）', () => {
    const [left, right] = CONTENT_PADDING_X_CLASSES.split(' ');
    expect(scaleToPx(left as string)).toBe(CONTENT_PADDING_LEFT_PX);
    expect(scaleToPx(right as string)).toBe(CONTENT_PADDING_RIGHT_PX);
    // 🔴 左が右より広い（右には副カラムが来るので、右端の余白は副カラムの内側と二重に見える）。
    expect(CONTENT_PADDING_LEFT_PX).toBeGreaterThan(CONTENT_PADDING_RIGHT_PX);
  });

  it('KPI のアイコン面は正方形（48 × 48）', () => {
    const [height, width] = KPI_ICON_TILE_CLASSES.split(' ');
    expect(scaleToPx(height as string)).toBe(KPI_ICON_TILE_PX);
    expect(scaleToPx(width as string)).toBe(KPI_ICON_TILE_PX);
  });
});

/**
 * 🔴 寸法のクラスを**リテラルで書いてよい箇所**（上の 🔴 の理由）。
 *
 * | ファイル | 語 | なぜリテラルか |
 * |---|---|---|
 * | `components/sidebar.tsx` | `w-52` / `w-14` | `group-has-checked:` / `xl:` の変種付き |
 * | `components/page-body.tsx` | `w-97` | `lg:` の変種付き |
 */
const EXPECTED_LITERAL_OWNERS: ReadonlyMap<string, readonly string[]> = new Map([
  ['packages/ui/src/components/sidebar.tsx', ['w-52', 'w-14']],
  ['packages/ui/src/components/page-body.tsx', ['w-97']],
]);

/** 🔴 寸法そのもの（幅・高さ）を表す語。余白（`p-*` / `gap-*`）は §7.9 の 7 段が別に縛る。 */
const GUARDED = [
  'w-52',
  'w-14',
  'w-97',
  'h-14',
  'h-11.5',
  'min-h-11.25',
  'min-h-26.25',
  'min-h-10',
] as const;

describe('🔴 環境バナーの高さが、置く側と引く側で一致している', () => {
  const read = (rel: string): string => readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf8');

  it('🔴 バナー自身が `md` 以上で固定の高さを持つ（可変だと引く値が決まらない）', () => {
    const banner = read('packages/ui/src/components/environment-banner.tsx');
    expect(banner, 'バナーに `md:h-10` が無い').toContain(ENV_BANNER_HEIGHT_CLASS);
  });

  it('🔴 柱が引いているのは同じ変数である（名前が 1 文字でも違えば `0px` に落ちて黙って戻る）', () => {
    const sidebar = read('packages/ui/src/components/sidebar.tsx');
    // 🔴 **変種付きなので柱の側はリテラルで書くしかない**（Tailwind の走査）。だからこそ
    //    「同じ名前か」を機械で見る —— 名前が違っても `var()` の既定値 `0px` が効くので、
    //    **画面は壊れず、バナーのぶんだけ柱が長いという元の症状に黙って戻る**。
    expect(sidebar).toContain(`var(${ENV_BANNER_HEIGHT_VAR},0px)`);
    expect(sidebar).toContain(`calc(100dvh-var(${ENV_BANNER_HEIGHT_VAR},0px))`);
  });

  it('🔴 変数を置いているのはルートレイアウトの 1 箇所で、`production` では置かない', () => {
    const layout = read('apps/web/app/layout.tsx');
    expect(layout).toContain('ENV_BANNER_HEIGHT_VAR');
    // 🔴 `production` にはバナーが無いので、変数も置かない（既定の `0px` = 従来の `100dvh`）。
    expect(layout).toMatch(/env === 'production'\s*\?\s*undefined/);
  });

  it('対照: 変数名を直書きしている実装ファイルが 2 つだけである（出所は 1 定数）', () => {
    // 🔴 **コメントを落としてから見る。** 落とさないと「変数名を説明している 🔴 コメント」まで
    //    数えてしまい、**実装が 1 箇所増えても気づけない**（許可リストが説明文で埋まる）。
    const withoutComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const owners = [
      path.join(repoRoot, 'apps', 'web', 'app'),
      path.join(repoRoot, 'packages', 'ui', 'src'),
    ]
      .flatMap((root) => collectSourceFiles(root, ['.ts', '.tsx']))
      .filter((absolute) => withoutComments(readSource(absolute)).includes(ENV_BANNER_HEIGHT_VAR))
      .map((absolute) => toRepoRelative(absolute))
      .sort();
    // 🔴 定数の宣言と、**リテラルで書くしかない柱**の 2 つだけ（上の 🔴）。
    expect(owners).toEqual([
      'packages/ui/src/components/sidebar.tsx',
      'packages/ui/src/lib/layout-tokens.ts',
    ]);
  });
});

describe('🔴 レイアウトの寸法を `layout-tokens.ts` の外で書き直していない', () => {
  const roots = [
    path.join(repoRoot, 'apps', 'web', 'app'),
    path.join(repoRoot, 'packages', 'ui', 'src'),
  ];
  const tokensFile = path.join(repoRoot, 'packages', 'ui', 'src', 'lib', 'layout-tokens.ts');
  const findings = roots
    .flatMap((root) => collectSourceFiles(root, ['.ts', '.tsx']))
    .filter((absolute) => absolute !== tokensFile)
    .flatMap((absolute) => {
      const file = toRepoRelative(absolute);
      return classTokensOf(readSource(absolute), file)
        // 🔴 変種（`lg:` / `group-has-checked:`）を剥がしてから照合する。
        .filter((entry) => (GUARDED as readonly string[]).includes(utilityOf(entry.token)))
        .map((entry) => ({ file, token: utilityOf(entry.token), line: entry.line }));
    });

  it('対照: 走査が現にファイルを読んでいる（0 件で緑になっていない）', () => {
    // 🔴 `layout-tokens.ts` **自身**には全部の語が在る（それがこのファイルの役割である）。
    const own = classTokensOf(readFileSync(tokensFile, 'utf8'), 'layout-tokens.ts').map((entry) =>
      utilityOf(entry.token),
    );
    for (const token of GUARDED) {
      expect(own, `${token} が layout-tokens.ts に無い（表が実装とずれている）`).toContain(token);
    }
  });

  it('🔴 許された 2 ファイル以外に寸法のクラスが書かれていない', () => {
    const offenders = findings
      .filter((finding) => !(EXPECTED_LITERAL_OWNERS.get(finding.file) ?? []).includes(finding.token))
      .map((finding) => `${finding.file}:${String(finding.line)} ${finding.token}`);
    expect(
      offenders,
      '🔴 外枠の寸法は `packages/ui/src/lib/layout-tokens.ts` の 1 箇所で決めます' +
        '（`docs/design-system.md` §4）。画面側で `w-52` / `h-14` を書き直すと、' +
        '**サイドバーが画面ごとに 208 / 220 / 240px になる**という、1 画面ずつ見ても' +
        '気づけない壊れ方をします。定数を import してください。',
    ).toEqual([]);
  });

  it('🔴 許可は「現に在るから許している」（使われなくなった許可が残らない）', () => {
    for (const [file, tokens] of EXPECTED_LITERAL_OWNERS) {
      for (const token of tokens) {
        expect(
          findings.some((finding) => finding.file === file && finding.token === token),
          `${file} に ${token} が無い（許可が不要になったなら、この表から消す）`,
        ).toBe(true);
      }
    }
  });
});
