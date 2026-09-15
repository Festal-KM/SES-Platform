// packages/domain/src/usage/storage-reconcile.test.ts
// 🔴 検算の判定（docs/05 §9.8 `usage.storage-reconcile`。許容差 0 / 自動補正はしない）。T-10-02。
import { describe, expect, it } from 'vitest';
import { reconcileStorageUsage } from './storage-reconcile.js';

describe('reconcileStorageUsage', () => {
  it('一致なら MATCH', () => {
    expect(reconcileStorageUsage({ counterBytes: 1024n, measuredBytes: 1024n })).toEqual({ kind: 'MATCH' });
    expect(reconcileStorageUsage({ counterBytes: 0n, measuredBytes: 0n })).toEqual({ kind: 'MATCH' });
  });

  it('🔴 1 バイトでも違えば DIVERGENCE（許容差 0）。符号は measured − counter', () => {
    expect(reconcileStorageUsage({ counterBytes: 1024n, measuredBytes: 1025n })).toEqual({ kind: 'DIVERGENCE', deltaBytes: 1n });
    expect(reconcileStorageUsage({ counterBytes: 2048n, measuredBytes: 1024n })).toEqual({ kind: 'DIVERGENCE', deltaBytes: -1024n });
  });

  it('負のバイト数は例外', () => {
    expect(() => reconcileStorageUsage({ counterBytes: -1n, measuredBytes: 0n })).toThrow(RangeError);
    expect(() => reconcileStorageUsage({ counterBytes: 0n, measuredBytes: -1n })).toThrow(RangeError);
  });
});
