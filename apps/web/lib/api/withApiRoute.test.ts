// apps/web/lib/api/withApiRoute.test.ts
// docs/05 §6.1 の境界（認証 → ガード → Zod → ハンドラ）と §15.2 の応答フォーマットを固定する。
// T-03-04（SP-03）。
//
// 🔴 `requireTenantCtx`（＝ Auth.js + DB）だけをモックする。ここで見たいのは
//    「ハンドラに届く前に何が起きるか」であり、認証そのものは T-03-01 の結合テストの範囲。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { HostOnlyContextError, type AuthenticatedTenantCtx } from '@ses/db';
import { InvalidStateTransitionError as DomainInvalidStateTransitionError } from '@ses/domain';

const requireTenantCtx = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../auth/session', () => ({
  requireTenantCtx: () => requireTenantCtx(),
}));

const { withApiRoute, REQUEST_ID_HEADER, searchParamsToObject } = await import('./withApiRoute');
const { requireExecutable, requireNotViewer, requireRole } = await import('./guards');
const { AuthenticationError, NotFoundError } = await import('./errors');

const CTX = {
  tenantId: '01930000-0000-7000-8000-0000000000a1',
  partnerCompanyId: null,
  userId: '01930000-0000-7000-8000-0000000000b1',
  role: 'ADMIN',
  lifecycleState: 'ACTIVE',
  deviceKind: 'api',
} as unknown as AuthenticatedTenantCtx;

function ctxWith(overrides: Partial<Record<'role' | 'lifecycleState', string>>) {
  return { ...CTX, ...overrides } as unknown as AuthenticatedTenantCtx;
}

type ErrorBody = {
  readonly error: { readonly code: string; readonly messageKey: string; readonly details?: string[] };
};

async function readError(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

const OK = async (): Promise<Response> => Response.json({ ok: true });

function postRequest(body: unknown, url = 'https://app.test/api/x'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireTenantCtx.mockReset();
  requireTenantCtx.mockResolvedValue(CTX);
});

describe('① 認証が最初（未認証にスキーマの形を教えない）', () => {
  it('未認証なら 401 で、body の検証結果を返さない', async () => {
    requireTenantCtx.mockRejectedValue(new AuthenticationError());
    const route = withApiRoute(
      { label: 'test', guards: [], body: z.object({ name: z.string() }) },
      OK,
    );

    const response = await route(postRequest({ name: 123 }));

    expect(response.status).toBe(401);
    const body = await readError(response);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.details).toBeUndefined();
  });
});

describe('② ガードが Zod より先（権限の無い呼び出しの入力を解釈しない）', () => {
  it('🔴 VIEWER が壊れた body を送っても 400 ではなく 403 になる', async () => {
    requireTenantCtx.mockResolvedValue(ctxWith({ role: 'VIEWER' }));
    const route = withApiRoute(
      { label: 'test', guards: [requireNotViewer()], body: z.object({ name: z.string() }) },
      OK,
    );

    const response = await route(postRequest({ name: 123 }));

    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe('VIEWER_NOT_ALLOWED');
  });

  it('🔴 CLOSING のテナントでは body が正しくても 409 になる', async () => {
    requireTenantCtx.mockResolvedValue(ctxWith({ lifecycleState: 'CLOSING' }));
    const route = withApiRoute(
      { label: 'test', guards: [requireExecutable()], body: z.object({ name: z.string() }) },
      OK,
    );

    const response = await route(postRequest({ name: 'ok' }));

    expect(response.status).toBe(409);
    const body = await readError(response);
    expect(body.error.code).toBe('TENANT_NOT_EXECUTABLE');
    expect(body.error.messageKey).toBe('error.tenant.closing');
  });

  it('ロールが合わなければ 403（ガードを宣言した順序は結果に影響しない）', async () => {
    requireTenantCtx.mockResolvedValue(ctxWith({ role: 'SALES' }));
    const route = withApiRoute(
      {
        label: 'test',
        guards: [requireNotViewer(), requireExecutable(), requireRole(['OWNER', 'ADMIN'])],
        body: z.object({ name: z.string() }),
      },
      OK,
    );

    expect((await route(postRequest({ name: 'ok' }))).status).toBe(403);
  });
});

describe('③ Zod の境界検証（400 / docs/05 §15.2 の details）', () => {
  it('body の失敗はフィールドパスだけを返す', async () => {
    const route = withApiRoute(
      { label: 'test', guards: [], body: z.object({ name: z.string(), age: z.number() }) },
      OK,
    );

    const response = await route(postRequest({ name: 123 }));

    expect(response.status).toBe(400);
    const body = await readError(response);
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details).toEqual(['body.name', 'body.age']);
  });

  it('JSON でない本文も 400 になる（例外にしない）', async () => {
    const route = withApiRoute(
      { label: 'test', guards: [], body: z.object({ name: z.string() }) },
      OK,
    );

    const response = await route(
      new Request('https://app.test/api/x', { method: 'POST', body: 'not json' }),
    );

    expect(response.status).toBe(400);
  });

  it('query / params を検証してハンドラに渡す', async () => {
    const route = withApiRoute(
      {
        label: 'test',
        guards: [],
        params: z.object({ id: z.string() }),
        query: z.object({ limit: z.coerce.number().default(50) }),
      },
      async ({ params, query, body }) => Response.json({ params, query, body: body ?? null }),
    );

    const response = await route(
      new Request('https://app.test/api/x/abc?limit=7'),
      { params: Promise.resolve({ id: 'abc' }) },
    );

    expect(await response.json()).toEqual({ params: { id: 'abc' }, query: { limit: 7 }, body: null });
  });

  it('query の失敗も 400（details に query. 接頭辞が付く）', async () => {
    const route = withApiRoute(
      { label: 'test', guards: [], query: z.object({ limit: z.coerce.number().max(200) }) },
      OK,
    );

    const response = await route(new Request('https://app.test/api/x?limit=999'));

    expect(response.status).toBe(400);
    expect((await readError(response)).error.details).toEqual(['query.limit']);
  });

  it('スキーマを宣言しない面は undefined のまま渡り、本文を読みに行かない', async () => {
    let seen: unknown = 'untouched';
    const route = withApiRoute({ label: 'test', guards: [] }, async ({ body }) => {
      seen = body;
      return new Response(null, { status: 204 });
    });

    const response = await route(postRequest({ ignored: true }));

    expect(response.status).toBe(204);
    expect(seen).toBeUndefined();
  });
});

