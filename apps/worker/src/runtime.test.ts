// apps/worker/src/runtime.test.ts
// 🔴 T-07-11。起動配線のうち**判断を持つ 3 つ**だけを固定する:
//    ① `demo` / `development` のモック応答（Issue #44 の回答 ①。docs/05 §13.2）
//    ② テナントのファンアウト（payload に `tenantId` を必ず載せる / 1 社の失敗で止めない）
//    ③ `send.*` の保留復帰 seam が未実装であること（SP-09 T-09-06）
//
// 🔴 配線そのもの（何個の Worker を作るか）はここで検査しない —— Redis が要り、
//    「作った」ことしか言えない。実際に待ち受けて走ることは
//    `tests/isolation/scheduler-fanout.test.ts` が実 DB + 実 Redis で通す。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSchedulerFanoutTenants = vi.fn();

vi.mock('@ses/db', () => ({ listSchedulerFanoutTenants }));

const { fanOutToTenants, resolveMockAiOptions, sendHoldReleaseNotImplemented, SchedulerFanOutError } =
  await import('./runtime.js');
const { SCHEDULED_JOBS } = await import('./jobs/index.js');
const { isQueueName } = await import('@ses/connectors');
const { DEMO_MOCK_ANTHROPIC_SCRIPT } = await import('@ses/ai');

beforeEach(() => {
  listSchedulerFanoutTenants.mockReset();
});

describe('🔴 モックの既定応答（Issue #44 の回答 ①。docs/05 §13.2）', () => {
  it('demo は常時 PASS のスクリプトを持つ', () => {
    expect(resolveMockAiOptions('demo')).toEqual({ script: DEMO_MOCK_ANTHROPIC_SCRIPT });
  });

  it('🔴 development は未設定のまま（ゲートが実質無効な環境を増やさない）', () => {
    expect(resolveMockAiOptions('development')).toEqual({});
  });

  it('🔴 demo 以外に既定応答を配らない（sandbox 以上は ai=real でここを通らない）', () => {
    for (const appEnv of ['sandbox', 'staging', 'production'] as const) {
      expect(resolveMockAiOptions(appEnv)).toEqual({});
    }
  });

  it('demo の応答は gate-inspector の「全層 PASS」である（警告も出さない）', () => {
    expect(DEMO_MOCK_ANTHROPIC_SCRIPT).toEqual([
      {
        kind: 'output',
        output: {
          pii: { verdict: 'PASS', findings: [] },
          commerce: { verdict: 'PASS', findings: [] },
          consistencyWarnings: [],
        },
      },
    ]);
  });
});

describe('🔴 テナントのファンアウト（docs/05 §9.1）', () => {
  it('payload に tenantId を必ず載せ、母集団の全社を直列に回す', async () => {
    listSchedulerFanoutTenants.mockResolvedValue(['t-1', 't-2', 't-3']);
    const seen: unknown[] = [];
    const handler = vi.fn(async (payload: unknown) => {
      seen.push(payload);
      return undefined;
    });

    const detail = await fanOutToTenants('gate.hold-release', 'repeat:gate.hold-release:1', handler);

    expect(seen).toEqual([{ tenantId: 't-1' }, { tenantId: 't-2' }, { tenantId: 't-3' }]);
    expect(detail).toEqual({ tenants: 3, succeeded: 3, failed: 0 });
  });

  it('jobId をそのままハンドラへ渡す（`systemTenantCtx` の JobIdentity に載る）', async () => {
    listSchedulerFanoutTenants.mockResolvedValue(['t-1']);
    const handler = vi.fn().mockResolvedValue(undefined);

    await fanOutToTenants('scan.poll', 'repeat:scan.poll:42', handler);

    expect(handler).toHaveBeenCalledWith({ tenantId: 't-1' }, 'repeat:scan.poll:42');
  });

  it('🔴 1 社の失敗で他社を止めない（残りも実行し、最後に失敗として報告する）', async () => {
    listSchedulerFanoutTenants.mockResolvedValue(['t-1', 't-2', 't-3']);
    const handler = vi.fn(async (payload: unknown) => {
      if ((payload as { tenantId: string }).tenantId === 't-2') throw new Error('boom');
      return undefined;
    });

    await expect(
      fanOutToTenants('gate.hold-release', 'repeat:gate.hold-release:1', handler),
    ).rejects.toBeInstanceOf(SchedulerFanOutError);

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('失敗の報告は件数だけを持つ（対象の値を載せない。docs/05 §16.2）', async () => {
    listSchedulerFanoutTenants.mockResolvedValue(['t-1', 't-2']);
    const handler = vi.fn().mockRejectedValue(new Error('secret detail'));

    const error = await fanOutToTenants('j', 'repeat:j:1', handler).catch(
      (caught: unknown) => caught as InstanceType<typeof SchedulerFanOutError>,
    );

    expect(error.counts).toEqual({ tenants: 2, succeeded: 0, failed: 2 });
    expect(error.message).not.toContain('t-1');
    expect(error.message).not.toContain('secret detail');
  });

  it('母集団が空でも例外にしない（テナントが 1 社も無い環境は正常系）', async () => {
    listSchedulerFanoutTenants.mockResolvedValue([]);
    const handler = vi.fn();

    expect(await fanOutToTenants('j', 'repeat:j:1', handler)).toEqual({
      tenants: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('🔴 send.* の保留復帰は未実装（SP-09 T-09-06）', () => {
  it('0 件を返す（保留を書く経路がまだ存在しないため事実である）', async () => {
    expect(await sendHoldReleaseNotImplemented({ headroom: 10 })).toBe(0);
  });
});

describe('🔴 宣言とキュー定義が食い違わない（T-07-11）', () => {
  it('SCHEDULED_JOBS の全ジョブに QUEUE_DEFINITIONS の定義がある', () => {
    // 🔴 `usage.seat-snapshot` は T-03-10 で宣言だけが置かれ、キュー定義が無いまま残っていた。
    //    起動配線は `requireQueueName` で落とすが、**その前にここで気づける**ようにしておく。
    const missing = SCHEDULED_JOBS.map((declaration) => declaration.name).filter(
      (name) => !isQueueName(name),
    );
    expect(missing).toEqual([]);
  });

  it('スケジュール宣言は 5 本である（docs/05 §9.1 / SP-07 T-07-11）', () => {
    expect(SCHEDULED_JOBS.map((declaration) => declaration.name).sort()).toEqual([
      'domain.recheck',
      'gate.hold-release',
      'scan.poll',
      'send.hold-release',
      'usage.seat-snapshot',
    ]);
  });
});
