// packages/db/src/recipient.test.ts
// T-04-02: 宛先分類の引き当て（docs/05 §8.2 / `docs/02` 章 7.6 NFR-ENV-1）。
//
// 🔴 ここで固定するのは次の 4 点である:
//    ① 4 分類 + 分類外を網羅して導けること
//    ② 判定順（パートナー所属 → テナント所属）が引き当て側でも保たれること
//    ③ 引き当てに失敗したときにモック側（`CLIENT`）へ倒れること
//    ④ 送信元テナントを**引数ではなく DB スコープ**から取ること（呼び出し側が偽装できない）
//
// 🔴 DB は使わない。`withTenant` を要する部分（RLS の効き方）は結合テスト
//    （`tests/isolation/**`）の範囲であり、ここでは「どの行をどう読み、どう判定に渡すか」を固定する。
//    フェイクの組み立ては `audit.test.ts` の `fakeWriter` と同じ方式（`as unknown as` で
//    最小のデリゲートだけを差し込む）。
import { describe, expect, it, vi } from 'vitest';
import { RECIPIENT_CLASSES } from '@ses/domain';
import { resolvePlatformCtx } from './platform-context.js';
import {
  platformRecipientClass,
  resolveRecipientClass,
  type RecipientLookupDb,
} from './recipient.js';
import { EMAIL_RECIPIENT_CLASSES } from './schema-value-sets.js';

const TENANT = '01930000-0000-7000-8000-0000000000a1';
const OTHER_TENANT = '01930000-0000-7000-8000-0000000000a2';
const PARTNER = '01930000-0000-7000-8000-0000000000b1';
const USER = '01930000-0000-7000-8000-0000000000c1';
const INVITATION = '01930000-0000-7000-8000-0000000000d1';

type Owner = { tenantId: string; partnerCompanyId: string | null } | null;

function fakeDb(rows: {
  tenant?: { id: string } | null;
  membership?: Owner;
  invitation?: Owner;
}): {
  db: RecipientLookupDb;
  tenantFindFirst: ReturnType<typeof vi.fn>;
  membershipFindFirst: ReturnType<typeof vi.fn>;
  invitationFindFirst: ReturnType<typeof vi.fn>;
} {
  // 🔴 `?? ` にしない（明示的に渡した `null` を既定値で握り潰さないため）。
  const tenantFindFirst = vi
    .fn()
    .mockResolvedValue('tenant' in rows ? rows.tenant : { id: TENANT });
  const membershipFindFirst = vi.fn().mockResolvedValue(rows.membership ?? null);
  const invitationFindFirst = vi.fn().mockResolvedValue(rows.invitation ?? null);
  return {
    db: {
      tenant: { findFirst: tenantFindFirst },
      membership: { findFirst: membershipFindFirst },
      invitation: { findFirst: invitationFindFirst },
    } as unknown as RecipientLookupDb,
    tenantFindFirst,
    membershipFindFirst,
    invitationFindFirst,
  };
}

