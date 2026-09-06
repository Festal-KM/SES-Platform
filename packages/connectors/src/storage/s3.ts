// packages/connectors/src/storage/s3.ts
// 🔴 `ObjectStore` の実装（docs/05 §8.1 / §14.1 / §14.2 / docs/03 §3.6）。T-05-04。
//
// 🔴 **1 バケット + テナント別プレフィックス**である（docs/03 申し送り 16。テナント別バケットは
//    GuardDuty の保護バケット上限 25 で詰まる）。バケット名を知っているのはこのクラスだけであり、
//    業務コードはキー（`t/{tenantId}/…`）しか扱わない。
//
// 🔴 本クラスは `S3Api`（`api.ts` のポート）だけに依存する。AWS SDK を import しない ——
//    実接続なしでユニットテストできる状態を保つためであり、SDK の型がジョブ層・ドメイン層へ
//    漏れないためでもある（`CLAUDE.md` §3.4）。

import { isTenantScopedObjectKey } from '@ses/domain';
import {
  contentDispositionOf,
  type ObjectHead,
  type ObjectStore,
  type PresignGetOptions,
} from '../interfaces.js';
import type { PresignedUrl } from '../types.js';
import type { S3Api } from './api.js';

/**
 * 🔴 テナントプレフィックスの外へ署名を出そうとした。
 *
 * 署名付き URL は**発行した時点で有効**であり、後から取り消せない。したがって「発行してから
 * 拒否する」経路を作らず、組み立ての誤りは発行前に例外で止める（`CLAUDE.md` §3.1）。
 */
export class ObjectKeyOutOfTenantScopeError extends Error {
  constructor() {
    super(
      'テナントプレフィックス（t/{tenantId}/…）の外側のオブジェクトキーには署名できません（docs/05 §14.1）。',
    );
    this.name = 'ObjectKeyOutOfTenantScopeError';
  }
}

export type S3ObjectStoreOptions = {
  readonly api: S3Api;
  /** `S3_BUCKET`。🔴 **全テナントで 1 つ**（プレフィックスで分ける）。 */
  readonly bucket: string;
  /**
   * `S3_KMS_KEY_ID`（SSE-KMS。docs/05 §14.1）。
   * 🔴 `development` の MinIO では KMS が無いため `undefined`。値の要否は `packages/config` の
   *    起動時検証が環境ごとに決めており（`sandbox` / `production` では必須）、ここでは分岐しない。
   */
  readonly kmsKeyId?: string;
  /** `S3_PRESIGNED_URL_TTL_SECONDS`（既定 300。docs/05 §14.2）。 */
  readonly presignedUrlTtlSeconds: number;
  /** 現在時刻の注入（既定は `new Date()`）。`expiresAt` の算出にだけ使う。 */
  readonly now?: () => Date;
};

export class S3ObjectStore implements ObjectStore {
  private calls = 0;

  constructor(private readonly options: S3ObjectStoreOptions) {}

  /**
   * アップロード用の署名（docs/05 §14.2）。
   *
   * 🔴 `maxBytes` は **`Content-Length` として署名に焼き込む**（`S3PresignPutRequest.ContentLength`
   *    のコメント参照）。呼び出し側が申告したサイズと違うアップロードは S3 が拒否するため、
   *    「小さいと申告して大きいものを置く」ことで上限判定（`decideStorageUpload`）を
   *    迂回できない。
   * 🔴 有効期限は短い（既定 5 分。docs/03 §3.6）。
   */
  async presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUrl> {
    this.assertKey(key);
    this.calls += 1;
    const expiresIn = this.options.presignedUrlTtlSeconds;
    const url = await this.options.api.presignPut({
      Bucket: this.options.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: maxBytes,
      ...(this.options.kmsKeyId === undefined ? {} : { SSEKMSKeyId: this.options.kmsKeyId }),
      ExpiresInSeconds: expiresIn,
    });
    return {
      url,
      expiresAt: this.expiresAt(expiresIn),
      // 🔴 署名に含めたヘッダは、クライアントが**そのまま**付けなければ 403 になる。
      //    ここで返す値が「クライアントが付けるべきヘッダ」の唯一の出所である。
      headers: {
        'content-type': contentType,
        'content-length': String(maxBytes),
        ...(this.options.kmsKeyId === undefined
          ? {}
          : {
              'x-amz-server-side-encryption': 'aws:kms',
              'x-amz-server-side-encryption-aws-kms-key-id': this.options.kmsKeyId,
            }),
      },
    };
  }

  /**
   * ダウンロード用の署名。
   * 🔴 発行の前提条件（`scanStatus='CLEAN'` / `VIEWER` でない / 監査記録が成功している）は
   *    **呼び出し側（`issueDownloadUrl`。T-05-07）** が持つ。コネクタは業務判断をしない。
   * 🔴 ダウンロード名（`Content-Disposition`）はここで**組み立てる**（呼び出し側にヘッダの
   *    文字列を作らせない）。値は ASCII の安全な形しか通さない（上の 🔴）。
   */
  async presignGet(
    key: string,
    ttlSec: number,
    options?: PresignGetOptions,
  ): Promise<PresignedUrl> {
    this.assertKey(key);
    const disposition = contentDispositionOf(options?.downloadFileName);
    this.calls += 1;
    const url = await this.options.api.presignGet({
      Bucket: this.options.bucket,
      Key: key,
      ExpiresInSeconds: ttlSec,
      ...(disposition === undefined ? {} : { ResponseContentDisposition: disposition }),
    });
    return { url, expiresAt: this.expiresAt(ttlSec), headers: {} };
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    this.calls += 1;
    await this.options.api.deleteObject({ Bucket: this.options.bucket, Key: key });
  }

  async head(key: string): Promise<ObjectHead | null> {
    this.assertKey(key);
    this.calls += 1;
    const found = await this.options.api.headObject({ Bucket: this.options.bucket, Key: key });
    return found === null
      ? null
      : {
          byteSize: found.ContentLength,
          versionId: found.VersionId,
          contentType: found.ContentType,
        };
  }

  callCount(): number {
    return this.calls;
  }

  /**
   * 🔴 すべての操作の入口で、キーがテナントプレフィックス配下であることを確かめる。
   *    判定そのものは `@ses/domain`（キーを組み立てる側と同じ規約）に置き、ここでは呼ぶだけ。
   */
  private assertKey(key: string): void {
    if (!isTenantScopedObjectKey(key)) throw new ObjectKeyOutOfTenantScopeError();
  }

  private expiresAt(ttlSec: number): Date {
    return new Date((this.options.now?.() ?? new Date()).getTime() + ttlSec * 1000);
  }
}
