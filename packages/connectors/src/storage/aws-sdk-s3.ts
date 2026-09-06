// packages/connectors/src/storage/aws-sdk-s3.ts
// 🔴 **`@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` を import してよい唯一のファイル**
//    （`email/ses/aws-sdk-api.ts` と同じ規律。`tests/static/aws-sdk-single-path.test.ts` が固定する）。
//
// ここが担うのは「ポート（`S3Api`）と SDK の橋渡し」だけであり、業務判断を 1 つも持たない:
//   - バケット名・KMS 鍵・有効期限の保持と、テナントプレフィックスの検査 … `s3.ts`
//   - 上限判定・キーの組み立て・計上 … `apps/web` / `packages/db` / `@ses/domain`
// 🔴 したがって `try/catch` は 1 か所だけである（`HeadObject` の 404 → `null`）。
//    これは「存在しない」をポートの契約（`| null`）に写す変換であって、例外の握り潰しではない。
//
// ============================================================================
// 🔴 リトライについて（`maxAttempts: 1`）
// ============================================================================
// 本アダプタの 4 操作は性質が 2 つに分かれる:
//   - **`presignPut` / `presignGet`** … 🔴 **ローカルの署名計算であり、ネットワークに出ない**
//     （`getSignedUrl` は資格情報で HMAC を作るだけ）。したがって「リトライ」という概念が無い。
//     失敗するとしたら資格情報の解決の失敗であり、再試行しても結果は同じである。
//   - **`deleteObject` / `headObject`** … ネットワークに出る。ここでも SDK 内部の再試行は止め、
//     **再試行の可否はジョブの `attempts`（`packages/connectors/src/queues.ts`）だけが決める**
//     （`CLAUDE.md` §3.4 / `BR-22` と同じ規律。SDK の既定 3 回を残すと、ジョブ側の
//     `attempts: 1` が内側から無効化される）。
//
// 🔴 本ファイルはパッケージの主バレル（`src/index.ts`）から re-export しない。
//    入口は `@ses/connectors/aws` サブパス（`src/aws.ts`）だけである ——
//    主バレルに載せると Next.js のサーババンドルに AWS SDK 一式が入る。

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  S3Api,
  S3HeadObjectResponse,
  S3ObjectRequest,
  S3PresignGetRequest,
  S3PresignPutRequest,
} from './api.js';

/**
 * 🔴 **署名に必ず含めるヘッダ**（クエリへ hoist させない）。
 *
 * SigV4 のクエリ署名では、既定で `x-amz-*` ヘッダが**クエリ文字列へ hoist される**。hoist されると
 * クライアントはそのヘッダを送らなくてよくなり、「`S3ObjectStore` が `requiredHeaders` として返した
 * ヘッダを送ると逆に署名が合わない」というちぐはぐな契約になる。`unhoistableHeaders` に入れて
 * **ヘッダのまま署名する**ことで、`requiredHeaders` に載るものはすべて
 * 「クライアントが送らなければならないもの」に一致する。
 */
const UNHOISTABLE_HEADERS = new Set([
  'x-amz-server-side-encryption',
  'x-amz-server-side-encryption-aws-kms-key-id',
]);

/**
 * 🔴 **署名対象に強制するヘッダ**（docs/05 §14.2 ④「`Content-Length` を制限する条件付き署名」）。
 *
 * `content-length` / `content-type` を `signableHeaders` に入れると `SignedHeaders` に載り、
 * **クライアントが同じ値を送らなければ S3 が 403 を返す**。これが「小さいと申告して大きいものを
 * 置く」ことでストレージ上限の判定（`decideStorageUpload`）を迂回できない根拠である。
 */
const PUT_SIGNABLE_HEADERS = new Set(['content-length', 'content-type']);

