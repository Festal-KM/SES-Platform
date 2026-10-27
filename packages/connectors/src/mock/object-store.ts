// packages/connectors/src/mock/object-store.ts
// docs/05 §13.2。`demo` で使う（`development` は MinIO の実接続 = `real`。docs/05 §13.1）。

import { randomUUID } from 'node:crypto';

import { buildTenantObjectPrefix, isTenantScopedObjectKey } from '@ses/domain';
import {
  contentDispositionOf,
  type ObjectHead,
  type ObjectStore,
  type PresignGetOptions,
  type PresignPutOptions,
  type StoredObjectSummary,
  type TenantStorageMeasurement,
} from '../interfaces.js';
import { ObjectKeyOutOfTenantScopeError } from '../storage/s3.js';
import type { PresignedUrl } from '../types.js';

/** 署名付き URL のスキーム。🔴 実在しないスキームにして、誤って外部へ渡っても到達しないようにする。 */
const MOCK_URL_SCHEME = 'mock-object-store:';

/** ✅ 2026-10-27: 作るだけの書き込みで、既にあるキーへ置こうとした（実装では S3 の 412 Precondition Failed）。 */
export class ObjectAlreadyExistsError extends Error {
  constructor() {
    super('オブジェクトは既にあります（作るだけの書き込みでは上書きできません）。');
    this.name = 'ObjectAlreadyExistsError';
  }
}

type MockObject = { byteSize: number; versionId: string; contentType: string; body?: Uint8Array; lastModified: Date };

export type MockObjectStoreOptions = {
  readonly now?: () => Date;
};

export class MockObjectStore implements ObjectStore {
  private readonly objects = new Map<string, MockObject>();
  private readonly deleted: string[] = [];
  private calls = 0;

  constructor(private readonly options: MockObjectStoreOptions = {}) {}

  /**
   * 🔴 T-10-09 レビュー: キーの検査は**実装（`S3ObjectStore.assertKey`）と同じ**にする。モックだけが緩いと、
   *    `t/{tenantId}/…` でないキー（UUID 等）を渡す呼び出しが `demo` / 結合テストでは通り、`production` で
   *    `ObjectKeyOutOfTenantScopeError` になって初めて露見する（docs/05 §13.2「モックを実装より緩くしない」）。
   */
  private assertKey(key: string): void {
    if (!isTenantScopedObjectKey(key)) throw new ObjectKeyOutOfTenantScopeError();
  }

  /**
   * 🔴 モックは「署名 URL を発行した = そのキーにオブジェクトが置かれた」とみなす。
   *    実装（S3）との差はここだけであり、`demo` で版管理・スキャン・共有の導線が
   *    最後まで動くようにするための割り切りである。**この差を他の場所で吸収しない**
   *    （`if (mock)` を業務コードに書かないため、モック側で完結させる）。
   *
   * 🔴 T-05-04: 置かれたことにするサイズは **`maxBytes`（＝ 署名に焼き込んだ `Content-Length`）**
   *    である。0 にしておくと `head()` が 0 を返し、`demo` でストレージ計測
   *    （`UsageCounter(STORAGE_BYTES)`）が常に 0 バイトになる —— 「動いているのに数字が増えない」
   *    という、実装のバグと見分けのつかない状態になる。
   */
  async presignPut(key: string, contentType: string, maxBytes: number, options?: PresignPutOptions): Promise<PresignedUrl> {
    this.assertKey(key);
    const createOnly = options?.createOnly === true;
    // ✅ 2026-10-27: 作るだけの書き込み（実装の `If-None-Match: *` と同じ結果）。既にあるキーへは置かない。
    if (createOnly && this.objects.has(key)) throw new ObjectAlreadyExistsError();
    this.calls += 1;
    this.objects.set(key, { byteSize: maxBytes, versionId: randomUUID(), contentType, lastModified: this.now() });
    return {
      url: `${MOCK_URL_SCHEME}//put/${encodeURIComponent(key)}`,
      expiresAt: new Date(this.now().getTime() + 15 * 60 * 1000),
      // 🔴 T-05-04: 返すヘッダの**キーは実装（`S3ObjectStore`）と同じ**にする。画面は
      //    `requiredHeaders` をそのまま PUT に付けるため、ここだけ別のキーにすると
      //    「`demo` では通るのに `production` では 403」という差が生まれる（docs/05 §13.2）。
      headers: { 'content-type': contentType, 'content-length': String(maxBytes), ...(createOnly ? { 'if-none-match': '*' } : {}) },
    };
  }

