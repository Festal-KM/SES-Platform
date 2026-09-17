// packages/connectors/src/mock/storage.test.ts
// MockObjectStore / MockMalwareScanner（docs/05 §13.2 / §14）。
import { describe, expect, it } from 'vitest';

import { UnsafeDownloadFileNameError } from '../interfaces.js';
import { ObjectKeyOutOfTenantScopeError } from '../storage/s3.js';
import { MockObjectStore } from './object-store.js';
import { MockMalwareScanner } from './scanner.js';

const now = () => new Date('2026-09-05T00:00:00.000Z');

/** 🔴 モックも実装（`S3ObjectStore`）と同じくテナントプレフィックス（`t/{tenantId}/…`）のキーしか受け付けない。 */
const TENANT = '01930000-0000-7000-8000-000000000001';
const OTHER = '01930000-0000-7000-8000-000000000002';
const K1 = `t/${TENANT}/skill-sheets/e/1/k1.xlsx`;
const K_PRESIGNED = `t/${TENANT}/skill-sheets/e/1/k-presigned.txt`;
const EXPORT_KEY = `t/${TENANT}/exports/r1/a.zip`;

describe('MockObjectStore', () => {
  it('署名 URL は外部に到達しないスキームを使う（誤って渡っても届かない）', async () => {
    const store = new MockObjectStore({ now });
    const put = await store.presignPut(`t/${TENANT}/skill-sheets/a.xlsx`, 'application/vnd.ms-excel', 10_000_000);
    expect(put.url.startsWith('mock-object-store:')).toBe(true);
    expect(put.expiresAt.getTime()).toBeGreaterThan(now().getTime());
    expect(put.headers['content-type']).toBe('application/vnd.ms-excel');
    // 🔴 T-05-04: 実装（`S3ObjectStore`）と同じキーで返す（demo と production で差を作らない）。
    expect(put.headers['content-length']).toBe('10000000');
  });

  it('🔴 presignPut したサイズで置かれたことにする（demo でストレージ計測が 0 のままにならない）', async () => {
    const store = new MockObjectStore({ now });
    await store.presignPut(K1, 'application/pdf', 4096);
    expect(await store.head(K1)).toMatchObject({ byteSize: 4096 });
  });

  it('🔴 T-10-02: measureTenantUsage は t/{tenantId}/ 配下だけを合計し、delete 後は減る（実装と同じ規約）', async () => {
    const store = new MockObjectStore({ now });
    await store.presignPut(`t/${TENANT}/skill-sheets/e/1/a.xlsx`, 'application/pdf', 100);
    await store.presignPut(`t/${TENANT}/skill-sheets/e/2/b.xlsx`, 'application/pdf', 20);
    await store.presignPut(`t/${OTHER}/skill-sheets/e/1/c.xlsx`, 'application/pdf', 999);

    expect(await store.measureTenantUsage(TENANT)).toEqual({ byteSize: 120n, objectCount: 2 });
    await store.delete(`t/${TENANT}/skill-sheets/e/2/b.xlsx`);
    expect(await store.measureTenantUsage(TENANT)).toEqual({ byteSize: 100n, objectCount: 1 });
    await expect(store.measureTenantUsage('not-a-uuid')).rejects.toThrow();
  });

  it('presignPut 後は head() が版 ID を返し、delete 後は null に戻る', async () => {
    const store = new MockObjectStore({ now });
    expect(await store.head(K1)).toBeNull();

    await store.presignPut(K1, 'text/plain', 100);
    const head = await store.head(K1);
    expect(head?.versionId).toBeTruthy();
    // 🔴 T-05-06: 署名時の content-type がそのまま返る（実装と同じ。demo だけ形式表示が
    //    変わらないようにする）。
    expect(head?.contentType).toBe('text/plain');

    await store.delete(K1);
    expect(await store.head(K1)).toBeNull();
  });

  it('🔴 T-10-09: put は本当に置く（head がサイズと content-type を返し、readBody が内容を返し、delete は deletedKeys に残る）', async () => {
    const store = new MockObjectStore({ now });
    const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    await store.put(EXPORT_KEY, body, 'application/zip');
    expect(await store.head(EXPORT_KEY)).toMatchObject({ byteSize: 4, contentType: 'application/zip' });
    expect(store.readBody(EXPORT_KEY)).toEqual(body);
    // `presignPut` で「置かれたことにした」キーには内容が無い。
    await store.presignPut(K_PRESIGNED, 'text/plain', 10);
    expect(store.readBody(K_PRESIGNED)).toBeNull();

    await store.delete(EXPORT_KEY);
    await store.delete(K_PRESIGNED);
    expect(store.deletedKeys()).toEqual([EXPORT_KEY, K_PRESIGNED]);
    expect(store.keys()).toEqual([]);
  });

  /**
   * 🔴 T-10-09 レビュー: キーの検査を実装（`S3ObjectStore`）と揃える。ここが素通しだと、`proposal_events.attachment_key`
   *    のような **S3 キーでない値（UUID）** を `delete` に渡す実装が結合テストでは通り、実 S3 では
   *    `ObjectKeyOutOfTenantScopeError` で削除が永久に失敗する（`PURGED` に到達しない）。
   */
  it('🔴 t/{tenantId}/… でないキーは 5 操作すべてで ObjectKeyOutOfTenantScopeError（実装と同じ検査。呼び出しは数えない）', async () => {
    const store = new MockObjectStore({ now });
    const uuid = '01930000-0000-7000-8000-00000000d101';
    for (const key of [uuid, 'k1', 'tenants/t1/sheets/a.xlsx', 't/x/exports/r1/a.zip', `t/${TENANT}/../evil.xlsx`, `t/${TENANT}`]) {
      await expect(store.presignPut(key, 'text/plain', 1), key).rejects.toBeInstanceOf(ObjectKeyOutOfTenantScopeError);
      await expect(store.presignGet(key, 60), key).rejects.toBeInstanceOf(ObjectKeyOutOfTenantScopeError);
      await expect(store.put(key, new Uint8Array([1]), 'text/plain'), key).rejects.toBeInstanceOf(ObjectKeyOutOfTenantScopeError);
      await expect(store.delete(key), key).rejects.toBeInstanceOf(ObjectKeyOutOfTenantScopeError);
      await expect(store.head(key), key).rejects.toBeInstanceOf(ObjectKeyOutOfTenantScopeError);
    }
    expect(store.callCount()).toBe(0);
    expect(store.deletedKeys()).toEqual([]);
    expect(store.keys()).toEqual([]);
  });

  it('callCount() が呼び出しを数える', async () => {
    const store = new MockObjectStore({ now });
    await store.presignPut(K1, 'text/plain', 100);
    await store.presignGet(K1, 60);
    expect(store.callCount()).toBe(2);
  });

  /**
   * 🔴 T-05-07: ダウンロード名の扱いを**実装（`S3ObjectStore`）と揃える**。
   *    ここが素通しだと、`demo` / E2E では通るのに `production` で
   *    `UnsafeDownloadFileNameError` になる差が生まれる（docs/05 §13.2）。
   */
  describe('presignGet のダウンロード名（実装と同じ検査を通す）', () => {
    it('指定した名前が URL に運ばれる（`attachment` として組み立てられている）', async () => {
      const store = new MockObjectStore({ now });
      const presigned = await store.presignGet(K1, 60, {
        downloadFileName: 'skill-sheet-v2.pdf',
      });
      expect(
        new URL(presigned.url.replace('mock-object-store://', 'https://mock/')).searchParams.get(
          'response-content-disposition',
        ),
      ).toBe('attachment; filename="skill-sheet-v2.pdf"');
    });

    it('指定しなければクエリを付けない', async () => {
      const store = new MockObjectStore({ now });
      expect((await store.presignGet(K1, 60)).url).not.toContain('response-content-disposition');
    });

    it('🔴 原本のファイル名（氏名を含む日本語）はモックでも拒否される', async () => {
      const store = new MockObjectStore({ now });
      await expect(
        store.presignGet(K1, 60, { downloadFileName: '山田 太郎 スキルシート.xlsx' }),
      ).rejects.toBeInstanceOf(UnsafeDownloadFileNameError);
      expect(store.callCount()).toBe(0);
    });
  });
});

