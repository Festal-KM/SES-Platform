// apps/web/lib/invitations/schemas.test.ts
// 🔴 `F-003 AC-1` / `F-004 AC-2` の入口側（`lib/auth/schemas.test.ts` と同じ趣旨）。
//    招待の発行・受諾の body に**分離キーもロールの偽装も入れられない**ことを固定する。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { PASSWORD_MIN_LENGTH } from '@ses/config';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  acceptInvitationBodySchema,
  createInvitationBodySchema,
  type AcceptInvitationBody,
  type CreateInvitationBody,
} from './schemas';

const VALID_PASSWORD = 'correct horse battery staple';

describe('createInvitationBodySchema（docs/05 §6.4 #14）', () => {
  it('🔴 shape に分離キーが 1 つも無い', () => {
    const keys = Object.keys(createInvitationBodySchema.shape);
    for (const forbidden of ISOLATION_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('出力の型は email / role だけ（型テスト）', () => {
    expectTypeOf<keyof CreateInvitationBody>().toEqualTypeOf<'email' | 'role'>();
  });

  it('🔴 分離キーを混ぜても解析結果が変わらない（strip される）', () => {
    const clean = createInvitationBodySchema.parse({ email: 'a@b.test', role: 'SALES' });
    const polluted = createInvitationBodySchema.parse({
      email: 'a@b.test',
      role: 'SALES',
      tenantId: '00000000-0000-7000-8000-000000000001',
      partnerCompanyId: '00000000-0000-7000-8000-000000000002',
    });
    expect(polluted).toEqual(clean);
    expect(Object.keys(polluted).sort()).toEqual(['email', 'role']);
  });

  it('メールは小文字化される', () => {
    expect(
      createInvitationBodySchema.parse({ email: 'Host@Example.test', role: 'ADMIN' }).email,
    ).toBe('host@example.test');
  });

  it('未知のロールは受け付けない（TENANT_ROLES に縛る）', () => {
    expect(
      createInvitationBodySchema.safeParse({ email: 'a@b.test', role: 'PLATFORM_OWNER' }).success,
    ).toBe(false);
  });

  it('メール形式でない値は 400 になる', () => {
    expect(createInvitationBodySchema.safeParse({ email: 'not-an-email', role: 'SALES' }).success).toBe(
      false,
    );
  });
});

describe('acceptInvitationBodySchema（docs/05 §6.3 #7）', () => {
  it('🔴 ロール・所属・メールアドレスを受け取らない（すべて招待行から決まる）', () => {
    expectTypeOf<keyof AcceptInvitationBody>().toEqualTypeOf<'displayName' | 'password'>();
    const parsed = acceptInvitationBodySchema.parse({
      displayName: '架空 太郎',
      password: VALID_PASSWORD,
      role: 'OWNER',
      email: 'attacker@example.test',
      tenantId: '00000000-0000-7000-8000-000000000001',
    });
    expect(Object.keys(parsed).sort()).toEqual(['displayName', 'password']);
  });

  it('🔴 パスワードの下限を満たさない値は受け付けない', () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    expect(
      acceptInvitationBodySchema.safeParse({ displayName: '架空 太郎', password: short }).success,
    ).toBe(false);
  });

  it('氏名が空の body は受け付けない', () => {
    expect(
      acceptInvitationBodySchema.safeParse({ displayName: '  ', password: VALID_PASSWORD }).success,
    ).toBe(false);
  });
});
