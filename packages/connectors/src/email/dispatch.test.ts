// packages/connectors/src/email/dispatch.test.ts
// T-04-02 の**型テスト**（docs/05 §9.4）。`queues.test.ts` と同じ方式で、
// `tsconfig.typecheck.json`（テストも型検査する）が `@ts-expect-error` を評価する。
//
// 🔴 ここで固定するのは「分類 2 / 3 / 4 の宛先を `email.dispatch` に渡せない」ことである。
//    渡せてしまうと、`attempts: 3` の再試行が取引先へ届くメールに掛かる（`BR-21` 違反）。
import { describe, expect, it } from 'vitest';
import { HOST_OR_PLATFORM_RECIPIENT_CLASSES, RECIPIENT_CLASSES } from '../types.js';
import type { HostOrPlatformDispatch } from './dispatch.js';

const BASE = { dispatchId: '01930000-0000-7000-8000-000000000191', tenantId: null } as const;

describe('🔴 email.dispatch の payload は分類 1 / 分類外しか受け取らない（docs/05 §9.4）', () => {
  it('分類 1（HOST_MEMBER）を載せられる', () => {
    const payload: HostOrPlatformDispatch = { ...BASE, recipientClass: 'HOST_MEMBER' };
    expect(payload.recipientClass).toBe('HOST_MEMBER');
  });

  it('分類外（PLATFORM）を載せられる（運営者宛は tenantId が null）', () => {
    const payload: HostOrPlatformDispatch = { ...BASE, recipientClass: 'PLATFORM' };
    expect(payload.tenantId).toBeNull();
  });

  it('🔴 分類 2 / 3 / 4 はコンパイルエラーになる（型テスト）', () => {
    // @ts-expect-error 分類 2（パートナー所属利用者）は email.dispatch に載せられない
    const partner: HostOrPlatformDispatch = { ...BASE, recipientClass: 'PARTNER_MEMBER' };
    // @ts-expect-error 分類 3（提案先・エンド企業）は email.dispatch に載せられない
    const client: HostOrPlatformDispatch = { ...BASE, recipientClass: 'CLIENT' };
    // @ts-expect-error 分類 4（エンジニア本人）は email.dispatch に載せられない
    const engineer: HostOrPlatformDispatch = { ...BASE, recipientClass: 'ENGINEER' };

    // 実行時にも「渡ってきていない」ことを確かめる（型テストが空振りしていない対照）。
    expect([partner, client, engineer].map((p) => p.recipientClass)).toEqual([
      'PARTNER_MEMBER',
      'CLIENT',
      'ENGINEER',
    ]);
  });

  it('🔴 分類の省略はコンパイルエラーになる（既定値を持たない。docs/05 §8.2）', () => {
    // @ts-expect-error recipientClass は必須プロパティである
    const withoutClass: HostOrPlatformDispatch = { ...BASE };
    expect(withoutClass.dispatchId).toBe(BASE.dispatchId);
  });

  it('対照: 受け入れる分類は 5 分類のうち 2 つだけである', () => {
    expect(HOST_OR_PLATFORM_RECIPIENT_CLASSES).toHaveLength(2);
    expect(RECIPIENT_CLASSES).toHaveLength(5);
  });
});
