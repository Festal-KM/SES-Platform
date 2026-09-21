// tests/static/forbidden-api-routes.test.ts
// 🔴 `docs/05` §6.8「主平面 API の『作らないもの』」のうち、**ルートの存在そのもので判定できるもの**を
//    機械的に固定する（docs/05 §17.2 #30。T-08-04）。
//
// 第一の対象は 🔴 **`GET /api/candidates/{candidateRef}`**（`docs/04` 申し送り 2 / §11-2 /
// `docs/05` §4.6）。**詳細エンドポイントは 5 項目を超える経路になる** ——
// 一覧に出すのは丸めた 5 項目だけでも、「1 件だけ詳しく見る画面」を作った瞬間に
// 「ここだけもう 1 項目」が積まれる置き場所ができる。開示項目を増やすことは**人間の承認事項**
// （`CLAUDE.md` §8.6 / §3.1 経路 4 の 🔴「匿名表示の項目を増やさない」）であり、
// **置き場所そのものを作らない**のが設計上の答えである。
//
// 🔴 **なぜ静的テストか**: 「作らない」は書かれていないことの検査なので、型でもユニットテストでも
//    表に出ない。ディレクトリ構造を走査する形にしておけば、**誰かが作った瞬間に落ちる**
//    （`route-boundaries.test.ts` / `package-zone-coverage.test.ts` と同じ発想）。
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..', '..', 'apps', 'web', 'app', 'api');

/** Route Handler の本体（このファイルがあるディレクトリが 1 つの API になる）。 */
const ROUTE_FILES = ['route.ts', 'route.tsx'] as const;

/**
 * 🔴 禁止するルート。**URL の形で書く**（`docs/05` §6.8 の行と 1 対 1 にする）。
 *
 * - ルートグループ（`(main)` / `(admin)` 等。URL に現れない）は取り除いてから照合する。
 * - 動的セグメント（`[id]` / `[candidateRef]`）は名前によらず `{}` に正規化する ——
 *   **パラメータ名を変えれば通る、という抜け道を作らない。**
 */
const FORBIDDEN_ROUTES: readonly { readonly url: string; readonly reason: string }[] = [
  {
    url: '/api/candidates/{}',
    reason:
      '🔴 docs/05 §6.8 / §4.6 / docs/04 申し送り 2: 匿名候補の詳細エンドポイントは ' +
      '開示 5 項目を超える経路になる（F-017 AC-1 / BR-54。開示項目の追加は人間の承認事項）',
  },
  {
    // 🔴 T-12-10（`docs/05` §6.8 / §11.11「T-12-10 の実装の決着」⑧ / `F-014 AC-9` / `AC-13`）。
    url: '/api/projects/{}/visibility/restore',
    reason:
      '🔴 自動解除を取り消せる / 上書きできるロールは `OWNER` を含めて存在しない（`BR-18` / `F-020 AC-2`）。' +
      '復帰は「`S-012` で 3 欄を直す → `S-013` で公開し直す」の 2 手だけであり、' +
      '権限で開くと `BR-18` が「権限のある人なら迂回できる」に変わる',
  },
  {
    // 🔴 T-12-10（同上）。
    url: '/api/projects/{}/recheck',
    reason:
      '🔴 「再検査だけをもう一度実行する」入口を作らない（`docs/04` §S-013 に操作が無い）。' +
      '元データが変わっていない再実行は結果が変わらず `F-026` の件数だけを消費する。' +
      '保留からの復帰は `gate.hold-release` が上限のリセット後に自動で行う（`F-014 AC-12`）',
  },
  {
    url: '/api/audit-logs/{}',
    reason:
      '🔴 docs/05 §6.4「#10 の改訂」/ §17.2 #32 ⑤（T-11-09）: S-041 の行の詳細は一覧の応答に同梱する。' +
      '展開ごとの追加取得を作ると、監査ログの閲覧そのものが記録の対象になり行数が読めなくなる（docs/04 §S-041）',
  },
];

/** `app/api` 配下で `route.ts` を持つディレクトリの、URL としてのパスを列挙する。 */
function collectRouteUrls(absolute: string, segments: readonly string[]): string[] {
  const entries = readdirSync(absolute, { withFileTypes: true });
  const urls: string[] = [];
  if (entries.some((entry) => entry.isFile() && (ROUTE_FILES as readonly string[]).includes(entry.name))) {
    urls.push(`/${['api', ...segments].join('/')}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // プライベートフォルダ（`_form` 等）は URL を持たない（Next.js の規約）。
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    urls.push(...collectRouteUrls(path.join(absolute, entry.name), [...segments, ...urlSegment(entry.name)]));
  }
  return urls;
}

/**
 * ディレクトリ名を URL のセグメントに変換する。
 * - ルートグループ `(main)` → セグメント無し
 * - 動的セグメント `[id]` / `[...slug]` → `{}`（🔴 名前を見ない）
 */
function urlSegment(name: string): string[] {
  if (name.startsWith('(') && name.endsWith(')')) return [];
  if (name.startsWith('[') && name.endsWith(']')) return ['{}'];
  return [name];
}

const routeUrls = collectRouteUrls(apiRoot, []);

describe('🔴 docs/05 §6.8「作らないもの」— ルートの存在で判定できるもの（§17.2 #30）', () => {
  it('対照: このテストが空振りしていない（api 配下に Route Handler が 1 本以上ある）', () => {
    expect(routeUrls.length).toBeGreaterThan(0);
    // ルートグループが取り除かれ、動的セグメントが正規化されていること（走査側の健全性）。
    expect(routeUrls).toContain('/api/engineers/{}');
    expect(routeUrls.some((url) => url.includes('(main)'))).toBe(false);
    expect(routeUrls.some((url) => url.includes('['))).toBe(false);
  });

  it.each(FORBIDDEN_ROUTES)('🔴 $url が存在しない', ({ url, reason }) => {
    expect(routeUrls, `${url} を作ってはならない: ${reason}`).not.toContain(url);
  });

  it('🔴 対照: 禁止パターンの照合が空振りしていない（合成パスには確かに一致する）', () => {
    // 走査ロジックを通した「もし作られたら」の形と、禁止リストの表記が一致することを示す。
    const synthesized = `/${['api', ...urlSegment('(main)'), 'candidates', ...urlSegment('[candidateRef]')].join('/')}`;
    expect(synthesized).toBe('/api/candidates/{}');
    expect(FORBIDDEN_ROUTES.map((entry) => entry.url)).toContain(synthesized);
    // 🔴 パラメータ名を変えても同じ形に正規化される（名前を変えれば通る抜け道が無い）。
    expect(urlSegment('[ref]')).toEqual(urlSegment('[candidateRef]'));
  });
});
