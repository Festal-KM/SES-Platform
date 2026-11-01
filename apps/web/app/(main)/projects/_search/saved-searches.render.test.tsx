// apps/web/app/(main)/projects/_search/saved-searches.render.test.tsx
// ⚠️ **拡張子が `.render.test.tsx` なのは vitest の `include` に合わせるため**である
//    （`apps/*/app/**/*.render.test.tsx` だけが拾われる。`vitest.config.ts`）。
//    🔴 中身は**保存先（`localStorage`）の読み書き**のテストであり、描画は 1 つも行わない。
//
// ============================================================================
// 🔴 なぜこのテストが要るのか
// ============================================================================
// 改修指示書 §5 は 🔴 **「破損データ、旧形式、保存容量エラーを扱い、失敗しているのに
// 『保存しました』と表示しないでください」** と明示している。
//
// 🔴 **この層が壊れても、画面上は「保存した条件が空っぽ」に見えるだけ**である。
//    「まだ保存していない」と見分けが付かないので、**目視では永久に気づけない。**
//    したがって分岐（壊れた JSON / 形式の版違い / 型違いの行 / 書き込みの失敗）を
//    ここで 1 つずつ固定する。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_PROJECT_SEARCH_DRAFT } from './filters';
import {
  isValidSavedSearchName,
  readSavedSearches,
  readSavedSearchSelection,
  writeSavedSearchSelection,
  savedSearchStorageKey,
  searchExpandedCookieName,
  writeSavedSearches,
} from './saved-searches';

const KEY = savedSearchStorageKey('tenant-1', 'user-1');

/**
 * 🔴 **`localStorage` を差し替える**（この層は `window.localStorage` しか触らない）。
 * ⚠️ `throws` を立てると `setItem` が投げる —— 容量超過（`QuotaExceededError`）と
 *    サイトデータの遮断（プライベートウィンドウ）の両方がこの形で来る。
 */
function installStorage(initial: Record<string, string> = {}, options: { throws?: boolean } = {}): void {
  const store = new Map(Object.entries(initial));
  const fake: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      if (options.throws === true) throw new Error('QuotaExceededError');
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: fake },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('🔴 保存先の鍵（改修指示書 §5）', () => {
  it('🔴 会社 ID・ユーザー ID・画面 ID・形式バージョンがすべて入る', () => {
    expect(KEY).toBe('ses.projects.savedSearches.v1.tenant-1.user-1');
  });

  it('🔴🔴 ユーザーが違えば別の鍵である（ユーザーをまたぐ共通保存にしない）', () => {
    expect(savedSearchStorageKey('tenant-1', 'user-2')).not.toBe(KEY);
    expect(savedSearchStorageKey('tenant-2', 'user-1')).not.toBe(KEY);
  });

  it('折りたたみの cookie もユーザー単位である', () => {
    expect(searchExpandedCookieName('user-1')).toBe('ses.projects.search.expanded.user-1');
    expect(searchExpandedCookieName('user-2')).not.toBe(searchExpandedCookieName('user-1'));
  });
});

describe('🔴 読み（壊れていても画面を落とさない / 黙って捨てない）', () => {
  it('何も保存されていなければ空（`broken` は立てない）', () => {
    expect(readSavedSearches(KEY)).toEqual({ items: [], broken: false });
  });

  it('🔴 壊れた JSON は `broken: true`（「保存したはずのものが消えた」の理由を残す）', () => {
    installStorage({ [KEY]: '{ this is not json' });

    expect(readSavedSearches(KEY)).toEqual({ items: [], broken: true });
  });

  it('🔴 形式の版が違えば読まない（旧形式を推測で解釈しない）', () => {
    installStorage({ [KEY]: JSON.stringify({ version: 2, items: [] }) });

    expect(readSavedSearches(KEY)).toEqual({ items: [], broken: true });
  });

  it('🔴 `items` が配列でなければ `broken: true`', () => {
    installStorage({ [KEY]: JSON.stringify({ version: 1, items: { a: 1 } }) });

    expect(readSavedSearches(KEY)).toEqual({ items: [], broken: true });
  });

  it('🔴 型違いの行だけを捨てる（正しい行は残す）', () => {
    installStorage({
      [KEY]: JSON.stringify({
        version: 1,
        items: [
          { id: 'a', name: '東京', filters: { q: '基幹' }, updatedAt: '2026-10-19T00:00:00.000Z' },
          { id: 42, name: '壊れた行', filters: {} },
          { id: 'c', name: 'ID はあるが filters が無い' },
          null,
        ],
      }),
    });

    const store = readSavedSearches(KEY);
    expect(store.broken).toBe(false);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toEqual({
      id: 'a',
      name: '東京',
      filters: { ...EMPTY_PROJECT_SEARCH_DRAFT, q: '基幹' },
      updatedAt: '2026-10-19T00:00:00.000Z',
    });
  });

  it('🔴🔴 古い `並行可否` が混ざっていても読み捨てる（検索に影響しない）', () => {
    installStorage({
      [KEY]: JSON.stringify({
        version: 1,
        items: [{ id: 'a', name: '旧', filters: { q: 'x', parallelOk: '1', sourceKind: 'OWN' } }],
      }),
    });

    const saved = readSavedSearches(KEY).items[0];
    expect(Object.keys(saved?.filters ?? {})).not.toContain('parallelOk');
    expect(Object.keys(saved?.filters ?? {})).not.toContain('sourceKind');
  });

  it('`localStorage` に触れない環境でも落ちない（空として扱う）', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        get localStorage(): Storage {
          throw new Error('blocked');
        },
      },
      configurable: true,
      writable: true,
    });

    expect(readSavedSearches(KEY)).toEqual({ items: [], broken: false });
  });
});

