// tests/static/split-layout-width-regression.test.ts
// 🔴 **「幅を広げると表が見えなくなる」挙動が 1 つも無いこと**を、幅ごとの実測値で固定する。
//
// ============================================================================
// なぜこの検査が本タスクで最も重要な成果物なのか
// ============================================================================
// 2026-10-03 の朝、`S-010`（案件一覧）が **1280px で 9 列 1,313px のうち 44% しか見えない**問題を
// 「副カラムの並置を `2xl` まで遅らせる」で直した。🔴 **これは崖を 1280 から 1536 へ移しただけ
// だった。** 同日の再監査（実画面 67 枚）の実測:
//
// | 幅 | `/proposal-requests` の器 | 可視率 | 行高 | 折返セル | `/projects` の可視率 |
// |---:|---:|---:|---:|---:|---:|
// | 1512 | 1,238 | 100% | 42 | 0 | 94% |
// | **1536** | **758** | **88%** | **56** | **3** | **58%** |
// | 1600 | 822 | 95% | 56 | 3 | 63% |
// | 1680 | 902 | 100% | 42 | 0 | 69% |
//
// 🔴 **1536 は Windows ノートで最も多い論理幅**（1920×1080 の 125% 表示）で、1512（MacBook Pro
// 14/16 の既定）の**すぐ隣が最悪の幅**だった。🔴 **同じ修正が問題を別の幅へ移すのを止める唯一の
// 手段がこの検査である**（E2E は 1280 と 375 の 2 幅しか見ておらず、その間と外は誰も見ていない）。
//
// ============================================================================
// 何を見るか —— 「実クラスから取り出した数」で計算する
// ============================================================================
// 🔴 **寸法をこのファイルに書き写さない。** 書き写すと `HANDOFF.md` §6-13 の罠（テスト側に同じ
//    誤りを書けば緑になる）に落ちる。したがって:
//   ① `packages/ui/src/components/sidebar.tsx` の**実クラス**から柱の幅（`w-14` / `xl:w-56`）を取る
//   ② `packages/ui/src/components/page-body.tsx` の**実クラスと実定数**から
//      gutter（`px-6`）/ gap（`gap-6`）/ 主カラムの下限（`basis-330`）/ 副カラム（`max-w-120`）を取り、
//      **クラスと px 定数が一致していること**も併せて検査する（片方だけ変えられないようにする）
//   ③ flexbox の行分割の規則（`PAGE_BODY_SPLIT_*` と同じ算数）で幅ごとの主カラム幅を出す
//
// 表の中身の幅（min-content / max-content）だけは**ブラウザでしか測れない**ので実測値を置く。
// 🔴 その代わりに **「主カラムの下限 >= 最も広い表の幅」** を検査する —— ここが、列を増やした / 下限を
//    下げた / 副カラムを広げた、のいずれでも落ちる本体の歯止めである。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SIDEBAR_SOURCE = readFileSync(
  path.join(repoRoot, 'packages', 'ui', 'src', 'components', 'sidebar.tsx'),
  'utf8',
);
const PAGE_BODY_SOURCE = readFileSync(
  path.join(repoRoot, 'packages', 'ui', 'src', 'components', 'page-body.tsx'),
  'utf8',
);

/** Tailwind の spacing は既定の `0.25rem`（`HANDOFF.md` §3.5「spacing は宣言しない」）。 */
const SPACING_PX = 4;

/** `w-56` / `basis-330` / `max-w-120` → px。🔴 単位付き・任意値は受け取らない（既定スケールのみ）。 */
function scaleToPx(utility: string): number {
  const match = /-(\d+)$/.exec(utility);
  expect(match, `${utility}: 既定スケールの数値が読めない`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]) * SPACING_PX;
}

/** ソースから `export const NAME = '…'` / `= 123` を取り出す（**値を書き写さないため**）。 */
function constOf(source: string, name: string): string {
  const match = new RegExp(`export const ${name} = ([^;]+);`).exec(source);
  expect(match, `${name} が見つからない`).not.toBeNull();
  return (match as RegExpExecArray)[1].trim();
}

function stringConstOf(source: string, name: string): string {
  const raw = constOf(source, name);
  const match = /^'([^']*)'$/.exec(raw);
  expect(match, `${name} は単一の文字列リテラルでなければならない（実際: ${raw}）`).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

