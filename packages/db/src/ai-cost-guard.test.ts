// packages/db/src/ai-cost-guard.test.ts
// 🔴 予約証（`AiCostReservation.handle`）の往復。T-07-04。
//
// DB を要する部分（原子性・並行実行・RLS・日またぎ）は `tests/isolation/ai-cost-guard.test.ts` が
// 実 DB で実証する。ここは**値の変換だけ**を見る（DB を立てずに固定できる部分を毎回の CI に載せる）。
//
// 🔴 なぜ証の検査が要るか: 証が壊れていると `settle` が**別の日の行**を補正する。予約は残り、
//    実コストは違う日に積まれる —— どちらも「動いているのに数字が合わない」壊れ方であり、
//    上限（`F-027`）が静かに効かなくなる。
import { describe, expect, it } from 'vitest';
import {
  decodeAiCostReservationHandle,
  encodeAiCostReservationHandle,
} from './ai-cost-guard.js';

describe('AI コスト予約の証（encode / decode）', () => {
  it('予約した日と額を往復できる', () => {
    const handle = encodeAiCostReservationHandle('2026-09-08', '0.031500');
    expect(handle).toBe('v1:2026-09-08:31500');
    expect(decodeAiCostReservationHandle(handle)).toEqual({
      periodKey: '2026-09-08',
      reservedUsd: '0.031500',
    });
  });

  it('0 円の予約も表現できる（見積りが極小のロール）', () => {
    expect(decodeAiCostReservationHandle(encodeAiCostReservationHandle('2026-09-08', '0'))).toEqual({
      periodKey: '2026-09-08',
      reservedUsd: '0.000000',
    });
  });

  it('🔴 壊れた証は握り潰さず例外にする（別の日の行を補正させない）', () => {
    for (const broken of [
      '',
      'v1:2026-09-08',
      'v2:2026-09-08:31500',
      'v1:20260908:31500',
      'v1:2026-09-08:abc',
      'v1:2026-09-08:-1',
      'v1:2026-09-08:31500:extra',
    ]) {
      expect(() => decodeAiCostReservationHandle(broken)).toThrow(RangeError);
    }
  });

  it('🔴 金額として不正な値は証にできない（SQL へ渡る前に落ちる）', () => {
    expect(() => encodeAiCostReservationHandle('2026-09-08', '1e-7')).toThrow(RangeError);
  });
});
