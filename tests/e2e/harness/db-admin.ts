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
// 🔴 汎用のエスケープハッチにしない。ここで公開するのは「K-7 の前提を作るための 1 関数」と、
//    T-08-09 の 3 関数（下段。worker 不在を補う期限到来の前提づくり / 凍結行の表明 / 合成データの後始末）
//    だけであり、任意の SQL を実行できる経路を増やさない（`packages/db/src/testing/isolation.ts`
//    冒頭コメントと同じ規律）。関数を足すときは目的を 1 つに絞り、SQL を固定文にすること。
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
  try {
    execFileSync(
      process.execPath,
      [PRISMA_CLI, 'db', 'execute', '--url', adminDatabaseUrl(), '--stdin'],
      { input: sql, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (error: unknown) {
    // 🔴 `prisma db execute` は失敗を stderr に書いて非 0 で終わる。`RAISE EXCEPTION` の本文
    //    （`assertEngineerSnapshotFrozen`）を呼び出し側の失敗メッセージに残すため、握り潰さず写す。
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr ?? '')
        : '';
    throw new Error(`prisma db execute が失敗しました。${stderr.trim()}`, { cause: error });
  }
}

/**
 * SQL の文字列リテラルに埋め込んでよい値か。🔴 汎用のクォート処理を持たない —— ここで扱う値は
 * 合成の表示名（`T0809合成-...`）と UUID だけであり、シングルクォートや制御文字を含む値は
 * 受け取らない（受け取れる形にすると「任意の文字列を流し込める入口」になる）。
 */
function assertPlainSqlLiteral(label: string, value: string): void {
  // eslint-disable-next-line no-control-regex -- 制御文字そのものを拒否する判定
  if (value === '' || /['\\\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} に SQL リテラルへ埋め込めない文字が含まれています。`);
  }
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

// ---------------------------------------------------------------------------
// 🔴 T-08-09（経路 4 の E2E。`tests/e2e/anonymous-share.spec.ts`）専用のシーム 2 つ
// ---------------------------------------------------------------------------
// K-7 のシームと同じ判断で置く: E2E ハーネスには worker プロセスも BullMQ（Redis）も無く
// （T-07-11 は SP-09 の先頭まで持ち越し。`docs/sprints/SP-08-anonymous-share.md` 冒頭）、
// 日次ジョブ `proposal-request.expire`（`apps/worker/src/jobs/proposal-request-expire.ts`）を
// E2E から動かせない。ジョブそのものの正しさ（母集団・CAS・監査・冪等）は
// `tests/isolation/proposal-request-respond.test.ts` ⑦ と
// `apps/worker/src/jobs/proposal-request-expire.test.ts` の射程であり、E2E が証明したいのは
// 🔴「ホストが `DECLINED` と `EXPIRED` を区別できるが、辞退の理由は区別できない」（`F-018 AC-2`）
// である。したがって**期限到来という前提だけ**を作る。
//
// 🔴 汎用のエスケープハッチにしない規律はそのまま —— 関数は目的ごとに 1 つ、SQL は固定文、
//    埋め込む値は UUID と合成の表示名に限る（`assertPlainSqlLiteral`）。

/**
 * 🔴 T-08-09 専用シーム: `REQUESTED` の提案依頼を「期限到来」で `EXPIRED` にする。
 *
 * 2 文で、`packages/db/src/proposal-request-expiry.ts` の `expireProposalRequests` と**同じ条件**
 * （母集団 `state = 'REQUESTED' AND expires_at <= now()`、CAS `WHERE state = 'REQUESTED'`、
 * `responded_at = now()` / `responded_by = NULL`）を辿る:
 *   ① `expires_at` を過去に倒す（期限到来の前提づくり）
 *   ② ジョブと同じ CAS で `EXPIRED` に確定する
 * ⚠️ ジョブが同じトランザクションで書く `AuditLog(operation='EXPIRE', actorKind='SYSTEM')` は
 *    ここでは書かない（E2E はそれを表明しない。監査行はジョブのテストが固定する）。
 * 🔴 `REQUESTED` 以外の行には何もしない（終端を `EXPIRED` で上書きしない。`docs/05` §15.3）。
 *    ②が 0 件でも例外にはならないので、呼び出し側は結果を API（#32）で確かめること。
 */
export function expireProposalRequestByDeadline(proposalRequestId: string): void {
  if (!UUID_PATTERN.test(proposalRequestId)) {
    throw new Error(`proposalRequestId が UUID の形をしていません: ${proposalRequestId}`);
  }
  execSql(
    `UPDATE proposal_requests SET expires_at = now() - interval '1 minute' ` +
      `WHERE id = '${proposalRequestId}' AND state = 'REQUESTED';\n` +
      `UPDATE proposal_requests SET state = 'EXPIRED', responded_at = now(), responded_by = NULL ` +
      `WHERE id = '${proposalRequestId}' AND state = 'REQUESTED' AND expires_at <= now();`,
  );
}

/**
 * 🔴 T-08-09 専用シーム: 応諾で生成された `Proposal(DRAFT)` に、**実名と最新 CLEAN 版のスキルシート**を
 *    写した `EngineerSnapshot` が 1 行あることを確かめる（`F-018 AC-3`「`ACCEPTED` と同時に
 *    `Proposal(DRAFT)` が生成され、その時点で実名・所属会社名・スキルシートが開示される」）。
 *
 * なぜ DB を直接見るか: ホストが凍結情報を読む API（`#46`。`S-023`）は SP-09 の範囲であり、T-08-09 の
 * 時点でホストが `Proposal` に到達できる経路は `GET /api/proposals/{id}/gate`（#40。存在と `contentHash`）
 * だけである。「到達できる」は #40 で、「何が凍結されたか」はこのシームで見る。
 *
 * 🔴 `prisma db execute` は結果集合を返せないため、**期待した行が無ければ `RAISE EXCEPTION` で
 *    落とす** DO ブロックにする（読み取りの手段ではなく、1 つの表明である）。`execSql` が stderr を
 *    例外メッセージに写すので、落ちたときは何が無かったかが分かる。
 */
export function assertEngineerSnapshotFrozen(
  proposalId: string,
  expected: { readonly displayName: string; readonly skillSheetId: string },
): void {
  if (!UUID_PATTERN.test(proposalId)) {
    throw new Error(`proposalId が UUID の形をしていません: ${proposalId}`);
  }
  if (!UUID_PATTERN.test(expected.skillSheetId)) {
    throw new Error(`skillSheetId が UUID の形をしていません: ${expected.skillSheetId}`);
  }
  assertPlainSqlLiteral('displayName', expected.displayName);
  execSql(
    `DO $$\n` +
      `BEGIN\n` +
      `  IF NOT EXISTS (\n` +
      `    SELECT 1 FROM engineer_snapshots s\n` +
      `    WHERE s.proposal_id = '${proposalId}'\n` +
      `      AND s.display_name = '${expected.displayName}'\n` +
      `      AND s.skill_sheet_id = '${expected.skillSheetId}'\n` +
      `  ) THEN\n` +
      `    RAISE EXCEPTION 'T-08-09: engineer_snapshots に proposal_id=% の期待した凍結行（実名 + 最新 CLEAN 版）がありません', '${proposalId}';\n` +
      `  END IF;\n` +
      `END $$;`,
  );
}

/** 🔴 T-08-09 の合成エンジニアの表示名の接頭辞。`anonymous-share.spec.ts` の `registerEngineer` と一致させる。 */
export const T0809_SYNTHETIC_ENGINEER_PREFIX = 'T0809合成-';

/**
 * 🔴 T-08-09 専用シーム（後始末）: `anonymous-share.spec.ts` が API 経由で登録した**合成エンジニア**（X / Y / Z）を
 *    行ごと消し、A1 の台帳を `seed:isolation` の状態に戻す。
 *
 * なぜ要るか: E2E の DB は実行ごとに作り直されるが（`global-setup.ts`）、**同じ実行の中では spec 間で共有**される。
 * `isolation.spec.ts` ④ T-05-09 は「A1 の台帳は seed の 1 件だけ」（`toEqual([ownId])` / `total === 1`）を表明しており、
 * アルファベット順で先に走る本 spec が A1 に 3 件を残すとそこが落ちる。表明を緩めるのではなく、増やした側が戻す
 * （`CLAUDE.md` e2e-tester の「テスト前後に対象テナントの業務テーブルをクリアする」）。
 *
 * 🔴 消してよい行を SQL 自身が限定する: `id` が指定された UUID **かつ** `display_name` が合成の接頭辞
 *    （`T0809合成-`）で始まる行だけ。seed の行や他 spec の行は ID を渡されても消えない。
 * 🔴 2 文の順序に意味がある: `engineer_snapshots.skill_sheet_id → skill_sheets` は `ON DELETE RESTRICT` なので、
 *    エンジニアの CASCADE で `skill_sheets` が先に消えると凍結行の参照が残って失敗する。**先に `proposals`**
 *    （→ `engineer_snapshots` / `proposal_events` が CASCADE）を消し、その後に `engineers`
 *    （→ `engineer_skills` / `skill_sheets` / `engineer_shares` / `match_candidates` / `proposal_requests` が CASCADE）を消す。
 *    `audit_logs` は FK を持たないため残る（記録は消さない）。
 */
export function deleteT0809SyntheticEngineers(engineerIds: readonly string[]): void {
  if (engineerIds.length === 0) return;
  for (const id of engineerIds) {
    if (!UUID_PATTERN.test(id)) throw new Error(`engineerId が UUID の形をしていません: ${id}`);
  }
  const idList = engineerIds.map((id) => `'${id}'`).join(', ');
  const synthetic =
    `SELECT id FROM engineers WHERE id IN (${idList}) ` +
    `AND display_name LIKE '${T0809_SYNTHETIC_ENGINEER_PREFIX}%'`;
  execSql(
    `DELETE FROM proposals WHERE engineer_id IN (${synthetic});\n` +
      `DELETE FROM engineers WHERE id IN (${synthetic});`,
  );
}
