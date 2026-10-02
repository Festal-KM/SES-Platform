// tests/static/ui-shadow-and-size.test.ts
// 🔴 **`docs/04` §7.9 改訂 23（2026-10-02）で名前が付いた「影 / 寸法 / 濃色」を、画面側が
//    直書きできないようにする**（改訂 23 の申し送り 22 ⑨(l) / 人間のブリーフの「作業 3-1」）。
//
// ============================================================================
// なぜ既存の検査では足りないのか
// ============================================================================
// 既存の 4 本はそれぞれ射程が決まっている。
//
//   | 既存の検査 | 射程 | 見るもの |
//   |---|---|---|
//   | `design-tokens.test.ts` | **`packages/ui/src/**` だけ** | 色 / spacing / 文字 / radius / 影 |
//   | `ui-color-tokens.test.ts` | `apps/web/app/**` | **色の直書きだけ** |
//   | `ui-spacing-scale.test.ts` | `apps/web/app/**` | **余白の段だけ** |
//   | `ui-type-scale.test.ts` | `apps/web/app/**` | **文字サイズだけ** |
//
// 🔴 **つまり `apps/web/app/**` 側には「影」と「寸法」の検査が 1 本も無かった。** 改訂 23 で
//    `--shadow-overlay` / `--shadow-control` / `--icon-*` / `--control-h-*` / `--row-h` /
//    `--border-w*` に名前が付いた以上、**名前の外の値を画面に書けないこと**を機械で止める。
//    これが無いと、`packages/ui/src/lib/overlay-classes.ts` の旧コメントが懸念していた
//    「`@theme` に宣言すると画面からも `shadow-overlay` と書けてしまう」がそのまま穴になる。
//
// ============================================================================
// 🔴 何を禁止するか（ブリーフの「作業 3-1」の列挙）
// ============================================================================
//   (a) **影の語**（`shadow-*`）… `packages/ui` の 2 箇所の外では 1 語も書けない。
//       🔴 `shadow-none`（打ち消し）も例外にしない —— 影を足す経路が無いなら打ち消しも要らない。
//   (b) **任意値の寸法**（`h-[32px]` / `size-[18px]` / `w-[200px]` / `text-[13px]` …）。
//       🔴 `max-h-[85vh]` のような**ビューポート基準の値は対象外**である（寸法の段の話ではなく
//       「画面に収める」ための制約であり、段を与える意味が無い。現に `packages/ui` の
//       `DIALOG_PANEL_CLASSES` が使っている）。
//   (c) **アイコン寸法の段外**（`size-6` 以上 / `size-3` 以下）。16px と 20px の 2 段だけである。
//   (d) **濃色サイドバーの色**（`*-sidebar-*`）… `Sidebar` 以外で使えない（濃色の面を増やさない）。
//   (e) **`text-metric`**（24px）… `KpiCard` 以外で使えない。
//
// 🔴 **許可リストは「いま在る違反」だけを列挙し、増やせない形にする**（既存のラチェットと同じ
//    思想。ただし 231 エントリの `ui-ratchet-allowlist.ts` には**足さない** —— あちらは
//    2026-09-30 に凍結した集合であり、`④ 部分集合である` の検査が新規追加を禁じている。
//    本検査は独立した 1 件なので、**このファイルの中に理由つきで持つ**）。
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classTokensOf,
  collectSourceFiles,
  readSource,
  repoRoot,
  toRepoRelative,
  utilityOf,
} from './support/ui-classes.js';
import { stageOf } from './support/ui-ratchet.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');

/** 🔴 影の語を書いてよい 2 箇所（`design-tokens.test.ts` の `SHADOW_ALLOWANCES` と同じ 2 ファイル）。 */
const SHADOW_OWNER_FILES = [
  'packages/ui/src/lib/control-classes.ts',
  'packages/ui/src/lib/overlay-classes.ts',
];

