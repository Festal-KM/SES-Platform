#!/usr/bin/env node
/**
 * scripts/railway-start.mjs
 *
 * Railway の `deploy.startCommand`（`railway.json`）。**web と worker が同じイメージ・同じ
 * 起動コマンドを共有し、`SES_RAILWAY_ROLE` だけで役割を決める。**
 *
 * 🔴 未設定・未知の値なら起動を失敗させる（既定で web に倒さない）。
 *    どちらが起動しているか分からない状態は、「worker を増やしたつもりが web が 2 つ動いていて
 *    スケジュールジョブが 1 つも走っていない」という**成功したように見える壊れ方**になる
 *    （`CLAUDE.md` §11.1 と同じ理由でフォールバックを作らない）。
 *
 * 🔴 このスクリプトは環境変数の検証をしない。設定の検証は `apps/web` の instrumentation.ts と
 *    `apps/worker` の main.ts が呼ぶ `@ses/config` の `initializeRuntimeConfig` が唯一の出所である
 *    （ここに判定を書くと web / worker / 起動スクリプトの 3 箇所に分かれる）。
 *
 * シグナル: SIGTERM / SIGINT を子プロセスへ透過し、子の終了コードをそのまま返す。
 *   - worker は BullMQ / Redis を閉じる停止処理を自分で持つ（`apps/worker/src/main.ts`）。
 *     透過しないと実行中のジョブが `stalled` として再実行される。
 *   - Railway はデプロイの入れ替え時に SIGTERM を送る。
 *
 * 依存ゼロ（Node.js の標準機能のみ）。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_PREFIX = '[ses:railway:start]';
const ROLE_VAR = 'SES_RAILWAY_ROLE';

/** Railway が渡す `PORT` が無いときに `next start` が使う既定ポート（Next.js の既定と同じ）。 */
const DEFAULT_WEB_PORT = '3000';

/** 透過するシグナル。番号は `os.constants.signals` から引く（128+N の慣行に使う）。 */
const FORWARDED_SIGNALS = ['SIGTERM', 'SIGINT'];

function log(line) {
  process.stdout.write(`${LOG_PREFIX} ${line}\n`);
}

function failAndExit(lines) {
  for (const line of lines) process.stderr.write(`${LOG_PREFIX} ${line}\n`);
  process.exit(1);
}

/**
 * web: `apps/web` で `next start`。
 * 🔴 `pnpm run start` を経由しない —— 中間に pnpm のプロセスが挟まると、シグナルが
 *    そこで止まったり、終了コードが pnpm のものに置き換わったりする。
 */
function webLaunch() {
  const port = process.env.PORT ?? DEFAULT_WEB_PORT;
  return {
    label: `web（next start / port=${port}${process.env.PORT === undefined ? ' = 既定値' : ''}）`,
    command: path.join(PROJECT_ROOT, 'apps', 'web', 'node_modules', '.bin', 'next'),
    args: ['start', '--port', port],
    cwd: path.join(PROJECT_ROOT, 'apps', 'web'),
    missingHint: '`pnpm --filter @ses/web... run build` が完了していない（next が入っていない）可能性がある。',
  };
}

/** worker: `apps/worker/dist/main.js`（`@ses/worker` の `start` スクリプトと同じ実体）。 */
function workerLaunch() {
  return {
    label: 'worker（node dist/main.js）',
    command: process.execPath,
    args: [path.join(PROJECT_ROOT, 'apps', 'worker', 'dist', 'main.js')],
    cwd: path.join(PROJECT_ROOT, 'apps', 'worker'),
    missingHint: '`pnpm --filter @ses/worker... run build` が完了していない（dist/main.js が無い）可能性がある。',
  };
}

/** 🔴 ここに列挙された値だけが有効である（`default:` を作らない）。 */
const LAUNCHERS = {
  web: webLaunch,
  worker: workerLaunch,
};

function resolveLaunch() {
  const role = process.env[ROLE_VAR];
  if (role === undefined || role === '' || !Object.hasOwn(LAUNCHERS, role)) {
    failAndExit([
      `${ROLE_VAR} が ${Object.keys(LAUNCHERS).join(' | ')} のいずれでもありません（受け取った値: ${role === undefined || role === '' ? '(未設定)' : role}）。`,
      `🔴 既定で ${Object.keys(LAUNCHERS)[0]} に倒さない。Railway の各サービスに ${ROLE_VAR} を設定してください（docs/DEPLOY-DEMO-RAILWAY.md）。`,
    ]);
  }
  return LAUNCHERS[role]();
}

function main() {
  const launch = resolveLaunch();
  if (!fs.existsSync(launch.command)) {
    failAndExit([`起動対象が見つかりません: ${path.relative(PROJECT_ROOT, launch.command)}`, launch.missingHint]);
  }

  log(`起動します: ${launch.label}`);
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    stdio: 'inherit',
    env: process.env,
  });

  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      // 🔴 自分では終了しない。子の停止処理（worker のキュー close）を待ち、
      //    子の終了コードを 'exit' ハンドラでそのまま返す。
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    });
  }

  child.on('error', (error) => {
    failAndExit([`子プロセスの起動に失敗しました: ${error.message}`]);
  });

  child.on('exit', (code, signal) => {
    if (code !== null) {
      log(`終了しました（exit code ${code}）。`);
      process.exit(code);
    }
    // シグナルで落ちた場合は POSIX の慣行（128 + シグナル番号）に写す。
    const number = os.constants.signals[signal] ?? 0;
    log(`シグナルで終了しました（${signal}）。`);
    process.exit(128 + number);
  });
}

main();
