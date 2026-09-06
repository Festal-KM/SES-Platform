// packages/connectors/src/email/dispatch.test.ts
// T-04-02 の**型テスト**（docs/05 §9.4）。`queues.test.ts` と同じ方式で、
// `tsconfig.typecheck.json`（テストも型検査する）が `@ts-expect-error` を評価する。
//
// 🔴 ここで固定するのは「**分類 3 / 4（提案先・エンジニア本人）の宛先を `email.dispatch` に
//    渡せない**」ことである。渡せてしまうと、`attempts: 3` の再試行が業務上の外部送信に掛かる
//    （`BR-21` 違反）。
// 🔴 T-05-08 で分類 2（パートナー所属利用者）は載せられるようになった（`F-011` 処理④ の周知が
//    パートナー側の担当者にも届く必要があるため）。**`sandbox` でのモック化は別判定**であり、
//    そちらは `delivery-mode.test.ts` / `sandbox-recipient-scoped.test.ts` が固定する。
import { describe, expect, it } from 'vitest';
import {
  HOST_OR_PLATFORM_RECIPIENT_CLASSES,
  isMockedDelivery,
  OPERATIONAL_MAIL_RECIPIENT_CLASSES,
  RECIPIENT_CLASSES,
} from '../index.js';
import type { OperationalMailDispatch } from './dispatch.js';

const BASE = { dispatchId: '01930000-0000-7000-8000-000000000191', tenantId: null } as const;

describe('🔴 email.dispatch の payload は分類 1 / 2 / 分類外しか受け取らない（docs/05 §9.4）', () => {
  it('分類 1（HOST_MEMBER）を載せられる', () => {
    const payload: OperationalMailDispatch = { ...BASE, recipientClass: 'HOST_MEMBER' };
    expect(payload.recipientClass).toBe('HOST_MEMBER');
  });

  it('分類外（PLATFORM）を載せられる（運営者宛は tenantId が null）', () => {
    const payload: OperationalMailDispatch = { ...BASE, recipientClass: 'PLATFORM' };
    expect(payload.tenantId).toBeNull();
  });

  it('🔴 T-05-08: 分類 2（PARTNER_MEMBER）を載せられる（F-011 処理④ の周知）', () => {
    const payload: OperationalMailDispatch = { ...BASE, recipientClass: 'PARTNER_MEMBER' };
    expect(payload.recipientClass).toBe('PARTNER_MEMBER');
  });

  it('🔴 分類 3 / 4 はコンパイルエラーになる（型テスト）', () => {
    // @ts-expect-error 分類 3（提案先・エンド企業）は email.dispatch に載せられない
    const client: OperationalMailDispatch = { ...BASE, recipientClass: 'CLIENT' };
    // @ts-expect-error 分類 4（エンジニア本人）は email.dispatch に載せられない
    const engineer: OperationalMailDispatch = { ...BASE, recipientClass: 'ENGINEER' };

    // 実行時にも「渡ってきていない」ことを確かめる（型テストが空振りしていない対照）。
    expect([client, engineer].map((p) => p.recipientClass)).toEqual(['CLIENT', 'ENGINEER']);
  });

  it('🔴 分類の省略はコンパイルエラーになる（既定値を持たない。docs/05 §8.2）', () => {
    // @ts-expect-error recipientClass は必須プロパティである
    const withoutClass: OperationalMailDispatch = { ...BASE };
    expect(withoutClass.dispatchId).toBe(BASE.dispatchId);
  });

  it('対照: 受け入れる分類は 5 分類のうち 3 つだけである', () => {
    expect(OPERATIONAL_MAIL_RECIPIENT_CLASSES).toHaveLength(3);
    expect(RECIPIENT_CLASSES).toHaveLength(5);
  });

  it('🔴 キューに載せられること ≠ sandbox で実送信されること（分類 2 はモックのまま）', () => {
    // 🔴 この 2 つを混ぜると「sandbox から取引先へ実メールが飛ぶ」（CLAUDE.md §11.1）。
    expect(HOST_OR_PLATFORM_RECIPIENT_CLASSES).toHaveLength(2);
    expect(isMockedDelivery('sandboxRecipientScoped', 'PARTNER_MEMBER')).toBe(true);
    expect(isMockedDelivery('sandboxRecipientScoped', 'HOST_MEMBER')).toBe(false);
  });
});
