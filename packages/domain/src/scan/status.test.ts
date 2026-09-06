// packages/domain/src/scan/status.test.ts
// 🔴 T-05-05 の中核: 「`CLEAN` へ戻さない」「判定不能を `CLEAN` にしない」「順序逆転に依存しない」。
import { describe, expect, it } from 'vitest';
import {
  decideScanStatusTransition,
  InvalidScanStatusTransitionError,
  isScanStatus,
  isShareableScanStatus,
  scanStatusesReplaceableBy,
  SCAN_STATUSES,
  type ScanStatus,
} from './status.js';

/** 確定結果（`SCANNING` 以外）。スキャン結果として届きうる値。 */
const RESOLVED: readonly ScanStatus[] = SCAN_STATUSES.filter((status) => status !== 'SCANNING');

function apply(current: ScanStatus, incoming: ScanStatus): ScanStatus {
  return decideScanStatusTransition({ current, incoming }) === 'APPLY' ? incoming : current;
}

describe('値集合（docs/05 §3.4）', () => {
  it('5 値ちょうどである（増減したら DB の CHECK と静的テストも動く）', () => {
    expect([...SCAN_STATUSES]).toEqual(['SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED']);
  });

  it('isScanStatus は未知の値を通さない', () => {
    expect(isScanStatus('CLEAN')).toBe(true);
    expect(isScanStatus('NO_THREATS_FOUND')).toBe(false);
    expect(isScanStatus('')).toBe(false);
  });
});

describe('🔴 共有可は CLEAN だけ（BR-26 / docs/03 §3.4.3-3）', () => {
  it.each([...SCAN_STATUSES])('%s', (status) => {
    expect(isShareableScanStatus(status)).toBe(status === 'CLEAN');
  });
});

describe('🔴 THREATS_FOUND の後に NO_THREATS_FOUND が来ても CLEAN に戻さない（docs/05 §8.5）', () => {
  it('INFECTED → CLEAN は KEEP', () => {
    expect(decideScanStatusTransition({ current: 'INFECTED', incoming: 'CLEAN' })).toBe('KEEP');
  });

  it('🔴 UNSCANNABLE / FAILED からも CLEAN へ戻らない（同じ性質の抜け道を残さない）', () => {
    expect(decideScanStatusTransition({ current: 'UNSCANNABLE', incoming: 'CLEAN' })).toBe('KEEP');
    expect(decideScanStatusTransition({ current: 'FAILED', incoming: 'CLEAN' })).toBe('KEEP');
  });

  it('INFECTED は UNSCANNABLE / FAILED でも上書きされない（感染の記録が消えない）', () => {
    expect(decideScanStatusTransition({ current: 'INFECTED', incoming: 'UNSCANNABLE' })).toBe('KEEP');
    expect(decideScanStatusTransition({ current: 'INFECTED', incoming: 'FAILED' })).toBe('KEEP');
  });

  it('🔴 CLEAN → INFECTED は APPLY（安全側へは動く。同一キーへの再 PUT で新しい版が感染した場合）', () => {
    expect(decideScanStatusTransition({ current: 'CLEAN', incoming: 'INFECTED' })).toBe('APPLY');
    expect(decideScanStatusTransition({ current: 'CLEAN', incoming: 'FAILED' })).toBe('APPLY');
    expect(decideScanStatusTransition({ current: 'CLEAN', incoming: 'UNSCANNABLE' })).toBe('APPLY');
  });
});

describe('🔴 SCANNING（未確定）の扱い', () => {
  it.each([...RESOLVED])('SCANNING → %s は APPLY（初回確定）', (incoming) => {
    expect(decideScanStatusTransition({ current: 'SCANNING', incoming })).toBe('APPLY');
  });

  it.each([...SCAN_STATUSES])('🔴 %s → SCANNING は適用できない（例外）', (current) => {
    expect(() => decideScanStatusTransition({ current, incoming: 'SCANNING' })).toThrow(
      InvalidScanStatusTransitionError,
    );
  });
});

describe('🔴 冪等（重複配信）', () => {
  it.each([...RESOLVED])('同じ結果を 2 回適用しても状態は 1 度しか動かない（%s）', (incoming) => {
    expect(decideScanStatusTransition({ current: 'SCANNING', incoming })).toBe('APPLY');
    // 1 回目の適用後は同じ結果でも KEEP になる（＝ DB の CAS が 0 件更新になる）。
    expect(decideScanStatusTransition({ current: incoming, incoming })).toBe('KEEP');
  });
});

describe('🔴 順序逆転しても最終状態が同じ（at-least-once の要求。docs/03 §3.4.3-2）', () => {
  it.each(
    RESOLVED.flatMap((a) => RESOLVED.map((b) => [a, b] as const)).filter(([a, b]) => a !== b),
  )('%s → %s と %s → %s（逆順）で同じ結果になる', (first, second) => {
    const forward = apply(apply('SCANNING', first), second);
    const backward = apply(apply('SCANNING', second), first);
    expect(forward).toBe(backward);
  });

  it('具体例: THREATS_FOUND(INFECTED) → NO_THREATS_FOUND(CLEAN) はどちらの順でも INFECTED', () => {
    expect(apply(apply('SCANNING', 'INFECTED'), 'CLEAN')).toBe('INFECTED');
    expect(apply(apply('SCANNING', 'CLEAN'), 'INFECTED')).toBe('INFECTED');
  });
});

describe('scanStatusesReplaceableBy（DB の CAS 述語）', () => {
  it('CLEAN で置き換えてよいのは SCANNING だけ', () => {
    expect([...scanStatusesReplaceableBy('CLEAN')]).toEqual(['SCANNING']);
  });

  it('INFECTED は他のすべてを置き換えられる（最も強い）', () => {
    expect([...scanStatusesReplaceableBy('INFECTED')].sort()).toEqual(
      ['CLEAN', 'FAILED', 'SCANNING', 'UNSCANNABLE'].sort(),
    );
  });

  it('自分自身を含まない（同じ結果の再適用は必ず 0 件更新になる）', () => {
    for (const status of RESOLVED) {
      expect(scanStatusesReplaceableBy(status)).not.toContain(status);
    }
  });

  it('🔴 SCANNING を渡すと例外（空配列を返して静かに no-op にしない）', () => {
    expect(() => scanStatusesReplaceableBy('SCANNING')).toThrow(InvalidScanStatusTransitionError);
  });
});
