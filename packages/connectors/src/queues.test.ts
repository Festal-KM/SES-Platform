// packages/connectors/src/queues.test.ts
// T-04-01 の完了判定の片方: 🔴 **`attempts: 2` を渡すコードがコンパイルエラーになる型テスト**
// （もう片方は tests/static/queue-attempts.test.ts の AST 走査）。
//
// 🔴 このファイルは `pnpm typecheck`（packages/connectors/tsconfig.typecheck.json）で
//    型検査される。`@ts-expect-error` はその行が**実際にエラーになる**ときだけ通り、
//    エラーが出なくなった瞬間に「未使用の @ts-expect-error」として型検査が落ちる。
//    = 送信系キューの `attempts: 1` 固定が外れたら CI が落ちる。
import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_SEND_JOB_NAMES,
  INTERNAL_JOB_NAMES,
  QUEUE_DEFINITIONS,
  externalSendQueue,
  internalQueue,
  queueDefinition,
  type ExternalSendQueueOptions,
  type InternalQueueOptions,
} from './queues.js';

describe('🔴 送信系キューの attempts が型で 1 に固定されている（docs/05 §9.1 / CLAUDE.md §3.4）', () => {
  it('attempts: 1 は許される', () => {
    const options: ExternalSendQueueOptions = { attempts: 1 };
    expect(options.attempts).toBe(1);
  });

  it('🔴 attempts: 2 はコンパイルエラーになる', () => {
    // @ts-expect-error 送信系キューに attempts: 2 は設定できない（BR-21 / BR-22 の二重送信）
    const options: ExternalSendQueueOptions = { attempts: 2 };
    // 実行時の値としては 2 のままである（型だけが禁じている、ということを明示する）。
    expect(options.attempts as number).toBe(2);
  });

  it('🔴 attempts: 3 もコンパイルエラーになる（内部ジョブの上限を流用できない）', () => {
    // @ts-expect-error 送信系キューに attempts: 3 は設定できない
    const options: ExternalSendQueueOptions = { attempts: 3 };
    expect(options.attempts as number).toBe(3);
  });

  it('🔴 attempts: 0（無限リトライ相当の書き間違い）もコンパイルエラーになる', () => {
    // @ts-expect-error 送信系キューの attempts はリテラル 1 のみ
    const options: ExternalSendQueueOptions = { attempts: 0 };
    expect(options.attempts as number).toBe(0);
  });

  it('🔴 backoff（自動リトライの設定）を持てない', () => {
    const options: ExternalSendQueueOptions = {
      attempts: 1,
      // @ts-expect-error 再試行しないのだからバックオフの設定自体が存在してはならない
      backoff: { type: 'fixed', delay: 1000 },
    };
    expect(options.attempts).toBe(1);
  });

  it('🔴 externalSendQueue は送信系のジョブ名しか受け付けない', () => {
    // @ts-expect-error 内部ジョブ（send.hold-release）を送信系キューとして作れない
    expect(() => externalSendQueue('send.hold-release')).toBeTruthy();
    // @ts-expect-error 未定義のジョブ名も作れない
    expect(() => externalSendQueue('send.anything')).toBeTruthy();
  });

  it('🔴 内部ジョブの attempts は 1〜3 に制限される', () => {
    const ok: InternalQueueOptions = { attempts: 3 };
    expect(ok.attempts).toBe(3);
    // @ts-expect-error 4 回以上の再試行は設定できない
    const tooMany: InternalQueueOptions = { attempts: 4 };
    expect(tooMany.attempts as number).toBe(4);
  });

  it('🔴 internalQueue は宣言済みの内部ジョブ名しか受け付けない（キュー定義を 1 箇所に閉じる）', () => {
    // @ts-expect-error 送信系のジョブ名を内部ジョブとして再定義できない
    expect(() => internalQueue('send.proposal', { attempts: 3 })).toBeTruthy();
  });
});

describe('キュー定義の実際の値（docs/05 §9.4 / §9.10）', () => {
  it.each([...EXTERNAL_SEND_JOB_NAMES])('%s は attempts: 1 かつ backoff なし', (name) => {
    const definition = QUEUE_DEFINITIONS[name];
    expect(definition.name).toBe(name);
    expect(definition.defaultJobOptions.attempts).toBe(1);
    expect(definition.defaultJobOptions.backoff).toBeUndefined();
  });

  it('externalSendQueue は引数のジョブ名にかかわらず attempts: 1 を返す', () => {
    for (const name of EXTERNAL_SEND_JOB_NAMES) {
      expect(externalSendQueue(name).defaultJobOptions).toEqual({ attempts: 1 });
    }
  });

  it('🔴 send.hold-release は「外部送信ではない send.*」であり attempts: 3 でよい', () => {
    // 名前の接頭辞で再試行可否を決めていないことの対照。
    expect(INTERNAL_JOB_NAMES).toContain('send.hold-release');
    expect(QUEUE_DEFINITIONS['send.hold-release'].defaultJobOptions.attempts).toBe(3);
    expect(EXTERNAL_SEND_JOB_NAMES as readonly string[]).not.toContain('send.hold-release');
  });

  it('EXTERNAL_SEND_JOB_NAMES と INTERNAL_JOB_NAMES は QUEUE_DEFINITIONS を過不足なく覆う', () => {
    const declared = [...EXTERNAL_SEND_JOB_NAMES, ...INTERNAL_JOB_NAMES].sort();
    expect(Object.keys(QUEUE_DEFINITIONS).sort()).toEqual(declared);
  });

  it('queueDefinition は定義済みのキューを引ける', () => {
    expect(queueDefinition('send.contract').defaultJobOptions.attempts).toBe(1);
  });
});
