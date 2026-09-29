// tests/e2e/harness/object-storage.ts
// docs/05 §17.6 globalSetup ①「コンテナ起動（PostgreSQL / Redis / オブジェクトストレージ /
// MailHog / ClamAV）」/ §17.5「development ではオブジェクトストレージ / MailHog / ClamAV の
// 実コンテナも併用」。
//
// 🔴 T-05-10（K-7 の E2E）で初めてスキルシートの保管（アップロード / ダウンロードの署名付き URL）を
//    実際に経由するテストを書くため、ここでオブジェクトストレージを追加する。これまでの `globalSetup`
//    （`postgres.ts`）は PostgreSQL しか起動していなかった —— Phase 0〜SP-04 の E2E は
//    オブジェクトストレージに触れる画面が無く、必要が無かったためである。
//
// 🔴 **`development` の `objectStore` は `real`**（`packages/config/src/connector-selection.ts`
//    `developmentSelection()`）であり、モックにフォールバックしない（`CLAUDE.md` §11.1）。
//    したがって E2E がアップロード / ダウンロードの署名付き URL を実際に解決するには、
//    到達可能な S3 互換エンドポイントが要る。ローカル `docker-compose.yml` の `s3mock` /
//    `s3mock-init` サービスと**同じイメージ・同じ初期化内容**（バケット作成 +
//    バージョニング有効化）を、Testcontainers で E2E 専用の使い捨てインスタンスとして用意する
//    （`docker compose up -d` の実行を前提にしない。PostgreSQL と同じ方針）。
//
// 🔴 **バージョニングが必須**（docker-compose.yml `s3mock-init` 冒頭コメントと同じ理由）。
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
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

// ============================================================================
// 🔴 使用するイメージの経緯（消さないこと。同じ調査を次の人に繰り返させないため）
// ============================================================================
// 【2026-09-15】レジストリを Docker Hub から quay.io へ移した。Docker Hub の `minio/minio` /
//   `minio/mc` は同じタグでも `pull access denied` を返すようになり、CI の isolation / E2E が
//   イメージ取得の段階で落ちた（run 34916918489）。当時 quay.io には同一タグが公開されていた。
//
// 【2026-09-28】🔴 **MinIO をやめ、`adobe/s3mock` に置き換えた**（Issue #75）。MinIO の
//   コンテナイメージが**匿名で取得できなくなった**（配布方針の外部変更）。CI の E2E は
//   2026-09-25 から `unauthorized: access to the requested resource is not authorized`（HTTP 500）で
//   赤のままだった。レジストリの manifest に匿名トークンで到達できるかの実測:
//
//     | イメージ                                       | 結果 |
//     |------------------------------------------------|------|
//     | `docker.io/minio/minio` / `docker.io/minio/mc`  | 401  |
//     | `quay.io/minio/minio` / `quay.io/minio/mc`      | 401  |
//     | `ghcr.io/minio/minio`                           | 403  |
//     | `docker.io/adobe/s3mock:4.7.0`                  | 200  |
//     | `docker.io/localstack/localstack:4`             | 200  |
//
//   🔴 **401 はリポジトリ単位である**（`quay.io/minio/minio:latest` も 401）。したがって
//      **古いタグへの固定では回避できず、ミラーも作れない**（ミラー元を pull できない）。
//      2026-09-15 に取った「別レジストリへ逃げる」手は、もう使えない。
//   🔴 **ローカルでは気づけない** —— 開発機にはイメージがキャッシュ済みで E2E が通る。
//      毎回まっさらな CI の runner だけが落ちる。
//
//   失う忠実度は **SigV4 の署名検証**（s3mock はどんな署名でも通す）。`tests/e2e/**` に
//   署名の検証結果に依存する主張は無く（S3 に触るのは `audit-k7.spec.ts` と `projects.spec.ts` の
//   2 本で、いずれもスキルシートのアップロード / ダウンロードと監査ログを見ている）、
//   署名の正しさは実 S3 を使う `production` の責務であり `packages/connectors` の単体テストで見る層である。
// ============================================================================

// 🔴 docker-compose.yml と同じイメージタグに揃える（`:latest` の浮動タグを避ける。
//    ローカルに既に pull 済みのタグを再利用でき、E2E 専用に新しいイメージを取得させない。
//    片方だけ変えるとローカルと CI で別のイメージを引くことになる）。
const OBJECT_STORAGE_IMAGE = 'adobe/s3mock:4.7.0';
/** s3mock の HTTP ポート（HTTPS の 9191 は使わない）。 */
const OBJECT_STORAGE_PORT = 9090;
const STARTUP_TIMEOUT_MS = 120_000;

/** E2E 専用のバケット名（`packages/config/src/testing/fixtures.ts` の `S3_BUCKET` とは別名）。 */
export const E2E_S3_BUCKET = 'ses-platform-e2e';