/**
 * 🔴 **画面に現に残っている直書き**（2026-10-02 の実測。**1 ファイル / 3 語だけ**）。
 *
 * | ファイル | 語 | いつ外すか |
 * |---|---|---|
 * | `projects/[id]/candidates/candidate-screen.tsx` | `shadow-xl` / `shadow-none` | `lg` で右パネルを `fixed` にしたときの浮き。**overlay に寄せれば `--shadow-overlay` の 1 段に収まる** |
 * | 同上 | `lg:min-w-[61.5rem]` | §S-016 の「8 列 + 右パネル」が成立する最小幅。🔴 **[Issue #83](https://github.com/Festal-KM/SES-Platform/issues/83) で設計側の判断待ち**（`docs/04` §7.1 と §S-016 が矛盾しており、1680px 以上でしか成立しない）。**判断が出たら段を与えて外す** |
 *
 * ⚠️ 🔴 **段は `SP-22` §4.1 の表のとおり「段②」である**（`T-22-07` が `S-016` を刷新した）。
 *    **つまりこれは段② の取りこぼしである** —— 当時 **影と任意寸法の検査が 1 本も無かった**ため、
 *    色・余白・文字サイズだけが掃除されて影と幅の任意値が残った。🔴 **`docs/05` §17.7 の (l) が
 *    無かったことがそのまま穴になっていた**という記録として、段を書き換えずに残す。
 *
 * 🔴 **増やせない。** 新しいファイルを足すには `docs/04` §7.9 の改訂（= 人間の判断）が要る
 *    （影を足したい要素が出てきたということは、**階層を border と背景の差で表せていない**という
 *    設計側の問題である。§7.9 の 🔴）。
 */
const DIRECT_WRITE_ALLOWLIST: ReadonlyMap<
  string,
  { readonly reason: string; readonly stage: 2 | 4 | 5; readonly utilities: readonly string[] }
> = new Map([
  [
    'apps/web/app/(main)/projects/[id]/candidates/candidate-screen.tsx',
    {
      reason:
        '`S-016` の候補パネルが `lg` で `fixed` になるときの浮きと、分割レイアウトの最小幅。' +
        '影は overlay（`--shadow-overlay`）か `PageBody` の `aside` に寄せて外す。最小幅は Issue #83 の判断待ち',
      stage: 2 as const,
      // 🔴 **バリアント接頭辞まで含めて固定する**（`shadow-xl` ではなく `lg:shadow-xl`）——
      //    接頭辞を落とすと「どの幅で影が出るのか」を許可が語らなくなり、`sm:shadow-xl` を
      //    足しても通ってしまう。
      utilities: ['lg:shadow-xl', 'xl:shadow-none', 'lg:min-w-[61.5rem]'],
    },
  ],
]);

/** その語がそのファイルで許されているか（🔴 **ファイル単位ではなく語単位**で固定する）。 */
function isAllowedDirectWrite(file: string, token: string): boolean {
  return DIRECT_WRITE_ALLOWLIST.get(file)?.utilities.includes(token) ?? false;
}

/** 🔴 アイコン寸法の 2 段（`packages/ui/src/icons.ts` の `ICON_SIZE_CLASSES` と一致させる）。 */
const ALLOWED_ICON_SIZES = new Set(['4', '5']);

/**
 * 🔴 **`size-*` のうち「アイコンではない正方形」**（2 件だけ）。
 *
 * | 場所 | 語 | 何の寸法か |
 * |---|---|---|
 * | `components/avatar.tsx` | `size-8` | **アバターの円**（32px = `--control-h-sm` と同じ段。上部バーの 1 段を押し広げない） |
 * | `components/sidebar.tsx` | `size-2` | **期限の点**（8px。アイコンではなく印であり、`--space-2` の段） |
 *
 * 🔴 **ファイル単位で許さず、語単位で固定する** —— `sidebar.tsx` を丸ごと除外すると、
 *    あのファイルに `size-6` が入っても気づけない。
 */
const NON_ICON_SQUARES: ReadonlyArray<readonly [file: string, utility: string]> = [
  ['packages/ui/src/components/avatar.tsx', 'size-8'],
  ['packages/ui/src/components/sidebar.tsx', 'size-2'],
];

