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
//    T-08-09 の 3 関数（下段。worker 不在を補う期限到来の前提づくり / 凍結行の表明 / 合成データの後始末）、
//    T-09-11 の「API を通らない経路の模擬」2 関数（送信元ドメインの検証 / 承認後の `content_hash` のずれ）と後始末、
//    T-11-07 の「非開示の値の仕込みと後始末」2 関数（E2E #15）、
//    T-12-14 ⑤ の「AI の上限到達の模擬」3 関数（E2E #23 (b) 後半。`usage_counters` を上限値に置く / 戻す。最下段）
//    だけであり、任意の SQL を実行できる経路を増やさない（`packages/db/src/testing/isolation.ts`
//    冒頭コメントと同じ規律）。関数を足すときは目的を 1 つに絞り、SQL を固定文にすること。
//    ✅ T-09-11 で worker がハーネスに入り（`harness/worker.ts`）、提案の**状態を直接書く**シームは削除した（下段の注記）。
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
// 🔴 `@ses/domain` をパッケージ名で import しない（`app-env.ts` / `worker.ts` と同じ理由。実装は同じファイル）。
//    期間キーの暦（`Asia/Tokyo`）を app と同じ 1 実装から取る（書き写すと日付の境界だけがずれる）。
import { usagePeriodKey } from '../../../packages/domain/src/usage/period-key.js';
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


// ---------------------------------------------------------------------------
// 🔴 T-09-03 / T-09-11（提案フローの E2E。docs/05 §17.3 #3 / #4 / #7 / #8 / #9 / #10 / #13）専用のシーム
// ---------------------------------------------------------------------------
// ✅ T-09-11 で E2E ハーネスに worker が入った（`harness/worker.ts`。docs/05 §17.6 ⑦）。それまで T-09-03 / T-09-08 / T-09-10 が
//    置いていた**状態を直接書くシーム**（`settleProposalGateAsPassedForE2e` / `settleProposalSendAsFailedForE2e` /
//    `settleProposalSendAsSucceededForE2e`）は **削除した** —— ゲートの確定・送信の確定はブラウザ経路（#39 → `gate.run` /
//    #43 → `send.proposal`）で本物を通す。残すと「E2E が本物を通していない」経路が残る。
//
// 🔴 ここに残る / 新設するのは **「API を通らない経路の模擬」と「合成データの後始末」だけ**である:
//   - `registerVerifiedSendingDomainForE2e` … 送信元ドメインの検証（`domain.verify` は SES の identity API を要求し、
//     `development` には無い。#72 が非本番で `NOT_REQUIRED` を返す点は Issue #57 未回答）。E2E #9 の「検証後に自動復帰」の
//     **検証**をこれで起こす
//   - `shiftProposalContentHashForE2e` … 承認後に `content_hash` をずらす（API からは変更できない = 多層防御の対象。E2E #10 の送信側）
//   - `deleteT0903SyntheticProposals` / `deleteT0911SyntheticProposals` / `deleteT0911SyntheticProjects` … 後始末
// 🔴 汎用のエスケープハッチにしない規律はそのまま —— 関数は目的ごとに 1 つ、SQL は固定文、埋め込む値は UUID と
//    合成の識別子（ドメイン名・接頭辞）に限る。**提案の状態を書く入口は 1 つも作らない。**

