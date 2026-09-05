// tests/e2e/harness/totp-store.ts
// 2 要素認証の登録で受け取った TOTP シークレットを、**実行中だけ**ファイルに持ち越す。
//
// 🔴 なぜファイルか: Playwright は**プロジェクト（`desktop-chromium` / `mobile-chromium`）ごとに
//    別のワーカープロセス**でテストを実行する。シークレットをモジュール変数だけで持つと、
//    2 つ目のプロジェクトが同じ利用者でサインインしたときに
//    「DB には確認済みの資格情報があるので登録ウィザードが出ない（`ALREADY_ENROLLED`）」
//    「しかしシークレットを知らない」という詰みになる。
//
// 🔴 これは**テスト専用のログイン迂回ではない**。アプリの経路（`docs/05` §6.3 #3 が
//    本人の画面に 1 回だけ返す `otpauth://` URL）で受け取った値を、利用者が認証アプリに
//    保存するのと同じ意味で持ち越しているだけである。
// 🔴 置き場所は `test-results/`（`.gitignore` 済み）。**毎回の globalSetup で消す**
//    （DB はコンテナごと作り直されるため、前回の値は必ず無効）。
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACT_DIR } from './paths.js';

const STORE_PATH = path.join(ARTIFACT_DIR, 'totp-secrets.json');

function readAll(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function resetTotpStore(): void {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.rmSync(STORE_PATH, { force: true });
}

export function readTotpSecret(subject: string): string | undefined {
  return readAll()[subject];
}

export function writeTotpSecret(subject: string, secret: string): void {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify({ ...readAll(), [subject]: secret }), 'utf8');
}
