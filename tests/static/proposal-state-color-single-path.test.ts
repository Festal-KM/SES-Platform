// tests/static/proposal-state-color-single-path.test.ts
// 🔴 **`Proposal` の状態 → 色の写像が `@ses/ui` の 1 箇所にしか無い**
//    （`docs/04` §5-1 / §5-13 / §7.4 / `CLAUDE.md` §4.2 / `BR-23`）。SP-22 段④。2026-10-03。
//
// ============================================================================
// なぜこの検査が要るのか（**実測で 2 度同じ壊れ方をした**）
// ============================================================================
// `docs/04` §5-13 は 🔴 **「状態名から表示を導出し、画面側で色を指定させない。1 箇所でしか色が
// 決まらないことが、§7.4 の意味の対応を守る唯一の方法である」** と定めている。着手前の実装は
// `BadgeVariant` への写像を**画面ごとに 12 箇所**持っており、段④ でそれを `StatusBadge`
// （`packages/ui/src/components/badge.tsx` の `STATUS_BADGE_APPEARANCES`）へ寄せた。
//
// 🔴 **寄せただけでは戻ってくる。** 段④ の第 3 弾（`21b962a`）で `S-019` / `S-023` / `S-024` を
//    寄せたあとも、**`S-006`（エンジニア詳細の提案履歴）に同じ写像が生き残っていた**
//    （`TONE_VARIANTS` + `lib/proposals/list-rows.ts` の `proposalStateTone`）。
//    その結果、同じ `Proposal` の状態が画面によって違う色で描かれていた。
//
// 🔴 **放置したときの実害は「色が揃わない」ことではない。意味が逆になる。** 実測:
//
//   | 状態 | 残っていた写像 | §5-1 の表 | なぜ重いか |
//   |---|---|---|---|
//   | `GATE_FAILED` | **`danger`（赤）** | **`warning`（橙 / 塗り）** | §5-1 の 🔴「**赤は `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` の 3 つだけ**」に反する。ゲート差し戻しは外部に何も起きておらず「直せば進む」もの（`CLAUDE.md` §4.2「失敗と保留を混同しない」/ `BR-23`）。**赤にすると品質管理を強めるほど画面が赤くなる**という逆の動機が生まれる |
//   | `APPROVED` / `SUBMITTED` | **どちらも `success`（緑）** | `brand`（枠線）/ `success`（枠線） | 「**送る前**」と「**届いた後**」が同じ見た目になる。`CLAUDE.md` §7 の「提案メールの二重送信 0 件」を人間が目で確かめる手がかりが消える |
//
// ============================================================================
// 🔴 検査の形（**名前に依存する検査と、名前に依存しない検査の 2 本立て**）
// ============================================================================
//   ① **構造**（名前に依存しない）: `Proposal` の状態名を鍵に持つオブジェクトリテラルが、
//      バッジの語彙（`BadgeVariant` / `BadgeShape` / 旧 `tone` の 5 語）を値に持っていたら違反。
//      🔴 **変数名を変えても逃げられない**（`TONE_VARIANTS` を `STATE_COLORS` に改名しても捕まる）。
//   ② **名前**（既に消した識別子の復活を止める）: `ProposalStateTone` / `proposalStateTone` /
//      `STATE_TONES` / `TONE_VARIANTS` が `apps/**` と `packages/**` に 1 つも無い。
//      🔴 ①だけでは**間接化**（状態 → `tone` → 色の 2 段）をすり抜けられる —— 1 段目は値が
//      バッジの語彙でないため構造検査に当たらない。②がその経路を名指しで塞ぐ。
//
// 🔴 **唯一の出所（`packages/ui/src/components/badge.tsx`）だけを除外する。** 除外を画面ごとに
//    増やさない（増やせる形にした時点で「1 箇所」ではなくなる）。
// 🔴 **色の値（クラス名・階調）をこのファイルに書き写さない。** 見るのは「写像がどこに在るか」
//    だけであり、`STATUS_BADGE_APPEARANCES` の中身の正しさは
//    `apps/web/app/_components/ui-display.render.test.tsx` が `@ses/domain` の定数と突き合わせる。
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_STATES } from '../../packages/domain/src/index.js';
import { collectSourceFiles, readSource, repoRoot, toRepoRelative } from './support/ui-classes.js';

