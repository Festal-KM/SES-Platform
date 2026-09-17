// tests/e2e/global-teardown.ts
// worker・アプリのプロセスとコンテナ（PostgreSQL / MinIO / Redis）を止める。
//
// 🔴 片方の停止が失敗しても、もう片方の停止を試みる（片付け漏れでポートとコンテナが
//    残ると、次の実行が「原因不明の起動失敗」になる）。
// 🔴 順序: worker → アプリ → コンテナ。worker（BullMQ の Worker）は Redis へ接続を持つので、Redis を止める前に閉じる
//    （逆にすると閉じる途中で接続エラーが出て「停止に失敗」と誤って報告する）。
import process from 'node:process';
import { takeHarness } from './harness/state.js';

export default async function globalTeardown(): Promise<void> {
  const { database, objectStorage, redis, webServer, worker } = takeHarness();
  const failures: string[] = [];

  try {
    await worker?.stop();
  } catch (error) {
    failures.push(`worker の停止に失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  try {
    await objectStorage?.stop();
  } catch (error) {
    failures.push(`MinIO の停止に失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await redis?.stop();
  } catch (error) {
    failures.push(`Redis の停止に失敗: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (failures.length > 0) process.stderr.write(`${failures.join('\n')}\n`);
}
