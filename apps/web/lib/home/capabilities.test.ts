// apps/web/lib/home/capabilities.test.ts
// `deriveMainCapabilities`（`BR-31` / `F-004 AC-6` / `F-006 AC-3`）。T-03-06。
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import { deriveMainCapabilities } from './capabilities';

const NON_VIEWER_ROLES = TENANT_ROLES.filter((role): role is Exclude<TenantRole, 'VIEWER'> => role !== 'VIEWER');

describe('deriveMainCapabilities', () => {
  it.each(NON_VIEWER_ROLES)('%s は承認・送信・ダウンロード・エクスポートを実行できる', (role) => {
    expect(deriveMainCapabilities(role).execute).toEqual({
      approve: true,
      submit: true,
      download: true,
      export: true,
    });
  });

  it('🔴 F-006 AC-3: VIEWER は承認・送信・ダウンロード・エクスポートのいずれも実行できない', () => {
    expect(deriveMainCapabilities('VIEWER').execute).toEqual({
      approve: false,
      submit: false,
      download: false,
      export: false,
    });
  });
});