function isNonIconSquare(file: string, utility: string): boolean {
  return NON_ICON_SQUARES.some(([allowedFile, allowedUtility]) => allowedFile === file && allowedUtility === utility);
}

/** `size-<n>` / `size-[…]`（アイコンの寸法。`size-full` 等は対象外）。 */
const SIZE_UTILITY = /^size-(\d+(?:\.\d+)?|\[[^\]]+\])$/;

/**
 * 任意値の寸法（`h-[32px]` / `w-[200px]` / `min-w-[10rem]` …）。
 * 🔴 **ビューポート基準（`vh` / `vw` / `dvh` / `svh` / `%`）は対象外**（ファイル冒頭の (b)）。
 */
const ARBITRARY_SIZE = /^(?:h|w|min-h|min-w|max-h|max-w|size|basis|gap|inset|top|right|bottom|left)-\[([^\]]+)\]$/;
const VIEWPORT_UNIT = /(?:vh|vw|dvh|dvw|svh|svw|lvh|lvw|%|calc\()/;

type Finding = { readonly file: string; readonly line: number; readonly token: string };

function scan(roots: readonly string[], extensions: readonly string[]): Finding[] {
  return roots.flatMap((root) =>
    collectSourceFiles(root, extensions).flatMap((absolute) => {
      const file = toRepoRelative(absolute);
      return classTokensOf(readSource(absolute), absolute).map(({ token, line }) => ({ file, line, token }));
    }),
  );
}

const appTokens = scan([APP_ROOT], ['.tsx']);
const uiTokens = scan([path.join(repoRoot, 'packages', 'ui', 'src')], ['.ts', '.tsx']);
const allTokens = [...appTokens, ...uiTokens];

describe('🔴 (l) 影は `packages/ui` の 2 箇所にしか無い（§7.9 改訂 23 で名前が 2 つに固定された）', () => {
  it('走査が空振りしていない（対照）', () => {
    expect(appTokens.length).toBeGreaterThan(1000);
    expect(uiTokens.length).toBeGreaterThan(500);
    // 影の語が現に `packages/ui` の 2 箇所に在る（検出器が働いていることの対照）。
    const owners = new Set(
      allTokens.filter((finding) => /^shadow(-|$)/.test(utilityOf(finding.token))).map((finding) => finding.file),
    );
    for (const owner of SHADOW_OWNER_FILES) expect([...owners]).toContain(owner);
    // 🔴 「アイコンではない正方形」の許可が実在する（未使用の許可が残らない）。
    for (const [file, utility] of NON_ICON_SQUARES) {
      expect(
        allTokens.some((finding) => finding.file === file && utilityOf(finding.token) === utility),
        `${file} に ${utility} が無い（許可だけが残っている）`,
      ).toBe(true);
    }
  });

  it('🔴 影の語が「2 箇所 + 許可リスト」の外に 1 件も無い', () => {
    const offenders = allTokens
      .filter((finding) => /^shadow(-|$)/.test(utilityOf(finding.token)))
      .filter((finding) => !SHADOW_OWNER_FILES.includes(finding.file))
      .filter((finding) => !isAllowedDirectWrite(finding.file, finding.token))
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      offenders,
      '🔴 影は **overlay（`shadow-overlay`）と入力欄の輪郭（`shadow-control`）の 2 箇所だけ**です' +
        '（`docs/04` §7.9）。**階層は border と background の差で表してください** —— ' +
        '影が多い画面は「どれが操作可能か」の手がかりを失います。' +
        '🔴 画面で面を作るなら `Card` / `KpiCard` / `RailCard` を使ってください' +
        '（面の実装は `packages/ui/src/lib/surface-classes.ts` の 1 箇所です）。',
    ).toEqual([]);
  });

  it('🔴 許可リストが「理由 + どの段で外すか」を持ち、`SP-22` §4.1 の段と一致する', () => {
    const broken = [...DIRECT_WRITE_ALLOWLIST].flatMap(([file, entry]) => {
      const row = stageOf(file);
      if (entry.reason.trim() === '') return [`${file}: 理由が空である`];
      if (row === null) return [`${file}: SP-22 §4.1 の表に無いディレクトリである`];
      return row.stage === entry.stage ? [] : [`${file}: 段が §4.1 と食い違う（${String(entry.stage)} ≠ ${String(row.stage)}）`];
    });
    expect(broken).toEqual([]);
  });

  it('🔴 許可リストに未使用の項目が無い（直したら外す。語単位で見る）', () => {
    const present = new Set(allTokens.map((finding) => `${finding.file} ${finding.token}`));
    const unused = [...DIRECT_WRITE_ALLOWLIST].flatMap(([file, entry]) =>
      entry.utilities.filter((utility) => !present.has(`${file} ${utility}`)).map((utility) => `${file} ${utility}`),
    );
    expect(
      unused,
      '🔴 直った語が許可リストに残っています（掃除の完了を機械で強制する。既存のラチェットの ② と同じ）。削除してください',
    ).toEqual([]);
  });
});

