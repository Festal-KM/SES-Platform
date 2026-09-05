// apps/web/lib/jobs/account-mail.test.ts
// 🔴 CLAUDE.md §11.1「成功したように見えて実際には送信されていない」を作らないための検査。
//    キューが登録されていない状態で enqueue が**黙って成功しない**ことを固定する。
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_MAIL_KINDS,
  AccountMailQueueUnavailableError,
  AccountMailRecipientClassError,
  configureAccountMailQueue,
  PendingAccountMailQueue,
  requireAccountMailQueue,
  requireAccountMailRecipientClass,
  resetAccountMailQueue,
  type AccountMailJob,
} from './account-mail';

const JOB = {
  tenantId: '01930000-0000-7000-8000-0000000000a1',
  kind: 'INVITATION',
  targetId: '01930000-0000-7000-8000-000000000191',
  recipientClass: 'HOST_MEMBER',
  token: 'plaintext-token',
} as const;

afterEach(() => {
  resetAccountMailQueue();
});

describe('🔴 未登録のまま enqueue できない（fail-closed）', () => {
  it('🔴 キューの取り出しが例外になる（黙って捨てない / 副作用の前に落とせる）', () => {
    resetAccountMailQueue();
    expect(() => requireAccountMailQueue()).toThrow(AccountMailQueueUnavailableError);
  });
});

describe('PendingAccountMailQueue（development / demo）', () => {
  it('積んだ件数を数えられる（docs/05 §13.2 の callCount と同じ用途）', async () => {
    const queue = new PendingAccountMailQueue();
    configureAccountMailQueue(queue);

    expect(await requireAccountMailQueue().enqueue(JOB)).toBe('MOCKED');
    expect(await requireAccountMailQueue().enqueue({ ...JOB, kind: 'PASSWORD_RESET' })).toBe(
      'MOCKED',
    );

    expect(queue.callCount()).toBe(2);
    expect(queue.jobsOf('INVITATION')).toHaveLength(1);
    expect(queue.jobsOf('PASSWORD_RESET')).toHaveLength(1);
  });

  it('payload の平文トークンはそのまま保持される（ジョブ側が使う。DB には渡らない）', async () => {
    const queue = new PendingAccountMailQueue();
    configureAccountMailQueue(queue);
    await requireAccountMailQueue().enqueue(JOB);
    expect(queue.jobsOf('INVITATION')[0]?.token).toBe('plaintext-token');
  });
});

describe('payload の kind', () => {
  it('docs/05 §9.4 の 2 種だけである（増やすときは SP-04 のハンドラと対で）', () => {
    expect([...ACCOUNT_MAIL_KINDS]).toEqual(['INVITATION', 'PASSWORD_RESET']);
  });
});

describe('🔴 宛先分類は必須で、分類 1 / 2 しか載らない（docs/05 §8.2 / §9.4。T-04-02）', () => {
  it('分類 1 / 2 はそのまま通る', () => {
    expect(requireAccountMailRecipientClass('HOST_MEMBER')).toBe('HOST_MEMBER');
    expect(requireAccountMailRecipientClass('PARTNER_MEMBER')).toBe('PARTNER_MEMBER');
  });

  it.each(['CLIENT', 'ENGINEER', 'PLATFORM'] as const)(
    '🔴 %s は例外になる（fail-closed。黙って送信対象にしない）',
    (recipientClass) => {
      expect(() => requireAccountMailRecipientClass(recipientClass)).toThrow(
        AccountMailRecipientClassError,
      );
    },
  );

  it('🔴 分類を省略した payload はコンパイルエラーになる（型テスト）', () => {
    const { recipientClass, ...withoutClass } = JOB;
    // @ts-expect-error recipientClass は必須プロパティである（既定値を持たない。docs/05 §8.2）
    const job: AccountMailJob = withoutClass;
    expect(job.targetId).toBe(JOB.targetId);
    expect(recipientClass).toBe('HOST_MEMBER');
  });

  it('🔴 分類 3 / 4 を payload に書けない（型テスト）', () => {
    // @ts-expect-error 業務上の外部送信（分類 3）は account.mail に載せられない
    const job: AccountMailJob = { ...JOB, recipientClass: 'CLIENT' };
    expect(job.recipientClass).toBe('CLIENT');
  });
});