  /**
   * 🔴 T-05-07: ダウンロード名の検査（`contentDispositionOf`）は**実装と同じ関数**を通す。
   *    ここを素通しにすると、`demo` / E2E では通るのに `production` で
   *    `UnsafeDownloadFileNameError` になる差が生まれる（docs/05 §13.2）。
   * 🔴 組み立てた値は URL のクエリに載せる（実装が `response-content-disposition` として
   *    署名に載せるのと同じ位置）。テストはこれを見て「名前が最後まで運ばれたか」を確かめられる。
   */
  async presignGet(
    key: string,
    ttlSec: number,
    options?: PresignGetOptions,
  ): Promise<PresignedUrl> {
    this.assertKey(key);
    const disposition = contentDispositionOf(options?.downloadFileName);
    this.calls += 1;
    const query =
      disposition === undefined
        ? ''
        : `?response-content-disposition=${encodeURIComponent(disposition)}`;
    return {
      url: `${MOCK_URL_SCHEME}//get/${encodeURIComponent(key)}${query}`,
      expiresAt: new Date(this.now().getTime() + ttlSec * 1000),
      headers: {},
    };
  }

  /**
   * 🔴 T-10-09: サーバ側で生成した実体（返却 ZIP）。実装（S3）と同じく**バイト数をそのまま**保管する
   *    （`presignPut` の「置かれたことにする」と違い、ここは本当に置かれる）。テストは `head()` で
   *    サイズと content-type を、`readBody()` で内容を確かめる。
   */
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.assertKey(key);
    this.calls += 1;
    this.objects.set(key, { byteSize: body.byteLength, versionId: randomUUID(), contentType, body, lastModified: this.now() });
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    this.calls += 1;
    this.objects.delete(key);
    this.deleted.push(key);
  }

  /** 検証用: `put` で置いた内容（`presignPut` で「置かれたことにした」キーは `null`）。 */
  readBody(key: string): Uint8Array | null {
    return this.objects.get(key)?.body ?? null;
  }

  /** 検証用: `delete` されたキーの列（削除ジョブが S3 の実体を**オブジェクト数と同じ回数**消したことを数える）。 */
  deletedKeys(): readonly string[] {
    return [...this.deleted];
  }

  /** 検証用: 現在保管されているキー。 */
  keys(): readonly string[] {
    return [...this.objects.keys()];
  }

  async head(key: string): Promise<ObjectHead | null> {
    this.assertKey(key);
    this.calls += 1;
    const found = this.objects.get(key);
    return found === undefined
      ? null
      : {
          byteSize: found.byteSize,
          versionId: found.versionId,
          // 🔴 T-05-06: 実装（S3）と同じく **署名時の content-type がそのまま返る**
          //    （実装では署名に焼き込んだ値が保管される）。ここで `application/octet-stream` に
          //    固定すると、`demo` だけ版一覧の形式表示と抽出可否の判定が変わる。
          contentType: found.contentType,
        };
  }

  /**
   * 🔴 T-10-02: 実装（`S3ObjectStore`）と同じく `buildTenantObjectPrefix` の範囲を合計する。
   *    `presignPut` で「置かれたことにした」サイズ（`maxBytes`）がそのまま実測になる。
   */
  async measureTenantUsage(tenantId: string): Promise<TenantStorageMeasurement> {
    this.calls += 1;
    const prefix = buildTenantObjectPrefix(tenantId);
    let byteSize = 0n;
    let objectCount = 0;
    for (const [key, object] of this.objects) {
      if (!key.startsWith(prefix)) continue;
      byteSize += BigInt(object.byteSize);
      objectCount += 1;
    }
    return { byteSize, objectCount };
  }

  async listTenantObjects(tenantId: string, kindSegment: string): Promise<readonly StoredObjectSummary[]> {
    this.calls += 1;
    const prefix = `${buildTenantObjectPrefix(tenantId)}${kindSegment}/`;
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, object]) => ({ key, byteSize: object.byteSize, lastModified: object.lastModified }));
  }

  /**
   * 検証用: 作るだけの書き込みで 2 回目の PUT を模す（実装では S3 が 412 を返す）。`createOnly` でなければ上書きする。
   */
  simulatePut(key: string, body: Uint8Array, contentType: string, options?: PresignPutOptions): void {
    this.assertKey(key);
    if (options?.createOnly === true && this.objects.has(key)) throw new ObjectAlreadyExistsError();
    this.objects.set(key, { byteSize: body.byteLength, versionId: randomUUID(), contentType, body, lastModified: this.now() });
  }

  callCount(): number {
    return this.calls;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
