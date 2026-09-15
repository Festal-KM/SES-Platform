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

// ---------------------------------------------------------------------------
// 🔴 ラベル折り返し検出器（T-08-11。SP-21 §8.5 の申し送りの常設化）
// ---------------------------------------------------------------------------

/** 1 要素に対して成立した判定の種別。 */
export type BrokenLabelKind =
  | 'wrapped-short-label'
  | 'one-char-per-line'
  | 'clipped-x'
  | 'clipped-y'
  | 'unreachable-overflow';

export type BrokenLabelFinding = {
  readonly why: readonly BrokenLabelKind[];
  readonly tag: string;
  readonly testid: string | null;
  /** 表示用（先頭 40 文字）。判定に使った文字数は `chars`。 */
  readonly text: string;
  readonly chars: number;
  readonly width: number;
  readonly height: number;
  readonly lines: number;
  readonly charsPerLine: number;
};

export type BrokenLabelReport = {
  /** 走査したラベル要素の数（「空だったから 0 件」を見分けるために返す）。 */
  readonly scanned: number;
  readonly findings: readonly BrokenLabelFinding[];
};

/**
 * 🔴 **判定の閾値。** 「落ちたので上げた」を残さないため、変更するときは理由と計測値を
 *    ここに書く（SP-21 §5 / §6 の規律。`T-08-11` 受け入れ基準 3）。
 *
 * - `WRAPPED_MAX_CHARS = 24` / `WRAPPED_MIN_LINES = 3`: 24 文字以内のラベルが 3 行以上に
 *   割れているのは「行が足りない」のではなく「箱が足りない」（T-21-01 の実害は 6 行）。
 *   モバイル（393px）で 24 文字の和文ラベルは text-sm（14px）でも 1〜2 行で収まる。
 * - `ONE_CHAR_MAX_PER_LINE = 2` / `ONE_CHAR_MIN_LINES = 2`: 1 行あたり 2 文字以下は、和文が
 *   文字単位で改行できることを利用して**箱の幅まで縮んだ**状態そのもの（T-21-01 は 1 文字 / 行）。
 * - `CLIP_TOLERANCE_PX = 1`: `expectNoHorizontalOverflow` と同じ 1px（端数の丸め）。
 */
const WRAPPED_MAX_CHARS = 24;
const WRAPPED_MIN_LINES = 3;
const ONE_CHAR_MAX_PER_LINE = 2;
const ONE_CHAR_MIN_LINES = 2;
const CLIP_TOLERANCE_PX = 1;

