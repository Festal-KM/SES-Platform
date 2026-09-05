// packages/connectors/src/mock/storage.test.ts
// MockObjectStore / MockMalwareScanner（docs/05 §13.2 / §14）。
import { describe, expect, it } from 'vitest';

import { MockObjectStore } from './object-store.js';
import { MockMalwareScanner } from './scanner.js';

const now = () => new Date('2026-09-05T00:00:00.000Z');

describe('MockObjectStore', () => {
  it('署名 URL は外部に到達しないスキームを使う（誤って渡っても届かない）', async () => {
    const store = new MockObjectStore({ now });
    const put = await store.presignPut('tenants/t1/sheets/a.xlsx', 'application/vnd.ms-excel', 10_000_000);
    expect(put.url.startsWith('mock-object-store:')).toBe(true);
    expect(put.expiresAt.getTime()).toBeGreaterThan(now().getTime());
    expect(put.headers['content-type']).toBe('application/vnd.ms-excel');
  });

  it('presignPut 後は head() が版 ID を返し、delete 後は null に戻る', async () => {
    const store = new MockObjectStore({ now });
    expect(await store.head('k1')).toBeNull();

    await store.presignPut('k1', 'text/plain', 100);
    const head = await store.head('k1');
    expect(head?.versionId).toBeTruthy();

    await store.delete('k1');
    expect(await store.head('k1')).toBeNull();
  });

  it('callCount() が呼び出しを数える', async () => {
    const store = new MockObjectStore({ now });
    await store.presignPut('k1', 'text/plain', 100);
    await store.presignGet('k1', 60);
    expect(store.callCount()).toBe(2);
  });
});

describe('MockMalwareScanner', () => {
  it('既定は CLEAN（demo で後続の導線が動く）', async () => {
    const scanner = new MockMalwareScanner();
    await scanner.enqueue('k1');
    expect(await scanner.getResult('k1', 'v1')).toBe('CLEAN');
  });

  it('既定の判定を差し替えられる（INFECTED の導線を同じモックで確かめる）', async () => {
    const scanner = new MockMalwareScanner({ defaultResult: 'INFECTED' });
    await scanner.enqueue('k1');
    expect(await scanner.getResult('k1', 'v1')).toBe('INFECTED');
  });

  it('キー × 版ごとに判定を上書きできる', async () => {
    const scanner = new MockMalwareScanner();
    await scanner.enqueue('k1');
    scanner.setResult('k1', 'v2', 'UNSCANNABLE');
    expect(await scanner.getResult('k1', 'v1')).toBe('CLEAN');
    expect(await scanner.getResult('k1', 'v2')).toBe('UNSCANNABLE');
  });

  it('未登録のキーは null（「まだ結果が無い」と「CLEAN」を混同しない）', async () => {
    const scanner = new MockMalwareScanner();
    expect(await scanner.getResult('unknown', 'v1')).toBeNull();
  });
});
