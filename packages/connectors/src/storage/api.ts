// packages/connectors/src/storage/api.ts
// 🔴 S3（S3 互換ストレージ）への**呼び出しの形**（docs/03 §3.6 / docs/05 §14）。T-05-04。
//
// ============================================================================
// 🔴 なぜ SDK を直接 import せず「ポート」を置くのか（`email/ses/api.ts` と同じ理由）
// ============================================================================
// ① **実 S3 / 実 MinIO を叩かないユニットテスト**を成立させるため。`S3ObjectStore` はこのポート
//    だけに依存し、テストはモックの実装を注入する（資格情報もネットワークも要らない）。
// ② `@aws-sdk/client-s3` の `PutObjectCommandInput` / `HeadObjectCommandOutput` と
//    **構造的に一致**させてある。アダプタは詰め替えを持たない。
// 🔴 したがってフィールド名は AWS の綴り（PascalCase）のままにする。
//
// 🔴 **本ポートの実装は AWS SDK のアダプタ 1 ファイルだけである**（`aws-sdk-s3.ts`。
//    `email/ses/aws-sdk-api.ts` と同じ規律で、`tests/static/aws-sdk-single-path.test.ts` が
//    import 元を固定する）。公開経路は `@ses/connectors/aws` サブパス 1 本であり、
//    主バレル（`@ses/connectors`）からは到達できない —— 主バレルは `apps/web` も import するため、
//    載せると Next.js のサーババンドルに AWS SDK 一式が同梱されてしまう。
// 🔴 `objectStore: 'real'` かつ `runtime.s3` 未指定なら、`createObjectStore` は例外で
//    **起動を止める**（モックを代替として選ばせない。§11.1）。

/** `PutObject` の署名（`presignPut`）に要る値。 */
export type S3PresignPutRequest = {
  readonly Bucket: string;
  readonly Key: string;
  readonly ContentType: string;
  /**
   * 🔴 署名に焼き込むサイズ（docs/05 §14.2「`Content-Length` を制限する条件付き署名」）。
   *
   * 🔴 **上限ではなく「このサイズちょうど」として署名する。** SigV4 のクエリ署名では
   *    「N バイト以下」を表現できず、範囲を表せるのは POST policy だけである。上限として
   *    扱えるかのような名前にすると、アダプタの実装が「実は何バイトでも通る」状態になりうる。
   *    呼び出し側（#18）は申告サイズを渡し、確定（#19）で `head()` の実サイズと突き合わせる。
   */
  readonly ContentLength: number;
  /** SSE-KMS の鍵（`S3_KMS_KEY_ID`）。未設定の環境（MinIO）では `undefined`。 */
  readonly SSEKMSKeyId?: string;
  readonly ExpiresInSeconds: number;
};

export type S3PresignGetRequest = {
  readonly Bucket: string;
  readonly Key: string;
  readonly ExpiresInSeconds: number;
};

export type S3ObjectRequest = {
  readonly Bucket: string;
  readonly Key: string;
};

/** `HeadObject` の応答のうち本プロダクトが読む部分。 */
export type S3HeadObjectResponse = {
  readonly ContentLength: number;
  /** バージョニング有効なバケットの版 ID（`FileScanResult.objectVersionId` の出所）。 */
  readonly VersionId: string;
  /**
   * 🔴 T-05-06: 実際に保管されている content-type（`SkillSheet.contentType` の出所）。
   *    署名（`presignPut`）に `Content-Type` を焼き込んでいるため、これは #18 で検証済みの
   *    申告値と必ず一致する。**確定（#19）では申告を受け取らず、この値だけを保存する。**
   */
  readonly ContentType: string;
};

/**
 * 🔴 `S3ObjectStore` が依存する唯一の外部境界。
 *
 * 実装は 2 つだけである:
 *   - AWS SDK のアダプタ（`development` の MinIO / `sandbox` 以上の S3）
 *   - テストが注入するモック（`packages/connectors/src/storage/s3.test.ts`）
 * 🔴 `packages/connectors/src/mock/object-store.ts`（`demo` のモック）はここではなく
 *    `ObjectStore` そのものを実装する。層を取り違えないこと ——
 *    こちらは「S3 の API を模す」もの、あちらは「オブジェクト保管という機能を模す」ものである。
 */
export interface S3Api {
  /** 🔴 署名の生成はローカル計算であり、ネットワークに出ない（発行しただけでは何も起きない）。 */
  presignPut(request: S3PresignPutRequest): Promise<string>;
  presignGet(request: S3PresignGetRequest): Promise<string>;
  deleteObject(request: S3ObjectRequest): Promise<void>;
  /** 存在しなければ `null`（404 を例外にしない。確定前の照会で使うため）。 */
  headObject(request: S3ObjectRequest): Promise<S3HeadObjectResponse | null>;
}