export type S3ApiOptions = {
  /** `S3_REGION`（`packages/config`）。🔴 ここで `process.env` を読まない。 */
  readonly region: string;
  /**
   * `S3_ENDPOINT`。🔴 **`development` の MinIO 専用**（docs/03 §6.5）。`staging` / `production` は
   * 未設定であり、SDK の既定リージョンエンドポイントを使う。
   */
  readonly endpoint?: string;
  /** `S3_FORCE_PATH_STYLE`（MinIO 用。🔴 `production` で `true` なら `packages/config` が起動を止める）。 */
  readonly forcePathStyle?: boolean;
  /**
   * 🔴 `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`（**`development` の MinIO 資格情報**）。
   *
   * 🔴 SES のアダプタ（`createSesApi`）が資格情報を引数に取らないのに対し、こちらは取る。
   *    MinIO には IAM ロールが無く、静的キー以外に認証手段が存在しないためである。
   *    **「`staging` / `production` でこの値が設定されていたら起動を失敗させる」判定は
   *    `packages/config` の 1 箇所が持つ**（docs/03 §6.5 / NFR-ENV-4）。ここで環境を見て
   *    分岐しない —— 判定を 2 箇所に置くと、片方だけが緩む。
   * 🔴 未指定なら AWS SDK の既定の資格情報チェーン（IAM ロール）に委ねる。
   */
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  /**
   * 差し替え用（テストのスタブ）。省略時は `S3Client` を作る。
   * 🔴 型は実クラスのままにする —— `getSignedUrl` はクライアントの設定（資格情報・署名者）を
   *    読むため、構造的部分型では受けられない（テストは実インスタンスの `send` を差し替える）。
   */
  readonly client?: S3Client;
};

/**
 * 🔴 SDK の応答は**全フィールドが optional** である。欠けていたときに既定値で埋めない ——
 *    `ContentLength` を 0 に埋めると**置いたはずのバイト数が計上されず**、
 *    `VersionId` を空文字に埋めると `FileScanResult` がスキャン結果を版に結び付けられなくなる。
 */
function toHeadResponse(output: HeadObjectCommandOutput): S3HeadObjectResponse {
  if (typeof output.ContentLength !== 'number') {
    throw new Error(
      'S3 の HeadObject が ContentLength を返しませんでした（ストレージ使用量を計上できません）。',
    );
  }
  if (typeof output.VersionId !== 'string' || output.VersionId === '') {
    // 🔴 docs/05 §14.1 は「バージョニング有効」を前提にしている（`FileScanResult.objectVersionId`）。
    //    ここで空文字に丸めると、スキャン結果の重複排除キーが全オブジェクトで衝突する。
    throw new Error(
      'S3 の HeadObject が VersionId を返しませんでした（バケットのバージョニングが有効か確認してください。docs/05 §14.1）。',
    );
  }
  return { ContentLength: output.ContentLength, VersionId: output.VersionId };
}

/** `HeadObject` の 404（存在しない）。🔴 これだけをポートの `null` に写す。 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { name?: unknown }).name === 'NotFound') return true;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return metadata?.httpStatusCode === 404;
}

/**
 * 🔴 `S3Api` の実装（`createConnectors` / `createObjectStore` の `runtime.s3.api` に渡す）。
 *
 * 起動時に 1 回だけ作る（`apps/web` は `lib/db/bootstrap.ts`、`apps/worker` は `src/main.ts`）。
 */
export function createS3Api(options: S3ApiOptions): S3Api {
  const client =
    options.client ??
    new S3Client({
      region: options.region,
      // 🔴 SDK 内部の再試行を止める（既定 3 回）。再試行の可否はジョブの `attempts` が決める。
      maxAttempts: 1,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    });

  return {
    /**
     * 🔴 ネットワークに出ない（ローカルの署名計算）。**発行した時点で有効**であり取り消せないため、
     *    発行してよいかの判断は呼び出し側（`S3ObjectStore` のキー検査、サービス層の上限判定）で
     *    すべて終わっている。
     */
    async presignPut(request: S3PresignPutRequest): Promise<string> {
      const command = new PutObjectCommand({
        Bucket: request.Bucket,
        Key: request.Key,
        ContentType: request.ContentType,
        ContentLength: request.ContentLength,
        ...(request.SSEKMSKeyId === undefined
          ? {}
          : { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: request.SSEKMSKeyId }),
      });
      return getSignedUrl(client, command, {
        expiresIn: request.ExpiresInSeconds,
        signableHeaders: new Set(PUT_SIGNABLE_HEADERS),
        unhoistableHeaders: new Set(UNHOISTABLE_HEADERS),
      });
    },

    async presignGet(request: S3PresignGetRequest): Promise<string> {
      const command = new GetObjectCommand({ Bucket: request.Bucket, Key: request.Key });
      return getSignedUrl(client, command, { expiresIn: request.ExpiresInSeconds });
    },

    async deleteObject(request: S3ObjectRequest): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: request.Bucket, Key: request.Key }));
    },

    async headObject(request: S3ObjectRequest): Promise<S3HeadObjectResponse | null> {
      try {
        return toHeadResponse(
          await client.send(new HeadObjectCommand({ Bucket: request.Bucket, Key: request.Key })),
        );
      } catch (error) {
        // 🔴 404 だけを `null` に写す（ポートの契約）。それ以外は握り潰さずそのまま投げる。
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}
