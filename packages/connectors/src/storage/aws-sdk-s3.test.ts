// packages/connectors/src/storage/aws-sdk-s3.test.ts
// 🔴 **実 S3 / 実 MinIO に接続しない。**
//    - `presignPut` / `presignGet` は**ローカルの署名計算**なので、ダミーの静的資格情報で
//      実際に URL を生成し、その中身（署名対象・有効期限・キー）を検査する。
//    - `deleteObject` / `headObject` はネットワークに出るため、`S3Client.send` を差し替える。
//
// ここで固定するのは 4 点である:
//   ① 🔴 `Content-Length` / `Content-Type` が `SignedHeaders` に載る（docs/05 §14.2 ④。
//      クライアントが同じ値を送らなければ 403 = 上限判定を迂回できない）
//   ② 🔴 SSE-KMS のヘッダがクエリへ hoist されず、**ヘッダのまま署名される**
//      （`requiredHeaders` として返すものと一致させるため）
//   ③ 🔴 SDK の optional な応答を既定値で埋めない（`ContentLength` / `VersionId` 欠落は例外）
//   ④ `HeadObject` の 404 だけを `null` に写し、それ以外の例外は握り潰さない
//
// 🔴 「SDK を import してよいのはこの 2 アダプタだけ」「SDK 内部のリトライを止めている」は
//    リポジトリ全体を走査する `tests/static/aws-sdk-single-path.test.ts` が固定する。
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createObjectStore } from '../index.js';
import { S3ObjectStore } from './s3.js';
import { createS3Api, type S3ApiOptions } from './aws-sdk-s3.js';

const BUCKET = 'ses-platform-test';
const TENANT = '01930000-0000-7000-8000-000000000001';
const KEY = `t/${TENANT}/skill-sheets/01930000-0000-7000-8000-0000000000e1/1/01930000-0000-7000-8000-0000000000a1.xlsx`;

/**
 * 🔴 ダミーの静的資格情報（MinIO 相当）。署名は HMAC のローカル計算であり、
 *    この値でネットワークに出る操作は 1 つも無い。
 */
const CREDENTIALS = { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' };

function localClient(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    maxAttempts: 1,
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
    credentials: CREDENTIALS,
  });
}

function api(overrides: Partial<S3ApiOptions> = {}) {
  return createS3Api({ region: 'us-east-1', client: localClient(), ...overrides });
}

describe('🔴 ① ② presignPut（ローカル署名。docs/05 §14.2）', () => {
  it('署名付き URL がバケット・キー・有効期限を含む', async () => {
    const url = new URL(
      await api().presignPut({
        Bucket: BUCKET,
        Key: KEY,
        ContentType: 'application/pdf',
        ContentLength: 1024,
        ExpiresInSeconds: 300,
      }),
    );

    expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
  });

  it('🔴 content-length と content-type が SignedHeaders に載る（申告より大きいものを置けない）', async () => {
    const url = new URL(
      await api().presignPut({
        Bucket: BUCKET,
        Key: KEY,
        ContentType: 'application/pdf',
        ContentLength: 1024,
        ExpiresInSeconds: 300,
      }),
    );

    const signedHeaders = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    expect(signedHeaders).toContain('content-length');
    expect(signedHeaders).toContain('content-type');
    expect(signedHeaders).toContain('host');
  });

  it('🔴 サイズが 1 バイト違えば署名も変わる（Content-Length が署名に効いている対照）', async () => {
    const target = api();
    const base = {
      Bucket: BUCKET,
      Key: KEY,
      ContentType: 'application/pdf',
      ExpiresInSeconds: 300,
    } as const;
    const a = new URL(await target.presignPut({ ...base, ContentLength: 1024 }));
    const b = new URL(await target.presignPut({ ...base, ContentLength: 1025 }));

    expect(a.searchParams.get('X-Amz-Signature')).not.toBe(b.searchParams.get('X-Amz-Signature'));
  });

  it('🔴 SSE-KMS のヘッダはクエリへ hoist されず、署名対象のヘッダとして残る', async () => {
    const url = new URL(
      await api().presignPut({
        Bucket: BUCKET,
        Key: KEY,
        ContentType: 'application/pdf',
        ContentLength: 1024,
        SSEKMSKeyId: 'arn:aws:kms:ap-northeast-1:000000000000:key/abc',
        ExpiresInSeconds: 300,
      }),
    );

    const signedHeaders = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    expect(signedHeaders).toContain('x-amz-server-side-encryption');
    expect(signedHeaders).toContain('x-amz-server-side-encryption-aws-kms-key-id');
    // hoist されていない ＝ クエリ文字列には現れない（クライアントがヘッダで送る）。
    expect(url.searchParams.get('x-amz-server-side-encryption')).toBeNull();
  });

  it('鍵が未設定なら SSE の指定を 1 つも載せない（MinIO で 400 にならない）', async () => {
    const url = new URL(
      await api().presignPut({
        Bucket: BUCKET,
        Key: KEY,
        ContentType: 'application/pdf',
        ContentLength: 1024,
        ExpiresInSeconds: 300,
      }),
    );

    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders).not.toContain('x-amz-server-side-encryption');
  });
});

