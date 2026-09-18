// packages/connectors/src/bullmq.test.ts
// 🔴 T-07-10: `stepped` バックオフ（docs/05 §9.1 / §9.4 の 5s / 30s）の **BullMQ への写像**を固定する。
//
// なぜ要るか（T-07-08 の申し送り ②）:
//   T-07-08 の時点では `stepped` を写像できず `UnsupportedQueueOptionError` で落としていた。
//   組み込み戦略（`fixed` / `exponential`）で近似すると、**設計値と実際の待ち時間が黙ってずれる**
//   （`fixed` は毎回同じ、`exponential` は 5s の次が 10s）。したがって写像は
//   「カスタム戦略の名前だけを渡し、待ち時間は `steppedBackoffDelayMs`（純粋関数）が計算する」形にした。
//   ここで固定するのは **その 2 つが同じ表（`QUEUE_DEFINITIONS`）から出ていること**である。
//
// 🔴 T-12-17 ⑥: failed セットの読み取り（`createBullMqFailedJobsReader` の中身 `bullMqFailedJobsSource` +
//    `readFailedJobsSnapshot`）が **`gate.run` 以外で `Job` ハッシュを取得しない**ことも固定する（下段）。
//    `account.mail` の failed ジョブの `data` には平文トークンが載る（docs/05 §9.4）。旧実装は全キューで
//    `getFailed(0, 0)` を呼び、ハッシュ全体をプロセスのメモリに乗せてから時刻だけを写していた。
//
// 🔴 Redis に接続しない。`Queue` / `Worker` を作らず、写像の関数だけを呼ぶ。
import { describe, expect, it, vi } from 'vitest';
import {
  bullMqBackoffStrategy,
  bullMqFailedJobsSource,
  readFailedJobsSnapshot,
  toBullMqJobOptions,
  UnsupportedQueueOptionError,
  type FailedJobsQueue,
} from './bullmq.js';
import { EMAIL_DISPATCH_BACKOFF_DELAYS_MS, QUEUE_DEFINITIONS, queueDefinition, type QueueName } from './queues.js';

describe('🔴 既定ジョブオプションの写像（docs/05 §9.1）', () => {
  it('gate.run は attempts: 1 と removeOnComplete: true をそのまま渡す（値を作らない）', () => {
    const definition = queueDefinition('gate.run');
    expect(toBullMqJobOptions(definition.name, definition.defaultJobOptions)).toEqual({
      attempts: 1,
      removeOnComplete: true,
    });
  });

  it('gate.hold-release は attempts: 3 だけを渡す（removeOnComplete を付けない）', () => {
    const definition = queueDefinition('gate.hold-release');
    expect(toBullMqJobOptions(definition.name, definition.defaultJobOptions)).toEqual({ attempts: 3 });
  });

  it('組み込みのバックオフ（exponential）は type と delay をそのまま渡す', () => {
    const definition = queueDefinition('webhook.process');
    expect(toBullMqJobOptions(definition.name, definition.defaultJobOptions)).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
  });

  it('🔴 stepped は「カスタム戦略の名前」だけを渡す（delay を作らない = 近似しない）', () => {
    const definition = queueDefinition('email.dispatch');
    expect(toBullMqJobOptions(definition.name, definition.defaultJobOptions)).toEqual({
      attempts: 3,
      backoff: { type: 'stepped' },
    });
  });
});

describe('🔴 Worker に渡すバックオフ戦略（docs/05 §9.1「計算を 2 箇所に散らさない」）', () => {
  it('email.dispatch の待ち時間は定義の表（5s / 30s）そのものである', () => {
    const strategy = bullMqBackoffStrategy('email.dispatch');
    expect(strategy(1, 'stepped')).toBe(EMAIL_DISPATCH_BACKOFF_DELAYS_MS[0]);
    expect(strategy(2, 'stepped')).toBe(EMAIL_DISPATCH_BACKOFF_DELAYS_MS[1]);
    // 🔴 表を超えても最後の値（0 を返すと即時再試行になる）。
    expect(strategy(9, 'stepped')).toBe(EMAIL_DISPATCH_BACKOFF_DELAYS_MS[1]);
  });

  it('account.mail も同じ表を使う（運用メールで待ち方を変える理由が無い）', () => {
    expect(bullMqBackoffStrategy('account.mail')(1, 'stepped')).toBe(
      bullMqBackoffStrategy('email.dispatch')(1, 'stepped'),
    );
  });

  it('🔴 表を持たないキューでカスタム戦略が要求されたら落とす（0 を返して即時再試行にしない）', () => {
    // BullMQ は `backoff.type` がカスタム名のときしか呼ばないため、通常は到達しない経路である。
    expect(() => bullMqBackoffStrategy('gate.run')(1, 'stepped')).toThrow(UnsupportedQueueOptionError);
    expect(() => bullMqBackoffStrategy('gate.hold-release')(1, 'stepped')).toThrow(
      UnsupportedQueueOptionError,
    );
  });
});

