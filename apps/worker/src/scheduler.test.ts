// apps/worker/src/scheduler.test.ts
// 🔴 T-07-11。`runScheduled`（docs/05 §9.1）の 3 つの責務を固定する:
//    ① slot の取り出し（**現在時刻を使わない**）② 1 slot 1 回 ③ 結果 / 例外の確定。
//
// 🔴 DB は差し替える（実 DB での「二重起動でハンドラが 1 回」は
//    `tests/isolation/scheduler-fanout.test.ts` が UNIQUE 制約ごと通す）。
//    ここで見るのは**ラッパの分岐**である。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimSchedulerRun = vi.fn();
const finishSchedulerRun = vi.fn();

vi.mock('@ses/db', () => ({ claimSchedulerRun, finishSchedulerRun }));

const {
  InvalidSchedulerJobIdError,
  runScheduled,
  schedulerRunKey,
  schedulerSlotIso,
  schedulerSlotMillis,
} = await import('./scheduler.js');

const NOW = new Date('2026-09-10T03:00:00.000Z');
const now = (): Date => NOW;

beforeEach(() => {
  claimSchedulerRun.mockReset();
  finishSchedulerRun.mockReset();
  finishSchedulerRun.mockResolvedValue(undefined);
});

describe('slot の取り出し（🔴 現在時刻で代用しない）', () => {
  it('BullMQ の repeat ジョブ ID から発火予定時刻（ミリ秒）を取り出す', () => {
    expect(schedulerSlotMillis('gate.hold-release', 'repeat:gate.hold-release:1789009200000')).toBe(
      Date.UTC(2026, 8, 10, 3, 0, 0),
    );
  });

  it('🔴 想定外の形の jobId は例外にする（現在時刻に落とすと UNIQUE が効かなくなる）', () => {
    for (const jobId of ['', 'gate.hold-release', 'repeat:gate.hold-release', 'repeat::123', 'x:y:z']) {
      expect(() => schedulerSlotMillis('gate.hold-release', jobId)).toThrow(InvalidSchedulerJobIdError);
    }
  });

  it('schedulerId に `:` が含まれていても末尾のミリ秒を取る（貪欲一致）', () => {
    expect(schedulerSlotMillis('j', 'repeat:a:b:c:1700000000000')).toBe(1_700_000_000_000);
  });

  it('slot は JST の ISO 8601（同じ入力から常に同じ文字列）', () => {
    expect(schedulerSlotIso(Date.UTC(2026, 8, 10, 3, 0, 0))).toBe('2026-09-10T12:00:00.000+09:00');
    expect(schedulerSlotIso(0)).toBe('1970-01-01T09:00:00.000+09:00');
  });

  it('run_key は `{jobName}:{slot}`（docs/05 §9.1）', () => {
    expect(schedulerRunKey('scan.poll', `repeat:scan.poll:${Date.UTC(2026, 8, 10, 3, 0, 0)}`)).toBe(
      'scan.poll:2026-09-10T12:00:00.000+09:00',
    );
  });
});

describe('runScheduled（1 slot 1 回）', () => {
  it('実行権を取れたときだけハンドラを呼び、OK を記録する', async () => {
    claimSchedulerRun.mockResolvedValue({ kind: 'CLAIMED', runId: 'run-1' });
    const handler = vi.fn().mockResolvedValue({ tenants: 2, succeeded: 2, failed: 0 });

    const outcome = await runScheduled({
      jobName: 'gate.hold-release',
      jobId: 'repeat:gate.hold-release:1789009200000',
      now,
      handler,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      kind: 'RAN',
      runId: 'run-1',
      detail: { tenants: 2, succeeded: 2, failed: 0 },
    });
    expect(claimSchedulerRun).toHaveBeenCalledWith({
      jobName: 'gate.hold-release',
      runKey: 'gate.hold-release:2026-09-10T12:00:00.000+09:00',
      startedAt: NOW,
    });
    expect(finishSchedulerRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'OK',
      finishedAt: NOW,
      detail: { tenants: 2, succeeded: 2, failed: 0 },
    });
  });

  it('🔴 実行権を取れなければハンドラを呼ばない（二重起動でハンドラは 1 回）', async () => {
    claimSchedulerRun.mockResolvedValue({ kind: 'ALREADY_RUNNING' });
    const handler = vi.fn();

    const outcome = await runScheduled({
      jobName: 'scan.poll',
      jobId: 'repeat:scan.poll:1789009200000',
      now,
      handler,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'SKIPPED', runKey: 'scan.poll:2026-09-10T12:00:00.000+09:00' });
    expect(finishSchedulerRun).not.toHaveBeenCalled();
  });

  it('🔴 ハンドラが失敗したら FAILED を記録してから再 throw する（握り潰さない）', async () => {
    claimSchedulerRun.mockResolvedValue({ kind: 'CLAIMED', runId: 'run-2' });
    class BoomError extends Error {
      override readonly name = 'BoomError';
    }
    const handler = vi.fn().mockRejectedValue(new BoomError('詳細は載せない'));

    await expect(
      runScheduled({
        jobName: 'usage.seat-snapshot',
        jobId: 'repeat:usage.seat-snapshot:1789009200000',
        now,
        handler,
      }),
    ).rejects.toBeInstanceOf(BoomError);

    // 🔴 記録が先、throw が後（先に throw すると RUNNING のまま残り、再試行が取り直せない）。
    expect(finishSchedulerRun).toHaveBeenCalledWith({
      runId: 'run-2',
      status: 'FAILED',
      finishedAt: NOW,
      detail: { error: 'BoomError' },
    });
  });

  it('🔴 失敗の記録に例外メッセージを載せない（対象の値が混ざりうる。docs/05 §16.2）', async () => {
    claimSchedulerRun.mockResolvedValue({ kind: 'CLAIMED', runId: 'run-3' });
    const handler = vi.fn().mockRejectedValue(new Error('tenant=00000000 の氏名が…'));

    await expect(
      runScheduled({ jobName: 'j', jobId: 'repeat:j:1', now, handler }),
    ).rejects.toBeInstanceOf(Error);

    const detail = finishSchedulerRun.mock.calls[0]?.[0]?.detail as Record<string, unknown>;
    expect(detail).toEqual({ error: 'Error' });
    expect(JSON.stringify(detail)).not.toContain('氏名');
  });

  it('🔴 jobId が壊れていたら SchedulerRun を 1 行も書かずに落ちる', async () => {
    const handler = vi.fn();
    await expect(
      runScheduled({ jobName: 'j', jobId: 'not-a-repeat-job', now, handler }),
    ).rejects.toBeInstanceOf(InvalidSchedulerJobIdError);
    expect(claimSchedulerRun).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