function numberConstOf(source: string, name: string): number {
  const raw = constOf(source, name);
  expect(raw, `${name} は数値リテラルでなければならない`).toMatch(/^\d+$/);
  return Number(raw);
}

// ============================================================================
// ① 外枠（柱）の幅 —— 実クラスから取る
// ============================================================================
const SIDEBAR_CLASS_LINE = /'(w-14 [^']*w-56[^']*)'/.exec(SIDEBAR_SOURCE);
const SIDEBAR_SHELL_CLASSES = /const SIDEBAR_SHELL_CLASSES = '([^']+)'/.exec(SIDEBAR_SOURCE);

/** 柱の幅（px）。`hidden … md:block` なので `md` 未満は 0（下端のタブに替わる）。 */
function sidebarWidthPx(viewportPx: number): number {
  expect(SIDEBAR_CLASS_LINE, '柱の幅クラス（`w-14 … xl:w-56`）が見つからない').not.toBeNull();
  expect(SIDEBAR_SHELL_CLASSES?.[1], '柱の器が `hidden … md:block` でなくなった').toContain('md:block');
  const classes = (SIDEBAR_CLASS_LINE as RegExpExecArray)[1].split(' ');
  const compact = classes.find((token) => /^w-\d+$/.test(token));
  const expanded = classes.find((token) => /^xl:w-\d+$/.test(token));
  expect(compact, '`w-<n>`（アイコンのみ）が無い').toBeDefined();
  expect(expanded, '`xl:w-<n>`（展開）が無い').toBeDefined();
  if (viewportPx < 768) return 0;
  if (viewportPx < 1280) return scaleToPx(compact as string);
  return scaleToPx(expanded as string);
}

