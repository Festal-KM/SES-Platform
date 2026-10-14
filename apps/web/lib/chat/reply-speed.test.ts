// apps/web/lib/chat/reply-speed.test.ts
// `S-031` の「返信が早い取引先」と「要返信の印」（`lib/chat/reply-speed.ts`）。
import { describe, expect, it } from 'vitest';
import { fastReplyGroupKeys, isAwaitingReply, type ReplySample } from './reply-speed';

const BASE = Date.parse('2026-10-01T00:00:00.000Z');
const minutes = (value: number): Date => new Date(BASE + value * 60_000);

/** 会社 `key` のスレッド `thread` で、ホストが送って `delay` 分後に取引先が返す往復を `count` 回。 */
function exchanges(key: string, thread: string, delay: number, count = 3): ReplySample[] {
  return Array.from({ length: count }, (_, index) => [
    { threadId: thread, groupKey: key, fromPartner: false, sentAt: minutes(index * 1000) },
    { threadId: thread, groupKey: key, fromPartner: true, sentAt: minutes(index * 1000 + delay) },
  ]).flat();
}

describe('fastReplyGroupKeys', () => {
  it('🔴 上位 10%（最低 1 社）だけを返す。遅い会社には何も付けない', () => {
    const samples = [
      ...exchanges('A', 't-a', 5),
      ...exchanges('B', 't-b', 60),
      ...exchanges('C', 't-c', 120),
      ...exchanges('D', 't-d', 300),
    ];
    expect([...fastReplyGroupKeys(samples)]).toEqual(['A']);
  });

  it('20 社なら 2 社', () => {
    const samples = Array.from({ length: 20 }, (_, index) =>
      exchanges(`K${String(index).padStart(2, '0')}`, `t${String(index)}`, (index + 1) * 10),
    ).flat();
    expect([...fastReplyGroupKeys(samples)].sort()).toEqual(['K00', 'K01']);
  });

  it('🔴 比べられる会社が 3 社未満なら誰にも付けない', () => {
    expect(fastReplyGroupKeys([...exchanges('A', 't-a', 5), ...exchanges('B', 't-b', 60)]).size).toBe(0);
  });

  it('返信が 3 回に満たない会社は比べない', () => {
    const samples = [
      ...exchanges('A', 't-a', 1, 2),
      ...exchanges('B', 't-b', 60),
      ...exchanges('C', 't-c', 120),
      ...exchanges('D', 't-d', 300),
    ];
    expect([...fastReplyGroupKeys(samples)]).toEqual(['B']);
  });

  it('ホストの連投は最初の発言から数え、取引先の連投は最初の返信だけを数える', () => {
    const thread: ReplySample[] = [
      { threadId: 't', groupKey: 'A', fromPartner: false, sentAt: minutes(0) },
      { threadId: 't', groupKey: 'A', fromPartner: false, sentAt: minutes(30) },
      { threadId: 't', groupKey: 'A', fromPartner: true, sentAt: minutes(40) },
      { threadId: 't', groupKey: 'A', fromPartner: true, sentAt: minutes(41) },
    ];
    // A は 40 分（3 回分そろえる）。B / C はそれより遅い。
    const samples = [
      ...thread,
      ...thread.map((s) => ({ ...s, threadId: 't2' })),
      ...thread.map((s) => ({ ...s, threadId: 't3' })),
      ...exchanges('B', 't-b', 60),
      ...exchanges('C', 't-c', 120),
    ];
    expect([...fastReplyGroupKeys(samples)]).toEqual(['A']);
  });

  it('入力の順番に依らない', () => {
    const samples = [...exchanges('A', 't-a', 5), ...exchanges('B', 't-b', 60), ...exchanges('C', 't-c', 120)];
    expect([...fastReplyGroupKeys([...samples].reverse())]).toEqual(['A']);
  });
});

describe('isAwaitingReply', () => {
  it('最後の発言が相手からなら要返信', () => {
    expect(isAwaitingReply({ fromCounterparty: true })).toBe(true);
    expect(isAwaitingReply({ fromCounterparty: false })).toBe(false);
    expect(isAwaitingReply(null)).toBe(false);
  });
});