/**
 * 🔴 ラベルの器（ボタン・リンク・見出しセル・ラベル・凡例・タブ）が、**読める・押せる形**で
 *    描画されていること（`CLAUDE.md` §13.3「押せない・読めないボタンは劣化ではなく遮断」）。
 *
 * ## なぜ「溢れ」ではなく「折り返し」を測るか（SP-21 §8.5）
 *
 * T-21-01 で見つかった **38px 幅・98px 高のボタン（ラベルが 1 文字ずつ 6 行）** は、
 * 最初から壊れていたのに E2E が通っていた（縦に伸びた当たり判定が Playwright のクリック位置の
 * ずれを吸収していた）。レビューが申し送った式
 *
 *     el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1
 *
 * は、この実害を**検出できない**。🔴 **和文は文字単位で改行できる**ため、ラベルは 1 文字ずつ
 * 折り返して箱の**中に収まり**（箱が縦に伸びる）、`scrollWidth == clientWidth` になる。
 * そこで本検出器は**折り返しそのもの**を測る。溢れの式は補助（clipped-x / clipped-y）として残す。
 *
 * ## 判定（1 要素につき複数成立しうる。いずれか 1 つでも FAIL）
 *
 * | 判定 | 式 | 捉えるもの |
 * |---|---|---|
 * | `wrapped-short-label` | 直下テキストの行数 >= 3 かつ 文字数 <= 24 | 短いラベルが箱の幅で折られている（T-21-01 の実害） |
 * | `one-char-per-line` | 行数 >= 2 かつ 文字数 / 行数 <= 2 | 1 文字ずつの改行（同上。箱が min-content まで縮んだ） |
 * | `clipped-x` | `scrollWidth > clientWidth + 1`（自身が `overflow-x: auto|scroll` の容器なら対象外） | 枠から横に溢れて切れている |
 * | `clipped-y` | `scrollHeight > clientHeight + 1`（自身が `overflow-y: auto|scroll` の容器なら対象外） | 固定高の箱から縦に溢れている（`h-8` / `h-10` の Button でラベルが箱を突き抜ける形） |
 * | `unreachable-overflow` | ビューポートの外に出ており、かつ `overflow-x: auto|scroll` の祖先を持たない | スクロールしても到達できない（切れて二度と読めない）。**全要素**が対象 |
 *
 * 行数は `Range.getClientRects()` の矩形を**縦方向の重なりで束ねて**数える（後述の「偽陽性 ③④」）。
 *
 * ## 初回計測（T-21-06）で出た偽陽性 4 件と、その解消（🔴 閾値は 1 つも動かしていない）
 *
 * T-08-11 で、素朴な版（「矩形数 = 行数」「1×1 の要素を除かない」）と本実装を**同じ DOM に
 * 当てて**（`.playwright/t0811/label.audit.ts`。T-21-06 と同じ巡回範囲 + `S-015`）偽陽性の
 * 実体を名指しで確認した。除外は**判定条件の明確化**でのみ行い、**要素を名指しで除外する
 * セレクタは 0 件**である。どの要素が・なぜ偽陽性だったか・どの条件で除かれるかを 1 件ずつ残す:
 *
 * ① `S-005` エンジニア台帳の `<legend class="sr-only">検索条件</legend>`
 *    （`apps/web/app/(main)/engineers/engineer-ledger-screen.tsx`）
 *    — 素朴な版では `clipped-x` + `clipped-y`（実測 1×1px、`scrollWidth` 64 / `clientWidth` 1、
 *    `scrollHeight` 26 / `clientHeight` 1）。`sr-only` は 1×1px + `overflow: hidden` で文字列を
 *    **隠すことが目的**なので、溢れているのが正しい。
 * ② `S-010` 案件一覧の `<legend class="sr-only">検索条件</legend>`
 *    （`apps/web/app/(main)/projects/project-list-screen.tsx`）— ①と同じ値・同じ理由。
 *    → ①② は **「読み上げ専用（1×1px かつ `overflow: hidden`）の要素は、見えないのが正しい」**
 *      という**幾何の条件**（`isScreenReaderOnly`）で除く。🔴 `sr-only` という**クラス名では
 *      見ない** —— クラス名の一致は「見えない」ことの証明にならず、逆に 1×1 に潰れた
 *      **見えるべき**ラベルを取り逃がす。**見えるべき画面の器が消えていないか**は各 spec の
 *      `toBeVisible()` が別に見る。
 * ③ `S-012` 案件の登録の `<legend>単価レンジ（月額・外部公開用）（円）</legend>`
 *    （`apps/web/app/(main)/projects/_form/project-form.tsx`。JSX は
 *    `{messages.unitPriceLabel}（{messages.unitPriceUnit}）`）
 *    — 素朴な版では `wrapped-short-label`（実測 235×20px、20 文字、**矩形 4 つ、`top` はすべて
 *    同じ値**）。JSX の補間は**隣接する 4 つのテキストノード**（`単価レンジ（月額・外部公開用）` /
 *    `（` / `円` / `）`）として描画され、`Range.getClientRects()` はテキストノードごとに矩形を
 *    返すため、**1 行でも矩形が 4 つ**になる。
 * ④ `S-007` エンジニアの登録の `<legend>単価レンジ（月額）（円）</legend>`
 *    （`apps/web/app/(main)/engineers/_form/engineer-form.tsx`。同じ JSX の形）
 *    — 実測 158×20px、12 文字、矩形 4 つ、`top` はすべて同じ値。③と同じ理由。
 *    → ③④ は **「矩形の数を行数として数えない」**で除く。矩形を `top` で並べ、**縦方向に重なる
 *      矩形は同じ行**として束ねる（矩形の中心が直前の行の下端より上なら同じ行。`countLines`）。
 *      同じ規則で、和文・全角括弧・英数の混在によるフォント切替で矩形が割れ `top` が 1〜2px
 *      ずれる場合も 1 行に入る（`Math.round(top)` の異なり数で数えると、このずれで行が増える）。
 *
 * ## 走査対象
 *
 * `button` / `a` / `th` / `label` / `legend` / `summary` / `[role=button]` / `[role=tab]` の
 * うち、表示されており（`display: none` / `visibility: hidden` でなく、面積を持つ）、
 * 文字列を持つもの。折り返しの判定は**直下のテキストノード**に対して行う（入れ子の要素の
 * 本文は、それ自身が走査対象なら別に判定される）。`td` / 見出し / 段落は本文が折り返してよい
 * ので対象にしない（T-21-06 と同じ集合。T-21-06 で 199 要素、T-08-11 の常設化時点で
 * 12 spec + `S-015` の 13 画面（S-008 は 3 状態）で 4 判定 0 件を確認済み）。
 *
 * ## 呼び出し元（T-08-11 時点）
 *
 * `home.mobile`（S-003 / S-004 / **S-015**）/ `settings.mobile`（S-036 / S-014 / S-005）/
 * `projects.mobile`（S-010 / S-011 ×2 / S-012 / S-013）/ `audit-k7.mobile`（S-008 ×3 状態）。
 * ⚠️ `S-016`〜`S-018`（`T-08-05` / `T-08-06` / `T-08-07` で新設予定。T-08-11 時点で未存在）は、
 *    画面が出来た時点で**その spec から本関数を呼ぶ**（本関数側の変更は不要）。
 */
