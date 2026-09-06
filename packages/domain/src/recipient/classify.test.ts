// packages/domain/src/recipient/classify.test.ts
// T-04-02: 宛先分類の判定（docs/05 §8.2 / docs/02 章 7.6 NFR-ENV-1）。
//
// 🔴 ここで固定するのは **4 分類 + 分類外の網羅**と**判定順**である。
//    判定順が壊れると `sandbox` から実在の取引先企業の担当者へメールが飛ぶ（Issue #9 / #10）。
//    これは `CLAUDE.md` §7 の「0 件」に数えられる事故であり、テストで固定しないと気づけない。
import { describe, expect, it } from 'vitest';
import { classifyRecipient, RECIPIENT_CLASSES, type RecipientFacts } from './classify.js';
import {
  ACCOUNT_MAIL_RECIPIENT_CLASSES,
  EXTERNAL_RECIPIENT_CLASSES,
  HOST_OR_PLATFORM_RECIPIENT_CLASSES,
  isAccountMailRecipientClass,
  isExternalRecipientClass,
  isHostOrPlatformRecipientClass,
  isOperationalMailRecipientClass,
  OPERATIONAL_MAIL_RECIPIENT_CLASSES,
  OUTSIDER_RECIPIENT_CLASSES,
} from './scope.js';

const TENANT = '01930000-0000-7000-8000-0000000000a1';
const OTHER_TENANT = '01930000-0000-7000-8000-0000000000a2';
const PARTNER = '01930000-0000-7000-8000-0000000000b1';

function facts(overrides: Partial<RecipientFacts> = {}): RecipientFacts {
  return { isPlatformUser: false, membership: null, tenantId: TENANT, ...overrides };
}

describe('classifyRecipient（docs/02 章 7.6 の 4 分類 + 分類外）', () => {
  it('分類 1: ホスト所属利用者 → HOST_MEMBER', () => {
    expect(
      classifyRecipient(facts({ membership: { tenantId: TENANT, partnerCompanyId: null } })),
    ).toBe('HOST_MEMBER');
  });

  it('分類 2: パートナー所属利用者 → PARTNER_MEMBER', () => {
    expect(
      classifyRecipient(facts({ membership: { tenantId: TENANT, partnerCompanyId: PARTNER } })),
    ).toBe('PARTNER_MEMBER');
  });

  it('分類 3: テナントに所属しない宛先 → CLIENT', () => {
    expect(classifyRecipient(facts({ membership: null }))).toBe('CLIENT');
  });

  it('分類 4（ENGINEER）は事実からは導かれない — 送信経路の fallback でしか出ない', () => {
    // 🔴 `classifyRecipient` は「所属が引けない宛先」を必ず CLIENT（分類 3）に倒す。
    //    エンジニア本人宛（分類 4）は送信経路側が `fallback: 'ENGINEER'` として表明する。
    //    どちらもモック側であり、実送信側へ落ちる経路は無い。
    expect(classifyRecipient(facts({ membership: null }))).not.toBe('ENGINEER');
    expect(isExternalRecipientClass('ENGINEER')).toBe(true);
  });

  it('分類外: PlatformUser → PLATFORM', () => {
    expect(classifyRecipient(facts({ isPlatformUser: true }))).toBe('PLATFORM');
  });

  it('別テナントの所属は HOST_MEMBER にならない（CLIENT に倒れる）', () => {
    expect(
      classifyRecipient(facts({ membership: { tenantId: OTHER_TENANT, partnerCompanyId: null } })),
    ).toBe('CLIENT');
  });

  it('送信元テナントが未確定（null）なら HOST_MEMBER にならない', () => {
    expect(
      classifyRecipient(
        facts({ membership: { tenantId: TENANT, partnerCompanyId: null }, tenantId: null }),
      ),
    ).toBe('CLIENT');
  });
});

