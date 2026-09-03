// packages/db/src/audit.test.ts
// docs/05 §16.1 / F-005 / T-03-05: `writeAuditLog` / `auditLogRowValues` の単体テスト。
//
// 🔴 `recordAuditLog` / `recordAuthAuditLog` は `runInTenantTransaction`（実 DB のトランザクション）
//    を要するため、ここではユニットテストの対象にしない（結合テストの範囲。
//    `tests/isolation/audit-log.test.ts`）。ここで固定するのは、DB を要さない純粋な部分
//    （行の組み立て）と、`createMany` の戻り値から「記録に失敗した」を判定するロジックである。
import { describe, expect, it, vi } from 'vitest';
import { AuditLogWriteError, auditLogRowValues, writeAuditLog, type AuditLogWriter } from './audit.js';

const BASE_ENTRY = {
  action: 'engineer.view',
  actorKind: 'USER' as const,
  actorId: '01930000-0000-7000-8000-0000000000a1',
  targetType: 'Engineer',
  targetId: '01930000-0000-7000-8000-0000000000b1',
  summary: { via: 'test' },
  ipAddress: '203.0.113.10',
  deviceKind: 'api' as const,
};

describe('auditLogRowValues（tenantId を含まない行の組み立て）', () => {
  it('必須項目のみを渡すと、省略可能な列は null で埋まる', () => {
    expect(
      auditLogRowValues({ action: 'auth.login', actorKind: 'SYSTEM', summary: {} }),
    ).toEqual({
      actorKind: 'SYSTEM',
      actorId: null,
      action: 'auth.login',
      targetType: null,
      targetId: null,
      summary: {},
      ipAddress: null,
      deviceKind: null,
    });
  });

  it('全項目を渡すとそのまま反映される', () => {
    expect(auditLogRowValues(BASE_ENTRY)).toEqual({
      actorKind: 'USER',
      actorId: BASE_ENTRY.actorId,
      action: 'engineer.view',
      targetType: 'Engineer',
      targetId: BASE_ENTRY.targetId,
      summary: { via: 'test' },
      ipAddress: '203.0.113.10',
      deviceKind: 'api',
    });
  });

  it('🔴 tenantId を持たない（分離キーは Prisma 拡張が文脈から確定させる）', () => {
    expect(auditLogRowValues(BASE_ENTRY)).not.toHaveProperty('tenantId');
  });
});

describe('writeAuditLog（docs/05 §15.5 / F-005 / F-012 AC-2）', () => {
  function fakeWriter(count: number): { writer: AuditLogWriter; createMany: ReturnType<typeof vi.fn> } {
    const createMany = vi.fn().mockResolvedValue({ count });
    return { writer: { auditLog: { createMany } } as unknown as AuditLogWriter, createMany };
  }

  it('createMany が 1 件返せば成立する（createMany に渡す data は 1 行の配列）', async () => {
    const { writer, createMany } = fakeWriter(1);

    await writeAuditLog(writer, BASE_ENTRY);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({ data: [auditLogRowValues(BASE_ENTRY)] });
  });

  it('🔴 createMany が 0 件を返す（＝ 記録に失敗した）と AuditLogWriteError を投げる', async () => {
    const { writer } = fakeWriter(0);

    await expect(writeAuditLog(writer, BASE_ENTRY)).rejects.toThrow(AuditLogWriteError);
    await expect(writeAuditLog(writer, BASE_ENTRY)).rejects.toThrow(/engineer\.view/);
  });

  it('🔴 createMany 自体が例外を投げたら、そのまま伝播する（握りつぶさない）', async () => {
    const dbError = new Error('connection reset');
    const writer = {
      auditLog: { createMany: vi.fn().mockRejectedValue(dbError) },
    } as unknown as AuditLogWriter;

    await expect(writeAuditLog(writer, BASE_ENTRY)).rejects.toBe(dbError);
  });
});
