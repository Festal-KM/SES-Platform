// tests/static/sidebar-form-css-order.test.ts
// 🔴 **ビルド出力 CSS 上で、同特異度どうしの勝敗（= 宣言順）を固定する**（SP-22 `T-22-05` の
//    レビュー指摘 10。`docs/04` §3.1 の 2 形態 / §7.10 の状態の優先順）。
//
// ============================================================================
// なぜこの 1 本が要るのか
// ============================================================================
// `packages/ui/src/components/sidebar.tsx` の 2 形態（展開 / アイコンのみ）は **JS を持たない**
// （`'use client'` を増やせないため `<input type="checkbox">` + CSS で作っている）。その切り替えは
//
//   `w-14` / `group-has-checked:w-56` / `xl:w-56` / `xl:group-has-checked:w-14`
//
// の 4 クラスの勝敗で決まるが、**`group-has-checked:*` と `xl:group-has-checked:*` は同特異度
// (0,2,0) であり、どちらが勝つかは生成 CSS に出る順序だけが決めている。**
// 同じことがラベル・印の `hidden` / `block` の 4 クラス、点（dot）のその裏返しの 4 クラス、
// そして現在地の `hover:` / `active:` の上書きにも当てはまる。
//
// 🔴 **順序が反転しても既存のテストは 1 本も落ちない。** `*.render.test.tsx` は class 属性の
//    文字列を見るだけで、`class` の並びは CSS の順序と無関係である（`packages/ui/src/lib/cn.ts` の
//    経緯）。つまり **「テストは緑のまま形態が反転する」**（`xl` 以上で既定がアイコンのみになる /
//    現在地の背景が hover で消える）。Tailwind のバリアント順は実装詳細であり、
//    メジャー更新で変わりうる。**だから出力そのものを見る。**
//
// ============================================================================
// 🔴 このテストはビルド成果物を読む（`tests/static` で唯一）
// ============================================================================
// `tests/static/design-tokens.test.ts` の ⚠️ が「生成 CSS にトークンが載っているかは実測しか
// 確かめられない」と書いたまま置いていた穴がここである。`tests/smoke/**` は docker-compose 前提で
// `pnpm test:unit` の外にあるため、**毎回走らない場所に置くと安全網にならない**。
//
// 🔴 **成果物が無ければ落ちる**（skip しない）。先例は `tests/startup/startup-di.test.ts` で、
//    あれも `packages/config/dist` を要り「CI の実行順（build → test）に依存する」と明記している。
//    `.github/workflows/ci.yml` は `pnpm run build`（= `pnpm -r run build`。`@ses/web` を含む）を
//    `pnpm run test:unit` の**前**に走らせるので、CI では常に在る。手元で落ちたときは
//    `env -u NODE_ENV pnpm --filter @ses/web run build` を先に走らせること。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const chunksDir = path.join(repoRoot, 'apps', 'web', '.next', 'static', 'chunks');

/** 🔴 サイドバーの 2 形態が載っている CSS を特定する目印（これが無いチャンクは対象外）。 */
const SENTINEL = String.raw`.group-has-checked\:w-56`;

const BUILD_HINT =
  '🔴 ビルド出力が見つかりません。`env -u NODE_ENV pnpm --filter @ses/web run build` を先に走らせてください' +
  '（CI は build → test:unit の順なので常に在ります。`tests/startup/startup-di.test.ts` と同じ依存です）。';

function sidebarCssFiles(): ReadonlyArray<{ readonly label: string; readonly css: string }> {
  if (!existsSync(chunksDir)) return [];
  return readdirSync(chunksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => ({
      label: path.join('apps/web/.next/static/chunks', entry.name),
      css: readFileSync(path.join(chunksDir, entry.name), 'utf8'),
    }))
    .filter((file) => file.css.includes(SENTINEL));
}

const files = sidebarCssFiles();

/**
 * 🔴 順序を固定する組（**先に出るものから並べる**）。
 *    末尾のものが勝つ ＝ **その形態・その状態が実際に適用される**。
 */
