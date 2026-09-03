// apps/web/lib/auth/credentials.test.ts
// 🔴 docs/04 §S-001「メールアドレスが存在しないとパスワードが違うを区別しない」の**実装側**の固定。
//
//    応答の中身（`REJECTED` の 1 種類だけ）は tests/isolation/auth-tenant-ctx.test.ts が DB 付きで
//    見ている。ここで固定するのは **応答時間の等化**、すなわち
//    「未知アカウント / パスワード不一致 / 無効化済み の 3 分岐すべてで Argon2id の検証が
//     ちょうど 1 回走ること」である。未知アカウントだけ検証を省くと、応答時間の差から
//    「そのメールアドレスは登録されている」ことが観測できてしまう。
//
// 🔴 検証の実行有無を観測するため `./password` と `@ses/db` をモックする。
//    ここは「呼ばれたか」だけを見る単体テストであり、実 DB は使わない（実経路は結合テスト側）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.fn の型引数で「任意個の引数」を宣言する（`mock.calls[i][1]` を読むため）。
const withAuthLookup = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const recordAuthAuditLog = vi.fn<(...args: unknown[]) => Promise<void>>();
const verifyPassword = vi.fn<(...args: unknown[]) => Promise<boolean>>();

vi.mock('@ses/db', () => ({
  withAuthLookup: (...args: unknown[]) => withAuthLookup(...args),
  recordAuthAuditLog: (...args: unknown[]) => recordAuthAuditLog(...args),
}));

vi.mock('./password', async () => {
  // 🔴 `DUMMY_PASSWORD_HASH` は実物を使う（定数が消えたら本テストが落ちる）。
  const actual = await vi.importActual<typeof import('./password')>('./password');
  return {
    DUMMY_PASSWORD_HASH: actual.DUMMY_PASSWORD_HASH,
    hashPassword: actual.hashPassword,
    verifyPassword: (...args: unknown[]) => verifyPassword(...args),
  };
});

const { authenticateCredentials } = await import('./credentials');
const { DUMMY_PASSWORD_HASH } = await import('./password');

const META = { deviceKind: 'api', ipAddress: null } as const;
const INPUT = { email: 'someone@seed-isolation.test', password: 'attempted password' };

const USER_ROW = {
  userId: '00000000-0000-7000-8000-000000000001',
  tenantId: '00000000-0000-7000-8000-0000000000a1',
  partnerCompanyId: null,
  email: INPUT.email,
  displayName: 'テスト利用者',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
  disabledAt: null,
};

beforeEach(() => {
  withAuthLookup.mockReset();
  recordAuthAuditLog.mockReset();
  recordAuthAuditLog.mockResolvedValue(undefined);
  verifyPassword.mockReset();
  verifyPassword.mockResolvedValue(false);
});

describe('🔴 3 つの失敗分岐すべてで Argon2id の検証がちょうど 1 回走る（応答時間の等化）', () => {
  it('未知アカウント: ダミーハッシュに対して検証が 1 回走り、監査ログは書かれない', async () => {
    withAuthLookup.mockResolvedValue(null);

    const result = await authenticateCredentials(INPUT, META);

    expect(result).toEqual({ outcome: 'REJECTED' });
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    // 🔴 検証対象が「固定のダミーハッシュ」であること（省略も、ユーザー由来の値でもない）。
    expect(verifyPassword).toHaveBeenCalledWith(INPUT.password, DUMMY_PASSWORD_HASH);
    // テナントが確定しないため AuditLog には書けない（credentials.ts の説明を参照）。
    expect(recordAuthAuditLog).not.toHaveBeenCalled();
  });

  it('パスワード不一致: 利用者のハッシュに対して検証が 1 回走り、auth.login_failed が記録される', async () => {
    withAuthLookup.mockResolvedValue(USER_ROW);
    verifyPassword.mockResolvedValue(false);

    const result = await authenticateCredentials(INPUT, META);

    expect(result).toEqual({ outcome: 'REJECTED' });
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(verifyPassword).toHaveBeenCalledWith(INPUT.password, USER_ROW.passwordHash);
    expect(recordAuthAuditLog).toHaveBeenCalledTimes(1);
    expect(recordAuthAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'auth.login_failed',
      summary: { reason: 'PASSWORD_MISMATCH' },
    });
  });

  it('無効化済み: パスワードが正しくても検証を 1 回走らせてから拒否する', async () => {
    withAuthLookup.mockResolvedValue({ ...USER_ROW, disabledAt: new Date('2026-09-01T00:00:00Z') });
    verifyPassword.mockResolvedValue(true);

    const result = await authenticateCredentials(INPUT, META);

    expect(result).toEqual({ outcome: 'REJECTED' });
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(recordAuthAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'auth.login_failed',
      summary: { reason: 'USER_DISABLED' },
    });
  });

  it('対照: 成功時も検証は 1 回で、auth.login が記録される（分岐間で回数が揃っている）', async () => {
    withAuthLookup.mockResolvedValue(USER_ROW);
    verifyPassword.mockResolvedValue(true);

    const result = await authenticateCredentials(INPUT, META);

    expect(result).toEqual({
      outcome: 'AUTHENTICATED',
      claims: {
        tenantId: USER_ROW.tenantId,
        partnerCompanyId: null,
        userId: USER_ROW.userId,
      },
    });
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(recordAuthAuditLog.mock.calls[0]?.[1]).toMatchObject({ action: 'auth.login' });
  });

  it('🔴 監査ログの書き込みに失敗したら認証を成立させない（例外を握りつぶさない）', async () => {
    withAuthLookup.mockResolvedValue(USER_ROW);
    verifyPassword.mockResolvedValue(true);
    recordAuthAuditLog.mockRejectedValue(new Error('audit write failed'));

    await expect(authenticateCredentials(INPUT, META)).rejects.toThrow(/audit write failed/);
  });
});
