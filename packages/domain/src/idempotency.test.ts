// packages/domain/src/idempotency.test.ts
// T-09-05: 冪等性キーが**決定的**で、`{entity}:{entity_id}:{attempt_seq}` の規約どおりであること（docs/05 §10.1）。
import { describe, expect, it } from 'vitest';
import {
  InvalidIdempotencyKeyInputError,
  idempotencyKey,
  isSendEntityType,
  isValidAttemptSeq,
  SEND_ENTITY_TYPES,
} from './idempotency.js';

const ENTITY_ID = '01930000-0000-7000-8000-000000000111';

describe('値集合（docs/05 §3.9 / §10.1）', () => {
  it('3 値ちょうどである（増減したら DB の CHECK と静的テストも動く）', () => {
    expect([...SEND_ENTITY_TYPES]).toEqual(['PROPOSAL', 'INTERVIEW', 'CONTRACT']);
  });

  it('isSendEntityType は未知の値を通さない（ジョブ名の接尾辞と混同しない）', () => {
    expect(isSendEntityType('INTERVIEW')).toBe(true);
    expect(isSendEntityType('INTERVIEW_INVITE')).toBe(false);
    expect(isSendEntityType('proposal')).toBe(false);
  });
});

describe('🔴 idempotencyKey は決定的である（docs/05 §10.1 / docs/03 §4.7）', () => {
  it('規約どおりの文字列を返し、同じ入力には常に同じ出力を返す', () => {
    const first = idempotencyKey('PROPOSAL', ENTITY_ID, 1);
    expect(first).toBe(`proposal:${ENTITY_ID}:1`);
    expect(idempotencyKey('PROPOSAL', ENTITY_ID, 1)).toBe(first);
    expect(idempotencyKey('CONTRACT', ENTITY_ID, 3)).toBe(`contract:${ENTITY_ID}:3`);
    expect(idempotencyKey('INTERVIEW', ENTITY_ID, 2)).toBe(`interview:${ENTITY_ID}:2`);
  });

  it('attemptSeq が違えば別のキー（人間の再送 = 新しいキー）、同じなら同じキー（再実行 = 送らない）', () => {
    expect(idempotencyKey('PROPOSAL', ENTITY_ID, 2)).not.toBe(idempotencyKey('PROPOSAL', ENTITY_ID, 1));
    expect(idempotencyKey('PROPOSAL', ENTITY_ID, 2)).toBe(idempotencyKey('PROPOSAL', ENTITY_ID, 2));
  });

  it('乱数を含まない（形が完全に固定されている）', () => {
    expect(idempotencyKey('PROPOSAL', ENTITY_ID, 1)).toMatch(/^proposal:[0-9a-f-]{36}:1$/);
  });

  it('🔴 不正な入力は例外にする（黙って壊れたキーを返さない）', () => {
    expect(() => idempotencyKey('PROPOSAL', '', 1)).toThrow(InvalidIdempotencyKeyInputError);
    expect(() => idempotencyKey('PROPOSAL', 'a:b', 1)).toThrow(InvalidIdempotencyKeyInputError);
    expect(() => idempotencyKey('PROPOSAL', ENTITY_ID, 0)).toThrow(InvalidIdempotencyKeyInputError);
    expect(() => idempotencyKey('PROPOSAL', ENTITY_ID, 1.5)).toThrow(InvalidIdempotencyKeyInputError);
    expect(() => idempotencyKey('PROPOSAL', ENTITY_ID, Number.NaN)).toThrow(InvalidIdempotencyKeyInputError);
    // 実行時に文字列で来る値（DB / payload）を型を広げて渡した場合も通さない。
    expect(() => idempotencyKey('EMAIL' as never, ENTITY_ID, 1)).toThrow(InvalidIdempotencyKeyInputError);
  });

  it('isValidAttemptSeq は 1 以上の整数だけを通す', () => {
    expect(isValidAttemptSeq(1)).toBe(true);
    expect(isValidAttemptSeq(2)).toBe(true);
    expect(isValidAttemptSeq(0)).toBe(false);
    expect(isValidAttemptSeq(-1)).toBe(false);
    expect(isValidAttemptSeq(1.5)).toBe(false);
  });
});