describe('🔴 (l) 寸法は名前のある 2 段だけである（任意の px を書かない）', () => {
  it('🔴 アイコンの寸法が 16px / 20px の 2 段だけである', () => {
    const offenders = allTokens
      .map((finding) => ({ finding, match: SIZE_UTILITY.exec(utilityOf(finding.token)) }))
      .filter(({ match }) => match !== null && !ALLOWED_ICON_SIZES.has(match[1] ?? ''))
      // 🔴 アイコンではない正方形（アバターの円 / 期限の点）は**語単位**で許す（上の 🔴）。
      .filter(({ finding }) => !isNonIconSquare(finding.file, utilityOf(finding.token)))
      .map(({ finding }) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      offenders,
      '🔴 アイコンは **16px（`size-4`）と 20px（`size-5`）の 2 段だけ**です' +
        '（`docs/04` §7.9 の `--icon-sm` / `--icon-md`。24px 以上は装飾になります。§7.5）。' +
        '🔴 画面で `size-*` を書かず、`<Icon name={…} size="sm" />` を使ってください' +
        '（段外は**型エラー**になります）。',
    ).toEqual([]);
  });

  it('🔴 任意値の寸法（`h-[32px]` / `w-[200px]`）が無い（ビューポート基準は対象外）', () => {
    const offenders = allTokens
      .map((finding) => ({ finding, match: ARBITRARY_SIZE.exec(utilityOf(finding.token)) }))
      .filter(({ match }) => match !== null && !VIEWPORT_UNIT.test(match[1] ?? ''))
      .filter(({ finding }) => !isAllowedDirectWrite(finding.file, finding.token))
      .map(({ finding }) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      offenders,
      '🔴 高さ・幅・余白は**名前のある段**で書いてください（`docs/04` §7.9 の寸法トークン / ' +
        '§7.9 の spacing 7 段）。高さは `packages/ui/src/lib/control-classes.ts` の ' +
        '`CONTROL_HEIGHT_CLASSES`（32px / 40px）、幅は `PageBody` の 3 クラスです。' +
        '⚠️ ビューポート基準（`max-h-[85vh]`）は対象外です（段の話ではありません）。',
    ).toEqual([]);
  });
});

