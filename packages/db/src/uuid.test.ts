// packages/db/src/uuid.test.ts
import { describe, expect, it } from 'vitest';
import { uuidV7, uuidV7TimeOf } from './uuid.js';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV7（RFC 9562 §5.7）', () => {
  it('版 7・バリアント 0b10 の形をしている', () => {
    expect(uuidV7(new Date('2026-09-04T12:00:00.000Z'))).toMatch(UUID_SHAPE);
  });

  it('🔴 時刻が進むと辞書順でも大きくなる（カーソルページングの前提）', () => {
    const earlier = uuidV7(new Date('2026-09-04T12:00:00.000Z'));
    const later = uuidV7(new Date('2026-09-04T12:00:01.000Z'));
    expect(earlier < later).toBe(true);
  });

  it('同じ時刻でも衝突しない（乱数部が効いている）', () => {
    const at = new Date('2026-09-04T12:00:00.000Z');
    const values = new Set(Array.from({ length: 200 }, () => uuidV7(at)));
    expect(values.size).toBe(200);
  });

  it('先頭 48 bit が Unix ミリ秒である', () => {
    const at = new Date('2026-09-04T12:00:00.000Z');
    const hex = uuidV7(at).replace(/-/g, '').slice(0, 12);
    expect(Number.parseInt(hex, 16)).toBe(at.getTime());
  });

  it('不正な日時は例外にする', () => {
    expect(() => uuidV7(new Date('not-a-date'))).toThrow(RangeError);
  });
});

describe('uuidV7TimeOf（T-05-03。docs/05 §16.5 と同じ読み替え）', () => {
  it('🔴 生成に使った時刻をそのまま取り出せる（往復）', () => {
    const at = new Date('2026-09-06T01:23:45.678Z');
    expect(uuidV7TimeOf(uuidV7(at))?.toISOString()).toBe(at.toISOString());
  });

  it('ハイフン無し・大文字でも読める（DB から来る表記ゆれを吸収する）', () => {
    const at = new Date('2026-09-06T00:00:00.000Z');
    const value = uuidV7(at);
    expect(uuidV7TimeOf(value.replace(/-/g, '').toUpperCase())?.getTime()).toBe(at.getTime());
  });

  it('🔴 v7 でない UUID は null（時刻でない値を時刻として表示しない）', () => {
    // v4（バージョン桁が 4）。
    expect(uuidV7TimeOf('01930000-0000-4000-8000-000000000001')).toBeNull();
  });

  it('UUID の形をしていない文字列は null', () => {
    expect(uuidV7TimeOf('not-a-uuid')).toBeNull();
    expect(uuidV7TimeOf('')).toBeNull();
  });
});
