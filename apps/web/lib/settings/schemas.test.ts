// apps/web/lib/settings/schemas.test.ts
// docs/05 §6.3 #64 の body スキーマ。T-03-10。
//
// 🔴 最重要の検証: **`lifecycleState` を PATCH で変更できない**（#64「読み取り専用」/
//    `CLAUDE.md` §4.2「テナント側のロールはこの状態を変更できない」）。
import { describe, expect, it } from 'vitest';
import { TENANT_LIFECYCLE_STATES } from '@ses/domain';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  ORGANIZATION_PATCHABLE_KEYS,
  updateOrganizationBodySchema,
} from './schemas';

describe('updateOrganizationBodySchema（#64）', () => {
  it('3 項目すべてを省略できる（部分更新）', () => {
    expect(updateOrganizationBodySchema.safeParse({}).success).toBe(true);
  });

  it('name / autoApproveEnabled / piiRetentionYears を受け付ける', () => {
    const parsed = updateOrganizationBodySchema.safeParse({
      name: '  ホスト株式会社  ',
      autoApproveEnabled: true,
      piiRetentionYears: 5,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.name).toBe('ホスト株式会社');
  });

  it('🔴 スキーマのキーは 3 つちょうどである（先回りして書ける項目を増やさない）', () => {
    expect(Object.keys(updateOrganizationBodySchema.shape).sort()).toEqual(
      [...ORGANIZATION_PATCHABLE_KEYS].sort(),
    );
  });

  it('🔴 lifecycleState をキーとして持たない（読み取り専用。docs/05 §6.3 #64）', () => {
    expect(Object.keys(updateOrganizationBodySchema.shape)).not.toContain('lifecycleState');
  });

  it.each([...TENANT_LIFECYCLE_STATES])(
    '🔴 lifecycleState=%s を送っても body から落ちる（変更できない）',
    (lifecycleState) => {
      const parsed = updateOrganizationBodySchema.safeParse({ lifecycleState });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data).not.toHaveProperty('lifecycleState');
    },
  );

  it('🔴 environment / timezone も変更できない（開設時にしか書けない / #64 の body に無い）', () => {
    const parsed = updateOrganizationBodySchema.safeParse({
      environment: 'production',
      timezone: 'UTC',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty('environment');
    expect(parsed.data).not.toHaveProperty('timezone');
  });

  it('🔴 分離キーをスキーマに持たない（CLAUDE.md §3.1 / BR-03）', () => {
    const keys = Object.keys(updateOrganizationBodySchema.shape);
    for (const isolationKey of ISOLATION_KEYS) {
      expect(keys).not.toContain(isolationKey);
    }
  });

  it('明らかな誤入力の保持期間（0 年 / 100 年）を弾く', () => {
    expect(updateOrganizationBodySchema.safeParse({ piiRetentionYears: 0 }).success).toBe(false);
    expect(updateOrganizationBodySchema.safeParse({ piiRetentionYears: 100 }).success).toBe(false);
  });

  it('空の組織名を弾く', () => {
    expect(updateOrganizationBodySchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});
