// packages/connectors/src/email/delivery-mode.test.ts
// 🔴 docs/05 §13.2 / §9.7: `SENT` と `MOCKED` の記録を取り違えない。
//    `tenant.purge-scan` は「削除予告が配送済みか」をこの状態で判定する（`F-064 AC-10`）ため、
//    取り違えると**予告が届いていないテナントのデータを削除しうる**。
import { describe, expect, it } from 'vitest';
import { RECIPIENT_CLASSES } from '../types.js';
import { isMockedDelivery } from './delivery-mode.js';
import { SandboxRecipientScopedEmailSender } from './sandbox-recipient-scoped.js';
import { MockEmailSender } from '../mock/email.js';

describe('isMockedDelivery（docs/05 §13.2）', () => {
  it.each([...RECIPIENT_CLASSES])('mock（development / demo）では %s もモック', (recipientClass) => {
    expect(isMockedDelivery('mock', recipientClass)).toBe(true);
  });

  it.each([...RECIPIENT_CLASSES])('real（staging / production）では %s も実送信', (recipientClass) => {
    expect(isMockedDelivery('real', recipientClass)).toBe(false);
  });

  it('🔴 sandbox は分類 1 / 分類外だけ実送信、それ以外はモック（Issue #9 / #10）', () => {
    expect(isMockedDelivery('sandboxRecipientScoped', 'HOST_MEMBER')).toBe(false);
    expect(isMockedDelivery('sandboxRecipientScoped', 'PLATFORM')).toBe(false);
    expect(isMockedDelivery('sandboxRecipientScoped', 'PARTNER_MEMBER')).toBe(true);
    expect(isMockedDelivery('sandboxRecipientScoped', 'CLIENT')).toBe(true);
    expect(isMockedDelivery('sandboxRecipientScoped', 'ENGINEER')).toBe(true);
  });
});

describe('🔴 実際の振り分けと判定が一致する（記録と現実がずれない）', () => {
  it.each([...RECIPIENT_CLASSES])(
    'sandbox の %s について、モックへ流れたか否かと isMockedDelivery が一致する',
    async (recipientClass) => {
      const real = new MockEmailSender();
      const mock = new MockEmailSender();
      const sender = new SandboxRecipientScopedEmailSender({ real, mock });

      await sender.send({
        recipientClass,
        to: 'someone@example.co.jp',
        templateKey: 'T',
        params: {},
        tenantId: '01930000-0000-7000-8000-0000000000a1',
        // 分類 2 / 3 / 4 は検証済みドメインが要る（`BR-51`）。振り分けの検証が目的なので満たす。
        fromDomain: {
          domain: 'example.co.jp',
          mailFromDomain: 'mail.example.co.jp',
          verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        token: {
          idempotencyKey: 'PROPOSAL:p1:1',
          attemptSeq: 1,
          entityType: 'PROPOSAL',
          entityId: 'p1',
        } as never,
      });

      const wentToMock = mock.callCount() === 1;
      expect(wentToMock).toBe(isMockedDelivery('sandboxRecipientScoped', recipientClass));
      expect(real.callCount() + mock.callCount()).toBe(1);
    },
  );
});
