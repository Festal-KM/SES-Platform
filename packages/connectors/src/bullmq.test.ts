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
// 🔴 Redis に接続しない。`Queue` / `Worker` を作らず、写像の関数だけを呼ぶ。
import { describe, expect, it } from 'vitest';
import { bullMqBackoffStrategy, toBullMqJobOptions, UnsupportedQueueOptionError } from './bullmq.js';
import { EMAIL_DISPATCH_BACKOFF_DELAYS_MS, queueDefinition } from './queues.js';

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