// ============================================================================
// ② `PageBody` の寸法 —— 実クラスと実定数から取り、両者の一致も検査する
// ============================================================================
const GUTTER_CLASS = stringConstOf(PAGE_BODY_SOURCE, 'PAGE_BODY_GUTTER_CLASS');
const MAIN_MIN_CLASS = stringConstOf(PAGE_BODY_SOURCE, 'PAGE_BODY_SPLIT_MAIN_MIN_CLASS');
const MAIN_MIN_PX = numberConstOf(PAGE_BODY_SOURCE, 'PAGE_BODY_SPLIT_MAIN_MIN_PX');
const SPLIT_GAP_PX = numberConstOf(PAGE_BODY_SOURCE, 'PAGE_BODY_SPLIT_GAP_PX');
const ASIDE_WIDTH_PX = numberConstOf(PAGE_BODY_SOURCE, 'PAGE_BODY_ASIDE_WIDTH_PX');
const ASIDE_WRAP_CLASSES = stringConstOf(PAGE_BODY_SOURCE, 'PAGE_BODY_ASIDE_WIDTH_CLASSES_WRAP');
const SPLIT_ROW_WRAP_CLASSES = stringConstOf(PAGE_BODY_SOURCE, 'PAGE_BODY_SPLIT_ROW_CLASSES_WRAP');
const SPLIT_MAIN_WRAP_CLASSES = /export const PAGE_BODY_SPLIT_MAIN_CLASSES_WRAP = `([^`]+)`/.exec(
  PAGE_BODY_SOURCE,
);

/** 本体（`PageBody`）の内容ボックスの幅。= ビューポート − 柱 − gutter × 2。 */
function contentWidthPx(viewportPx: number): number {
  const gutter = scaleToPx(GUTTER_CLASS);
  return viewportPx - sidebarWidthPx(viewportPx) - gutter * 2;
}

/**
 * 🔴 **flexbox の行分割をそのまま写した算数**（`pageBodySplitGeometry` と同一）。
 *    並置は「主カラムの下限 + gap + 副カラム」が 1 行に収まるときだけ起きる。
 *
 * ⚠️ **受け取るのは本体（`PageBody`）の内容ボックスの幅**であり、ビューポートではない。
 *    🔴 分割レイアウトの責務はここまでである —— 柱の幅（`md` で 0 → 56px、`xl` で 56 → 224px）は
 *    `AppShell` / `Sidebar` が決めており、**`xl` での 168px の増分は利用者がトグルで戻せる**
 *    （`SIDEBAR_TOGGLE_ID`）。分割の検査にそれを混ぜると、**本件の崖（副カラムの並置）と
 *    柱の設計上の増分が同じ失敗として出てしまい、どちらを直すべきか読めなくなる。**
 */
function splitGeometryByContent(contentPx: number): { readonly beside: boolean; readonly mainPx: number } {
  const beside = contentPx >= MAIN_MIN_PX + SPLIT_GAP_PX + ASIDE_WIDTH_PX;
  return { beside, mainPx: beside ? contentPx - SPLIT_GAP_PX - ASIDE_WIDTH_PX : contentPx };
}

function splitGeometry(viewportPx: number): { readonly beside: boolean; readonly mainPx: number } {
  return splitGeometryByContent(contentWidthPx(viewportPx));
}

/**
 * 🔴 旧実装（`2xl:flex-row` + 副カラム 480px 固定）。**対照としてだけ残す。**
 * `2xl` = 1536px を内容ボックスの幅に写すと `contentWidthPx(1536)` になる。
 */
function legacyGeometryByContent(contentPx: number): { readonly beside: boolean; readonly mainPx: number } {
  const beside = contentPx >= contentWidthPx(1536);
  return { beside, mainPx: beside ? contentPx - SPLIT_GAP_PX - ASIDE_WIDTH_PX : contentPx };
}

/** 表の器は主カラムから左右の枠線 1px を引いた幅（`Table` の器が `w-full border`）。 */
const TABLE_BORDER_PX = 2;

/**
 * 🔴 **ブラウザでしか測れない値**（2026-10-03 のデモ環境の実測）。
 *
 * `contentPx` は**折り返さずに全列が並ぶ幅**（max-content）であり、器がこれ以上あれば
 * 可視率 100% / 行高 42px / 折返セル 0 になる。器がこれを下回ると可視率が落ち、
 * `whitespace="normal"` のセルが折り返して行高が 56px になる。
 */
const MEASURED_TABLES: readonly { readonly screen: string; readonly route: string; readonly contentPx: number }[] = [
  // 9 列。「650,000〜750,000 円」の「円」が切れていた画面。
  { screen: 'S-010', route: '/projects', contentPx: 1313 },
  // 実測の逆算: 758 / 0.88 = 861 / 822 / 0.95 = 865。
  { screen: 'S-017', route: '/proposal-requests', contentPx: 865 },
];

function visibleRatio(tablePx: number, containerPx: number): number {
  return Math.min(1, Math.max(0, containerPx) / tablePx);
}

/** 器が max-content を下回ると `whitespace="normal"` のセルが折り返す（行高 42 → 56）。 */
function rowHeightPx(tablePx: number, containerPx: number): number {
  return containerPx >= tablePx ? 42 : 56;
}

/**
 * 走査する**内容ボックスの幅**（🔴 **1px 刻み**。崖は 1px の隣に現れる）。
 * 320px（iPhone SE の内容幅）から 2,560px（27 インチの論理幅）まで。
 */
const SWEEP: readonly number[] = Array.from({ length: 2561 - 280 }, (_, index) => 280 + index);

/** 監査が実測した幅（上の表がそのまま基準値になる）。 */
const AUDITED: readonly number[] = [1280, 1512, 1536, 1600, 1680, 1920, 2096];

describe('🔴 分割レイアウト: 幅を広げると悪化する挙動が無い', () => {
  it('① クラスと px 定数が一致している（片方だけ変えられないようにする）', () => {
    expect(scaleToPx(MAIN_MIN_CLASS), `${MAIN_MIN_CLASS} と PAGE_BODY_SPLIT_MAIN_MIN_PX が食い違う`).toBe(
      MAIN_MIN_PX,
    );
    // gap は器の `gap-6`（`PageBody` の `cn('gap-6', …)`）。
    expect(scaleToPx('gap-6')).toBe(SPLIT_GAP_PX);
    expect(PAGE_BODY_SOURCE).toContain("'gap-6',");
    // 副カラムは `w-full max-w-<n>`（上限が並置時の固定幅そのものである）。
    const asideMax = ASIDE_WRAP_CLASSES.split(' ').find((token) => /^max-w-\d+$/.test(token));
    expect(asideMax, `${ASIDE_WRAP_CLASSES} に \`max-w-<n>\` が無い`).toBeDefined();
    expect(scaleToPx(asideMax as string)).toBe(ASIDE_WIDTH_PX);
    expect(ASIDE_WRAP_CLASSES.split(' ')).toContain('w-full');
  });

  it('② `main-min` の判定に画面幅の境界を 1 つも使っていない（`flex-wrap` だけ）', () => {
    expect(SPLIT_ROW_WRAP_CLASSES).toContain('flex-wrap');
    expect(SPLIT_ROW_WRAP_CLASSES).not.toMatch(/(?:sm|md|lg|xl|2xl):/);
    expect(SPLIT_ROW_WRAP_CLASSES).not.toContain('flex-col');
    expect(ASIDE_WRAP_CLASSES).not.toMatch(/(?:sm|md|lg|xl|2xl):/);
    expect(SPLIT_MAIN_WRAP_CLASSES, '主カラムのクラスがテンプレートリテラルで無くなった').not.toBeNull();
    const mainWrap = (SPLIT_MAIN_WRAP_CLASSES as RegExpExecArray)[1];
    expect(mainWrap).not.toMatch(/(?:sm|md|lg|xl|2xl):/);
    // 🔴 `min-w-0` が無いと、下段に落ちた主カラムが `basis` のまま横溢れする。
    expect(mainWrap).toContain('min-w-0');
    expect(mainWrap).toContain('grow');
    expect(mainWrap).toContain('${PAGE_BODY_SPLIT_MAIN_MIN_CLASS}');
  });

  it('🔴 ③ 主カラムの下限が、最も広い表の幅以上である（並置に入っても見える量が減らない）', () => {
    const widest = Math.max(...MEASURED_TABLES.map((table) => table.contentPx));
    expect(
      MAIN_MIN_PX - TABLE_BORDER_PX,
      `主カラムの下限 ${MAIN_MIN_PX}px が最も広い表 ${widest}px を下回る（並置に入った瞬間に列が隠れる）`,
    ).toBeGreaterThanOrEqual(widest);
  });

  /** 内容ボックスの幅を 1px ずつ広げたときに悪化する点を列挙する（④⑤⑦ が共有する）。 */
  function sweepRegressions(
    geometry: (contentPx: number) => { readonly mainPx: number },
    metric: (table: (typeof MEASURED_TABLES)[number], containerPx: number) => number,
    worse: 'lower' | 'higher',
  ): readonly string[] {
    const regressions: string[] = [];
    for (const table of MEASURED_TABLES) {
      let previous: number | null = null;
      for (const contentPx of SWEEP) {
        const value = metric(table, geometry(contentPx).mainPx - TABLE_BORDER_PX);
        if (previous !== null) {
          const degraded = worse === 'lower' ? value < previous - 1e-9 : value > previous + 1e-9;
          if (degraded) regressions.push(`${table.route} 内容幅 ${contentPx}px: ${previous} → ${value}`);
        }
        previous = value;
      }
    }
    return regressions;
  }

  it('🔴 ④ 内容幅を 1px 広げて可視率が下がる点が 1 つも無い（280〜2560px を全走査）', () => {
    expect(
      sweepRegressions(
        splitGeometryByContent,
        (table, container) => Math.round(visibleRatio(table.contentPx, container) * 100),
        'lower',
      ),
    ).toEqual([]);
  });

  it('🔴 ⑤ 内容幅を 1px 広げて行高が増える点が 1 つも無い（折り返しが戻らない）', () => {
    expect(
      sweepRegressions(splitGeometryByContent, (table, container) => rowHeightPx(table.contentPx, container), 'higher'),
    ).toEqual([]);
  });

  /**
   * 🔴 柱（`AppShell` / `Sidebar`）の幅は分割の責務ではないが、**`xl` で 56 → 224px に増える**ため
   *    ビューポートで見ると 1280px だけは内容幅が減る。🔴 **これを「気づかなかった」にしないため
   *    に明示的に記録する**（利用者はトグルで戻せる。設計上の増分であり、本件の崖とは別物）。
   */
  it('🔴 ⑤b 内容幅がビューポートに対して減る点は柱の 2 段（768 / 1280）だけである', () => {
    const drops: string[] = [];
    let previous: number | null = null;
    for (let viewport = 320; viewport <= 2560; viewport += 1) {
      const content = contentWidthPx(viewport);
      if (previous !== null && content < previous) drops.push(`${viewport}px`);
      previous = content;
    }
    expect(drops).toEqual(['768px', '1280px']);
  });

  it('🔴 ⑥ 監査が実測した 7 幅の基準値（器 / 並置 / 可視率 / 行高）', () => {
    const rows = AUDITED.map((viewport) => {
      const geometry = splitGeometry(viewport);
      const container = geometry.mainPx - TABLE_BORDER_PX;
      const cells = MEASURED_TABLES.map((table) => {
        const ratio = Math.round(visibleRatio(table.contentPx, container) * 100);
        return `${table.screen}=${ratio}%/${rowHeightPx(table.contentPx, container)}px`;
      });
      return `${viewport}: 器${container} ${geometry.beside ? '並置' : '下段'} ${cells.join(' ')}`;
    });
    expect(rows).toEqual([
      '1280: 器1006 下段 S-010=77%/56px S-017=100%/42px',
      '1512: 器1238 下段 S-010=94%/56px S-017=100%/42px',
      '1536: 器1262 下段 S-010=96%/56px S-017=100%/42px',
      '1600: 器1326 下段 S-010=100%/42px S-017=100%/42px',
      '1680: 器1406 下段 S-010=100%/42px S-017=100%/42px',
      '1920: 器1646 下段 S-010=100%/42px S-017=100%/42px',
      '2096: 器1318 並置 S-010=100%/42px S-017=100%/42px',
    ]);
  });

  it('🔴 ⑦ 対照: 旧実装（`2xl:flex-row`）はこの検査で落ちる（検出器が空振りしていない）', () => {
    // 🔴 再監査の実測（1536 で 88% / 58%、行高 56、折返 3 セル）をこの算数が再現すること。
    const legacy = [1512, 1536, 1600, 1680].map((viewport) => {
      const container = legacyGeometryByContent(contentWidthPx(viewport)).mainPx - TABLE_BORDER_PX;
      const cells = MEASURED_TABLES.map(
        (table) =>
          `${table.screen}=${Math.round(visibleRatio(table.contentPx, container) * 100)}%/${rowHeightPx(table.contentPx, container)}px`,
      );
      return `${viewport}: 器${container} ${cells.join(' ')}`;
    });
    expect(legacy).toEqual([
      '1512: 器1238 S-010=94%/56px S-017=100%/42px',
      '1536: 器758 S-010=58%/56px S-017=88%/56px',
      '1600: 器822 S-010=63%/56px S-017=95%/56px',
      '1680: 器902 S-010=69%/56px S-017=100%/42px',
    ]);

    // 🔴 そして旧実装では ④ / ⑤ がどちらも落ちる（= ④⑤ は無条件に緑ではない）。
    const cliff = contentWidthPx(1536);
    expect(
      sweepRegressions(
        legacyGeometryByContent,
        (table, container) => Math.round(visibleRatio(table.contentPx, container) * 100),
        'lower',
      ).map((line) => line.split(':')[0]),
    ).toEqual([`/projects 内容幅 ${cliff}px`, `/proposal-requests 内容幅 ${cliff}px`]);
    expect(
      sweepRegressions(
        legacyGeometryByContent,
        (table, container) => rowHeightPx(table.contentPx, container),
        'higher',
      ).map((line) => line.split(':')[0]),
    ).toEqual([`/proposal-requests 内容幅 ${cliff}px`]);
  });

  it('🔴 ⑧ `main-min` を使う画面が実在し、旧実装の語が 1 つも残っていない', () => {
    const screens = [
      'apps/web/app/(main)/projects/(list)/page.tsx',
      'apps/web/app/(main)/proposal-requests/proposal-request-screen.tsx',
      'apps/web/app/(main)/proposals/send-failures/send-failure-screen.tsx',
    ];
    for (const relative of screens) {
      const source = readFileSync(path.join(repoRoot, relative), 'utf8');
      expect(
        /asideFrom="main-min"|PAGE_BODY_SPLIT_ROW_CLASSES_WRAP/.test(source),
        `${relative} が main-min を使っていない`,
      ).toBe(true);
      // 🔴 旧実装の語が `className` / import に 1 つも残っていない（「片方だけ直った」を作らない）。
      //    ⚠️ 説明文（コメント）には旧実装の名が残る —— **なぜ捨てたかの記録である**。
      expect(source).not.toMatch(/className=[^\n]*2xl:flex-row/);
      expect(source).not.toMatch(/^\s*PAGE_BODY_ASIDE_WIDTH_CLASSES_FROM_2XL,$/m);
      expect(source).not.toMatch(/\{PAGE_BODY_ASIDE_WIDTH_CLASSES_FROM_2XL\}/);
    }
  });
});
