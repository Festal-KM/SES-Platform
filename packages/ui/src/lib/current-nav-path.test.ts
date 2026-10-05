// packages/ui/src/lib/current-nav-path.test.ts
// 🔴 現在地の判定（`./current-nav-path.ts`）。2026-10-04。
//
// 🔴 **ここが「サーバの初回描画」と「クライアントの上書き」が共有する唯一の判定**である
//    （同ファイル冒頭の 🔴）。判定が 2 つになると、水和の前後で光る項目が変わる。
import { describe, expect, it } from 'vitest';
import {
  currentNavSectionIndex,
  isCurrentNavPath,
  matchesCurrentNavPath,
  navLinkClassName,
} from './current-nav-path.js';

describe('isCurrentNavPath', () => {
  it('🔴 ホーム（`/`）は完全一致のときだけ現在地になる', () => {
    expect(isCurrentNavPath('/', '/')).toBe(true);
    // 🔴 前方一致にすると全画面がホームの現在地になる（それが 2026-10-04 に実際に見えた症状と
    //    同じ見え方になる）。
    expect(isCurrentNavPath('/engineers', '/')).toBe(false);
    expect(isCurrentNavPath('/settings/organization', '/')).toBe(false);
  });

  it('配下のパスも現在地になる（詳細画面で親の項目が光る）', () => {
    expect(isCurrentNavPath('/engineers', '/engineers')).toBe(true);
    expect(isCurrentNavPath('/engineers/e1', '/engineers')).toBe(true);
    expect(isCurrentNavPath('/proposals/abc/approve', '/proposals')).toBe(true);
  });

  it('🔴 区切りを `/` ごと見るので `/engineers` が `/engineer-shares` を飲み込まない', () => {
    expect(isCurrentNavPath('/engineer-shares', '/engineers')).toBe(false);
    expect(isCurrentNavPath('/engineers-x', '/engineers')).toBe(false);
  });

  it('🔴 現在地が取れないとき（空文字）はどの項目にも一致しない', () => {
    for (const href of ['/', '/engineers', '/settings']) {
      expect(isCurrentNavPath('', href), href).toBe(false);
    }
  });
});

describe('matchesCurrentNavPath', () => {
  it('射程のいずれかに一致すれば現在地になる（第 2 階層 / 索引のパス）', () => {
    const projects = ['/projects', '/proposals', '/proposal-requests'];
    expect(matchesCurrentNavPath('/proposal-requests', projects)).toBe(true);
    expect(matchesCurrentNavPath('/proposals/abc/approve', projects)).toBe(true);
    expect(matchesCurrentNavPath('/engineers', projects)).toBe(false);
  });

  it('🔴 射程が空なら現在地にならない（「その他」のパネルがこれに当たる）', () => {
    expect(matchesCurrentNavPath('/engineers', [])).toBe(false);
  });
});

describe('currentNavSectionIndex', () => {
  const sections = [
    ['/engineers', '/engineer-shares'],
    ['/projects', '/proposals', '/proposal-requests'],
  ];

  it('現在地を含むセクションの添字を返す', () => {
    expect(currentNavSectionIndex('/engineer-shares', sections)).toBe(0);
    expect(currentNavSectionIndex('/engineers/e1', sections)).toBe(0);
    expect(currentNavSectionIndex('/proposals', sections)).toBe(1);
  });

  it('🔴 どのセクションにも属さない画面では `-1`（帯を描かない）', () => {
    for (const path of ['/', '/settings', '/skills', '/audit-logs', '']) {
      expect(currentNavSectionIndex(path, sections), path).toBe(-1);
    }
  });

  it('🔴 複数一致しても最初の 1 つだけを返す（帯が 2 本出る状態を作らない）', () => {
    expect(currentNavSectionIndex('/projects', [['/projects'], ['/projects']])).toBe(0);
  });
});

describe('navLinkClassName', () => {
  it('現在地なら `currentClassName`、そうでなければ `className`', () => {
    expect(navLinkClassName(true, 'base', 'current')).toBe('current');
    expect(navLinkClassName(false, 'base', 'current')).toBe('base');
  });

  it('🔴 `currentClassName` を持たない呼び出し側は現在地の表現を持たない', () => {
    expect(navLinkClassName(true, 'base', undefined)).toBe('base');
    expect(navLinkClassName(false, undefined, 'current')).toBeUndefined();
  });
});