const ORDERED_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly why: string;
  readonly selectors: readonly string[];
}> = [
  {
    label: '2 形態の幅（`docs/04` §3.1: `xl` 未満は既定でアイコンのみ / `xl` 以上は既定で展開）',
    why:
      '🔴 反転すると **`xl` 以上の既定がアイコンのみ**になり、チェックを入れないと展開できなくなる' +
      '（`sidebar.tsx` の「チェックの意味は『既定と逆の形態にする』」が成り立たなくなる）。',
    selectors: [
      '.w-14{',
      String.raw`.group-has-checked\:w-56`,
      String.raw`.xl\:w-56`,
      String.raw`.xl\:group-has-checked\:w-14`,
    ],
  },
  {
    label: 'ラベルと印（`SIDEBAR_LABEL_CLASSES.sidebar` / `SIDEBAR_MARK_CLASSES.sidebar`）',
    why: '🔴 反転すると `xl` 以上でラベルが消え、`xl` 未満でラベルが出る（幅と形態が食い違う）。',
    selectors: [
      '.hidden{',
      String.raw`.group-has-checked\:block`,
      String.raw`.xl\:block`,
      String.raw`.xl\:group-has-checked\:hidden`,
    ],
  },
  {
    label: '点（dot。`SIDEBAR_ICON_ONLY_CLASSES` = 上の裏返し）',
    why:
      '🔴 反転すると、**期限バッジと点が同時に出る / どちらも出ない**。点はバッジが隠れる形態の' +
      '代わりであり（`CLAUDE.md` §1.2 の取引先が 1024–1279px で期限に気づける唯一の手がかり）、' +
      '両方消えると `F-004 AC-4` の代替が無くなる。',
    selectors: [
      '.block{',
      String.raw`.group-has-checked\:hidden`,
      String.raw`.xl\:hidden`,
      String.raw`.xl\:group-has-checked\:block`,
    ],
  },
  {
    label: '現在地の hover（§7.10 の優先順 `selected > hover`）',
    why:
      '🔴 反転すると、**現在地の項目にポインタが乗った瞬間に背景が hover 色に置き換わる**' +
      '（`SIDEBAR_CURRENT_CLASSES` が `hover:bg-sidebar-selected-bg` で塗り直している理由。' +
      '`lib/state-classes.ts` の「hover と selected を同じ見た目にしない」）。' +
      '✅ 2026-10-02: サイドバーが濃色になり、語が `bg-bg-subtle` / `bg-brand-bg` から濃色の' +
      'トークンに替わった。🔴 **順序を見るという判定は 1 つも変えていない。**',
    selectors: [String.raw`.hover\:bg-sidebar-hover-bg`, String.raw`.hover\:bg-sidebar-selected-bg`],
  },
  {
    label: 'テーブルの行の selected（§7.10 の優先順 `selected > hover`）',
    why:
      '🔴 サイドバーと**完全に同型の脆さ**である。`TableRow` は `hover:bg-row-hover-bg` と ' +
      '`data-[state=selected]:bg-brand-bg` を同時に持ち、どちらも特異度 (0,2,0) なので、' +
      '勝敗はこの順序だけが決める。`T-22-05` のレビュー（指摘 6）で「現時点では順序が正しいので' +
      'バグは無いが、依存している事実は sidebar と同型」と確認された。🔴 **行選択を使う画面が' +
      '段② で入る前に固定しておく** —— 反転しても既存のテストは緑のままで、選択した行が' +
      'ポインタを乗せた瞬間に「選択中」に見えなくなる。' +
      '✅ 2026-10-02: 行の hover の語が `bg-bg-subtle` → `bg-row-hover-bg`（**値は同一**）に替わった。',
    selectors: [String.raw`.hover\:bg-row-hover-bg`, String.raw`.data-\[state\=selected\]\:bg-brand-bg`],
  },
];

/**
 * ⚠️ **2026-10-02 に 1 群（「現在地の active」）を外した。🔴 検査を緩めたのではない。**
 *
 * 濃色サイドバーには **`active` の段が無い**（`docs/04` §7.9 改訂 23 が定めた 8 トークンに
 * `--sidebar-active-bg` が無く、🔴 **階調を実装側で作らない**（`U-25`）ため段を足せない）。
 * したがって `active:bg-bg-inset` / `active:bg-brand-bg` の**組そのものがサイドバーから消えた** ——
 * 存在しないクラスの順序を検査すると「1 回だけ出現する」の対照で必ず落ちる（＝ 嘘の検査になる）。
 *
 * 🔴 **`active` の段を足すときは、この群を同じ形で戻すこと**（`docs/04` §7.9 への追記 =
 *    人間の判断が先に要る）。それまでは `hover` の群が「selected が hover に食われない」ことを
 *    固定しており、§7.10 の優先順のうち**実装に存在する部分は全部見ている。**
 */
const REMOVED_GROUPS_REASON = 'サイドバーの active は濃色の 8 トークンに段が無いため実装していない';

describe('🔴 サイドバーの 2 形態と現在地は、生成 CSS の宣言順に依存している（T-22-05 レビュー指摘 10）', () => {
  it('対照: ビルド出力にサイドバーの CSS が 1 ファイルだけ在る（走査が空振りしていない）', () => {
    expect(files.map((file) => file.label), BUILD_HINT).toHaveLength(1);
  });

  for (const group of ORDERED_GROUPS) {
    it(`🔴 ${group.label} の宣言順が保たれている`, () => {
      expect(files, BUILD_HINT).toHaveLength(1);
      const file = files[0] as { readonly label: string; readonly css: string };
      // 🔴 各セレクタは 1 回しか出てこない（位置の比較が意味を持つ前提）。
      for (const selector of group.selectors) {
        expect(
          (file.css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length,
          `${selector} が ${file.label} に 1 回だけ出現しない（Tailwind の出力の形が変わった？）`,
        ).toBe(1);
      }
      const positions = group.selectors.map((selector) => file.css.indexOf(selector));
      expect(
        positions,
        `${group.why}\n実測（${file.label} 内のバイト位置）: ` +
          group.selectors.map((selector, index) => `${selector}=${String(positions[index])}`).join(' / '),
      ).toEqual([...positions].sort((a, b) => a - b));
    });
  }

  it('🔴 外した群（現在地の active）は「クラスが存在しないから」である（対照）', () => {
    // 🔴 存在しないクラスの順序を検査すると、上の「1 回だけ出現する」の対照で必ず落ちる
    //    （嘘の検査になる）。**本当に無いこと**をここで示し、戻すときの条件を文章で残す。
    expect(files, BUILD_HINT).toHaveLength(1);
    const file = files[0] as { readonly label: string; readonly css: string };
    expect(
      file.css.includes(String.raw`.active\:bg-brand-bg`),
      '🔴 現在地の `active` を復活させたなら、`ORDERED_GROUPS` にその群を戻すこと' +
        `（外した理由: ${REMOVED_GROUPS_REASON}）。`,
    ).toBe(false);
    expect(REMOVED_GROUPS_REASON).toContain('段が無い');
  });

  it('🔴 対照: 判定が順序を実際に見ている（並べ替えた写しでは落ちる）', () => {
    // 🔴 「順序を見ている」は書かれていないことなので、**逆順なら落ちる形**で示す。
    const ascending = [10, 20, 30];
    const descending = [30, 20, 10];
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
    expect(descending).not.toEqual([...descending].sort((a, b) => a - b));
  });
});
