// packages/connectors/src/email/sandbox-recipient-scoped.test.ts
// T-04-02: 🔴 `sandbox` の実送信が**分類 1 と分類外だけ**であること
//    （`docs/02` 章 7.6 NFR-ENV-1 ②③ / docs/05 §8.2 の表 / [Issue #9] / [Issue #10]）。
//
// 🔴 ここが崩れると、`sandbox` から実在の取引先企業の担当者・提案先へメールが届く。
//    `CLAUDE.md` §7 の「0 件」に数える事故であり、E2E（T-04-10）を待たずに固定する。
import { describe, expect, it } from 'vitest';
import { MockEmailSender } from '../mock/index.js';
import { RECIPIENT_CLASSES, type RecipientClass, type VerifiedSendingDomain } from '../types.js';
import type { DispatchToken } from '../types.js';
import { SandboxRecipientScopedEmailSender } from './sandbox-recipient-scoped.js';

const VERIFIED_DOMAIN: VerifiedSendingDomain = {
  domain: 'example.co.jp',
  mailFromDomain: 'mail.example.co.jp',
  verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
};

/** `EmailDispatch` 行の作成に成功したときだけ `packages/db` が返すトークン（テストでは直接組む）。 */
const TOKEN = {
  dispatchId: '01930000-0000-7000-8000-000000000191',
  dedupeKey: 'INVITATION:01930000-0000-7000-8000-000000000191:0123456789abcdef',
} as unknown as DispatchToken;

function inputOf(recipientClass: RecipientClass) {
  return {
    recipientClass,
    to: 'someone@example.co.jp',
    templateKey: 'INVITATION',
    params: {},
    tenantId: '01930000-0000-7000-8000-0000000000a1',
    // 🔴 分類 2 / 3 / 4 は検証済みドメインが無いと実装が throw する（docs/05 §8.3）。
    //    ここで検証したいのは振り分けなので、常に検証済みを渡す。
    fromDomain: VERIFIED_DOMAIN,
    token: TOKEN,
  };
}

function build(): {
  sender: SandboxRecipientScopedEmailSender;
  real: MockEmailSender;
  mock: MockEmailSender;
} {
  // 🔴 「実送信側」も検証ではモックで代用する（実 API を叩かない）。実装が渡す `real` は
  //    T-04-03 の SES 実装であり、ここで見たいのは**どちらへ振り分けたか**だけである。
  const real = new MockEmailSender();
  const mock = new MockEmailSender();
  return { sender: new SandboxRecipientScopedEmailSender({ real, mock }), real, mock };
}

describe('🔴 sandbox の振り分けは宛先分類だけで決まる（docs/02 章 7.6 NFR-ENV-1）', () => {
  it.each(['HOST_MEMBER', 'PLATFORM'] as const)('分類 1 / 分類外（%s）は実送信側へ行く', async (recipientClass) => {
    const { sender, real, mock } = build();

    await sender.send(inputOf(recipientClass));

    expect(real.callCount()).toBe(1);
    expect(mock.callCount()).toBe(0);
  });

  it.each(['PARTNER_MEMBER', 'CLIENT', 'ENGINEER'] as const)(
    '🔴 分類 2 / 3 / 4（%s）はモックへ行く（実在の取引先・第三者に届かない）',
    async (recipientClass) => {
      const { sender, real, mock } = build();

      await sender.send(inputOf(recipientClass));

      expect(real.callCount()).toBe(0);
      expect(mock.callCount()).toBe(1);
    },
  );

  it('🔴 全 5 分類を網羅しても、実送信側に届くのは分類 1 と分類外の 2 通だけである', async () => {
    const { sender, real, mock } = build();

    for (const recipientClass of RECIPIENT_CLASSES) {
      await sender.send(inputOf(recipientClass));
    }

    expect(real.callCount()).toBe(2);
    expect(mock.callCount()).toBe(3);
    expect(sender.callCount()).toBe(RECIPIENT_CLASSES.length);
    expect(real.callsOf('PARTNER_MEMBER')).toHaveLength(0);
    expect(real.callsOf('CLIENT')).toHaveLength(0);
    expect(real.callsOf('ENGINEER')).toHaveLength(0);
  });

  it('送信基盤の 24h 枠は実送信側の値を返す（モックに流した分は枠を消費していない）', async () => {
    const { sender, mock } = build();

    await sender.send(inputOf('CLIENT'));
    await sender.send(inputOf('PARTNER_MEMBER'));

    expect(mock.callCount()).toBe(2);
    expect((await sender.getQuota()).sentLast24h).toBe(0);
  });
});
