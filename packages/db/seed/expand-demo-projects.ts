import process from 'node:process';
import { expandDemoProjects } from './index.js';
import { resolveSeedDatabaseUrl } from './args.js';

expandDemoProjects({ appEnv: process.env.APP_ENV, databaseUrl: resolveSeedDatabaseUrl(process.env) })
  .then((added) => process.stdout.write(`デモ案件の追加: ${String(added)}件\n`))
  .catch((error: unknown) => {
    // DB例外には接続情報が含まれうるため、値や生の例外は出さない。
    process.stderr.write(`デモ案件の追加に失敗しました (${error instanceof Error ? error.name : 'UnknownError'})\n`);
    process.exitCode = 1;
  });
