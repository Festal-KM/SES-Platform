// tests/e2e/harness/object-storage.ts
// docs/05 §17.6 globalSetup ①「コンテナ起動（PostgreSQL / Redis / MinIO / MailHog / ClamAV）」/
// §17.5「development では MinIO / MailHog / ClamAV の実コンテナも併用」。
//
// 🔴 T-05-10（K-7 の E2E）で初めてスキルシートの保管（アップロード / ダウンロードの署名付き URL）を
//    実際に経由するテストを書くため、ここで MinIO を追加する。これまでの `globalSetup`
//    （`postgres.ts`）は PostgreSQL しか起動していなかった —— Phase 0〜SP-04 の E2E は
//    オブジェクトストレージに触れる画面が無く、必要が無かったためである。
//
// 🔴 **`development` の `objectStore` は `real`**（`packages/config/src/connector-selection.ts`
//    `developmentSelection()`）であり、モックにフォールバックしない（`CLAUDE.md` §11.1）。
//    したがって E2E がアップロード / ダウンロードの署名付き URL を実際に解決するには、
//    到達可能な S3 互換エンドポイントが要る。ローカル `docker-compose.yml` の `minio` /
//    `minio-init` サービスと**同じイメージ・同じ初期化コマンド**（バケット作成 +
//    バージョニング有効化）を、Testcontainers で E2E 専用の使い捨てインスタンスとして用意する
//    （`docker compose up -d` の実行を前提にしない。PostgreSQL と同じ方針）。
//
// 🔴 **バージョニングが必須**（docker-compose.yml `minio-init` 冒頭コメントと同じ理由）。
//    `ObjectStore.head()`（`packages/connectors/src/storage/aws-sdk-s3.ts` の `toHeadResponse`）は
//    `VersionId` が空なら例外にする —— `FileScanResult` / `skill_sheets` の重複排除キーが
//    `(objectKey, versionId)` を要求するためである。バージョニングを有効化し忘れると、
//    アップロードの確定（#19）が必ず失敗する。
//
// 🔴 **ClamAV は起動しない。** `apps/web` は `createConnectors()`（`malwareScanner` を含む
//    全区分の一括組み立て）を一度も呼ばない —— `lib/db/bootstrap.ts` の `objectStore()` は
//    `objectStore` の実装だけを遅延生成する（`createConnectors` を呼ぶと未登録の
//    `malwareScanner`〔development の ClamAV。T-05-05 の射程外〕で起動そのものが落ちるため）。
//    したがって ClamAV への到達性が無くてもアプリの起動は落ちない。スキャン結果の適用
//    （`scan.apply-result`）は `apps/worker` の範囲であり、E2E ハーネスには worker プロセスも
//    BullMQ 経由の駆動も無い。K-7 の E2E がスキャン結果を `CLEAN` にする手段は
//    `harness/db-admin.ts` を参照（本ファイルと対の関係）。
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers';

// 🔴 docker-compose.yml と同じイメージタグに揃える（`:latest` の浮動タグを避ける。
//    code-reviewer 指摘 #4 と同じ理由。ローカルに既に pull 済みのタグを再利用でき、
//    E2E 専用に新しいイメージを取得させない）。
const MINIO_IMAGE = 'minio/minio:RELEASE.2025-09-07T16-13-09Z';
const MINIO_MC_IMAGE = 'minio/mc:RELEASE.2025-08-13T08-35-41Z';
const MINIO_PORT = 9000;
const MINIO_NETWORK_ALIAS = 'minio';
const STARTUP_TIMEOUT_MS = 120_000;

/** E2E 専用のバケット名（`packages/config/src/testing/fixtures.ts` の `S3_BUCKET` とは別名）。 */
export const E2E_S3_BUCKET = 'ses-platform-e2e';