describe('🔴 判定順（docs/02 章 7.6 / docs/05 §8.2。この順序を変えない）', () => {
  it('①PlatformUser がパートナー所属より先に判定される', () => {
    expect(
      classifyRecipient(
        facts({ isPlatformUser: true, membership: { tenantId: TENANT, partnerCompanyId: PARTNER } }),
      ),
    ).toBe('PLATFORM');
  });

  it('①PlatformUser がテナント所属より先に判定される', () => {
    expect(
      classifyRecipient(
        facts({ isPlatformUser: true, membership: { tenantId: TENANT, partnerCompanyId: null } }),
      ),
    ).toBe('PLATFORM');
  });

  it('🔴 ②パートナー所属が③テナント所属より先に判定される（取引先担当者を実送信側に落とさない）', () => {
    // パートナー所属の利用者は「そのテナントに所属している」ため、③を先に評価すると
    // HOST_MEMBER（sandbox で実送信）になる。実在の取引先企業の担当者へメールが飛ぶ。
    expect(
      classifyRecipient(
        facts({ membership: { tenantId: TENANT, partnerCompanyId: PARTNER } }),
      ),
    ).toBe('PARTNER_MEMBER');
  });

  it('🔴 パートナー所属は、送信元テナントが一致しなくても実送信側に落ちない', () => {
    expect(
      classifyRecipient(
        facts({ membership: { tenantId: OTHER_TENANT, partnerCompanyId: PARTNER } }),
      ),
    ).toBe('PARTNER_MEMBER');
  });
});

describe('分類の部分集合（docs/05 §8.2 / §8.3 / §9.4）', () => {
  it('分類は 5 つで、順序も固定されている（DB の CHECK と突合する値集合）', () => {
    expect([...RECIPIENT_CLASSES]).toEqual([
      'HOST_MEMBER',
      'PARTNER_MEMBER',
      'CLIENT',
      'ENGINEER',
      'PLATFORM',
    ]);
  });

  it('🔴 全 5 分類が「実送信してよい分類」と「外部送信の分類」のどちらか一方だけに属する', () => {
    for (const value of RECIPIENT_CLASSES) {
      const inHostOrPlatform = isHostOrPlatformRecipientClass(value);
      const inExternal = isExternalRecipientClass(value);
      expect(inHostOrPlatform !== inExternal).toBe(true);
    }
  });

  it('🔴 独自ドメイン必須（外部送信）は分類 2 / 3 / 4 である（BR-51 / docs/05 §8.3）', () => {
    expect([...EXTERNAL_RECIPIENT_CLASSES]).toEqual(['PARTNER_MEMBER', 'CLIENT', 'ENGINEER']);
  });

  it('🔴 sandbox で実送信してよいのは分類 1 と分類外だけである（CLAUDE.md §11.1）', () => {
    expect([...HOST_OR_PLATFORM_RECIPIENT_CLASSES]).toEqual(['HOST_MEMBER', 'PLATFORM']);
    expect(isHostOrPlatformRecipientClass('PARTNER_MEMBER')).toBe(false);
    expect(isHostOrPlatformRecipientClass('CLIENT')).toBe(false);
    expect(isHostOrPlatformRecipientClass('ENGINEER')).toBe(false);
  });

  it('🔴 email.dispatch に載せてよいのは分類 1 / 2 / 分類外である（docs/05 §9.4。T-05-08）', () => {
    expect([...OPERATIONAL_MAIL_RECIPIENT_CLASSES]).toEqual([
      'HOST_MEMBER',
      'PARTNER_MEMBER',
      'PLATFORM',
    ]);
    // 🔴 業務上の外部送信（提案先・エンジニア本人）は `attempts: 3` のキューに載らない。
    expect(isOperationalMailRecipientClass('CLIENT')).toBe(false);
    expect(isOperationalMailRecipientClass('ENGINEER')).toBe(false);
  });

  it('🔴 「キューに載せてよい」と「sandbox で実送信してよい」は別物である（混同禁止）', () => {
    // 混ぜると sandbox から取引先の担当者へ実メールが飛ぶ（CLAUDE.md §11.1 の最悪の事故）。
    expect(isOperationalMailRecipientClass('PARTNER_MEMBER')).toBe(true);
    expect(isHostOrPlatformRecipientClass('PARTNER_MEMBER')).toBe(false);
  });

  it('🔴 account.mail に載せてよいのは分類 1 と分類 2 だけである（docs/05 §9.4）', () => {
    expect([...ACCOUNT_MAIL_RECIPIENT_CLASSES]).toEqual(['HOST_MEMBER', 'PARTNER_MEMBER']);
    expect(isAccountMailRecipientClass('CLIENT')).toBe(false);
    expect(isAccountMailRecipientClass('ENGINEER')).toBe(false);
    expect(isAccountMailRecipientClass('PLATFORM')).toBe(false);
  });

  it('🔴 fallback に使えるのはモック側（分類 3 / 4）だけである（docs/02 章 7.6 のタイブレーカー）', () => {
    expect([...OUTSIDER_RECIPIENT_CLASSES]).toEqual(['CLIENT', 'ENGINEER']);
    for (const value of OUTSIDER_RECIPIENT_CLASSES) {
      expect(isHostOrPlatformRecipientClass(value)).toBe(false);
    }
  });
});