/**
 * `globalSetup` が書き、テストファイル（`tests/e2e/support/**` / `*.spec.ts`）が読む
 * オブジェクトストレージのオリジン（`http://host:port`）。
 *
 * 🔴 なぜ環境変数で受け渡すか: Playwright の `globalSetup` はワーカープロセスの起動より**前**に
 *    実行される（`harness/db-admin.ts` 冒頭コメントと同じ理由）。`harness/endpoint.ts` の
 *    `SES_E2E_PORT` と同じ「env 経由で globalSetup → テストへ渡す」パターンを踏襲する。
 * 🔴 ブラウザからオブジェクトストレージへ到達する経路（ダウンロードの署名付き URL への実ナビゲーション）は
 *    `tests/e2e/support/network.ts` の外向き遮断（`guardOutboundRequests`）の対象になるため、
 *    このオリジンを**明示的に許可リストへ足す**必要がある（同ファイルの `extraAllowedOrigins`）。
 *    「何でも許可する」のではなく、E2E が自分で起動した使い捨てインスタンスの 1 オリジンだけを許す。
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

/** `PutBucketVersioning` の本文（S3 の API 仕様どおりの XML）。 */
const VERSIONING_ENABLED_XML =
  '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>';

/**
 * バケットのバージョニングを有効化し、**有効になったことを読み直して確かめる**。
 *
 * 🔴 s3mock の `initialBuckets` はバケットを作るだけで、バージョニングは**既定で無効**である
 *    （実測: 有効化前の `PutObject` は `x-amz-version-id` を返さない）。有効化を忘れると
 *    `toHeadResponse` が「VersionId を返しませんでした」で落ち、アップロードの確定が必ず失敗する。
 * 🔴 署名を付けずに投げる。s3mock は SigV4 を**検証しない**（それが MinIO との唯一の差である）ため、
 *    ここで AWS SDK を新規依存として持ち込む必要が無い。`fetch` 1 発で済ませる。
 * 🔴 PUT の 2xx だけで満足しない。**読み直して `Enabled` を確認する** —— s3mock 側の仕様変更で
 *    黙って無効のままになると、原因が「アップロードの確定が失敗する」という遠い症状でしか出ない。
 */
async function enableBucketVersioning(endpoint: string, bucket: string): Promise<void> {
  const url = `${endpoint}/${bucket}?versioning`;
  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/xml' },
    body: VERSIONING_ENABLED_XML,
  });
  if (!put.ok) {
    throw new Error(
      `バケット ${bucket} のバージョニング有効化に失敗しました（status=${put.status}）。` +
        `本文: ${(await put.text()).slice(0, 300)}`,
    );
  }

  const get = await fetch(url);
  const body = await get.text();
  if (!get.ok || !body.includes('<Status>Enabled</Status>')) {
    throw new Error(
      `バケット ${bucket} のバージョニングが Enabled になっていません（status=${get.status}）。` +
        `docs/05 §14.1 が前提にしており、無効のままだと HeadObject が VersionId を返しません。本文: ${body.slice(0, 300)}`,
    );
  }
}

/**
 * オブジェクトストレージ（`adobe/s3mock`）を起動し、バケットを作成してバージョニングを有効化する。
 *
 * 🔴 `docker-compose.yml` の `s3mock` / `s3mock-init` と**同じイメージ・同じ初期化内容**にする
 *    （初期化手順を 2 通り持たない）。バケットの作成は s3mock の `initialBuckets` が行うため、
 *    MinIO 時代にあった `mc` の初期化コンテナ（`Wait.forOneShotStartup()` で待つ 2 本目）は
 *    **不要になった**。残る初期化はバージョニングの有効化 1 つだけで、これは `fetch` で足りる。
 */
export async function startE2eObjectStorage(): Promise<E2eObjectStorage> {
  // 🔴 s3mock は資格情報を検証しないが、`packages/config` は `S3_ACCESS_KEY_ID` /
  //    `S3_SECRET_ACCESS_KEY` を必須にしている（`harness/app-env.ts`）。実行ごとに異なる値を
  //    渡し続けるのは、**アプリ側がこの値を実際に使っていること**（未設定でも動く経路が生えていないこと）を
  //    保ち続けるためである。
  const accessKeyId = `ses_e2e_${randomBytes(6).toString('hex')}`;
  const secretAccessKey = randomBytes(24).toString('hex');

  const objectStorage: StartedTestContainer = await new GenericContainer(OBJECT_STORAGE_IMAGE)
    // 🔴 バケットの作成（`docker-compose.yml` の `s3mock` サービスと同じ環境変数）。
    .withEnvironment({ initialBuckets: E2E_S3_BUCKET, retainFilesOnExit: 'false' })
    .withExposedPorts(OBJECT_STORAGE_PORT)
    // 🔴 `GET /`（ListBuckets）が 200 を返せば S3 API が応答している。s3mock の
    //    `/actuator/health` は `Accept: application/json` を要求し、付けないと 406 を返す（実測）。
    .withWaitStrategy(Wait.forHttp('/', OBJECT_STORAGE_PORT).forStatusCode(200))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = objectStorage.getHost();
  const port = objectStorage.getMappedPort(OBJECT_STORAGE_PORT);
  const endpoint = `http://${host}:${port}`;

  await enableBucketVersioning(endpoint, E2E_S3_BUCKET);

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket: E2E_S3_BUCKET,
    region: 'us-east-1',
    stop: async () => {
      await objectStorage.stop();
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
