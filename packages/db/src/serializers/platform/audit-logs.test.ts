// packages/db/src/serializers/platform/audit-logs.test.ts
// `toPlatformAuditLog`（docs/05 §5.5 第 2 層 / `F-058 AC-1` / `AC-3` / `BR-40`）。T-11-03。
//
// 🔴 `Object.keys` 照合で境界外フィールドが無いこと、`summary` が**必ずマスクを通った固定形**で
//    出ることを実行時に固定する（`tenants.test.ts` の先例に倣う。CLAUDE.md §8「テストの同梱」）。
//    マスキング規則そのものの網羅は `@ses/domain` の `mask-summary.test.ts` が持つ。ここでは
//    「シリアライザが規則を迂回していない」ことだけを見る。
import { describe, expect, it } from 'vitest';
import { toPlatformAuditLog, type PlatformAuditLogRow } from './audit-logs.js';

const ROW: PlatformAuditLogRow = {
  id: '01930000-0000-7000-8000-000000000f01',
  tenantId: '01930000-0000-7000-8000-0000000000a1',
  tenantName: 'Tenant A',
  actorKind: 'USER',
  actorId: '01930000-0000-7000-8000-0000000000d1',
  action: 'proposal.submit',
  targetType: 'Proposal',
  targetId: '01930000-0000-7000-8000-000000000111',
  summary: {
    operation: 'SEND',
    recipientEmail: 'sales@partner.example.jp',
    displayName: '山田 太郎',
    contactPhone: '090-1234-5678',
    subject: 'ご提案',
    body: '山田太郎をご提案します。',
    offeredUnitPrice: 800000,
  },
  impersonationSessionId: null,
  ipAddress: '203.0.113.10',
  deviceKind: 'desktop',
  createdAt: new Date('2026-09-16T01:02:03.000Z'),
};

describe('toPlatformAuditLog（A-006 / API-A7）', () => {
  it('🔴 応答のフィールドは固定列挙のみ（`actorDisplayName` を持たない）', () => {
    const view = toPlatformAuditLog(ROW);
    expect(Object.keys(view).sort()).toEqual(
      [
        'action',
        'actorId',
        'actorKind',
        'createdAt',
        'deviceKind',
        'id',
        'impersonationSessionId',
        'ipAddress',
        'summary',
        'targetId',
        'targetType',
        'tenantId',
        'tenantName',
      ].sort(),
    );
    expect('actorDisplayName' in view).toBe(false);
  });

  it('🔴 F-058 AC-1 / AC-3: summary はマスク済みで、内容キーはキーごと落ちる（スナップショット）', () => {
    expect(toPlatformAuditLog(ROW)).toMatchInlineSnapshot(`
      {
        "action": "proposal.submit",
        "actorId": "01930000-0000-7000-8000-0000000000d1",
        "actorKind": "USER",
        "createdAt": "2026-09-16T01:02:03.000Z",
        "deviceKind": "desktop",
        "id": "01930000-0000-7000-8000-000000000f01",
        "impersonationSessionId": null,
        "ipAddress": "203.0.113.10",
        "summary": {
          "contactPhone": "[masked]",
          "displayName": "[masked]",
          "offeredUnitPrice": "[masked]",
          "operation": "SEND",
          "recipientEmail": "[masked]",
        },
        "targetId": "01930000-0000-7000-8000-000000000111",
        "targetType": "Proposal",
        "tenantId": "01930000-0000-7000-8000-0000000000a1",
        "tenantName": "Tenant A",
      }
    `);
  });

  it('🔴 既知の氏名・メール・電話・本文が JSON のどこにも現れない', () => {
    const serialized = JSON.stringify(toPlatformAuditLog(ROW));
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('sales@partner.example.jp');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).not.toContain('ご提案');
    expect(serialized).not.toContain('800000');
  });

  it('summary がオブジェクトでない過去の行でも固定形（空オブジェクト）になる', () => {
    expect(toPlatformAuditLog({ ...ROW, summary: '山田 太郎' }).summary).toEqual({});
    expect(toPlatformAuditLog({ ...ROW, summary: null }).summary).toEqual({});
  });

  it('横断操作（tenantId = null）はテナント名も null', () => {
    const view = toPlatformAuditLog({ ...ROW, tenantId: null, tenantName: null, actorKind: 'PLATFORM_USER' });
    expect(view.tenantId).toBeNull();
    expect(view.tenantName).toBeNull();
    expect(view.actorKind).toBe('PLATFORM_USER');
  });
});