describe('resolveRecipientClass（4 分類 + 分類外の網羅。docs/05 §8.2）', () => {
  it('分類 1: ホスト所属の利用者 → HOST_MEMBER', async () => {
    const { db } = fakeDb({ membership: { tenantId: TENANT, partnerCompanyId: null } });
    await expect(resolveRecipientClass(db, { userId: USER }, 'CLIENT')).resolves.toBe('HOST_MEMBER');
  });

  it('分類 1: 招待中の本人（ホスト宛の招待）→ HOST_MEMBER', async () => {
    // 🔴 受諾前は Membership がまだ無い（CLAUDE.md §11.1「招待中の本人を含む」）。
    const { db, invitationFindFirst, membershipFindFirst } = fakeDb({
      invitation: { tenantId: TENANT, partnerCompanyId: null },
    });
    await expect(
      resolveRecipientClass(db, { invitationId: INVITATION }, 'CLIENT'),
    ).resolves.toBe('HOST_MEMBER');
    expect(invitationFindFirst).toHaveBeenCalledWith({
      where: { id: INVITATION },
      select: { tenantId: true, partnerCompanyId: true },
    });
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });

  it('🔴 分類 2: パートナー所属の利用者 → PARTNER_MEMBER（sandbox でモックになる側）', async () => {
    const { db } = fakeDb({ membership: { tenantId: TENANT, partnerCompanyId: PARTNER } });
    await expect(resolveRecipientClass(db, { userId: USER }, 'CLIENT')).resolves.toBe(
      'PARTNER_MEMBER',
    );
  });

  it('🔴 分類 2: 取引先招待（パートナー宛の招待）→ PARTNER_MEMBER', async () => {
    const { db } = fakeDb({ invitation: { tenantId: TENANT, partnerCompanyId: PARTNER } });
    await expect(
      resolveRecipientClass(db, { invitationId: INVITATION }, 'CLIENT'),
    ).resolves.toBe('PARTNER_MEMBER');
  });

  it('分類 3: テナント外の宛先（subject が null）→ fallback の CLIENT', async () => {
    const { db, tenantFindFirst } = fakeDb({});
    await expect(resolveRecipientClass(db, null, 'CLIENT')).resolves.toBe('CLIENT');
    // subject が無いなら DB を引く必要も無い（余計な読み取りをしない）。
    expect(tenantFindFirst).not.toHaveBeenCalled();
  });

  it('分類 4: エンジニア本人（subject が null）→ fallback の ENGINEER', async () => {
    const { db } = fakeDb({});
    await expect(resolveRecipientClass(db, null, 'ENGINEER')).resolves.toBe('ENGINEER');
  });

  it('分類外: 運営者宛は管理平面の platformRecipientClass だけが返す', async () => {
    const ctx = await resolvePlatformCtx(
      { platformUserId: USER, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
      { deviceKind: 'api' },
    );
    expect(platformRecipientClass(ctx)).toBe('PLATFORM');
  });
});

describe('🔴 判定順と fail-closed（docs/02 章 7.6 / CLAUDE.md §11.1）', () => {
  it('🔴 パートナー所属はテナント所属より先に判定される（実送信側に落とさない）', async () => {
    // 引き当てた行は「このテナントに所属し、かつパートナー企業に属する」= 判定順を
    // 逆にすると HOST_MEMBER（sandbox で実送信）になる組み合わせ。
    const { db } = fakeDb({ membership: { tenantId: TENANT, partnerCompanyId: PARTNER } });
    await expect(resolveRecipientClass(db, { userId: USER }, 'CLIENT')).resolves.not.toBe(
      'HOST_MEMBER',
    );
  });

  it('引き当てられない（行が見えない）ときは CLIENT に倒れる', async () => {
    const { db } = fakeDb({ membership: null });
    await expect(resolveRecipientClass(db, { userId: USER }, 'CLIENT')).resolves.toBe('CLIENT');
  });

  it('🔴 テナントスコープが引けない（tenants が 0 件）ときも HOST_MEMBER にならない', async () => {
    const { db } = fakeDb({
      tenant: null,
      membership: { tenantId: TENANT, partnerCompanyId: null },
    });
    await expect(resolveRecipientClass(db, { userId: USER }, 'CLIENT')).resolves.toBe('CLIENT');
  });

  it('別テナントの所属は HOST_MEMBER にならない', async () => {
    const { db } = fakeDb({ membership: { tenantId: OTHER_TENANT, partnerCompanyId: null } });
    await expect(resolveRecipientClass(db, { userId: USER }, 'CLIENT')).resolves.toBe('CLIENT');
  });

  it('無効化された所属（revokedAt）を分類の材料にしない', async () => {
    const { db, membershipFindFirst } = fakeDb({
      membership: { tenantId: TENANT, partnerCompanyId: null },
    });
    await resolveRecipientClass(db, { userId: USER }, 'CLIENT');
    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { userId: USER, revokedAt: null },
      select: { tenantId: true, partnerCompanyId: true },
    });
  });

  it('🔴 送信元テナントは引数ではなく DB スコープから取る（呼び出し側が偽装できない）', async () => {
    const { db, tenantFindFirst } = fakeDb({
      membership: { tenantId: TENANT, partnerCompanyId: null },
    });
    await resolveRecipientClass(db, { userId: USER }, 'CLIENT');
    expect(tenantFindFirst).toHaveBeenCalledWith({ select: { id: true } });
  });
});

describe('値集合の一致（docs/05 §3.9 の CHECK と @ses/domain の union）', () => {
  it('EMAIL_RECIPIENT_CLASSES と RECIPIENT_CLASSES が完全に一致する', () => {
    expect([...EMAIL_RECIPIENT_CLASSES]).toEqual([...RECIPIENT_CLASSES]);
  });
});