describe('🔴🔴 書き（失敗を成功に見せない。指示書 §5）', () => {
  const item = {
    id: 'a',
    name: '東京の募集中',
    filters: EMPTY_PROJECT_SEARCH_DRAFT,
    updatedAt: '2026-10-19T00:00:00.000Z',
  };

  it('書けたら `true` で、読み戻せる', () => {
    expect(writeSavedSearches(KEY, [item])).toBe(true);
    expect(readSavedSearches(KEY).items).toEqual([item]);
  });

  it('🔴🔴 容量超過・遮断で `setItem` が投げたら `false`（呼び出し側が「保存しました」を出さない根拠）', () => {
    installStorage({}, { throws: true });

    expect(writeSavedSearches(KEY, [item])).toBe(false);
  });
});

describe('🔴 保存名は前後の空白を除いて 1〜40 文字（指示書 §5）', () => {
  it('空・空白だけは不可', () => {
    expect(isValidSavedSearchName('')).toBe(false);
    expect(isValidSavedSearchName('   ')).toBe(false);
    expect(isValidSavedSearchName('　')).toBe(false);
  });

  it('境界（1 / 40 / 41 文字）', () => {
    expect(isValidSavedSearchName('あ')).toBe(true);
    expect(isValidSavedSearchName('あ'.repeat(40))).toBe(true);
    expect(isValidSavedSearchName('あ'.repeat(41))).toBe(false);
  });

  it('🔴 前後の空白は数えない（空白で 40 文字を超えたことにしない）', () => {
    expect(isValidSavedSearchName(`  ${'あ'.repeat(40)}  `)).toBe(true);
  });
});


describe('適用した保存条件の選択を保持する', () => {
  function sessionStore(): Map<string, string> {
    const data = new Map<string, string>();
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    } });
    return data;
  }
  it('未記録と明示的なクリアを区別する（リロードで再選択しない）', () => {
    sessionStore();
    expect(readSavedSearchSelection(KEY)).toBeUndefined();
    writeSavedSearchSelection(KEY, 'saved-a');
    expect(readSavedSearchSelection(KEY)).toBe('saved-a');
    writeSavedSearchSelection(KEY, null);
    expect(readSavedSearchSelection(KEY)).toBeNull();
  });
  it('条件を編集・保存しても選択IDは変わらず、別ユーザーとは分離する', () => {
    sessionStore();
    writeSavedSearchSelection(KEY, 'saved-a');
    writeSavedSearches(KEY, [{ id: 'saved-a', name: '案件A', filters: { ...EMPTY_PROJECT_SEARCH_DRAFT, q: '変更後' }, updatedAt: '2026-10-23' }]);
    expect(readSavedSearchSelection(KEY)).toBe('saved-a');
    expect(readSavedSearchSelection(savedSearchStorageKey('tenant-1', 'other-user'))).toBeUndefined();
    writeSavedSearchSelection(KEY, 'saved-b');
    expect(readSavedSearchSelection(KEY)).toBe('saved-b');
  });
  it('破損・保存禁止でも検索自体を妨げない', () => {
    const store = sessionStore();
    store.set(`${KEY}.selection`, '{broken');
    expect(readSavedSearchSelection(KEY)).toBeUndefined();
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    expect(readSavedSearchSelection(KEY)).toBeUndefined();
    expect(() => { writeSavedSearchSelection(KEY, 'saved-a'); }).not.toThrow();
  });
});
