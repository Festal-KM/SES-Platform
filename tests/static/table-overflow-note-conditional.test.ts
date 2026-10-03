// tests/static/table-overflow-note-conditional.test.ts
// 🔴 **表の下の 1 行（「右端が切れているときは…」）が、切れ目の印と同じ条件でしか出ない。**
//
// ============================================================================
// 何が起きていたか（2026-10-03 の再監査）
// ============================================================================
// 切れ目の印（`overflow-indicator-x`）は **横に溢れているときだけ**出るのに、その下の注記は
// **どの幅でも出ていた**。印が正しく消えている幅で注記だけが残ると、**表が収まっていることを
// 疑わせる**（注記は「気づいた人が次に何をすればよいか」を伝えるためのものであり、
// 気づく必要が無いときに出す理由が無い）。
//
// ============================================================================
// なぜ静的検査か / 何を見るか
// ============================================================================
// 🔴 **判定は「スクロールできるかどうか」であり、画面幅でも列数でもない。** これは実ブラウザで
//    レイアウトしないと決まらないため、ユニットテストでは条件そのものを再現できない。
//    したがって**仕掛けが在ること**と、🔴 **壊れ方の向き**（未対応ブラウザで注記が
//    「消える」のではなく「常に出る」= 直す前と同じになること）を構造で固定する。
//
// 🔴 **向きが最も重要である。** `@container scroll-state()` のような「対応していれば出す」側の
//    実装にすると、未対応ブラウザでは**注記が永久に出ない**（＝ 横スクロールできることを
//    誰も知らされない）。`animation-timeline` は宣言が捨てられると**文書タイムラインで 1 回
//    走って `forwards` で止まる**ので、未対応ブラウザでは常に出る。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const CSS = readFileSync(path.join(repoRoot, 'apps', 'web', 'app', 'tailwind.css'), 'utf8');
const TABLE_TSX = readFileSync(path.join(repoRoot, 'packages', 'ui', 'src', 'components', 'table.tsx'), 'utf8');

/** `@utility <name> { … }` の中身を取り出す。 */
function utilityBody(name: string): string {
  const match = new RegExp(`@utility ${name} \\{([^}]*)\\}`).exec(CSS);
  expect(match, `@utility ${name} が tailwind.css に無い`).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

function keyframesBody(name: string): string {
  const start = CSS.indexOf(`@keyframes ${name} {`);
  expect(start, `@keyframes ${name} が無い`).toBeGreaterThanOrEqual(0);
  // ネストした `{ … }` を 1 段だけ数えて閉じ括弧を探す。
  let depth = 0;
  for (let i = CSS.indexOf('{', start); i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(CSS.indexOf('{', start) + 1, i);
    }
  }
  throw new Error(`@keyframes ${name} の終端が見つからない`);
}

describe('🔴 表の下の注記は、切れ目の印と同じ条件でしか出ない', () => {
  it('① 3 つの `@utility` が揃っている（器 / 走査域 / 注記）', () => {
    // 器がタイムラインを作り、その名を囲みが兄弟へ見せ、注記がそれに結び付く。
    expect(utilityBody('table-overflow-scroller')).toMatch(
      /scroll-timeline:\s*--ses-table-overflow-x\s+inline\s*;/,
    );
    expect(utilityBody('table-overflow-scope')).toMatch(/timeline-scope:\s*--ses-table-overflow-x\s*;/);
    expect(utilityBody('table-overflow-note')).toMatch(/animation-timeline:\s*--ses-table-overflow-x\s*;/);
  });

  it('🔴 ② 既定は畳まれている（印が消えている幅で注記だけ残らない）', () => {
    const note = utilityBody('table-overflow-note');
    expect(note).toMatch(/visibility:\s*hidden\s*;/);
    // 🔴 余白ごと畳む（`visibility` だけだと「表の下に意味不明な空白」が常に残る）。
    expect(note).toMatch(/max-height:\s*0\s*;/);
    expect(note).toMatch(/margin-top:\s*0\s*;/);
  });

  it('🔴 ③ 壊れ方の向き: `animation-timeline` 未対応では注記が「常に出る」（消えない）', () => {
    const note = utilityBody('table-overflow-note');
    // `forwards` が無いと、未対応ブラウザでアニメーション終了後に既定（畳んだ状態）へ戻る。
    expect(note, '🔴 `forwards` が無いと未対応ブラウザで注記が消える').toMatch(
      /animation:[^;]*\bforwards\b[^;]*;/,
    );
    const frames = keyframesBody('ses-table-overflow-note');
    expect(frames).toMatch(/visibility:\s*visible\s*;/);
    expect(frames).toMatch(/max-height:\s*10rem\s*;/);
    // 🔴 `height: auto` を書かない（補間できない値は実装差が出て「見えない」側に倒れうる）。
    expect(frames).not.toContain('auto');
    // 🔴 `from` と `to` が同じ 1 ブロック（進捗で見え方が変わると、スクロール位置で注記が点滅する）。
    expect(frames.replace(/\s+/g, ' ')).toMatch(/^ from, to \{/);
  });

  it('🔴 ④ `Table` が 3 クラスを実際に使っている（CSS だけ在って誰も使っていない状態にしない）', () => {
    expect(TABLE_TSX).toContain("TABLE_OVERFLOW_SCROLLER_CLASS = 'table-overflow-scroller'");
    expect(TABLE_TSX).toContain("TABLE_OVERFLOW_SCOPE_CLASS = 'table-overflow-scope'");
    expect(TABLE_TSX).toContain("TABLE_OVERFLOW_NOTE_CLASS = 'table-overflow-note'");
    // 器は常にタイムラインを作る（注記の有無で器の実装を 2 つにしない）。
    expect(TABLE_TSX).toMatch(/TABLE_OVERFLOW_INDICATOR_CLASS,\s*(?:\/\/[^\n]*\n\s*)*TABLE_OVERFLOW_SCROLLER_CLASS,/);
    // 注記は `TABLE_OVERFLOW_SCOPE_CLASS` の中にあり、注記自身がクラスを持つ。
    expect(TABLE_TSX).toMatch(/<div className=\{TABLE_OVERFLOW_SCOPE_CLASS\}>/);
    expect(TABLE_TSX).toMatch(/cn\('mb-0 text-xs text-fg-muted', TABLE_OVERFLOW_NOTE_CLASS\)/);
    // 🔴 `mt-1` を併記しない（生成 CSS で `.mt-1` が後ろに出るため、畳んでも 4px の帯が残る）。
    expect(TABLE_TSX).not.toMatch(/cn\('mt-1[^']*', TABLE_OVERFLOW_NOTE_CLASS\)/);
    // 🔴 機械検査の掴み（`data-table-overflow-note`）は従来どおり残す。
    expect(TABLE_TSX).toContain('data-table-overflow-note=""');
  });

  it('🔴 ⑤ 画面幅の境界で出し分けていない（幅は表の内容幅を知らない）', () => {
    for (const name of ['table-overflow-scope', 'table-overflow-scroller', 'table-overflow-note']) {
      expect(utilityBody(name)).not.toMatch(/@media|min-width|max-width/);
    }
  });
});
