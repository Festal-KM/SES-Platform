// packages/domain/src/state/tenant-creation.test.ts
// 🔴 開設（`F-001`）は遷移ではない（docs/02 章 5.4 の規則）。開設できる状態と、
//    環境との整合を固定する。T-03-10。
import { describe, expect, it } from 'vitest';
import {
  isValidTenantCreation,
  TENANT_CREATION_STATES,
  TENANT_ENVIRONMENTS,
  TENANT_LIFECYCLE_STATES,
} from './tenant.js';

describe('TENANT_CREATION_STATES（docs/02 章 5.4）', () => {
  it('🔴 開設できるのは SANDBOX / ACTIVE の 2 つだけである', () => {
    expect([...TENANT_CREATION_STATES]).toEqual(['SANDBOX', 'ACTIVE']);
  });

  it('🔴 ライフサイクル状態（5 値）から自動導出していない（PURGED で開設できない）', () => {
    expect(TENANT_CREATION_STATES.length).toBeLessThan(TENANT_LIFECYCLE_STATES.length);
    expect([...TENANT_CREATION_STATES]).not.toContain('PURGED');
    expect([...TENANT_CREATION_STATES]).not.toContain('SUSPENDED');
    expect([...TENANT_CREATION_STATES]).not.toContain('CLOSING');
  });
});

describe('isValidTenantCreation（docs/02 章 5.4）', () => {
  it('見込み客の試用 = sandbox × SANDBOX', () => {
    expect(isValidTenantCreation({ environment: 'sandbox', lifecycleState: 'SANDBOX' })).toBe(true);
  });

  it('本契約 = production × ACTIVE', () => {
    expect(isValidTenantCreation({ environment: 'production', lifecycleState: 'ACTIVE' })).toBe(
      true,
    );
  });

  it('🔴 demo 環境のテナントは ACTIVE として扱う', () => {
    expect(isValidTenantCreation({ environment: 'demo', lifecycleState: 'ACTIVE' })).toBe(true);
    expect(isValidTenantCreation({ environment: 'demo', lifecycleState: 'SANDBOX' })).toBe(false);
  });

  it('🔴 sandbox 環境を ACTIVE で開設できない（試用は SANDBOX で始まる）', () => {
    expect(isValidTenantCreation({ environment: 'sandbox', lifecycleState: 'ACTIVE' })).toBe(false);
  });

  it('🔴 production 環境を SANDBOX で開設できない', () => {
    expect(isValidTenantCreation({ environment: 'production', lifecycleState: 'SANDBOX' })).toBe(
      false,
    );
  });

  it('対照: 全組み合わせのうち妥当なのは 3 つだけである', () => {
    const valid = TENANT_ENVIRONMENTS.flatMap((environment) =>
      TENANT_CREATION_STATES.filter((lifecycleState) =>
        isValidTenantCreation({ environment, lifecycleState }),
      ).map((lifecycleState) => `${environment}:${lifecycleState}`),
    );
    expect(valid.sort()).toEqual(
      ['demo:ACTIVE', 'production:ACTIVE', 'sandbox:SANDBOX'].sort(),
    );
  });
});