describe('🔴 分離キーをリクエスト入力に持てない（CLAUDE.md §3.1 / F-004 AC-2）', () => {
  it.each(['params', 'query', 'body'] as const)(
    '%s スキーマに tenantId があるとルート構築時に落ちる',
    (surface) => {
      expect(() =>
        withApiRoute(
          { label: 'test', guards: [], [surface]: z.object({ tenantId: z.string() }) },
          OK,
        ),
      ).toThrow(/分離キー/);
    },
  );

  it('partnerCompanyId も同じく落ちる', () => {
    expect(() =>
      withApiRoute(
        { label: 'test', guards: [], body: z.object({ partnerCompanyId: z.string() }) },
        OK,
      ),
    ).toThrow(/分離キー/);
  });

  it('オブジェクトでないスキーマは受け付けない（分離キーを検査できないため）', () => {
    expect(() => withApiRoute({ label: 'test', guards: [], body: z.string() }, OK)).toThrow(
      /オブジェクトスキーマ/,
    );
  });

  it('壊れたガード宣言もルート構築時に落ちる', () => {
    expect(() =>
      withApiRoute({ label: 'test', guards: [requireExecutable(), requireExecutable()] }, OK),
    ).toThrow(/重複/);
  });
});

describe('例外の写像（docs/05 §15）', () => {
  it('🔴 境界外のホスト専用経路は 404 になる（403 と区別しない）', async () => {
    const route = withApiRoute({ label: 'test', guards: [] }, async () => {
      throw new HostOnlyContextError();
    });

    const response = await route(new Request('https://app.test/api/x'));

    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe('NOT_FOUND');
  });

  it('🔴 見つからない ID と境界外の ID で応答が 1 バイトも違わない', async () => {
    const notFound = withApiRoute({ label: 'test', guards: [] }, async () => {
      throw new NotFoundError();
    });
    const outOfBoundary = withApiRoute({ label: 'test', guards: [] }, async () => {
      throw new HostOnlyContextError();
    });

    const a = await notFound(new Request('https://app.test/api/x'));
    const b = await outOfBoundary(new Request('https://app.test/api/x'));

    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it('🔴 遷移表に無い状態遷移は 422（サイレントに無視しない）', async () => {
    const route = withApiRoute({ label: 'test', guards: [] }, async () => {
      throw new DomainInvalidStateTransitionError('Proposal', 'DRAFT', 'SUBMITTED');
    });

    const response = await route(new Request('https://app.test/api/x'));

    expect(response.status).toBe(422);
    const body = await readError(response);
    expect(body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(body.error.messageKey).toBe('error.state.invalidTransition');
  });

  it('未知の例外は 500 に畳み、原因を応答に載せない', async () => {
    const route = withApiRoute({ label: 'test', guards: [] }, async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:5432 (内部の事情)');
    });

    const response = await route(new Request('https://app.test/api/x'));

    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toContain('ECONNREFUSED');
    expect(JSON.parse(raw)).toEqual({
      error: { code: 'INTERNAL', messageKey: 'error.internal', retryable: false },
    });
  });
});

describe('x-request-id（docs/05 §16.2）', () => {
  it('成功応答にも失敗応答にも付き、リクエストごとに異なる', async () => {
    const ok = withApiRoute({ label: 'test', guards: [] }, OK);
    const ng = withApiRoute({ label: 'test', guards: [] }, async () => {
      throw new NotFoundError();
    });

    const a = await ok(new Request('https://app.test/api/x'));
    const b = await ok(new Request('https://app.test/api/x'));
    const c = await ng(new Request('https://app.test/api/x'));

    expect(a.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers.get(REQUEST_ID_HEADER)).not.toBe(b.headers.get(REQUEST_ID_HEADER));
  });

  it('🔴 cache-control: no-store を既定にする（経路上のキャッシュでテナントが混ざらない）', async () => {
    const ok = withApiRoute({ label: 'test', guards: [] }, OK);
    const ng = withApiRoute({ label: 'test', guards: [] }, async () => {
      throw new NotFoundError();
    });

    expect((await ok(new Request('https://app.test/api/x'))).headers.get('cache-control')).toBe(
      'no-store',
    );
    expect((await ng(new Request('https://app.test/api/x'))).headers.get('cache-control')).toBe(
      'no-store',
    );
  });

  it('ハンドラが付けたヘッダを消さない', async () => {
    const route = withApiRoute({ label: 'test', guards: [] }, async () =>
      Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }),
    );

    const response = await route(new Request('https://app.test/api/x'));

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('searchParamsToObject', () => {
  it('同じキーが複数回現れたら配列にする', () => {
    expect(searchParamsToObject(new URLSearchParams('state=A&state=B&q=x'))).toEqual({
      state: ['A', 'B'],
      q: 'x',
    });
  });

  it('値の無いキーは空文字にする', () => {
    expect(searchParamsToObject(new URLSearchParams('cursor='))).toEqual({ cursor: '' });
  });
});