describe('MockMalwareScanner', () => {
  it('既定は CLEAN（demo で後続の導線が動く）', async () => {
    const scanner = new MockMalwareScanner();
    await scanner.enqueue('k1');
    // 🔴 T-05-05: `getResult` は「状態 + 生値 + 版」を返す（`MalwareScanner` の契約）。
    //    版を `FileScanResult` の重複排除キーに使うため、状態だけでは記録できない。
    expect(await scanner.getResult('k1', 'v1')).toEqual({
      status: 'CLEAN',
      rawStatus: 'mock:CLEAN',
      objectVersionId: 'v1',
    });
  });

  it('既定の判定を差し替えられる（INFECTED の導線を同じモックで確かめる）', async () => {
    const scanner = new MockMalwareScanner({ defaultResult: 'INFECTED' });
    await scanner.enqueue('k1');
    expect((await scanner.getResult('k1', 'v1'))?.status).toBe('INFECTED');
  });

  it('キー × 版ごとに判定を上書きできる', async () => {
    const scanner = new MockMalwareScanner();
    await scanner.enqueue('k1');
    scanner.setResult('k1', 'v2', 'UNSCANNABLE');
    expect((await scanner.getResult('k1', 'v1'))?.status).toBe('CLEAN');
    expect((await scanner.getResult('k1', 'v2'))?.status).toBe('UNSCANNABLE');
  });

  it('版を指定しなければ（null）キー単位の判定を返す', async () => {
    const scanner = new MockMalwareScanner();
    await scanner.enqueue('k1');
    expect(await scanner.getResult('k1', null)).toEqual({
      status: 'CLEAN',
      rawStatus: 'mock:CLEAN',
      objectVersionId: 'mock-version-1',
    });
  });

  it('未登録のキーは null（「まだ結果が無い」と「CLEAN」を混同しない）', async () => {
    const scanner = new MockMalwareScanner();
    expect(await scanner.getResult('unknown', 'v1')).toBeNull();
  });

  it('🔴 SCANNING は確定結果として返さない（未確定は null で表す）', async () => {
    const scanner = new MockMalwareScanner();
    scanner.setResult('k1', null, 'SCANNING');
    expect(await scanner.getResult('k1', null)).toBeNull();
  });
});
