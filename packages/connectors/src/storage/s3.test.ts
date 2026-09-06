// packages/connectors/src/storage/s3.test.ts
// `S3ObjectStore`（docs/05 §14.1 / §14.2）。T-05-04。
// 🔴 実 S3 / 実 MinIO を叩かない（`S3Api` ポートのスタブを注入する）。
import { describe, expect, it, vi } from 'vitest';
import { buildSkillSheetDownloadFileName } from '@ses/domain';
import { UnsafeDownloadFileNameError } from '../interfaces.js';
import type { S3Api, S3PresignPutRequest } from './api.js';
import { ObjectKeyOutOfTenantScopeError, S3ObjectStore } from './s3.js';

const TENANT = '01930000-0000-7000-8000-000000000001';
const KEY = `t/${TENANT}/skill-sheets/01930000-0000-7000-8000-0000000000e1/1/01930000-0000-7000-8000-0000000000a1.xlsx`;
const NOW = new Date('2026-09-06T00:00:00.000Z');

function stubApi(overrides: Partial<S3Api> = {}): S3Api {
  return {
    presignPut: vi.fn(async (request: S3PresignPutRequest) => `https://s3.test/${request.Key}?put`),
    presignGet: vi.fn(async ({ Key }) => `https://s3.test/${Key}?get`),
    deleteObject: vi.fn(async () => undefined),
    headObject: vi.fn(async () => ({
      ContentLength: 1234,
      VersionId: 'v1',
      ContentType: 'application/pdf',
    })),
    ...overrides,
  };
}

function store(api: S3Api, kmsKeyId?: string): S3ObjectStore {
  return new S3ObjectStore({
    api,
    bucket: 'ses-platform-test',
    ...(kmsKeyId === undefined ? {} : { kmsKeyId }),
    presignedUrlTtlSeconds: 300,
    now: () => NOW,
  });
}

describe('S3ObjectStore.presignPut（docs/05 §14.2）', () => {
  it('🔴 1 バケット + キーで呼ぶ（テナントごとにバケットを分けない）', async () => {
    const api = stubApi();
    await store(api).presignPut(KEY, 'application/pdf', 1024);
    expect(api.presignPut).toHaveBeenCalledWith({
      Bucket: 'ses-platform-test',
      Key: KEY,
      ContentType: 'application/pdf',
      ContentLength: 1024,
      ExpiresInSeconds: 300,
    });
  });

  it('🔴 Content-Length を署名に焼き込み、クライアントが付けるヘッダとして返す', async () => {
    const put = await store(stubApi()).presignPut(KEY, 'application/pdf', 1024);
    expect(put.headers['content-length']).toBe('1024');
    expect(put.headers['content-type']).toBe('application/pdf');
  });

  it('有効期限は S3_PRESIGNED_URL_TTL_SECONDS（既定 300 秒）', async () => {
    const put = await store(stubApi()).presignPut(KEY, 'application/pdf', 1024);
    expect(put.expiresAt.toISOString()).toBe('2026-09-06T00:05:00.000Z');
  });

  it('SSE-KMS の鍵が設定されていれば署名にもヘッダにも載る', async () => {
    const api = stubApi();
    const put = await store(api, 'arn:aws:kms:key/abc').presignPut(KEY, 'application/pdf', 1024);
    expect(api.presignPut).toHaveBeenCalledWith(
      expect.objectContaining({ SSEKMSKeyId: 'arn:aws:kms:key/abc' }),
    );
    expect(put.headers['x-amz-server-side-encryption']).toBe('aws:kms');
  });

  it('🔴 鍵が未設定（MinIO）なら SSE のヘッダを付けない（付けると MinIO が 400 を返す）', async () => {
    const api = stubApi();
    const put = await store(api).presignPut(KEY, 'application/pdf', 1024);
    expect(api.presignPut).toHaveBeenCalledWith(
      expect.not.objectContaining({ SSEKMSKeyId: expect.anything() }),
    );
    expect(put.headers['x-amz-server-side-encryption']).toBeUndefined();
  });
});