/** 送信元ドメイン（合成）。小文字英数字・ドット・ハイフンだけ（SQL リテラルへそのまま埋め込むため厳しく絞る）。 */
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * 🔴 T-09-11 専用シーム: そのテナントの送信元ドメインを **`VERIFIED`** にする（無ければ行を作る）。
 *
 * 送信ジョブの ①-d（`resolveVerifiedSendingDomain`: `state='VERIFIED' AND verified_at IS NOT NULL AND mail_from_domain IS NOT NULL`）
 * が読むのと**同じ列**を書く。`mail_from_domain` は `domain.provision` と同じ規約（`mail.{domain}`。`mailFromDomainFor`）。
 * `ON CONFLICT (tenant_id, domain)` で 2 回呼んでも 1 行（部分 UNIQUE「VERIFIED は 1 テナント 1 ドメイン」にも抵触しない）。
 *
 * 🔴 なぜ実経路（#71 → `domain.provision` → `domain.verify`）で作らないか: `domain.verify` は SES の identity API で DKIM の
 *    検証状態を読む。`development` の email はモックであり identity API は無い（`runtime.ts` の `resolveIdentityApi` は throw する）。
 *    非本番で検証を成立させる設計は [Issue #57](https://github.com/Festal-KM/SES-Platform/issues/57) 未回答のため、E2E は
 *    「検証済みという事実」だけを作る（`CLAUDE.md` §11 の外部 API 不使用を守るための唯一の方法）。
 */
export function registerVerifiedSendingDomainForE2e(tenantId: string, domain: string): void {
  if (!UUID_PATTERN.test(tenantId)) throw new Error(`tenantId が UUID の形をしていません: ${tenantId}`);
  if (!DOMAIN_PATTERN.test(domain)) throw new Error(`domain が合成ドメインの形（小文字英数字・ドット・ハイフン）ではありません: ${domain}`);
  execSql(
    `INSERT INTO tenant_sending_domains ` +
      `(id, tenant_id, domain, state, mail_from_domain, verified_at, last_checked_at, created_at) ` +
      `VALUES (gen_random_uuid(), '${tenantId}', '${domain}', 'VERIFIED', 'mail.${domain}', now(), now(), now()) ` +
      `ON CONFLICT (tenant_id, domain) DO UPDATE SET state = 'VERIFIED', mail_from_domain = EXCLUDED.mail_from_domain, ` +
      `verified_at = now(), last_checked_at = now(), revoked_at = NULL, last_failure_reason = NULL;`,
  );
}

/**
 * 🔴 T-09-11 専用シーム（E2E #10 の送信側）: **承認済み**の提案の `content_hash` を、現在の内容から再計算される値と
 *    一致しない値にずらす。
 *
 * #37 は `DRAFT` 以外を 422 で止める（`S-020` は読み取り専用）ので、承認後の内容変更は **API を通らない経路**（運用 SQL・凍結の
 * 再生成・将来のコードの不備）でしか起きない（docs/05 §11.5 手順 2〔改訂〕。Issue #54）。その経路への多層防御 —— 送信前判定
 * `readProposalGateFreshness` が `storedHash !== currentHash` で `GATE_STALE` の保留にし、`castProposalToSubmitting` が
 * `SUBMITTING` に入れないこと —— を E2E で確かめるための前提づくりである。
 *
 * 値は元のハッシュから決定的に導く（`sha256(content_hash || ':e2e-shift')`。64 桁 hex のまま。`review_gates.content_hash` は触らない）。
 * 🔴 `APPROVED` 以外の行には何もしない。呼び出し側は結果を #43 / #46 / `S-021` で確かめること。
 */
export function shiftProposalContentHashForE2e(proposalId: string): void {
  if (!UUID_PATTERN.test(proposalId)) throw new Error(`proposalId が UUID の形をしていません: ${proposalId}`);
  execSql(
    `UPDATE proposals SET content_hash = encode(sha256(convert_to(content_hash || ':e2e-shift', 'UTF8')), 'hex'), updated_at = now() ` +
      `WHERE id = '${proposalId}' AND state = 'APPROVED' AND content_hash IS NOT NULL;`,
  );
}

/** 🔴 T-09-03 の合成提案の件名の接頭辞。`home.mobile.spec.ts` と一致させる。 */
export const T0903_SYNTHETIC_PROPOSAL_PREFIX = 'T0903合成-';
/** 🔴 T-09-11 の合成提案の件名の接頭辞。`proposal-cycle.spec.ts` と一致させる。 */
export const T0911_SYNTHETIC_PROPOSAL_PREFIX = 'T0911合成-';
/** 🔴 T-09-11 の合成案件の案件名の接頭辞。`proposal-cycle.spec.ts` と一致させる。 */
export const T0911_SYNTHETIC_PROJECT_PREFIX = 'T0911合成案件-';

/**
 * 合成提案を行ごと消す（`deleteT0809SyntheticEngineers` と同じ判断。同じ実行の中では spec 間で DB を共有する）。
 *
 * 🔴 消してよい行を SQL 自身が限定する: `id` が指定された UUID **かつ** `subject` が許可された合成の接頭辞で始まる行だけ。
 *    `review_gates` / `send_attempts` は多相（FK 無し）なので先に消し、`proposals` の CASCADE で `engineer_snapshots` /
 *    `proposal_events` を消す。`audit_logs` は FK を持たないため残る（記録は消さない）。
 */
function deleteSyntheticProposals(prefix: string, proposalIds: readonly string[]): void {
  if (proposalIds.length === 0) return;
  for (const id of proposalIds) {
    if (!UUID_PATTERN.test(id)) throw new Error(`proposalId が UUID の形をしていません: ${id}`);
  }
  assertPlainSqlLiteral('prefix', prefix);
  const idList = proposalIds.map((id) => `'${id}'`).join(', ');
  const synthetic = `SELECT id FROM proposals WHERE id IN (${idList}) AND subject LIKE '${prefix}%'`;
  execSql(
    `DELETE FROM review_gates WHERE target_type = 'PROPOSAL' AND target_id IN (${synthetic});\n` +
      // ✅ T-09-11: `send_attempts` は worker（送信ジョブの ④）が作る。多相（FK 無し）なので一緒に消す。
      `DELETE FROM send_attempts WHERE entity_type = 'PROPOSAL' AND entity_id IN (${synthetic});\n` +
      `DELETE FROM proposals WHERE id IN (${synthetic});`,
  );
}

/** 🔴 T-09-03 専用（後始末）: `home.mobile.spec.ts` が API 経由で作った合成提案を消す。 */
export function deleteT0903SyntheticProposals(proposalIds: readonly string[]): void {
  deleteSyntheticProposals(T0903_SYNTHETIC_PROPOSAL_PREFIX, proposalIds);
}

/** 🔴 T-09-11 専用（後始末）: `proposal-cycle.spec.ts` が seed の案件に対して作った合成提案を消す。 */
export function deleteT0911SyntheticProposals(proposalIds: readonly string[]): void {
  deleteSyntheticProposals(T0911_SYNTHETIC_PROPOSAL_PREFIX, proposalIds);
}

/**
 * 🔴 T-09-11 専用（後始末）: `proposal-cycle.spec.ts` シナリオ 1 が画面から登録・公開した**合成案件**を、配下の提案ごと消す。
 *
 * なぜ要るか: 公開した案件は取引先の `GET /api/projects` の母集団に入る。`isolation.spec.ts` は「取引先に見える案件は seed の
 * 1 件だけ」（`toEqual([publishedProjectId])` / `total === 1`）を表明しており、残すとそこが落ちる。増やした側が戻す。
 *
 * 🔴 消してよい行を SQL 自身が限定する: `id` が指定された UUID **かつ** `name` が合成の接頭辞（`T0911合成案件-`）で始まる行だけ。
 * 🔴 順序に意味がある: `project_visibilities.review_gate_id → review_gates` は `ON DELETE RESTRICT` なので、公開のゲート結果は
 *    **案件（→ CASCADE で公開範囲）を消した後**に消す。提案側のゲート結果・試行は提案より先に消す（多相）。
 */
export function deleteT0911SyntheticProjects(projectIds: readonly string[]): void {
  if (projectIds.length === 0) return;
  for (const id of projectIds) {
    if (!UUID_PATTERN.test(id)) throw new Error(`projectId が UUID の形をしていません: ${id}`);
  }
  const idList = projectIds.map((id) => `'${id}'`).join(', ');
  const synthetic = `SELECT id FROM projects WHERE id IN (${idList}) AND name LIKE '${T0911_SYNTHETIC_PROJECT_PREFIX}%'`;
  const proposals = `SELECT id FROM proposals WHERE project_id IN (${synthetic})`;
  execSql(
    `DELETE FROM review_gates WHERE target_type = 'PROPOSAL' AND target_id IN (${proposals});\n` +
      `DELETE FROM send_attempts WHERE entity_type = 'PROPOSAL' AND entity_id IN (${proposals});\n` +
      `DELETE FROM proposals WHERE project_id IN (${synthetic});\n` +
      `CREATE TEMP TABLE e2e_t0911_projects AS ${synthetic};\n` +
      `DELETE FROM projects WHERE id IN (SELECT id FROM e2e_t0911_projects);\n` +
      `DELETE FROM review_gates WHERE target_type = 'PROJECT_PUBLISH' AND target_id IN (SELECT id FROM e2e_t0911_projects);\n` +
      `DROP TABLE e2e_t0911_projects;`,
  );
}

// ---------------------------------------------------------------------------
// 🔴 T-11-07（E2E #15。`tests/e2e/admin-non-disclosure.spec.ts`）専用のシーム 2 つ: 非開示の値の仕込みと後始末
// ---------------------------------------------------------------------------
// E2E #15 は「運営者に非開示のものが管理平面の**どの応答にも**現れない」（docs/05 §17.3 #15 / `BR-40`）を、
// **値が実在する状態**で確かめる必要がある。`seed:isolation` は氏名・本文・単価・エンド企業名は持つが、
// 生年月日・連絡先・スキルシートの `object_key` / `note`・`review_gates.findings` の抜粋・DKIM トークン・
// `ai_usage` の生成由来・`email_dispatches.recipient_email`・提案依頼の本文・クォータ変更の理由・削除失敗の理由は
// 持たない（`packages/db/seed/**` は T-10-07 が並走中で触れない）。無い値は「現れない」を証明できないので、
// ここで 1 組だけ仕込み、**仕込んだ値そのものを禁止値として走査**する（`T1107_NON_DISCLOSURE_MARKERS`）。
//
// 🔴 汎用のエスケープハッチにしない規律はそのまま —— 関数は目的ごとに 1 つ、SQL は固定文、埋め込む値は UUID と
//    ここで定義した合成のマーカー文字列（`assertPlainSqlLiteral` を通す）に限る。行 ID は固定の合成 UUID
//    （`0193b107-…`）で、後始末は**その ID の行だけ**を消す。エンジニアの PII 列は `UPDATE` で仕込み、後始末で NULL に戻す
//    （`seed:isolation` はこれらの列を入れていない）。
// 🔴 仕込む行は `A-005` の各項目に**実際に載る**形にしてある（項目 1 = `SUBMIT_FAILED` の提案 / 4 = `FAILED` のスキルシート /
//    5 = `pii_verdict='FAIL'` のゲート / 7 = `FAILED` の削除実行 / 11 = `PENDING` の送信ドメイン / 16 = 滞留した `QUEUED`）。
//    0 件の項目は何も漏らさない —— 載っている状態で「件数・状態・時刻だけが出る」ことを見る。

/** 🔴 仕込む値 = 禁止値（E2E が import する。`T1107` を含む値は seed と衝突しない）。 */
export const T1107_NON_DISCLOSURE_MARKERS = {
  /** engineers（ホスト所属 1 名の PII 列）。 */
  engineerBirthDate: '1971-02-03',
  engineerContactEmail: 't1107-engineer-contact@seed-isolation.test',
  engineerContactPhone: '090-1107-1107',
  engineerAffiliationLabel: 'T1107-affiliation-forbidden',
  engineerCity: 'T1107-city-forbidden',
  engineerPreferenceNote: 'T1107-preference-note-forbidden',
  /** skill_sheets（`FAILED` の版）。 */
  skillSheetObjectKey: 'tenants/t1107/skill-sheets/forbidden-object-key.pdf',
  skillSheetNote: 'T1107-skill-sheet-note-forbidden',
  /** review_gates（DONE / PII FAIL）の指摘の抜粋と AI 警告。 */
  gateFindingExcerpt: 'T1107-gate-finding-excerpt-forbidden',
  gateAiWarning: 'T1107-gate-ai-warning-forbidden',
  /** tenant_sending_domains（テナント 2 の `PENDING`）。ドメイン名そのものは `A-005` 項目 11 が表示してよい（下の別定数）。 */
  dkimToken: 't1107dkimtokenforbidden',
  mailFromDomain: 'mail.t1107-mailfrom-forbidden.test',
  sesIdentityArn: 'arn:aws:ses:ap-northeast-1:000000000000:identity/t1107-forbidden',
  sendingDomainLastFailureReason: 'T1107-DKIM-FAILURE-forbidden',
  /** ai_usage（proposal-drafter 1 行）。`purpose` は列挙値なので値の照合は無い（キーで見る）。 */
  aiModelId: 'claude-t1107-forbidden-model',
  aiPromptVersion: 't1107.v99-forbidden',
  aiTargetId: '0193b107-0000-7000-8000-0000000000a1',
  /** email_dispatches（滞留した `QUEUED`）。 */
  dispatchRecipientEmail: 't1107-dispatch-recipient@seed-isolation.test',
  /** proposals（`SUBMIT_FAILED`）。単価は数値なので JSON にだけ当てる。 */
  proposalSubject: 'T1107-proposal-subject-forbidden',
  proposalBody: 'T1107-proposal-body-forbidden',
  proposalDraftBody: 'T1107-proposal-draft-body-forbidden',
  proposalRecipientCompanyName: 'T1107-recipient-company-forbidden',
  proposalRecipientEmail: 't1107-proposal-recipient@seed-isolation.test',
  proposalOfferedUnitPrice: 1107107,
  /** proposal_requests（`DECLINED`）。 */
  proposalRequestMessage: 'T1107-proposal-request-message-forbidden',
  proposalRequestDeclineReason: 'T1107-decline-reason-forbidden',
  /** tenant_quota_overrides（引き上げ。通知は起きない）。 */
  quotaOverrideReason: 'T1107-quota-override-reason-forbidden',
  /** tenant_purge_runs（`FAILED`）。件数は数値なので JSON にだけ当てる。 */
  purgeFailureReason: 'T1107-purge-failure-reason-forbidden',
  purgeCounts: 1107424,
  /** audit_logs の `summary`（身元キーは `[masked]`、内容キーはキーごと落ちることを見る）。 */
  auditDisplayName: 'T1107-audit-display-name-forbidden',
  auditEmail: 't1107-audit@seed-isolation.test',
  auditBody: 'T1107-audit-body-forbidden',
  auditNote: 'T1107-audit-note-forbidden',
  auditReason: 'T1107-audit-reason-forbidden',
  auditObjectKey: 'tenants/t1107/audit/forbidden-object-key.pdf',
} as const;

/**
 * 仕込む送信ドメイン名。🔴 **禁止値ではない**（`domain` 列は GRANT され、`A-005` 項目 11 が「ドメイン」列として表示する。
 * 非開示なのは同じ行の `dkim_tokens` の値 / `mail_from_domain` / `ses_identity_arn` / `last_failure_reason`）。
 */
export const T1107_FIXTURE_SENDING_DOMAIN = 't1107-nondisclosure.test';

/** 仕込む行の固定 ID（seed の `seedUuid` とは別の名前空間）。後始末はこの ID の行だけを消す。 */
export const T1107_FIXTURE_IDS = {
  skillSheet: '0193b107-0000-7000-8000-000000000001',
  reviewGate: '0193b107-0000-7000-8000-000000000002',
  sendingDomain: '0193b107-0000-7000-8000-000000000003',
  aiUsage: '0193b107-0000-7000-8000-000000000004',
  proposal: '0193b107-0000-7000-8000-000000000006',
  proposalRequest: '0193b107-0000-7000-8000-000000000007',
  quotaOverride: '0193b107-0000-7000-8000-000000000008',
  purgeRun: '0193b107-0000-7000-8000-000000000009',
  auditLog: '0193b107-0000-7000-8000-00000000000a',
} as const;

export type T1107FixtureRefs = {
  /** テナント 1（ホスト所属エンジニア・利用者・案件・提案を持つ）。 */
  readonly tenantId: string;
  readonly hostEngineerId: string;
  readonly hostUserId: string;
  readonly publishedProjectId: string;
  readonly privateProjectId: string;
  readonly hostProposalId: string;
  /** 提案依頼の依頼先（取引先 2 社目。seed は依頼を持たないので UNIQUE と衝突しない）。 */
  readonly requestPartnerCompanyId: string;
  readonly requestPartnerEngineerId: string;
  readonly requestPartnerUserId: string;
  /** 送信ドメインを仕込むテナント（seed で未検証のテナント 2）。 */
  readonly unverifiedTenantId: string;
  /** クォータ上書きの操作者（運営者）。 */
  readonly platformOwnerUserId: string;
};

/** `email_dispatches.id` は uuid(7) の時刻で滞留を判定する（`readMailDispatchStuck`）。2 時間前の時刻で組む。 */
export function t1107StuckDispatchId(now: Date): string {
  const ms = (now.getTime() - 2 * 60 * 60 * 1000).toString(16).padStart(12, '0');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7000-8000-000000001107`;
}

function assertUuids(refs: Record<string, string>): void {
  for (const [label, value] of Object.entries(refs)) {
    if (!UUID_PATTERN.test(value)) throw new Error(`${label} が UUID の形をしていません: ${value}`);
  }
}

/**
 * 🔴 T-11-07 専用シーム: 非開示の値を 1 組仕込む（冪等: 同じ ID の行は `ON CONFLICT DO NOTHING`、エンジニアの列は上書き）。
 */
export function plantNonDisclosureFixturesForE2e(refs: T1107FixtureRefs, dispatchId: string): void {
  assertUuids({ ...refs, dispatchId });
  const m = T1107_NON_DISCLOSURE_MARKERS;
  for (const [label, value] of Object.entries(m)) {
    if (typeof value === 'string') assertPlainSqlLiteral(label, value);
  }
  const ids = T1107_FIXTURE_IDS;
  execSql(
    `UPDATE engineers SET birth_date = '${m.engineerBirthDate}', contact_email = '${m.engineerContactEmail}', ` +
      `contact_phone = '${m.engineerContactPhone}', affiliation_label = '${m.engineerAffiliationLabel}', ` +
      `city = '${m.engineerCity}', preference_note = '${m.engineerPreferenceNote}' ` +
      `WHERE id = '${refs.hostEngineerId}' AND tenant_id = '${refs.tenantId}';\n` +
      `INSERT INTO skill_sheets (id, tenant_id, engineer_id, version, object_key, content_type, byte_size, scan_status, ` +
      `scan_updated_at, is_latest, note, uploaded_by, uploaded_at) ` +
      `VALUES ('${ids.skillSheet}', '${refs.tenantId}', '${refs.hostEngineerId}', 1107, '${m.skillSheetObjectKey}', ` +
      `'application/pdf', 1024, 'FAILED', now(), false, '${m.skillSheetNote}', '${refs.hostUserId}', now() - interval '2 hours') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO review_gates (id, tenant_id, target_type, target_id, content_hash, execution, pii_verdict, commerce_verdict, ` +
      `consistency_verdict, findings, ai_warnings, role, executed_at) ` +
      `VALUES ('${ids.reviewGate}', '${refs.tenantId}', 'PROPOSAL', '${refs.hostProposalId}', 't1107-gate-content-hash', 'DONE', ` +
      `'FAIL', 'PASS', 'PASS', ` +
      `'[{"layer":"PII","kind":"FULL_NAME","field":"body","offsetStart":0,"offsetEnd":10,"excerpt":"${m.gateFindingExcerpt}","severity":"BLOCK"}]'::jsonb, ` +
      `'[{"layer":"CONSISTENCY","message":"${m.gateAiWarning}"}]'::jsonb, 'gate-inspector', now() - interval '30 minutes') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO tenant_sending_domains (id, tenant_id, domain, state, ses_identity_arn, ses_tenant_name, dkim_tokens, ` +
      `mail_from_domain, last_checked_at, last_failure_reason, created_at) ` +
      `VALUES ('${ids.sendingDomain}', '${refs.unverifiedTenantId}', '${T1107_FIXTURE_SENDING_DOMAIN}', 'PENDING', '${m.sesIdentityArn}', ` +
      `'t-${refs.unverifiedTenantId}', '["${m.dkimToken}"]'::jsonb, '${m.mailFromDomain}', now() - interval '1 day', ` +
      `'${m.sendingDomainLastFailureReason}', now() - interval '3 days') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO ai_usage (id, tenant_id, role, model_id, purpose, prompt_version, target_type, target_id, input_tokens, ` +
      `output_tokens, estimated_cost_usd, attempt_no, succeeded, started_at, finished_at) ` +
      `VALUES ('${ids.aiUsage}', '${refs.tenantId}', 'proposal-drafter', '${m.aiModelId}', 'proposal_draft', '${m.aiPromptVersion}', ` +
      `'Proposal', '${m.aiTargetId}', 1000, 200, 0.011070, 1, true, now() - interval '1 hour', now() - interval '1 hour') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO email_dispatches (id, tenant_id, recipient_class, recipient_email, template_key, dedupe_key, status) ` +
      `VALUES ('${dispatchId}', '${refs.tenantId}', 'HOST_MEMBER', '${m.dispatchRecipientEmail}', 't1107.probe', 't1107.probe:${dispatchId}', 'QUEUED') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO proposals (id, tenant_id, owner_partner_company_id, project_id, engineer_id, state, recipient_company_name, ` +
      `recipient_email, offered_unit_price, subject, body, draft_body, content_hash, approved_at, last_failure_reason, created_by, ` +
      `created_at, updated_at) ` +
      `VALUES ('${ids.proposal}', '${refs.tenantId}', NULL, '${refs.publishedProjectId}', '${refs.hostEngineerId}', 'SUBMIT_FAILED', ` +
      `'${m.proposalRecipientCompanyName}', '${m.proposalRecipientEmail}', ${m.proposalOfferedUnitPrice}, '${m.proposalSubject}', ` +
      `'${m.proposalBody}', '${m.proposalDraftBody}', 't1107-proposal-content-hash', now() - interval '2 hours', 'UNKNOWN', ` +
      `'${refs.hostUserId}', now() - interval '3 hours', now() - interval '1 hour') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO proposal_requests (id, tenant_id, project_id, engineer_id, partner_company_id, state, message, expires_at, ` +
      `decline_reason, issued_by, responded_by, responded_at) ` +
      `VALUES ('${ids.proposalRequest}', '${refs.tenantId}', '${refs.privateProjectId}', '${refs.requestPartnerEngineerId}', ` +
      `'${refs.requestPartnerCompanyId}', 'DECLINED', '${m.proposalRequestMessage}', now() + interval '7 days', ` +
      `'${m.proposalRequestDeclineReason}', '${refs.hostUserId}', '${refs.requestPartnerUserId}', now()) ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO tenant_quota_overrides (id, tenant_id, metric, "limit", previous_limit, effective_from, set_by_platform_user_id, reason) ` +
      `VALUES ('${ids.quotaOverride}', '${refs.tenantId}', 'AI_UNIT_SHEET_PARSE', 1107000, 200, current_date, ` +
      `'${refs.platformOwnerUserId}', '${m.quotaOverrideReason}') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO tenant_purge_runs (id, tenant_id, cause, status, started_at, completed_at, counts, failure_reason) ` +
      `VALUES ('${ids.purgeRun}', '${refs.tenantId}', 'RETENTION', 'FAILED', now() - interval '1 day', NULL, ` +
      `'{"engineerContacts": ${m.purgeCounts}}'::jsonb, '${m.purgeFailureReason}') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO audit_logs (id, tenant_id, actor_kind, actor_id, action, target_type, target_id, summary, ip_address, device_kind, created_at) ` +
      `VALUES ('${ids.auditLog}', '${refs.tenantId}', 'USER', '${refs.hostUserId}', 'engineer.view', 'Engineer', '${refs.hostEngineerId}', ` +
      `'{"displayName":"${m.auditDisplayName}","email":"${m.auditEmail}","body":"${m.auditBody}","note":"${m.auditNote}",` +
      `"reason":"${m.auditReason}","objectKey":"${m.auditObjectKey}","offeredUnitPrice":${m.proposalOfferedUnitPrice},"via":"DETAIL"}'::jsonb, ` +
      `'127.0.0.1', 'desktop', now()) ` +
      `ON CONFLICT DO NOTHING;`,
  );
}

/**
 * 🔴 T-11-07 専用シーム（後始末）: 仕込んだ行を ID で消し、エンジニアの PII 列を NULL に戻す。
 *    `audit_logs` の合成行も消す（実操作の記録ではない。実操作の記録は他のシームと同じく消さない）。
 */
export function removeNonDisclosureFixturesForE2e(refs: T1107FixtureRefs, dispatchId: string): void {
  assertUuids({ ...refs, dispatchId });
  const ids = T1107_FIXTURE_IDS;
  execSql(
    `DELETE FROM audit_logs WHERE id = '${ids.auditLog}' AND action = 'engineer.view' AND tenant_id = '${refs.tenantId}';\n` +
      `DELETE FROM tenant_purge_runs WHERE id = '${ids.purgeRun}';\n` +
      `DELETE FROM tenant_quota_overrides WHERE id = '${ids.quotaOverride}';\n` +
      `DELETE FROM proposal_requests WHERE id = '${ids.proposalRequest}';\n` +
      `DELETE FROM review_gates WHERE target_type = 'PROPOSAL' AND target_id = '${ids.proposal}';\n` +
      `DELETE FROM send_attempts WHERE entity_type = 'PROPOSAL' AND entity_id = '${ids.proposal}';\n` +
      `DELETE FROM proposals WHERE id = '${ids.proposal}';\n` +
      `DELETE FROM email_dispatches WHERE id = '${dispatchId}';\n` +
      `DELETE FROM ai_usage WHERE id = '${ids.aiUsage}';\n` +
      `DELETE FROM tenant_sending_domains WHERE id = '${ids.sendingDomain}';\n` +
      `DELETE FROM review_gates WHERE id = '${ids.reviewGate}';\n` +
      `DELETE FROM skill_sheets WHERE id = '${ids.skillSheet}';\n` +
      `UPDATE engineers SET birth_date = NULL, contact_email = NULL, contact_phone = NULL, affiliation_label = NULL, ` +
      `city = NULL, preference_note = NULL WHERE id = '${refs.hostEngineerId}' AND tenant_id = '${refs.tenantId}';`,
  );
}

// ============================================================================
// 🔴 T-10-10 専用シーム（E2E #16「削除完了の確認が `A-010` の 1 本からしか取れない」。docs/05 §17.3 #16 / `F-062 AC-7`）
// ============================================================================
// `PURGED` に到達したテナントと、その `TenantPurgeRun`（FAILED → 再試行で COMPLETED）を合成で仕込む。
// 🔴 `tenant.purge` を実際に動かさない理由: `CLOSING` へ入れる主平面 / 管理平面の操作が Phase 1 に無く（`F-062` は Phase 3）、
//    ブラウザから 30 日を進める手段も無い（E2E #17 が結合で代替した理由と同じ）。ここで作るのは**確認画面の前提**だけである。
// 🔴 失敗理由（`failure_reason`）と件数は**運営者の応答に現れてはならない / 現れてよい**の対照として固定の値を持つ。
//    `T1010_DELETION_STATUS_MARKERS.failureReason` は `A-010` / API-A12 / API-A3 / API-A8 のどこにも出ない。
//    `completedCounts` は API-A12 と `A-010` に**だけ**出る（`A-003` / API-A3 / API-A8 に出ない）。

export const T1010_DELETION_STATUS_TENANT_ID = '0193b110-0000-7000-8000-000000001010';

export const T1010_DELETION_STATUS_MARKERS = {
  /** 🔴 どの応答にも現れてはならない（`app_platform` から REVOKE 済みの列の値）。 */
  failureReason: 'COLUMN_ERASE:T1010ForbiddenError',
  /** API-A12 / `A-010` にだけ現れる件数（`A-003` / API-A3 / API-A8 には現れない）。 */
  completedCounts: { engineers: 101042, skill_sheets: 7, messages: 3 } as const,
} as const;

const T1010_RUN_IDS = {
  failed: '0193b110-0000-7000-8000-000000001011',
  completed: '0193b110-0000-7000-8000-000000001012',
} as const;

/** 仕込み（`beforeAll`）。冪等（`ON CONFLICT DO NOTHING`）。 */
export function plantDeletionStatusFixturesForE2e(): void {
  const m = T1010_DELETION_STATUS_MARKERS;
  const counts = JSON.stringify(m.completedCounts);
  assertPlainSqlLiteral('failureReason', m.failureReason);
  execSql(
    `INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, closing_entered_at, provisioning_request_id, created_at) ` +
      `VALUES ('${T1010_DELETION_STATUS_TENANT_ID}', 'T1010 Deletion Status Tenant', 'production', 'PURGED', now() - interval '1 day', ` +
      `now() - interval '40 days', 't-10-10-e2e-deletion-status', now() - interval '200 days') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO tenant_purge_runs (id, tenant_id, cause, status, started_at, completed_at, counts, failure_reason) ` +
      `VALUES ('${T1010_RUN_IDS.failed}', '${T1010_DELETION_STATUS_TENANT_ID}', 'TENANT_PURGED', 'FAILED', now() - interval '2 days', NULL, ` +
      `'{}'::jsonb, '${m.failureReason}') ` +
      `ON CONFLICT (id) DO NOTHING;\n` +
      `INSERT INTO tenant_purge_runs (id, tenant_id, cause, status, started_at, completed_at, counts, failure_reason) ` +
      `VALUES ('${T1010_RUN_IDS.completed}', '${T1010_DELETION_STATUS_TENANT_ID}', 'TENANT_PURGED', 'COMPLETED', now() - interval '1 day', ` +
      `now() - interval '1 day' + interval '5 minutes', '${counts}'::jsonb, NULL) ` +
      `ON CONFLICT (id) DO NOTHING;`,
  );
}

/** 後始末（`afterAll`）。仕込んだ行だけを ID で消す。合成テナントに紐づく監査行は `audit_logs.tenant_id` の CASCADE で一緒に消える（使い捨ての E2E DB なので可）。 */
export function removeDeletionStatusFixturesForE2e(): void {
  execSql(
    `DELETE FROM tenant_purge_runs WHERE id IN ('${T1010_RUN_IDS.failed}', '${T1010_RUN_IDS.completed}');\n` +
      `DELETE FROM tenants WHERE id = '${T1010_DELETION_STATUS_TENANT_ID}';`,
  );
}

// ============================================================================
// ✅ T-12-14 ⑤（E2E #23 (b) 後半。`tests/e2e/ai-limit.spec.ts`）: AI の上限到達を「API を通らない経路の模擬」で作る
// ============================================================================
// 🔴 なぜシームか: ハーネスの env は 1 組（`app-env.ts`）で、他の全シナリオがゲート PASS を前提にする。上限到達を実経路
//    （`AI_DAILY_COST_LIMIT_USD_DEFAULT` を下げた worker / 運営者の `A-004`〔Phase 3〕）で再現すると spec ごとに worker の起動が
//    要る。上限到達の**判定**そのものは結合層（`tests/isolation/gate-hold-release.test.ts` / `ai-degraded.test.ts` ④）に固定済みで、
//    E2E が見るのは**表示**（`S-038` の残量 / `S-021` の HELD / 承認・送信の 422）だけである（SP-12 `T-12-03` 表 A #23 = 既定 (b)）。
// 🔴 書くのは `usage_counters` の **2 行だけ**（当日の `AI_COST_USD` / 当月の `AI_UNIT_PROPOSAL_DRAFT`）。提案・ゲート・状態は書かない。
//    - `AI_COST_USD` は **`reserved_value`** を上限値に置く。判定式は `value + reserved_value + 見積 <= 上限`（`reserveAiCost` /
//      `decideAiDailyCost`）であり、どちらの列でも上限到達になる。`value` は実績（モック AI の原価）であり、後始末で 0 に戻すと
//      `usage.gap-check`（`ai_usage` との突き合わせ）が乖離を報告する。`reserved_value` は予約の残高（暦日で消える設計。
//      `ai-cost-guard.ts` 冒頭）なので、0 に戻すことがそのまま正しい後始末になる。
//    - `AI_UNIT_PROPOSAL_DRAFT` は **`value`** をクォータに置く（Phase 1 に件数を積む AI ロールは無く、0 に戻して失うものが無い）。
//      🔴 `gate-inspector` は件数クォータの対象外（`F-027 AC-7`）なので、`S-038` の「上限到達」は件数 4 単位のどれかでしか描けない。
// 🔴 上限値・クォータは呼び出し側（spec）が **app と同じ出所**から渡す（`e2eAiDailyCostLimitUsd()` / `GET /api/usage` の `quota`）。
//    ここに数値を書かない。

/** 🔴 T-12-14 ⑤ の合成提案の件名の接頭辞。`ai-limit.spec.ts` と一致させる。 */
export const T1214_SYNTHETIC_PROPOSAL_PREFIX = 'T1214合成-';

export function deleteT1214SyntheticProposals(proposalIds: readonly string[]): void {
  deleteSyntheticProposals(T1214_SYNTHETIC_PROPOSAL_PREFIX, proposalIds);
}

/** 十進の USD（`AI_DAILY_COST_LIMIT_USD_DEFAULT` の形。`z.coerce.number().positive()` を通った値の文字列）。 */
const USD_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;

function assertUsd(label: string, value: string): void {
  if (!USD_DECIMAL_PATTERN.test(value) || Number(value) <= 0) {
    throw new Error(`${label} が正の十進 USD の形ではありません: ${value}`);
  }
}

function assertPositiveInteger(label: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} が正の整数ではありません: ${String(value)}`);
}

/**
 * 🔴 当日（`Asia/Tokyo`）の AI の日次コスト上限に**到達した**状態にする（`reserved_value = 上限値`）。
 *    以後、そのテナントの `gate.run` は `reserveAiCost` で `LIMIT_REACHED` になり、ゲートは `HELD_AI_COST_LIMIT` で保留される
 *    （`F-027 AC-5`。`GATE_FAILED` にならない）。2 回呼んでも同じ 1 行（`ON CONFLICT` の UPDATE）。
 */
export function reachAiDailyCostLimitForE2e(tenantId: string, limitUsd: string): void {
  if (!UUID_PATTERN.test(tenantId)) throw new Error(`tenantId が UUID の形をしていません: ${tenantId}`);
  assertUsd('limitUsd', limitUsd);
  const periodKey = usagePeriodKey('DAY', new Date());
  execSql(
    `INSERT INTO usage_counters (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at) ` +
      `VALUES (gen_random_uuid(), '${tenantId}', 'DAY', '${periodKey}', 'AI_COST_USD', 0, ${limitUsd}::numeric, now()) ` +
      `ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE SET reserved_value = ${limitUsd}::numeric, observed_at = now();`,
  );
}

/**
 * 🔴 当月（`Asia/Tokyo`）の提案ドラフト（`AI_UNIT_PROPOSAL_DRAFT`）の件数を**クォータちょうど**にする（`value = quota`）。
 *    `S-038` の残量が「あと 0 件」「上限に達しました」（`level = REACHED`）になる。判定は `GET /api/usage` と同じ
 *    `decideAiUnitQuota` / `assessAiUnitLimit`（`packages/domain`）。2 回呼んでも同じ 1 行。
 */
export function reachAiUnitQuotaForE2e(tenantId: string, quota: number): void {
  if (!UUID_PATTERN.test(tenantId)) throw new Error(`tenantId が UUID の形をしていません: ${tenantId}`);
  assertPositiveInteger('quota', quota);
  const periodKey = usagePeriodKey('MONTH', new Date());
  execSql(
    `INSERT INTO usage_counters (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at) ` +
      `VALUES (gen_random_uuid(), '${tenantId}', 'MONTH', '${periodKey}', 'AI_UNIT_PROPOSAL_DRAFT', ${String(quota)}, 0, now()) ` +
      `ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE SET value = ${String(quota)}, observed_at = now();`,
  );
}

/**
 * 後始末（`afterAll`）: 上の 2 関数が置いた値を戻す（`AI_COST_USD` の `reserved_value` → 0 / `AI_UNIT_PROPOSAL_DRAFT` の `value` → 0）。
 * 🔴 `AI_COST_USD` の `value`（実績）には触れない。行は消さない（`usage.gap-check` の母集団を変えない）。
 * 同じ実行の後続 spec（`proposal-cycle.spec.ts` 等）はゲート PASS を前提にするため、**必ず呼ぶ**こと。
 */
export function clearAiLimitFixturesForE2e(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) throw new Error(`tenantId が UUID の形をしていません: ${tenantId}`);
  const now = new Date();
  const dayKey = usagePeriodKey('DAY', now);
  const monthKey = usagePeriodKey('MONTH', now);
  execSql(
    `UPDATE usage_counters SET reserved_value = 0, observed_at = now() ` +
      `WHERE tenant_id = '${tenantId}' AND period_kind = 'DAY' AND period_key = '${dayKey}' AND metric = 'AI_COST_USD';\n` +
      `UPDATE usage_counters SET value = 0, observed_at = now() ` +
      `WHERE tenant_id = '${tenantId}' AND period_kind = 'MONTH' AND period_key = '${monthKey}' AND metric = 'AI_UNIT_PROPOSAL_DRAFT';`,
  );
}
