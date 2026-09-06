// apps/web/lib/projects/created-href.test.ts
// 🔴 T-06-01 Iteration 2: **登録直後の遷移先が実行時に壊れていないこと**を固定する。
//
// なぜこのテストが要るか（Iteration 1 の欠陥の再発防止）:
//   `PROJECT_CREATED_HREF_PATTERN` は、差し込み記号を `'use client'` のモジュールから
//   値 import して組み立てていた。RSC の**サーバグラフ**では `'use client'` の export が
//   client reference（プロキシ）に置換されるため、テンプレートリテラルに埋め込んだ瞬間に
//   **関数のソースが混ざった壊れた文字列**になる（`created-href.ts` 冒頭の実測メモ）。
//   その結果、案件の保存に成功した直後に
//   `/projects/function(){throw Error(...)}/edit` へ遷移していた。
//
// 🔴 このテストが直接押さえるのは「**パターンが差し込み記号だけを含む素の文字列である**」
//    ことである。値の出所が `'use client'` のモジュールへ戻された場合、
//    ①`toBe('/projects/{id}/edit')` が落ち（サーバ側評価なら文字列が変わる）
//    ②`buildCreatedHref` の結果に `function` が現れる、のどちらかで必ず表に出る。
// ⚠️ vitest は RSC 変換を経ないため、**このテストだけでは Iteration 1 の欠陥は再現しない。**
//    したがって「壊れないこと」の担保は 3 枚である:
//      (a) 本テスト（値が素の文字列であること / 組み立ての規則）
//      (b) `created-href.ts` に `'use client'` を置かず、実行時依存も持たせないこと
//      (c) 本モジュールが `lib/**` にあること（`app/**` に戻すと `vitest.config.ts` の
//          include から外れ、(a) が 1 度も走らなくなる）
//    (b)(c) を崩す変更は、`form-props.ts` / `project-form.tsx` の import を書き換えることになる。
import { describe, expect, it } from 'vitest';
import {
  buildCreatedHref,
  CREATED_HREF_ID_PLACEHOLDER,
  PROJECT_CREATED_HREF_PATTERN,
} from './created-href';

describe('🔴 登録直後の遷移先パターン（S-012）', () => {
  it('差し込み記号は素の文字列である', () => {
    expect(CREATED_HREF_ID_PLACEHOLDER).toBe('{id}');
    expect(typeof CREATED_HREF_ID_PLACEHOLDER).toBe('string');
  });

  it('🔴 パターンが `/projects/{id}/edit` そのものである（暫定値。T-06-02 で差し替え）', () => {
    expect(PROJECT_CREATED_HREF_PATTERN).toBe('/projects/{id}/edit');
  });

  it('🔴 パターンに関数のソースが混ざっていない（client reference の混入検知）', () => {
    expect(PROJECT_CREATED_HREF_PATTERN).toContain(CREATED_HREF_ID_PLACEHOLDER);
    expect(PROJECT_CREATED_HREF_PATTERN).not.toContain('function');
    expect(PROJECT_CREATED_HREF_PATTERN).not.toContain('Error');
    // パス区切りは 3 つだけ（`/projects` / `/{id}` / `/edit`）。
    expect(PROJECT_CREATED_HREF_PATTERN.split('/')).toHaveLength(4);
  });
});

describe('buildCreatedHref', () => {
  it('差し込み記号を採番された ID で置き換える', () => {
    expect(
      buildCreatedHref(PROJECT_CREATED_HREF_PATTERN, '01930000-0000-7000-8000-0000000000f1'),
    ).toBe('/projects/01930000-0000-7000-8000-0000000000f1/edit');
  });

  it('🔴 ID は URL エンコードされる（応答の値をそのまま連結しない）', () => {
    expect(buildCreatedHref(PROJECT_CREATED_HREF_PATTERN, 'a/b?c')).toBe(
      '/projects/a%2Fb%3Fc/edit',
    );
  });

  it('差し込み記号を持たないパターンはそのまま返る（置換に失敗しても壊れた URL を作らない）', () => {
    expect(buildCreatedHref('/projects', 'x')).toBe('/projects');
  });
});
