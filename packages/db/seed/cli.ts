// packages/db/seed/cli.ts
// `pnpm seed --preset=isolation --reset` の実体（docs/05 §13.6）。
//
// 🔴 このファイルは「引数と環境変数を読んで `runSeed()` を呼ぶ」だけである。
//    環境ガード（F-053 AC-6）は `runSeed()` の先頭にあり、CLI を迂回しても効く。
// 🔴 `packages/config` の `loadAppEnv`（アプリ全体の環境変数検証）はここでは呼ばない。
//    理由: シードはアプリのランタイムではなく、AI キー・Stripe・SES など投入に無関係な
//    40 個以上の変数を要求すると、ローカルで合成データを入れるだけの作業が実行できなくなる。
//    それでも **APP_ENV の判定は `packages/config` に閉じる**（`assertSeedableAppEnv` が唯一の
//    出所であり、CLI 側で条件式を書き直さない）。接続文字列は `MIGRATION_DATABASE_URL` と
//    同じ扱いで、実行時環境に置かず、このコマンドの直前にだけ渡す（args.ts 参照）。
import process from 'node:process';
import { SeedArgsError, parseSeedArgs, resolveSeedDatabaseUrl, seedUsage } from './args.js';
import { runSeed, runSeedReset } from './index.js';

async function main(): Promise<number> {
  const args = parseSeedArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${seedUsage()}\n`);
    return 0;
  }

  const databaseUrl = resolveSeedDatabaseUrl(process.env);
  const appEnv = process.env.APP_ENV;

  const result = args.resetOnly
    ? await runSeedReset({ appEnv, databaseUrl, preset: args.preset })
    : await runSeed({ appEnv, databaseUrl, preset: args.preset, reset: args.reset });

  const summary = Object.entries(result.counts)
    .map(([table, count]) => `  ${table}: ${count}`)
    .join('\n');
  process.stdout.write(
    `seed:${result.preset} ${args.resetOnly ? '(reset only)' : ''} 完了\n` +
      `テナント: ${result.tenantIds.join(', ')}\n${summary}\n`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // 🔴 値そのもの（接続文字列など）はメッセージに載せない（CLAUDE.md §3.5）。
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    if (error instanceof SeedArgsError) {
      process.stderr.write(`\n${seedUsage()}\n`);
    }
    process.exitCode = 1;
  });