/** 走査対象（出荷される実装）。🔴 `*.test.ts(x)` は `collectSourceFiles` が除く。 */
const SCAN_ROOTS = [path.join(repoRoot, 'apps'), path.join(repoRoot, 'packages')];

/** 🔴 **唯一の出所**。`STATUS_BADGE_APPEARANCES`（§5-1 の 36 状態の表）がここに在る。 */
const SINGLE_SOURCE = 'packages/ui/src/components/badge.tsx';

/**
 * バッジの語彙。🔴 **`BadgeVariant` / `BadgeShape` の実値**（`packages/ui` の `badge.tsx`）に、
 * 旧 `ProposalStateTone` の 5 語のうち `BadgeVariant` に無い `progress` を足したもの。
 * ⚠️ ここは「色の割り当て」ではなく「**色を名乗る語の一覧**」である（割り当ては `badge.tsx`）。
 */
const BADGE_VOCABULARY: ReadonlySet<string> = new Set([
  'neutral',
  'brand',
  'info',
  'success',
  'warning',
  'danger',
  'outline',
  'solid',
  'dashed',
  'progress',
]);

/** 🔴 復活を止める識別子（段④ で削除済み）。 */
const FORBIDDEN_IDENTIFIERS: readonly string[] = ['ProposalStateTone', 'proposalStateTone', 'STATE_TONES', 'TONE_VARIANTS'];

const PROPOSAL_STATE_NAMES: ReadonlySet<string> = new Set<string>(PROPOSAL_STATES);

/**
 * 🔴 判定は「**鍵の全部が `Proposal` の状態名**で、かつ 2 つ以上」である。
 *
 * ⚠️ **なぜ「全部」か**: 鍵に状態名以外が混じるものは、定義上**状態機械の写像ではない**。
 *    実例として `S-003` の要対応キューの**種別**バッジ（`action-queue-section.tsx` の
 *    `KIND_VARIANTS`）は `SEND_FAILED` / `SEND_HELD` / `PROPOSAL_REQUEST_PENDING` を含み、
 *    `docs/04` §S-003 表 1 の「種別 7 つ」という**別の軸**である（同じ画面の `状態` 列は
 *    `StatusBadge entity="proposal"` を通っている）。ここを拾うと、検査が「正当な別の軸」を
 *    禁じることになり、許可リストで緩める方向に倒れる。
 * ⚠️ **なぜ「2 つ以上」か**: 1 つだけなら `{ DRAFT: … }` のような同名の別物を拾いうる。
 * 🔴 部分写像（`{ GATE_FAILED: 'danger', APPROVED: 'success' }` の 2 件だけ）は**捕まる** ——
 *    「一部の状態だけ画面で色を上書きする」が最も起きやすい戻り方である。
 */
const STATE_KEY_THRESHOLD = 2;

export type Finding = { readonly file: string; readonly line: number; readonly detail: string };

function propertyName(member: ts.ObjectLiteralElementLike, source: ts.SourceFile): string | null {
  const name = member.name;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText(source);
}

