// apps/web/lib/format/initials.test.ts
// `displayInitials`（`lib/format/initials.ts`）。
// 🔴 `app/(main)/_shell/main-shell.tsx` の `accountInitials` から移した実装であり、**挙動は変えていない**
//    （移した理由は、`S-031` の吹き出しが `'use client'` の島から同じ規則を呼ぶため）。
import { describe, expect, it } from 'vitest';
import { displayInitials } from './initials';

describe('displayInitials', () => {
  it('日本語の氏名は先頭 1 文字（2 文字にすると円の中で潰れる）', () => {
    expect(displayInitials('サンプル 太郎')).toBe('サ');
    expect(displayInitials('仮名一郎')).toBe('仮');
  });

  it('ASCII の氏名（2 語）は語頭 2 文字を大文字で', () => {
    expect(displayInitials('Yamada Taro')).toBe('YT');
    expect(displayInitials('ada lovelace')).toBe('AL');
  });

  it('ASCII の 1 語は先頭 2 文字', () => {
    expect(displayInitials('taro')).toBe('TA');
  });

  it('🔴 空文字を返さない（円の中が空のアバターは「壊れている」に見える）', () => {
    expect(displayInitials('')).toBe('?');
    expect(displayInitials('   ')).toBe('?');
  });

  it('サロゲートペアを割らない', () => {
    expect(displayInitials('𠮷田 太郎')).toBe('𠮷');
  });
});
