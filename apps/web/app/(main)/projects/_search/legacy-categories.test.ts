import { describe, expect, it } from 'vitest';
import { LEGACY_PROJECT_CATEGORY_MAP as DB_MAP, PROJECT_CATEGORIES } from '@ses/db';
import { LEGACY_PROJECT_CATEGORY_MAP } from './legacy-categories';

describe('旧カテゴリの読み替え（クライアント側の写し）', () => {
  it('🔴 `@ses/db` の写像と完全に一致する', () => {
    expect(LEGACY_PROJECT_CATEGORY_MAP).toEqual(DB_MAP);
  });
  it('移送先はすべて現行の 12 値に含まれ、旧値は現行の値と重ならない', () => {
    for (const [legacy, target] of Object.entries(LEGACY_PROJECT_CATEGORY_MAP)) {
      expect(PROJECT_CATEGORIES).toContain(target);
      expect(PROJECT_CATEGORIES as readonly string[]).not.toContain(legacy);
    }
  });
});
