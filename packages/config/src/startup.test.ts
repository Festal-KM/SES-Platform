// packages/config/src/startup.test.ts
// T-03-12。`initializeRuntimeConfig`（起動時 DI の唯一の入口）の単体検証。
//
// 🔴 ここは**関数の振る舞い**（キャッシュ・ログ 1 行・シークレット非出力）だけを見る。
//    「apps/web / apps/worker が実際に呼んでいる」ことは、
//    `tests/startup/startup-di.test.ts`（起動経路の結合テスト）と
//    `tests/static/startup-di-callers.test.ts`（走査）が担う。T-01-03 の関数単体テストと
//    T-03-12 の起動経路テストを混ぜない（SP-03 §4 T-03-12 の完了判定）。
import { beforeEach, describe, expect, it } from 'vitest';
import { buildValidEnv } from './testing/fixtures.js';
import {
  formatStartupFailureLine,
  formatStartupLine,
  initializeRuntimeConfig,
  resetRuntimeConfigForTesting,
  STARTUP_LINE_PREFIX,
} from './startup.js';
import { EnvValidationError } from './errors.js';

function collector(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

beforeEach(() => {
  resetRuntimeConfigForTesting();
});

describe('initializeRuntimeConfig（起動時 DI の唯一の入口。docs/05 §13.1）', () => {
  it('development で env と connectors を解決し、起動ログを 1 行出す', () => {
    const { lines, log } = collector();
    const runtime = initializeRuntimeConfig(buildValidEnv('development'), log);

    expect(runtime.env.APP_ENV).toBe('development');
    expect(runtime.connectors).toEqual({
      email: 'mock',
      objectStore: 'real',
      malwareScanner: 'real',
      esign: 'mock',
      billing: 'mock',
      ai: 'mock',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('APP_ENV=development');
  });

  it('🔴 2 回目以降は再検証も再解決もせず、キャッシュをそのまま返す（多重初期化を作らない）', () => {
    const first = collector();
    const runtime1 = initializeRuntimeConfig(buildValidEnv('development'), first.log);

    // 2 回目に**検証に必ず落ちる source** を渡す。再検証が走っていれば throw するはずであり、
    // 例外なく同じインスタンスが返ることが「再検証していない」ことの証拠になる。
    const second = collector();
    const runtime2 = initializeRuntimeConfig({ APP_ENV: 'not-a-valid-env' }, second.log);

    expect(runtime2).toBe(runtime1);
    expect(first.lines).toHaveLength(1);
    expect(second.lines).toEqual([]);
  });

  it('🔴 検証に失敗したら throw し、失敗をキャッシュしない（次の呼び出しでやり直せる）', () => {
    const failed = collector();
    expect(() =>
      initializeRuntimeConfig(buildValidEnv('development', { AUTH_SECRET: undefined }), failed.log),
    ).toThrow(/環境変数の検証に失敗しました/);
    expect(failed.lines).toEqual([]);

    const retried = collector();
    const runtime = initializeRuntimeConfig(buildValidEnv('development'), retried.log);
    expect(runtime.env.APP_ENV).toBe('development');
    expect(retried.lines).toHaveLength(1);
  });

  it('🔴 非本番に本番の識別子があると throw する（NFR-ENV-4。起動を止める唯一の手段）', () => {
    const { lines, log } = collector();
    expect(() =>
      initializeRuntimeConfig(
        buildValidEnv('staging', { STRIPE_SECRET_KEY: 'sk_live_dummy_not_a_real_key' }),
        log,
      ),
    ).toThrow(/STRIPE_SECRET_KEY/);
    expect(lines).toEqual([]);
  });

  it('🔴 production でモック実装が選択される env は throw する（NFR-ENV-3）', () => {
    const { lines, log } = collector();
    expect(() =>
      initializeRuntimeConfig(buildValidEnv('production', { MALWARE_SCANNER: 'mock' }), log),
    ).toThrow(/MALWARE_SCANNER/);
    expect(lines).toEqual([]);
  });
});

describe('起動ログの内容（CLAUDE.md §3.5 / docs/05 §13.4 規則 6）', () => {
  it('APP_ENV と 6 区分の実装種別だけを含む', () => {
    const line = formatStartupLine({
      env: { APP_ENV: 'sandbox' } as never,
      connectors: {
        email: 'sandboxRecipientScoped',
        objectStore: 'real',
        malwareScanner: 'real',
        esign: 'mock',
        billing: 'real',
        ai: 'real',
      },
    });
    expect(line).toBe(
      `${STARTUP_LINE_PREFIX} APP_ENV=sandbox connectors: email=sandboxRecipientScoped ` +
        'objectStore=real malwareScanner=real esign=mock billing=real ai=real',
    );
  });

  it('🔴 シークレットの値がログに 1 つも現れない', () => {
    const source = buildValidEnv('production');
    const { lines, log } = collector();
    initializeRuntimeConfig(source, log);

    const line = lines[0] ?? '';
    // 値が「秘密である」変数を列挙し、その値が 1 つも含まれないことを見る。
    const secretVariables = [
      'AUTH_SECRET',
      'AUTH_PLATFORM_SECRET',
      'TOKEN_ENCRYPTION_KEY',
      'ANON_REFERENCE_HMAC_SECRET',
      'WEBHOOK_PATH_SECRET',
      'ANTHROPIC_API_KEY',
      'DATABASE_URL',
      'PLATFORM_DATABASE_URL',
      'PLATFORM_WRITE_DATABASE_URL',
      'SENTRY_DSN',
      'S3_KMS_KEY_ID',
      'AWS_ACCOUNT_ID',
    ];
    for (const variable of secretVariables) {
      const value = source[variable];
      expect(value, `${variable} がフィクスチャに無い（対照が空振りしている）`).toBeTruthy();
      expect(line, `${variable} の値が起動ログに現れている`).not.toContain(value);
    }
    // 変数名そのものも出さない（「何が設定されているか」の推測材料にしない）。
    expect(line).not.toContain('DATABASE_URL');
  });
});

describe('起動失敗の 1 行（web / worker で共通。docs/05 §13.4 規則 5 / 規則 6）', () => {
  it('どの変数がなぜ不正かを列挙し、値は含めない', () => {
    const error = new EnvValidationError([
      { variable: 'STRIPE_SECRET_KEY', message: 'staging では sk_test_ で始まる必要があります' },
      { variable: 'AWS_ACCOUNT_ID', message: '本番の AWS アカウント ID と一致しています' },
    ]);
    const line = formatStartupFailureLine(error);

    expect(line.startsWith(STARTUP_LINE_PREFIX)).toBe(true);
    expect(line).toContain('STRIPE_SECRET_KEY');
    expect(line).toContain('AWS_ACCOUNT_ID');
    expect(line).toContain('EnvValidationError');
  });

  it('Error でない値を投げられても、その中身をそのまま出さない', () => {
    expect(formatStartupFailureLine({ secret: 'sk_live_leaked' })).not.toContain('sk_live_leaked');
    expect(formatStartupFailureLine('sk_live_leaked')).not.toContain('sk_live_leaked');
  });
});