/**
 * `globalSetup` が書き、テストファイル（`tests/e2e/support/**` / `*.spec.ts`）が読む
 * MinIO のオリジン（`http://host:port`）。
 *
 * 🔴 なぜ環境変数で受け渡すか: Playwright の `globalSetup` はワーカープロセスの起動より**前**に
 *    実行される（`harness/db-admin.ts` 冒頭コメントと同じ理由）。`harness/endpoint.ts` の
 *    `SES_E2E_PORT` と同じ「env 経由で globalSetup → テストへ渡す」パターンを踏襲する。
 * 🔴 ブラウザから MinIO へ到達する経路（ダウンロードの署名付き URL への実ナビゲーション）は
 *    `tests/e2e/support/network.ts` の外向き遮断（`guardOutboundRequests`）の対象になるため、
 *    このオリジンを**明示的に許可リストへ足す**必要がある（同ファイルの `extraAllowedOrigins`）。
 *    「何でも許可する」のではなく、E2E が自分で起動した使い捨て MinIO の 1 オリジンだけを許す。
 */
export const OBJECT_STORAGE_ORIGIN_ENV = 'SES_E2E_OBJECT_STORAGE_ORIGIN';

export type E2eObjectStorage = {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly region: string;
  readonly stop: () => Promise<void>;
};

/**
 * MinIO を起動し、バケットを作成してバージョニングを有効化する。
 *
 * 🔴 `docker-compose.yml` の `minio-init`（`minio/mc` の 1 回きりの実行コンテナ）と**同じ
 *    イメージ・同じコマンド**を使う（バケット作成手順を 2 実装持たない）。`Wait.forOneShotStartup()`
 *    は「起動して仕事をして終了するコンテナ」を待つための Testcontainers の標準戦略であり、
 *    `minio-init` の `restart: "no"` と同じ性質を表現する。
 */
export async function startE2eObjectStorage(): Promise<E2eObjectStorage> {
  const accessKeyId = `ses_e2e_${randomBytes(6).toString('hex')}`;
  const secretAccessKey = randomBytes(24).toString('hex');

  const network = await new Network().start();

  const minio: StartedTestContainer = await new GenericContainer(MINIO_IMAGE)
    .withNetwork(network)
    .withNetworkAliases(MINIO_NETWORK_ALIAS)
    .withEnvironment({ MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey })
    .withCommand(['server', '/data'])
    .withExposedPorts(MINIO_PORT)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', MINIO_PORT))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const initScript = [
    'set -e',
    'mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"',
    'mc mb --ignore-existing "local/$S3_BUCKET"',
    'mc version enable "local/$S3_BUCKET"',
  ].join('\n');

  await new GenericContainer(MINIO_MC_IMAGE)
    .withNetwork(network)
    .withEnvironment({
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
      S3_BUCKET: E2E_S3_BUCKET,
    })
    .withEntrypoint(['/bin/sh', '-c', initScript])
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    // 🔴 一回きりの初期化コンテナ（`docker-compose.yml` の `minio-init` と同じ性質）。
    //    既定では終了後も残るため、実行のたびに停止済みコンテナが積み上がる（実測）。
    .withAutoRemove(true)
    .start();

  const host = minio.getHost();
  const port = minio.getMappedPort(MINIO_PORT);

  return {
    endpoint: `http://${host}:${port}`,
    accessKeyId,
    secretAccessKey,
    bucket: E2E_S3_BUCKET,
    region: 'us-east-1',
    stop: async () => {
      await minio.stop();
      await network.stop();
    },
  };
}

/** `globalSetup` が 1 度だけ呼ぶ（`db-admin.ts` の `ADMIN_DATABASE_URL_ENV` と同じ受け渡し方）。 */
export function writeObjectStorageOriginEnv(endpoint: string): void {
  process.env[OBJECT_STORAGE_ORIGIN_ENV] = endpoint;
}

/** テストファイルが読む側。未設定なら `globalSetup` が先に走っていない（設定漏れ）。 */
export function objectStorageOrigin(): string {
  const origin = process.env[OBJECT_STORAGE_ORIGIN_ENV];
  if (origin === undefined || origin === '') {
    throw new Error(
      `${OBJECT_STORAGE_ORIGIN_ENV} が設定されていません（globalSetup が先に走っていないか、` +
        'このプロセスへ引き継がれていません）。',
    );
  }
  return origin;
}