describe('🔴 T-12-17 ⑥: failed セットの読み取りは gate.run 以外で Job ハッシュを取得しない', () => {
  const FAILED_AT = 1_757_000_000_000;

  /** 偽の Redis: `zrevrange` はスコアを返し、`hgetall` は呼ばれたら落とす（到達しないことの表明）。 */
  function fakeRedis(scores: Partial<Record<QueueName, number>>) {
    return {
      zrevrange: vi.fn(async (key: string) => {
        const match = /^bull:(.+):failed$/.exec(key);
        const name = match?.[1] as QueueName | undefined;
        const score = name === undefined ? undefined : scores[name];
        return score === undefined ? [] : ['job-1', String(score)];
      }),
      hgetall: vi.fn(async () => {
        throw new Error('HGETALL に到達してはならない');
      }),
    };
  }

  /** 偽の Queue: `getFailed`（`Job` ハッシュの取得）は gate.run 以外で呼ばれたら落とす。 */
  function fakeQueues(counts: Partial<Record<QueueName, number>>, gateRunJobs: readonly unknown[] = []) {
    const getFailedCalls: QueueName[] = [];
    const resolve = (name: QueueName): FailedJobsQueue => {
      const queue = {
        getFailedCount: async () => counts[name] ?? 0,
        getFailed: async () => {
          getFailedCalls.push(name);
          if (name !== 'gate.run') throw new Error(`${name} の Job ハッシュを読んではならない`);
          return gateRunJobs;
        },
        toKey: (type: string) => `bull:${name}:${type}`,
      };
      return queue as unknown as FailedJobsQueue;
    };
    return { resolve, getFailedCalls };
  }

  it('account.mail の failed が在っても getFailed（HGETALL）を呼ばず、時刻は failed ZSET のスコアから取る', async () => {
    const redis = fakeRedis({ 'account.mail': FAILED_AT, 'email.dispatch': FAILED_AT - 1000 });
    const { resolve, getFailedCalls } = fakeQueues({ 'account.mail': 3, 'email.dispatch': 1 });

    const snapshot = await readFailedJobsSnapshot(bullMqFailedJobsSource(redis, resolve));

    expect(getFailedCalls).toEqual([]);
    expect(redis.hgetall).not.toHaveBeenCalled();
    expect(redis.zrevrange).toHaveBeenCalledWith('bull:account.mail:failed', 0, 0, 'WITHSCORES');
    const accountMail = snapshot.byQueue.find((entry) => entry.queueName === 'account.mail');
    expect(accountMail).toEqual({ queueName: 'account.mail', count: 3, lastFailedAt: new Date(FAILED_AT) });
    expect(snapshot.total).toBe(4);
    expect(snapshot.gateRun).toEqual([]);
  });

  it('0 件のキューは zrevrange も呼ばない（定義済みの全キューが byQueue に並ぶ）', async () => {
    const redis = fakeRedis({});
    const { resolve } = fakeQueues({});

    const snapshot = await readFailedJobsSnapshot(bullMqFailedJobsSource(redis, resolve));

    expect(redis.zrevrange).not.toHaveBeenCalled();
    expect(snapshot.byQueue.map((entry) => entry.queueName)).toEqual(Object.keys(QUEUE_DEFINITIONS));
    expect(snapshot.byQueue.every((entry) => entry.count === 0 && entry.lastFailedAt === null)).toBe(true);
  });

  it('gate.run だけは Job を読んで payload の 3 つの ID を写す（時刻は finishedOn）', async () => {
    const job = {
      id: 'g-1',
      data: { tenantId: 't-1', targetType: 'PROPOSAL', targetId: 'p-1' },
      finishedOn: FAILED_AT,
      timestamp: FAILED_AT - 5000,
    };
    const redis = fakeRedis({ 'gate.run': FAILED_AT });
    const { resolve, getFailedCalls } = fakeQueues({ 'gate.run': 1 }, [job]);

    const snapshot = await readFailedJobsSnapshot(bullMqFailedJobsSource(redis, resolve));

    expect(getFailedCalls).toEqual(['gate.run']);
    expect(snapshot.gateRun).toEqual([
      { tenantId: 't-1', targetType: 'PROPOSAL', targetId: 'p-1', failedAt: new Date(FAILED_AT) },
    ]);
    expect(snapshot.gateRunTruncated).toBe(false);
  });

  it('gate.run の payload が形に合わなければ黙って捨てずに落とす', async () => {
    const redis = fakeRedis({ 'gate.run': FAILED_AT });
    const { resolve } = fakeQueues({ 'gate.run': 1 }, [{ id: 'g-2', data: { token: 'x' }, finishedOn: FAILED_AT, timestamp: FAILED_AT }]);

    await expect(readFailedJobsSnapshot(bullMqFailedJobsSource(redis, resolve))).rejects.toThrow('GateRunJob の形ではありません');
  });

  it('壊れたスコアは時刻不明（null）にし、件数は保つ', async () => {
    const redis = {
      zrevrange: vi.fn(async () => ['job-1', 'not-a-number']),
      hgetall: vi.fn(),
    };
    const { resolve } = fakeQueues({ 'account.mail': 1 });

    const snapshot = await readFailedJobsSnapshot(bullMqFailedJobsSource(redis, resolve));

    const accountMail = snapshot.byQueue.find((entry) => entry.queueName === 'account.mail');
    expect(accountMail).toEqual({ queueName: 'account.mail', count: 1, lastFailedAt: null });
  });
});