export async function expectNoBrokenLabels(source: string, page: Page): Promise<void> {
  assertBrokenLabelReport(source, await collectBrokenLabelReport(page));
}

/**
 * 計測部。判定（`assertBrokenLabelReport`）と分けているのは、**計測器を 1 実装に保つ**ため
 * —— 使い捨ての巡回ハーネス（T-21-06 / T-08-11 の `.playwright/**`）も同じ計測を通し、
 * 「計測器だけ別物」で数字が食い違う状態を作らない。
 */
export async function collectBrokenLabelReport(page: Page): Promise<BrokenLabelReport> {
  return page.evaluate(
    ({ wrappedMaxChars, wrappedMinLines, oneCharMaxPerLine, oneCharMinLines, clipTolerancePx }) => {
      type Kind =
        | 'wrapped-short-label'
        | 'one-char-per-line'
        | 'clipped-x'
        | 'clipped-y'
        | 'unreachable-overflow';
      type Finding = {
        why: Kind[];
        tag: string;
        testid: string | null;
        text: string;
        chars: number;
        width: number;
        height: number;
        lines: number;
        charsPerLine: number;
      };

      const normalize = (value: string | null): string => (value ?? '').replace(/\s+/g, ' ').trim();
      const isScrollContainer = (value: string): boolean => value === 'auto' || value === 'scroll';
      /** 読み上げ専用（1×1px + `overflow: hidden`）。偽陽性 ①② の条件。 */
      const isScreenReaderOnly = (rect: DOMRect, cs: CSSStyleDeclaration): boolean =>
        rect.width <= 1 && rect.height <= 1 && cs.overflow === 'hidden';

      /**
       * 直下のテキストノードが何**行**に割れているか。
       * 🔴 矩形の数ではなく、縦方向に重なる矩形を束ねた数（偽陽性 ③④ の条件）。
       */
      const countLines = (el: HTMLElement): number => {
        const rects: DOMRect[] = [];
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType !== Node.TEXT_NODE || normalize(child.textContent) === '') continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          for (const rect of Array.from(range.getClientRects())) {
            // 折り返し位置で潰れた空白の矩形（幅 0）は行ではない。
            if (rect.width > 0 && rect.height > 0) rects.push(rect);
          }
        }
        rects.sort((a, b) => a.top - b.top);
        let lines = 0;
        let lineBottom = Number.NEGATIVE_INFINITY;
        for (const rect of rects) {
          const middle = (rect.top + rect.bottom) / 2;
          if (middle >= lineBottom) {
            lines += 1;
            lineBottom = rect.bottom;
          } else if (rect.bottom > lineBottom) {
            lineBottom = rect.bottom;
          }
        }
        return lines;
      };

      const ownText = (el: HTMLElement): string =>
        normalize(
          Array.from(el.childNodes)
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent ?? '')
            .join(''),
        );

      const describe = (el: HTMLElement, rect: DOMRect): Omit<Finding, 'why' | 'lines' | 'charsPerLine' | 'chars'> => ({
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid'),
        text: normalize(el.textContent).slice(0, 40),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });

      const findings: Finding[] = [];
      let scanned = 0;

      // ① ラベルの器。
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, a, th, label, legend, summary, [role="button"], [role="tab"]',
        ),
      );
      for (const el of candidates) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (isScreenReaderOnly(rect, cs)) continue;
        if (normalize(el.textContent) === '') continue;
        scanned += 1;

        const why: Kind[] = [];
        const label = ownText(el);
        const lines = label === '' ? 0 : countLines(el);
        const charsPerLine = lines > 0 ? label.length / lines : 0;
        if (lines >= wrappedMinLines && label.length <= wrappedMaxChars) why.push('wrapped-short-label');
        if (lines >= oneCharMinLines && charsPerLine <= oneCharMaxPerLine) why.push('one-char-per-line');
        if (!isScrollContainer(cs.overflowX) && el.scrollWidth > el.clientWidth + clipTolerancePx) {
          why.push('clipped-x');
        }
        if (!isScrollContainer(cs.overflowY) && el.scrollHeight > el.clientHeight + clipTolerancePx) {
          why.push('clipped-y');
        }
        if (why.length > 0) {
          findings.push({
            why,
            ...describe(el, rect),
            chars: label.length,
            lines,
            charsPerLine: Math.round(charsPerLine * 10) / 10,
          });
        }
      }

      // ② 到達不能なはみ出し（全要素）。`overflow-x: auto|scroll` の内側は Tier 3 の意図した
      //    劣化（横スクロール）なので除く。
      const viewportWidth = document.documentElement.clientWidth;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right <= viewportWidth + clipTolerancePx && rect.left >= -clipTolerancePx) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (isScreenReaderOnly(rect, cs)) continue;
        let reachable = false;
        for (let node = el.parentElement; node !== null; node = node.parentElement) {
          if (isScrollContainer(getComputedStyle(node).overflowX)) {
            reachable = true;
            break;
          }
        }
        if (reachable) continue;
        findings.push({
          why: ['unreachable-overflow'],
          ...describe(el, rect),
          chars: normalize(el.textContent).length,
          lines: 0,
          charsPerLine: 0,
        });
      }

      return { scanned, findings };
    },
    {
      wrappedMaxChars: WRAPPED_MAX_CHARS,
      wrappedMinLines: WRAPPED_MIN_LINES,
      oneCharMaxPerLine: ONE_CHAR_MAX_PER_LINE,
      oneCharMinLines: ONE_CHAR_MIN_LINES,
      clipTolerancePx: CLIP_TOLERANCE_PX,
    },
  );
}

