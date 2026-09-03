// apps/web/lib/api/errors.test.ts
// docs/05 §15.1 の階層と §4.8「見えない ＝ 存在しない」の写像。T-03-04（SP-03）。
import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  requireFound,
  TenantNotExecutableError,
  toApiErrorBody,
  ViewerNotAllowedError,
} from './errors';

describe('🔴 requireFound（docs/05 §4.8 / F-004 AC-4）', () => {
  it('値があればそのまま返す', () => {
    expect(requireFound({ id: 'x' })).toEqual({ id: 'x' });
  });

  it.each([null, undefined])('%s は 404 になる（403 と区別しない）', (value) => {
    let caught: unknown;
    try {
      requireFound(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect((caught as NotFoundError).httpStatus).toBe(404);
  });

  it('🔴 応答ボディに対象 ID もテナント ID も含まれない（存在の示唆を作らない）', () => {
    expect(toApiErrorBody(new NotFoundError())).toEqual({
      error: { code: 'NOT_FOUND', messageKey: 'error.notFound', retryable: false },
    });
  });

  it('false / 0 / 空文字は「見つかった」として扱う（値の意味で判定しない）', () => {
    expect(requireFound(false)).toBe(false);
    expect(requireFound(0)).toBe(0);
    expect(requireFound('')).toBe('');
  });
});

describe('docs/05 §15.1 に足した 3 型の応答', () => {
  it('ViewerNotAllowedError は 403 で専用の文言キーを返す（BR-31）', () => {
    const error = new ViewerNotAllowedError();
    expect(error.httpStatus).toBe(403);
    expect(toApiErrorBody(error)).toEqual({
      error: { code: 'VIEWER_NOT_ALLOWED', messageKey: 'error.viewer.notAllowed', retryable: false },
    });
  });

  it('🔴 TenantNotExecutableError は 409 で、状態そのものを応答に載せない', () => {
    const error = new TenantNotExecutableError('CLOSING', 'error.tenant.closing');
    expect(error.httpStatus).toBe(409);
    const body = toApiErrorBody(error);
    expect(body).toEqual({
      error: {
        code: 'TENANT_NOT_EXECUTABLE',
        messageKey: 'error.tenant.closing',
        retryable: false,
      },
    });
    // 内部ログ用に保持はする（応答には出ない）。
    expect(error.lifecycleState).toBe('CLOSING');
  });
});