describe('🔴 起動時 DI（docs/05 §13.1）', () => {
  it('createS3Api の戻り値をそのまま createObjectStore に渡して objectStore: real が解決できる', () => {
    // 🔴 `development`（MinIO）の起動と同じ組み合わせ。ここが throw すると
    //    「`development` でアップロード経路が立ち上がらない」ことになる。
    const store = createObjectStore('real', {
      s3: {
        api: createS3Api({
          region: 'us-east-1',
          endpoint: 'http://localhost:9000',
          forcePathStyle: true,
          credentials: CREDENTIALS,
        }),
        bucket: BUCKET,
        presignedUrlTtlSeconds: 300,
      },
    });

    expect(store).toBeInstanceOf(S3ObjectStore);
    expect(store.callCount()).toBe(0);
  });

  it('🔴 実際に署名まで通る（起動できるだけでなく、発行の 1 往復が成立する）', async () => {
    const store = createObjectStore('real', {
      s3: {
        api: createS3Api({
          region: 'us-east-1',
          endpoint: 'http://localhost:9000',
          forcePathStyle: true,
          credentials: CREDENTIALS,
        }),
        bucket: BUCKET,
        presignedUrlTtlSeconds: 300,
      },
    });

    const put = await store.presignPut(KEY, 'application/pdf', 2048);

    expect(new URL(put.url).searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(put.headers['content-length']).toBe('2048');
    expect(store.callCount()).toBe(1);
  });
});

describe('presignGet（ローカル署名）', () => {
  it('有効期限が指定どおりに載る', async () => {
    const url = new URL(
      await api().presignGet({ Bucket: BUCKET, Key: KEY, ExpiresInSeconds: 60 }),
    );
    expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
  });
});

describe('🔴 ③ ④ headObject / deleteObject（`send` を差し替え、ネットワークに出ない）', () => {
  it('応答を内部型へ正規化する（サービス固有の綴りを外に出さない）', async () => {
    const client = localClient();
    vi.spyOn(client, 'send').mockResolvedValue({
      ContentLength: 2048,
      VersionId: 'v-1',
      $metadata: {},
    } as never);

    expect(await api({ client }).headObject({ Bucket: BUCKET, Key: KEY })).toEqual({
      ContentLength: 2048,
      VersionId: 'v-1',
    });
  });

  it('🔴 ContentLength が欠けていたら 0 で埋めずに例外（置いたバイト数が計上から漏れない）', async () => {
    const client = localClient();
    vi.spyOn(client, 'send').mockResolvedValue({ VersionId: 'v-1', $metadata: {} } as never);

    await expect(api({ client }).headObject({ Bucket: BUCKET, Key: KEY })).rejects.toThrow(
      /ContentLength/,
    );
  });

  it('🔴 VersionId が欠けていたら空文字で埋めずに例外（スキャン結果を版に結び付けられない）', async () => {
    const client = localClient();
    vi.spyOn(client, 'send').mockResolvedValue({ ContentLength: 1, $metadata: {} } as never);

    await expect(api({ client }).headObject({ Bucket: BUCKET, Key: KEY })).rejects.toThrow(
      /VersionId/,
    );
  });

  it('404（NotFound）だけを null に写す', async () => {
    const client = localClient();
    vi.spyOn(client, 'send').mockRejectedValue(
      Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }),
    );

    expect(await api({ client }).headObject({ Bucket: BUCKET, Key: KEY })).toBeNull();
  });

  it('🔴 404 以外の例外は握り潰さない（権限エラーを「存在しない」にしない）', async () => {
    const client = localClient();
    vi.spyOn(client, 'send').mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    );

    await expect(api({ client }).headObject({ Bucket: BUCKET, Key: KEY })).rejects.toThrow('denied');
  });

  it('headObject / deleteObject が正しいコマンドを組み立てる', async () => {
    const client = localClient();
    const send = vi
      .spyOn(client, 'send')
      .mockResolvedValue({ ContentLength: 1, VersionId: 'v-1', $metadata: {} } as never);
    const target = api({ client });

    await target.headObject({ Bucket: BUCKET, Key: KEY });
    await target.deleteObject({ Bucket: BUCKET, Key: KEY });

    const commands = send.mock.calls.map(([command]) => command);
    expect(commands[0]).toBeInstanceOf(HeadObjectCommand);
    expect((commands[0] as HeadObjectCommand).input).toEqual({ Bucket: BUCKET, Key: KEY });
    expect((commands[1] as HeadObjectCommand).input).toEqual({ Bucket: BUCKET, Key: KEY });
  });
});
