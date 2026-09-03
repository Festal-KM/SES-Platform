// apps/web/lib/jobs/account-mail.test.ts
// 🔴 CLAUDE.md §11.1「成功したように見えて実際には送信されていない」を作らないための検査。
//    キューが登録されていない状態で enqueue が**黙って成功しない**ことを固定する。
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_MAIL_KINDS,
  AccountMailQueueUnavailableError,
  configureAccountMailQueue,
  PendingAccountMailQueue,
  requireAccountMailQueue,
  resetAccountMailQueue,
} from './account-mail';

const JOB = {
  tenantId: '01930000-0000-7000-8000-0000000000a1',
  kind: 'INVITATION',
  targetId: '01930000-0000-7000-8000-000000000191',
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