describe('🔴 (j)(h) 濃色と 24px は「それを持つ部品」の外に出ない', () => {
  it('🔴 `*-sidebar-*` の色を書いているのは `Sidebar` だけである（濃色の面を増やさない）', () => {
    const offenders = allTokens
      .filter((finding) => /^[a-z-]+-sidebar-[a-z-]+$/.test(utilityOf(finding.token)))
      .filter((finding) => finding.file !== 'packages/ui/src/components/sidebar.tsx')
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      offenders,
      '🔴 濃色の面はサイドバー 1 部品だけです（`docs/04` §3.3: **色を平面の差にしない** / ' +
        '§7.9: 濃色の面を増やすには設計の改訂を要する）。🔴 **管理平面のナビを濃色にしない。**',
    ).toEqual([]);
  });

  it('🔴 `text-metric`（24px）を書いているのは `KpiCard` だけである', () => {
    const offenders = allTokens
      .filter((finding) => utilityOf(finding.token) === 'text-metric')
      .filter((finding) => finding.file !== 'packages/ui/src/components/kpi-card.tsx')
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      offenders,
      '🔴 `--text-metric`（24px）は **`KpiCard` の件数 1 箇所のみ**です（§7.3 / §7.9 改訂 23）。' +
        '見出し・本文・セル・バッジに使わないでください（「全画面を組む」のは 6 種のままです）。',
    ).toEqual([]);
  });

  it('🔴 画面（`apps/web/app/**`）が `packages/ui` の面のクラス定数を再実装していない', () => {
    // 🔴 `rounded-md border border-border bg-surface` を画面に書くと、**カードの面が 2 本目になる**
    //    （`packages/ui/src/lib/surface-classes.ts` 冒頭の 🔴）。`bg-surface` の出現で検出する ——
    //    面の地の名前であり、部品の外で使う理由が無い。
    const offenders = appTokens
      .filter((finding) => utilityOf(finding.token) === 'bg-surface')
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      offenders,
      '🔴 カード・パネルの面は `packages/ui` の部品（`Card` / `KpiCard` / `RailCard` / `Timeline` / ' +
        '`RankedList` / overlay 6 種）だけが持ちます。画面で面を作らないでください' +
        '（面が 5 箇所に分かれると、そのうち 1 つだけ radius が違う状態が必ず生まれます）。',
    ).toEqual([]);
  });

  it('対照: `packages/ui` 側には `bg-surface` が現に在る（検出器が働いている）', () => {
    const owners = new Set(
      uiTokens.filter((finding) => utilityOf(finding.token) === 'bg-surface').map((finding) => finding.file),
    );
    expect([...owners].sort()).toEqual([
      'packages/ui/src/lib/overlay-classes.ts',
      'packages/ui/src/lib/surface-classes.ts',
    ]);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (l) の検出器', () => {
  it('アイコン寸法の段を見分ける', () => {
    expect(SIZE_UTILITY.test('size-4')).toBe(true);
    expect(SIZE_UTILITY.test('size-6')).toBe(true);
    expect(SIZE_UTILITY.test('size-[18px]')).toBe(true);
    // 🔴 `size-full` / `size-fit` は寸法の段ではない（内容に合わせる構造の指定）。
    expect(SIZE_UTILITY.test('size-full')).toBe(false);
    expect(ALLOWED_ICON_SIZES.has('4')).toBe(true);
    expect(ALLOWED_ICON_SIZES.has('6')).toBe(false);
  });

  it('任意値の寸法を拾い、ビューポート基準は拾わない', () => {
    for (const token of ['h-[32px]', 'w-[200px]', 'min-w-[10rem]', 'gap-[3px]']) {
      const match = ARBITRARY_SIZE.exec(token);
      expect(match, token).not.toBeNull();
      expect(VIEWPORT_UNIT.test(match?.[1] ?? ''), token).toBe(false);
    }
    for (const token of ['max-h-[85vh]', 'w-[100%]', 'h-[calc(100dvh-4rem)]']) {
      const match = ARBITRARY_SIZE.exec(token);
      expect(match, token).not.toBeNull();
      expect(VIEWPORT_UNIT.test(match?.[1] ?? ''), token).toBe(true);
    }
  });

  it('濃色の色の語を見分ける（`bg-sidebar-bg` は拾い、`bg-bg-subtle` は拾わない）', () => {
    const isSidebarColor = (token: string): boolean => /^[a-z-]+-sidebar-[a-z-]+$/.test(utilityOf(token));
    expect(isSidebarColor('bg-sidebar-bg')).toBe(true);
    expect(isSidebarColor('hover:bg-sidebar-hover-bg')).toBe(true);
    expect(isSidebarColor('text-sidebar-selected-fg')).toBe(true);
    expect(isSidebarColor('bg-bg-subtle')).toBe(false);
    expect(isSidebarColor('app-sidebar')).toBe(false);
  });
});