/** そのリテラル（入れ子を含む）に、バッジの語彙の文字列リテラルが在るか。 */
function mentionsBadgeVocabulary(node: ts.ObjectLiteralExpression): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (ts.isStringLiteralLike(current) && BADGE_VOCABULARY.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/**
 * ① 構造の検出器: **鍵の全部が `Proposal` の状態名（2 件以上）で、バッジの語彙を値に持つ**
 *    オブジェクトリテラル。
 * 🔴 export されているか / 変数名が何か / `satisfies` が付いているかを見ない（名前で逃げられない形）。
 */
export function stateColorMaps(source: ts.SourceFile): readonly { readonly line: number; readonly keys: number }[] {
  const hits: { line: number; keys: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map((member) => propertyName(member, source));
      const allStates = names.length > 0 && names.every((name) => name !== null && PROPOSAL_STATE_NAMES.has(name));
      if (allStates && names.length >= STATE_KEY_THRESHOLD && mentionsBadgeVocabulary(node)) {
        hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, keys: names.length });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** ② 名前の検出器: 削除済みの識別子の出現（コメントは拾わない —— 識別子トークンだけを見る）。 */
export function forbiddenIdentifierHits(source: ts.SourceFile): readonly { readonly line: number; readonly name: string }[] {
  const hits: { line: number; name: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.includes(node.text)) {
      hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, name: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function parse(absolute: string): ts.SourceFile {
  return ts.createSourceFile(absolute, readSource(absolute), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const scanned = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root, ['.ts', '.tsx']));

const structuralFindings: Finding[] = scanned.flatMap((absolute) => {
  const file = toRepoRelative(absolute);
  if (file === SINGLE_SOURCE) return [];
  return stateColorMaps(parse(absolute)).map((hit) => ({
    file,
    line: hit.line,
    detail: `Proposal の状態 ${hit.keys} 件を鍵に持つオブジェクトが、バッジの語彙を値に持っている`,
  }));
});

const identifierFindings: Finding[] = scanned.flatMap((absolute) =>
  forbiddenIdentifierHits(parse(absolute)).map((hit) => ({
    file: toRepoRelative(absolute),
    line: hit.line,
    detail: `削除済みの識別子 \`${hit.name}\` が復活している`,
  })),
);

describe('🔴 Proposal の状態 → 色の写像は packages/ui の 1 箇所だけ（docs/04 §5-13）', () => {
  it('走査が空振りしていない（実装ソースを現に読めている）', () => {
    expect(scanned.length).toBeGreaterThan(300);
    expect(scanned.map(toRepoRelative)).toContain(SINGLE_SOURCE);
    // 🔴 `*.test.ts(x)` は走査に入っていない（テストはフィクスチャで状態名と色の語を並べる）。
    expect(scanned.map(toRepoRelative).some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
  });

  it('🔴 ① `Proposal` の状態名から色を決めているオブジェクトが、唯一の出所の外に無い', () => {
    expect(
      structuralFindings.map((finding) => `${finding.file}:${String(finding.line)} — ${finding.detail}`),
      '🔴 docs/04 §5-13: 状態名から表示を導出し、画面側で色を指定させない。' +
        `色と形状は ${SINGLE_SOURCE} の STATUS_BADGE_APPEARANCES だけが決め、` +
        '呼び出し側は `<StatusBadge entity="proposal" state={…} label={…} />` で語だけを渡す。\n' +
        '🔴 2 度目の再発である（段④ 第 3 弾で S-019 / S-023 / S-024 を寄せた後も S-006 に残っていた）。' +
        'GATE_FAILED を赤にすると §5-1 の「赤は SUBMIT_FAILED / SEND_FAILED / SUSPENDED の 3 つだけ」に反する。',
    ).toEqual([]);
  });

  it('🔴 ② 削除済みの識別子（`proposalStateTone` ほか）が復活していない', () => {
    expect(
      identifierFindings.map((finding) => `${finding.file}:${String(finding.line)} — ${finding.detail}`),
      `🔴 ${FORBIDDEN_IDENTIFIERS.join(' / ')} は SP-22 段④ で削除した。` +
        '状態 → tone → 色の 2 段の間接化は、1 段目が色の語を持たないため ① の構造検査をすり抜ける。' +
        '行の型は `state`（名前）と `stateLabel`（語）だけを持つこと。',
    ).toEqual([]);
  });

  it('🔴 唯一の出所に `Proposal` の 14 状態の表が実在する（検査が「誰も色を決めていない」で緑になっていない）', () => {
    const source = parse(path.join(repoRoot, SINGLE_SOURCE));
    const maps = stateColorMaps(source);
    expect(maps.length).toBeGreaterThan(0);
    // 🔴 14 状態すべてが鍵に在る（1 つでも欠けると `StatusBadge` が実行時に throw する側の担保）。
    expect(Math.max(...maps.map((hit) => hit.keys))).toBe(PROPOSAL_STATES.length);
  });

  it('🔴 提案の状態を描く画面は `StatusBadge entity="proposal"` を通る（写像を消しただけで描画が消えていない）', () => {
    const users = scanned
      .filter((absolute) => toRepoRelative(absolute).startsWith('apps/web/app/'))
      .filter((absolute) => readSource(absolute).includes('entity="proposal"'))
      .map(toRepoRelative);
    // 🔴 **画面の数を期待値に書かない**（画面の増減でここを直すことになる。`docs/04` が数を持つ）。
    //    見るのは「提案まわりと人材詳細の両方が通っている」こと —— S-006 が抜けていたのが今回の実害である。
    expect(users.some((file) => file.startsWith('apps/web/app/(main)/proposals/'))).toBe(true);
    expect(users).toContain('apps/web/app/(main)/engineers/[id]/engineer-proposal-sections.tsx');
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: 状態 → 色の写像の検出器', () => {
  const parseText = (text: string): ts.SourceFile =>
    ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('🔴 状態名 → `BadgeVariant` の写像を拾う（変数名に依存しない）', () => {
    const named = parseText("const TONE_VARIANTS = { GATE_FAILED: 'danger', APPROVED: 'success' } as const;");
    const renamed = parseText("const whateverElse = { GATE_FAILED: 'danger', APPROVED: 'success' };");
    expect(stateColorMaps(named)).toHaveLength(1);
    expect(stateColorMaps(renamed)).toHaveLength(1);
  });

  it('🔴 入れ子（`{ variant, shape }` の形）も拾う', () => {
    const source = parseText(
      "const x = { GATE_FAILED: { variant: 'warning', shape: 'solid' }, WON: { variant: 'success', shape: 'solid' } };",
    );
    expect(stateColorMaps(source)).toHaveLength(1);
  });

  it('🔴 文字列のキー（`{ \'GATE_FAILED\': … }`）でも拾う', () => {
    expect(stateColorMaps(parseText("const x = { 'GATE_FAILED': 'danger', 'LOST': 'neutral' };"))).toHaveLength(1);
  });

  it('状態名 → **語**（文言キー）の写像は拾わない（色ではない）', () => {
    const source = parseText(
      "const LABELS = { GATE_FAILED: 'proposals.state.GATE_FAILED', APPROVED: 'proposals.state.APPROVED' };",
    );
    expect(stateColorMaps(source)).toEqual([]);
  });

  it('`Proposal` の状態名でない鍵 → 色の写像は拾わない（重要度 / 区分 / 水準のバッジは正当）', () => {
    const source = parseText("const SEVERITY = { CRITICAL: 'danger', WARN: 'warning', OK: 'success' };");
    expect(stateColorMaps(source)).toEqual([]);
  });

  it('🔴 状態名以外が混じる写像は拾わない（`S-003` の **種別** バッジは別の軸。§S-003 表 1）', () => {
    // `action-queue-section.tsx` の `KIND_VARIANTS` の形。`SEND_FAILED` / `SEND_HELD` /
    // `PROPOSAL_REQUEST_PENDING` は `ProposalState` に無く、7 種別という別の軸である。
    const source = parseText(
      "const KIND = { SEND_FAILED: 'danger', APPROVAL_PENDING: 'brand', GATE_FAILED: 'warning', SEND_HELD: 'outline' };",
    );
    expect(stateColorMaps(source)).toEqual([]);
  });

  it('状態名が 1 つだけの写像は拾わない（閾値 2）', () => {
    expect(stateColorMaps(parseText("const x = { GATE_FAILED: 'danger' };"))).toEqual([]);
  });

  it('🔴 部分写像（2 状態だけ画面で色を上書きする形）は拾う', () => {
    expect(stateColorMaps(parseText("const x = { GATE_FAILED: 'danger', APPROVED: 'success' };"))).toHaveLength(1);
  });

  it('🔴 削除済みの識別子を拾う。コメント・文言の中の同じ語は拾わない', () => {
    expect(forbiddenIdentifierHits(parseText('const a = proposalStateTone(s);')).map((hit) => hit.name)).toEqual([
      'proposalStateTone',
    ]);
    expect(forbiddenIdentifierHits(parseText('// proposalStateTone は削除した\nconst s = "TONE_VARIANTS";'))).toEqual([]);
  });
});
