// apps/web/lib/skill-sheets/upload-client.test.ts
// `S-008` のアップロード手順（#18 → S3 → #19）。T-05-06。
// 🔴 実 S3 / 実 MinIO を叩かない（`fetch` をスタブする）。
import { describe, expect, it, vi } from 'vitest';
import { requiresDirectTransfer, uploadSkillSheet } from './upload-client';

const ENGINEER = '01930000-0000-7000-8000-0000000000e1';
const OBJECT_KEY = `t/01930000-0000-7000-8000-000000000001/skill-sheets/${ENGINEER}/1/01930000-0000-7000-8000-0000000000a1.xlsx`;

function ticket(uploadUrl: string) {
  return {
    objectKey: OBJECT_KEY,
    uploadUrl,
    expiresIn: 300,
    requiredHeaders: { 'content-type': 'application/pdf', 'content-length': '10' },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function input() {
  return {
    engineerId: ENGINEER,
    fileName: '山田 太郎 スキルシート.xlsx',
    contentType: 'application/pdf',
    byteSize: 10,
    note: 'v2 の更新',
    body: 'x'.repeat(10),
  };
}

describe('requiresDirectTransfer', () => {
  it.each(['https://s3.example.com/x?sig', 'http://localhost:9000/bucket/key?sig'])(
    'HTTP(S) の署名 URL には転送する（%s）',
    (url) => {
      expect(requiresDirectTransfer(url)).toBe(true);
    },
  );

  it('🔴 `demo` のモック URL には転送しない（到達しないスキームであり、転送先が存在しない）', () => {
    expect(requiresDirectTransfer('mock-object-store://put/k')).toBe(false);
  });
});

describe('uploadSkillSheet（#18 → S3 → #19）', () => {
  it('署名 → PUT → 確定 の順に 3 回呼び、版番号を返す', async () => {
    const calls: string[] = [];
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(`${init?.method ?? 'GET'} ${href}`);
      if (href.endsWith('/skill-sheets/upload-url')) {
        return jsonResponse(ticket('https://s3.test/put'), 201);
      }
      if (href === 'https://s3.test/put') return new Response(null, { status: 200 });
      return jsonResponse({ id: 'x', version: 3, scanStatus: 'SCANNING' }, 201);
    });

    const outcome = await uploadSkillSheet(input(), { fetch: fetchStub as unknown as typeof fetch });

    expect(outcome).toEqual({ ok: true, version: 3 });
    expect(calls).toEqual([
      `POST /api/engineers/${ENGINEER}/skill-sheets/upload-url`,
      'PUT https://s3.test/put',
      `POST /api/engineers/${ENGINEER}/skill-sheets`,
    ]);
  });

  it('🔴 署名に焼き込んだヘッダをそのまま PUT に付ける（1 つでも欠けると S3 が 403）', async () => {
    let putInit: RequestInit | undefined;
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/skill-sheets/upload-url')) {
        return jsonResponse(ticket('https://s3.test/put'), 201);
      }
      if (href === 'https://s3.test/put') {
        putInit = init;
        return new Response(null, { status: 200 });
      }
      return jsonResponse({ id: 'x', version: 1, scanStatus: 'SCANNING' }, 201);
    });

    await uploadSkillSheet(input(), { fetch: fetchStub as unknown as typeof fetch });

    expect(putInit?.headers).toEqual({
      'content-type': 'application/pdf',
      'content-length': '10',
    });
  });

  it('🔴 署名が発行されなければ転送も確定もしない（上限超過の code をそのまま返す）', async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: { code: 'STORAGE_LIMIT_EXCEEDED' } }, 429),
    );

    const outcome = await uploadSkillSheet(input(), { fetch: fetchStub as unknown as typeof fetch });

    expect(outcome).toEqual({ ok: false, code: 'STORAGE_LIMIT_EXCEEDED' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('🔴 転送に失敗したら確定しない（実体が無いのに版を作らない）', async () => {
    const fetchStub = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/skill-sheets/upload-url')) {
        return jsonResponse(ticket('https://s3.test/put'), 201);
      }
      return new Response(null, { status: 403 });
    });

    const outcome = await uploadSkillSheet(input(), { fetch: fetchStub as unknown as typeof fetch });

    expect(outcome).toEqual({ ok: false, code: null });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('🔴 確定に失敗したら成功にしない（版は存在せず、検査も走らない）', async () => {
    const fetchStub = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/skill-sheets/upload-url')) {
        return jsonResponse(ticket('https://s3.test/put'), 201);
      }
      if (href === 'https://s3.test/put') return new Response(null, { status: 200 });
      return jsonResponse({ error: { code: 'SKILL_SHEET_OBJECT_MISSING' } }, 409);
    });

    const outcome = await uploadSkillSheet(input(), { fetch: fetchStub as unknown as typeof fetch });

    expect(outcome).toEqual({ ok: false, code: 'SKILL_SHEET_OBJECT_MISSING' });
  });

  it('モックストレージ（`demo`）では転送を飛ばして確定へ進む', async () => {
    const calls: string[] = [];
    const fetchStub = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/skill-sheets/upload-url')) {
        return jsonResponse(ticket('mock-object-store://put/k'), 201);
      }
      return jsonResponse({ id: 'x', version: 1, scanStatus: 'SCANNING' }, 201);
    });

    const outcome = await uploadSkillSheet(input(), { fetch: fetchStub as unknown as typeof fetch });

    expect(outcome).toEqual({ ok: true, version: 1 });
    expect(calls).toEqual([
      `/api/engineers/${ENGINEER}/skill-sheets/upload-url`,
      `/api/engineers/${ENGINEER}/skill-sheets`,
    ]);
  });
});
