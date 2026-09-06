// tests/e2e/harness/db-admin.ts
// K-7 の E2E（T-05-10。`docs/sprints/SP-05-engineer-ledger.md` §T-05-10 / `docs/dev-plan.md` §6.1）
// 専用のシーム: ウイルススキャン結果の実際の適用（`SCANNING` → `CLEAN`）は GuardDuty Webhook →
// `scan.apply-result`（`apps/worker`）だけが行う経路である。E2E ハーネスには worker プロセスも
// BullMQ 経由の駆動も無く（`development` は `PendingScanApplyResultQueue` というインメモリの
// 保留キューにしか積まない。`apps/web/lib/db/bootstrap.ts` の該当コメント）、Webhook を叩いても
// 結果は**キューに積まれるだけで最後まで適用されない**。
//
// 🔴 K-7 が証明したいのは「閲覧・DL の記録が経路によらず漏れないこと」（`BR-28`）であり、
//    ウイルススキャンの状態遷移そのものは T-05-05 のユニット / 結合テスト
//    （`packages/connectors/src/scan/**` / `apps/worker/src/jobs/scan-apply-result.test.ts`）の
//    射程である。したがって本ファイルは「スキャン結果の適用経路を最後まで動かす」のではなく、
//    **`tests/isolation/skill-sheet-download.test.ts` の `setScanStatus` と同じ手法**
//    （特権接続で `scan_status` を直接 `CLEAN` にする）を踏襲し、前提条件だけを作る。
//
// 🔴 汎用のエスケープハッチにしない。ここで公開するのは「K-7 の前提を作るための 1 関数」だけで
//    あり、任意の SQL を実行できる経路を増やさない（`packages/db/src/testing/isolation.ts`
//    冒頭コメントと同じ規律）。
//
// 🔴 生 SQL の発行は **Prisma CLI**（`prisma db execute --stdin`）経由で行う。`harness/postgres.ts`
//    が `migrate deploy` に使っているのと同じ CLI 実体（`packages/db/node_modules/prisma/...`）を
//    再利用するだけであり、新しい DB クライアント依存（`pg` 等）を足さない。接続先は
//    `globalSetup` が `seed:isolation` の投入に使うのと同じ PostgreSQL スーパーユーザー接続
//    （`E2eDatabase.seedUrl`）であり、プロセス間の受け渡しは環境変数 1 本で行う
//    （Playwright の `globalSetup` はワーカープロセスの起動より前に実行されるため、ここで
//    設定した環境変数はテストファイルからも読める。`harness/endpoint.ts` の `SES_E2E_PORT` と
//    同じパターン）。
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { PRISMA_CLI } from './paths.js';

/** `globalSetup` が書き、本ファイルが読む唯一のキー。 */
export const ADMIN_DATABASE_URL_ENV = 'SES_E2E_ADMIN_DATABASE_URL';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `globalSetup` が 1 度だけ呼ぶ。 */
export function writeAdminDatabaseUrlEnv(seedUrl: string): void {
  process.env[ADMIN_DATABASE_URL_ENV] = seedUrl;
}

function adminDatabaseUrl(): string {
  const url = process.env[ADMIN_DATABASE_URL_ENV];
  if (url === undefined || url === '') {
    throw new Error(
      `${ADMIN_DATABASE_URL_ENV} が設定されていません（globalSetup が先に走っていないか、` +
        'このプロセスへ引き継がれていません）。',
    );
  }
  return url;
}

function execSql(sql: string): void {
  execFileSync(
    process.execPath,
    [PRISMA_CLI, 'db', 'execute', '--url', adminDatabaseUrl(), '--stdin'],
    { input: sql, stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

/**
 * 🔴 K-7 の E2E 専用シーム: `skill_sheets.scan_status` を `CLEAN` に強制する。
 *
 * `is_latest` には触れない（`skill_sheets_latest_clean_check` の CHECK は
 * `is_latest = false OR scan_status = 'CLEAN'` であり、`is_latest` が既定の `false` のままなら
 * この更新は制約に抵触しない）。K-7 が検証する閲覧（#21）とダウンロード（#20）はどちらも
 * `scanStatus === 'CLEAN'` だけを条件にしており（`apps/web/lib/skill-sheets/policy.ts`
 * `isSkillSheetShareable` / `download.ts`）、最新版フラグを要求しない。
 */
export function markSkillSheetClean(skillSheetId: string): void {
  if (!UUID_PATTERN.test(skillSheetId)) {
    throw new Error(`skillSheetId が UUID の形をしていません: ${skillSheetId}`);
  }
  execSql(
    `UPDATE skill_sheets SET scan_status = 'CLEAN', scan_updated_at = now() ` +
      `WHERE id = '${skillSheetId}';`,
  );
}
