#!/usr/bin/env node
// 接続先は開発VMに限定する。アプリやDBをローカルで起動しない。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { createServer } from 'node:net';
import { assertAccount, stackOutputs, REGION } from './aws/common.mjs';

try {
  const [port = '3000', ...rest] = process.argv.slice(2);
  if (!['3000', '9000', '8025'].includes(port) || rest.length) throw new Error('使い方: node scripts/aws-connect-development.mjs [3000|9000|8025]');
  assertAccount();
  const { InstanceId } = stackOutputs('ses-platform-development-workspace');
  if (!/^i-[a-f0-9]+$/.test(InstanceId ?? '')) throw new Error('開発VMの識別子が不正です');
  // 別プロジェクトが同じポートを使用中でも停止しない。
  const check = createServer();
  await new Promise((resolve, reject) => {
    check.once('error', () => reject(new Error(`localhost:${port} は使用中です。既存の接続・別プロジェクトを確認してください`)));
    check.listen(Number(port), '127.0.0.1', () => check.close(resolve));
  });
  const env = { ...process.env };
  const plugin = env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Amazon', 'SessionManagerPlugin', 'bin');
  if (plugin && existsSync(join(plugin, 'session-manager-plugin.exe'))) env.PATH = `${plugin}${delimiter}${env.PATH ?? ''}`;
  console.log(`AWS開発環境の${port}番へ接続します。このターミナルを開いたまま利用してください。`);
  const child = spawn('aws', ['ssm', 'start-session', '--region', REGION, '--target', InstanceId,
    '--document-name', 'AWS-StartPortForwardingSession', '--parameters', JSON.stringify({ portNumber: [port], localPortNumber: [port] })],
  { env, stdio: 'inherit', windowsHide: true });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
  child.on('error', () => { console.error('AWS CLIとSession Manager pluginの導入を確認してください'); process.exitCode = 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
