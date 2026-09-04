// packages/db/src/platform.test.ts
// T-03-08: 管理平面の分離バイパス（docs/05 §5.2 / §5.3）のうち、**DB を要らない部分**の検証。
//
// 🔴 「監査ログの書き込みに失敗したらクエリを実行しない」（§5.3 / `BR-41`）と
//    「対象テナントに閉じる」「read-only である」は RLS と GRANT の話であり、
//    `tests/isolation/platform-plane.test.ts`（Testcontainers）が実証する。
//    ここで見るのは**宣言そのもの**（ドメインとモデルの対応・監査行の組み立て・列挙の網羅）である。
import { describe, expect, it } from 'vitest';
import { resolvePlatformCtx } from './platform-context.js';
import {
  auditEntryOf,
  PLATFORM_ACTIONS,
  PLATFORM_READABLE_MODELS,
  PLATFORM_WRITE_DOMAIN_MODELS,
  PLATFORM_WRITE_DOMAINS,
  PlatformWriteDomainViolationError,
  restrictToWriteDomain,
  type PlatformWriteDomain,
} from './platform.js';

const PLATFORM_USER_ID = '11111111-1111-4111-8111-111111111111';

async function ctxOf(role: 'PLATFORM_OWNER' | 'PLATFORM_SUPPORT' = 'PLATFORM_OWNER') {
  return resolvePlatformCtx(
    { platformUserId: PLATFORM_USER_ID, platformRole: role, twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
}

describe('書き込みドメインの宣言（docs/05 §5.2 / CLAUDE.md §10.5）', () => {
  it('🔴 7 ドメインすべてに触れてよいモデルの宣言がある（宣言漏れでドメインが素通りしない）', () => {
    for (const domain of PLATFORM_WRITE_DOMAINS) {
      const models = PLATFORM_WRITE_DOMAIN_MODELS[domain];
      expect(models.length, `${domain}: 宣言が空`).toBeGreaterThan(0);
    }
    expect(Object.keys(PLATFORM_WRITE_DOMAIN_MODELS).sort()).toEqual([...PLATFORM_WRITE_DOMAINS].sort());
  });

  it('🔴 どのドメインにもテナントの業務データのモデルが 1 つも現れない（BR-37 / §10.5「既定 read-only」）', () => {
    // `CLAUDE.md` §1.3 のループが扱う中核データ。運営者が書き換えられてはならない。
    const BUSINESS_MODELS = [
      'engineer',
      'engineerSkill',
      'skillSheet',
      'skillSheetExtraction',
      'project',
      'projectRequirement',
      'projectVisibility',
      'engineerShare',
      'matchCandidate',
      'proposalRequest',
      'proposal',
      'engineerSnapshot',
      'proposalEvent',
      'reviewGate',
      'chatThread',
      'threadParticipant',
      'message',
      'contract',
      'contractDocument',
      'contractTemplate',
      'order',
      'assignment',
      'extensionReview',
      'task',
      'notification',
      'auditLog',
      'user',
      'membership',
      'partnerCompany',
    ];
    const declared = new Set(Object.values(PLATFORM_WRITE_DOMAIN_MODELS).flat() as string[]);
    expect([...declared].filter((model) => BUSINESS_MODELS.includes(model))).toEqual([]);
  });

  it('🔴 tenants は TENANT_LIFECYCLE と TENANT_PROVISIONING の両方に現れる（DB 権限だけでは分離できない前提）', () => {
    expect(PLATFORM_WRITE_DOMAIN_MODELS.TENANT_LIFECYCLE).toContain('tenant');
    expect(PLATFORM_WRITE_DOMAIN_MODELS.TENANT_PROVISIONING).toContain('tenant');
  });
});

describe('実行時のドメイン照合（docs/05 §5.2 の「3 枚目」）', () => {
  /** Prisma のトランザクションクライアントの代わり（デリゲートの実体は要らない）。 */
  const fakeTx = {
    tenant: { kind: 'tenant' },
    invitation: { kind: 'invitation' },
    tenantSendingDomain: { kind: 'tenantSendingDomain' },
    subscription: { kind: 'subscription' },
    announcement: { kind: 'announcement' },
    // 🔴 業務データ。ドメイン照合が無ければここへ到達できてしまう。
    engineer: { kind: 'engineer' },
    proposal: { kind: 'proposal' },
  } as unknown as Parameters<typeof restrictToWriteDomain>[0];

  it('宣言されたモデルには到達できる', () => {
    const db = restrictToWriteDomain(fakeTx, 'TENANT_PROVISIONING');
    expect(db.tenant).toEqual({ kind: 'tenant' });
    expect(db.invitation).toEqual({ kind: 'invitation' });
    expect(db.tenantSendingDomain).toEqual({ kind: 'tenantSendingDomain' });
  });

  it('🔴 宣言外のモデルに触れると throw する（型を as any で破っても止まる）', () => {
    const db = restrictToWriteDomain(fakeTx, 'TENANT_PROVISIONING') as unknown as Record<
      string,
      unknown
    >;
    expect(() => db['engineer']).toThrow(PlatformWriteDomainViolationError);
    expect(() => db['proposal']).toThrow(PlatformWriteDomainViolationError);
    // 監査ログもドメインの宣言に無い（監査は withPlatformWrite 自身が書く）。
    expect(() => db['auditLog']).toThrow(PlatformWriteDomainViolationError);
  });

  it('🔴 別ドメインのモデルにも到達できない（ANNOUNCEMENT から tenants を書けない）', () => {
    const db = restrictToWriteDomain(fakeTx, 'ANNOUNCEMENT') as unknown as Record<string, unknown>;
    expect(db['announcement']).toEqual({ kind: 'announcement' });
    expect(() => db['tenant']).toThrow(PlatformWriteDomainViolationError);
  });

  it('Promise の解決で参照される then / catch / finally は throw しない（await が壊れない）', () => {
    const db = restrictToWriteDomain(fakeTx, 'ANNOUNCEMENT') as unknown as Record<string, unknown>;
    expect(() => db['then']).not.toThrow();
    expect(db['then']).toBeUndefined();
  });

  it.each([...PLATFORM_WRITE_DOMAINS])(
    '%s: 宣言されたモデル以外に触れると throw する（全ドメインで同じ）',
    (domain) => {
      const db = restrictToWriteDomain(fakeTx, domain as PlatformWriteDomain) as unknown as Record<
        string,
        unknown
      >;
      expect(() => db['engineer']).toThrow(PlatformWriteDomainViolationError);
    },
  );
});

describe('監査行の組み立て（docs/05 §5.3 / §16.1 / §16.2）', () => {
  it('🔴 主体は ctx から来る（actorKind = PLATFORM_USER / actorId = ctx.platformUserId）', async () => {
    const entry = auditEntryOf({
      ctx: await ctxOf(),
      action: 'admin.tenant.view',
      targetTenantId: 'tenant-1',
    });
    expect(entry.actorKind).toBe('PLATFORM_USER');
    expect(entry.actorId).toBe(PLATFORM_USER_ID);
    expect(entry.deviceKind).toBe('desktop');
  });

  it('🔴 どの権限で行われたかを summary に必ず残す（§10.5「運営者の全操作を記録する」）', async () => {
    const entry = auditEntryOf({
      ctx: await ctxOf('PLATFORM_SUPPORT'),
      action: 'admin.tenant.list',
      targetTenantId: null,
    });
    expect(entry.summary['platformRole']).toBe('PLATFORM_SUPPORT');
  });

  it('🔴 呼び出し側の summary で platformRole を偽装できない（ctx の値が必ず勝つ）', async () => {
    const entry = auditEntryOf({
      ctx: await ctxOf('PLATFORM_SUPPORT'),
      action: 'admin.tenant.list',
      targetTenantId: null,
      summary: { platformRole: 'PLATFORM_OWNER' },
    });
    expect(entry.summary['platformRole']).toBe('PLATFORM_SUPPORT');
  });

  it('reason は指定したときだけ載る（代理閲覧。§5.6）', async () => {
    const withoutReason = auditEntryOf({
      ctx: await ctxOf(),
      action: 'impersonation.start',
      targetTenantId: 'tenant-1',
    });
    expect(withoutReason.summary).not.toHaveProperty('reason');

    const withReason = auditEntryOf({
      ctx: await ctxOf(),
      action: 'impersonation.start',
      targetTenantId: 'tenant-1',
      reason: '請求金額の不一致の調査（Zendesk #1234）',
    });
    expect(withReason.summary['reason']).toBe('請求金額の不一致の調査（Zendesk #1234）');
  });
});

describe('列挙の網羅（docs/05 §5.2 / §5.5）', () => {
  it('🔴 読み取り可能なモデルは 52 件ちょうど（migration 20260904010000 §2 の GRANT と 1 対 1）', () => {
    expect(PLATFORM_READABLE_MODELS).toHaveLength(52);
    expect(new Set(PLATFORM_READABLE_MODELS).size).toBe(52);
  });

  it('🔴 射程外の 4 表（skills / platform_users / plans / subscriptions）を含まない（CLAUDE.md §3.1）', () => {
    const models = new Set<string>(PLATFORM_READABLE_MODELS);
    for (const excluded of ['skill', 'platformUser', 'plan', 'subscription']) {
      expect(models.has(excluded), `${excluded}: 射程外の表が読み取り対象に入っている`).toBe(false);
    }
  });

  it('action は重複の無い列挙である（AuditLog の action と同一。§5.2）', () => {
    expect(new Set(PLATFORM_ACTIONS).size).toBe(PLATFORM_ACTIONS.length);
    // 🔴 §16.1 が名前を明示している 2 つは必ず含む。
    expect(PLATFORM_ACTIONS).toContain('impersonation.start');
    expect(PLATFORM_ACTIONS).toContain('impersonation.end');
  });
});
