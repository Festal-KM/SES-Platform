// tests/e2e/global-teardown.ts
// アプリのプロセスと PostgreSQL コンテナを止める。
//
// 🔴 片方の停止が失敗しても、もう片方の停止を試みる（片付け漏れでポートとコンテナが
//    残ると、次の実行が「原因不明の起動失敗」になる）。
import process from 'node:process';
import { takeHarness } from './harness/state.js';

export default async function globalTeardown(): Promise<void> {
  const { database, webServer } = takeHarness();
  const failures: string[] = [];

  try {
    await webServer?.stop();
  } catch (error) {
    failures.push(`アプリの停止に失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await database?.stop();
  } catch (error) {
    failures.push(
      `PostgreSQL の停止に失敗: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (failures.length > 0) process.stderr.write(`${failures.join('\n')}\n`);
}
