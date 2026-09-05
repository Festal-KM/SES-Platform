// apps/web/lib/forms/submit-guard.test.ts
// docs/sprints/SP-03 T-03-13 完了判定 #4「送信中にボタンが送信中表示へ置換され、
// 二重送信できないこと」。UI の disabled 属性だけでなく、実行そのものが 1 回に畳まれることを
// DOM を介さずに証明する。
import { describe, expect, it } from 'vitest';
import { createSubmitGuard } from './submit-guard';

describe('createSubmitGuard（二重送信防止。docs/04 §S-046 ほか共通規律）', () => {
  it('実行中に重ねて呼んでも、内側の task は 1 回しか動かない', async () => {
    const guard = createSubmitGuard<number>();
    let calls = 0;
    let resolveTask: ((value: number) => void) | undefined;
    const task = (): Promise<number> =>
      new Promise<number>((resolve) => {
        calls += 1;
        resolveTask = resolve;
      });

    const first = guard.run(task);
    expect(guard.pending).toBe(true);
    // 🔴 二重送信に相当する呼び出し。task を一切呼ばずに null を返す。
    const second = guard.run(task);

    resolveTask?.(42);
    expect(await second).toBeNull();
    expect(await first).toBe(42);
    expect(calls).toBe(1);
    expect(guard.pending).toBe(false);
  });

  it('完了後は再度実行できる（明示的なリトライまで塞がない）', async () => {
    const guard = createSubmitGuard<string>();
    expect(await guard.run(async () => 'ok')).toBe('ok');
    expect(guard.pending).toBe(false);
    expect(await guard.run(async () => 'ok-again')).toBe('ok-again');
  });

  it('task が例外を投げても pending が解除される', async () => {
    const guard = createSubmitGuard<never>();
    await expect(
      guard.run(async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
    expect(guard.pending).toBe(false);
  });
});
