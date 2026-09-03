// apps/web/lib/auth/schemas.test.ts
// 🔴 `F-003 AC-1` / `F-004 AC-2`:「リクエストのボディ・クエリ・パスにテナント識別子や
//    パートナー識別子を含めても、参照範囲は変化しない」の**入口側**の証明。
//
//    ここで固定するのは 2 点:
//      ① スキーマが分離キーを**キーとして持たない**（型テスト + 実行時の対照）
//      ② 分離キーを混ぜた body を通しても、**解析結果が 1 バイトも変わらない**
//    参照範囲そのものが変わらないことは tests/isolation/auth-tenant-ctx.test.ts が DB 付きで見る。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ISOLATION_KEYS, assertNoIsolationKeys } from '../api/isolation-keys';
import { signInBodySchema, type SignInBody } from './schemas';

const CLEAN_BODY = { email: 'Host@Example.test', password: 'correct horse battery staple' };

const POLLUTED_BODY = {
  ...CLEAN_BODY,
  tenantId: '00000000-0000-7000-8000-000000000001',
  partnerCompanyId: '00000000-0000-7000-8000-000000000002',
  ownerPartnerCompanyId: '00000000-0000-7000-8000-000000000003',
  role: 'OWNER',
  lifecycleState: 'ACTIVE',
};

describe('signInBodySchema は分離キーを受け付けない（F-003 AC-1）', () => {
  it('スキーマの shape に分離キーが 1 つも無い', () => {
    const keys = Object.keys(signInBodySchema.shape);
    for (const forbidden of ISOLATION_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('出力の型に分離キーが現れない（型テスト）', () => {
    expectTypeOf<keyof SignInBody>().toEqualTypeOf<'email' | 'password'>();
  });

  it('body に分離キーを混ぜても解析結果が変わらない（strip される）', () => {
    const clean = signInBodySchema.parse(CLEAN_BODY);
    const polluted = signInBodySchema.parse(POLLUTED_BODY);
    expect(polluted).toEqual(clean);
    expect(Object.keys(polluted).sort()).toEqual(['email', 'password']);
  });

  it('メールは小文字化して照合する（users_auth_lookup_select が lower(email) で比較する）', () => {
    expect(signInBodySchema.parse(CLEAN_BODY).email).toBe('host@example.test');
  });

  it('email / password が無い body は検証に失敗する', () => {
    expect(signInBodySchema.safeParse({}).success).toBe(false);
    expect(signInBodySchema.safeParse({ email: 'a@b.test' }).success).toBe(false);
  });
});

describe('assertNoIsolationKeys（実行時の対照。型テストが空振りしていないこと）', () => {
  it('分離キーを含む shape は例外になる', () => {
    expect(() => assertNoIsolationKeys(['email', 'tenantId'], 'testSchema')).toThrow(/tenantId/);
  });

  it('分離キーを含まない shape は通る', () => {
    expect(() => assertNoIsolationKeys(['email', 'password'], 'testSchema')).not.toThrow();
  });
});
