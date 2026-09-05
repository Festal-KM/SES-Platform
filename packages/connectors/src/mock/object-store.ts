// packages/connectors/src/mock/object-store.ts
// docs/05 §13.2。`demo` で使う（`development` は MinIO の実接続 = `real`。docs/05 §13.1）。

import { randomUUID } from 'node:crypto';

import type { ObjectStore } from '../interfaces.js';
import type { PresignedUrl } from '../types.js';

/** 署名付き URL のスキーム。🔴 実在しないスキームにして、誤って外部へ渡っても到達しないようにする。 */
const MOCK_URL_SCHEME = 'mock-object-store:';

type MockObject = { byteSize: number; versionId: string; contentType: string };

export type MockObjectStoreOptions = {
  readonly now?: () => Date;
};

export class MockObjectStore implements ObjectStore {
  private readonly objects = new Map<string, MockObject>();
  private calls = 0;

  constructor(private readonly options: MockObjectStoreOptions = {}) {}

  /**
   * 🔴 モックは「署名 URL を発行した = そのキーにオブジェクトが置かれた」とみなす。
   *    実装（S3）との差はここだけであり、`demo` で版管理・スキャン・共有の導線が
   *    最後まで動くようにするための割り切りである。**この差を他の場所で吸収しない**
   *    （`if (mock)` を業務コードに書かないため、モック側で完結させる）。
   */
  async presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUrl> {
    this.calls += 1;
    this.objects.set(key, { byteSize: 0, versionId: randomUUID(), contentType });
    return {
      url: `${MOCK_URL_SCHEME}//put/${encodeURIComponent(key)}`,
      expiresAt: new Date(this.now().getTime() + 15 * 60 * 1000),
      headers: { 'content-type': contentType, 'x-mock-max-bytes': String(maxBytes) },
    };
  }

  async presignGet(key: string, ttlSec: number): Promise<PresignedUrl> {
    this.calls += 1;
    return {
      url: `${MOCK_URL_SCHEME}//get/${encodeURIComponent(key)}`,
      expiresAt: new Date(this.now().getTime() + ttlSec * 1000),
      headers: {},
    };
  }

  async delete(key: string): Promise<void> {
    this.calls += 1;
    this.objects.delete(key);
  }

  async head(key: string): Promise<{ byteSize: number; versionId: string } | null> {
    this.calls += 1;
    const found = this.objects.get(key);
    return found === undefined ? null : { byteSize: found.byteSize, versionId: found.versionId };
  }

  callCount(): number {
    return this.calls;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