/**
 * 判定部分。`expectNoBrokenLabels` から切り出しているのは、落ちたときのメッセージに
 * **どの要素が・どの判定で・何行に割れていたか**を残すため（`expectNoMarkers` と同じ思想）。
 */
export function assertBrokenLabelReport(source: string, report: BrokenLabelReport): void {
  const described = report.findings.map(
    (finding) =>
      `${finding.why.join(',')} <${finding.tag}${
        finding.testid === null ? '' : ` data-testid="${finding.testid}"`
      }> "${finding.text}" ${finding.width}x${finding.height}px lines=${finding.lines} chars=${finding.chars} chars/line=${finding.charsPerLine}`,
  );
  expect(
    described,
    `${source}: ラベルが読めない・押せない形で描画されています（折り返し / 溢れ / 到達不能。走査 ${report.scanned} 要素）`,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------
// 🔴 非本番環境バナー（T-10-05 / `F-028 AC-1`）
// ---------------------------------------------------------------------------

/**
 * 🔴 **`production` 以外の画面で環境バナーが視認でき、スクロールしても消えない**（`F-028 AC-1`）。
 *
 * E2E ハーネスは `APP_ENV=development` 固定なので、ここで確かめられるのは `development` の
 * 帯だけである（`demo` / `sandbox` / `staging` の文言と `production` で出ないことは
 * `apps/web/app/_components/environment-banner.render.test.tsx` /
 * `apps/web/app/layout.render.test.tsx` が固定する）。**呼び出し元は主平面・管理平面の
 * 両方、およびモバイル spec から呼ぶ**（片方だけ直る状態を作らない）。
 *
 * 手順:
 *   1. バナーが見えており、`expectedText`（`t('env.development')`）を含む
 *   2. ビューポートの高さを詰めてページを必ずスクロール可能にし、末尾までスクロールする
 *      （画面の高さに依存して「スクロールできなかったから消えなかった」を green にしない。
 *      `window.scrollY > 0` を対照として確かめる）
 *   3. スクロール後もバナーがビューポートの最上部（`y = 0`）に在り、見えている
 *   4. ビューポートは元の大きさに戻す（後続の検査を狭い画面で走らせない）
 */
export async function expectEnvironmentBannerPinned(
  source: string,
  page: Page,
  expectedText: string,
): Promise<void> {
  const banner = page.getByTestId('environment-banner');
  await expect(banner, `${source}: 環境バナーが表示されていません`).toBeVisible();
  await expect(banner, `${source}: 環境バナーの文言が違います`).toContainText(expectedText);

  const original = page.viewportSize();
  const width = original?.width ?? 1280;
  try {
    await page.setViewportSize({ width, height: 200 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY, `${source}: ページがスクロールできず、固定表示を検証できていません`).toBeGreaterThan(0);

    await expect(banner, `${source}: スクロール後に環境バナーが見えなくなりました`).toBeVisible();
    const box = await banner.boundingBox();
    expect(box, `${source}: スクロール後に環境バナーの矩形が取れません`).not.toBeNull();
    expect(
      Math.round(box?.y ?? Number.NaN),
      `${source}: スクロール後に環境バナーが最上部に固定されていません`,
    ).toBe(0);
    expect(
      Math.round(box?.height ?? 0),
      `${source}: 環境バナーの高さが 0 です（見えていない）`,
    ).toBeGreaterThan(0);
  } finally {
    if (original !== null) await page.setViewportSize(original);
  }
}