describe('🔴 テナントプレフィックスの外には署名しない（docs/05 §14.1）', () => {
  it.each([
    ['バケット直下', 'evil.xlsx'],
    ['別プレフィックス', 'exports/dump.zip'],
    ['相対参照', `t/${TENANT}/../other/a.xlsx`],
  ])('%s は presignPut で例外（発行してから拒否しない）', async (_label, key) => {
    const api = stubApi();
    await expect(store(api).presignPut(key, 'application/pdf', 1)).rejects.toBeInstanceOf(
      ObjectKeyOutOfTenantScopeError,
    );
    expect(api.presignPut).not.toHaveBeenCalled();
  });

  it('presignGet / delete / head も同じ門番を通る', async () => {
    const api = stubApi();
    const target = store(api);
    await expect(target.presignGet('evil.xlsx', 60)).rejects.toBeInstanceOf(
      ObjectKeyOutOfTenantScopeError,
    );
    await expect(target.delete('evil.xlsx')).rejects.toBeInstanceOf(ObjectKeyOutOfTenantScopeError);
    await expect(target.head('evil.xlsx')).rejects.toBeInstanceOf(ObjectKeyOutOfTenantScopeError);
    expect(target.callCount()).toBe(0);
  });
});

/**
 * 🔴 T-05-07: ダウンロード名（`Content-Disposition`）。docs/05 §14.1 の決着 ——
 *    **原本のファイル名を保存せず、版番号から作った ASCII の名前だけを署名に載せる**。
 */
describe('S3ObjectStore.presignGet のダウンロード名（docs/05 §14.1 / §14.2）', () => {
  it('指定しなければ `ResponseContentDisposition` を送らない（S3 のキー名で落ちる）', async () => {
    const api = stubApi();
    await store(api).presignGet(KEY, 300);
    expect(api.presignGet).toHaveBeenCalledWith({
      Bucket: 'ses-platform-test',
      Key: KEY,
      ExpiresInSeconds: 300,
    });
  });

  it('版番号ベースの名前を `attachment` として署名に載せる', async () => {
    const api = stubApi();
    await store(api).presignGet(KEY, 300, { downloadFileName: 'skill-sheet-v3.xlsx' });
    expect(api.presignGet).toHaveBeenCalledWith({
      Bucket: 'ses-platform-test',
      Key: KEY,
      ExpiresInSeconds: 300,
      // 🔴 常に `attachment`（`inline` にするとブラウザが開いてしまい、
      //    「ダウンロードを記録する」前提と実際の閲覧経路がずれる）。
      ResponseContentDisposition: 'attachment; filename="skill-sheet-v3.xlsx"',
    });
  });

  it.each([
    // 🔴 原本のファイル名（氏名を含みうる / 日本語）は**渡せない**。
    ['山田 太郎 スキルシート.xlsx', '氏名を含む日本語のファイル名'],
    ['a".xlsx', '引用符でヘッダを閉じる'],
    ['a\r\nX-Injected: 1', 'CRLF でヘッダを増やす'],
    ['', '空文字'],
    [`${'a'.repeat(101)}.pdf`, '長すぎる'],
  ])('🔴 %s（%s）は署名する前に例外で止まる', async (fileName) => {
    const api = stubApi();
    const target = store(api);
    await expect(
      target.presignGet(KEY, 300, { downloadFileName: fileName }),
    ).rejects.toBeInstanceOf(UnsafeDownloadFileNameError);
    // 🔴 署名付き URL は発行した時点で有効なので、**発行してから拒否する**形にしない。
    expect(api.presignGet).not.toHaveBeenCalled();
    expect(target.callCount()).toBe(0);
  });

  it('🔴 `@ses/domain` が作る名前はそのまま通る（2 つの規約がずれていない）', async () => {
    const fileName = buildSkillSheetDownloadFileName(KEY);
    expect(fileName).toBe('skill-sheet-v1.xlsx');
    const api = stubApi();
    await store(api).presignGet(KEY, 300, { downloadFileName: fileName ?? undefined });
    expect(api.presignGet).toHaveBeenCalledWith(
      expect.objectContaining({
        ResponseContentDisposition: 'attachment; filename="skill-sheet-v1.xlsx"',
      }),
    );
  });
});

describe('S3ObjectStore の残りの操作', () => {
  it('head() は S3 の応答を内部型へ正規化する（サービス固有の綴りを外に出さない）', async () => {
    expect(await store(stubApi()).head(KEY)).toEqual({
      byteSize: 1234,
      versionId: 'v1',
      // 🔴 T-05-06: 確定（#19）は申告ではなくこの値を `SkillSheet.contentType` に保存する。
      contentType: 'application/pdf',
    });
  });

  it('head() は存在しないキーで null（404 を例外にしない）', async () => {
    const api = stubApi({ headObject: vi.fn(async () => null) });
    expect(await store(api).head(KEY)).toBeNull();
  });

  it('callCount() が呼び出しを数える（モックと同じシグネチャ。docs/05 §13.2）', async () => {
    const target = store(stubApi());
    await target.presignPut(KEY, 'application/pdf', 1);
    await target.presignGet(KEY, 60);
    await target.head(KEY);
    await target.delete(KEY);
    expect(target.callCount()).toBe(4);
  });
});
