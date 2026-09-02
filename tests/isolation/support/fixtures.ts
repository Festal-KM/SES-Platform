// tests/isolation/support/fixtures.ts
// 二重防御テスト（docs/05 §4.7）の固定データ。
// 🔴 CLAUDE.md §5 Phase 0 の成功条件に合わせ、必ず 2 テナント以上を投入する（docs/05 §17.6）。
//    加えてテナント A にはホスト所属とパートナー所属のエンジニアを 1 件ずつ置き、
//    テナント境界（第一境界）とパートナー境界（第二境界）の両方を同じ検証で扱えるようにする。

export const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
export const TENANT_B = '01930000-0000-7000-8000-0000000000b1';

/** テナント A に招待されている取引先企業。 */
export const PARTNER_A1 = '01930000-0000-7000-8000-0000000000c1';

export const USER_A_HOST = '01930000-0000-7000-8000-0000000000d1';
export const USER_A_PARTNER = '01930000-0000-7000-8000-0000000000d2';
export const USER_B_HOST = '01930000-0000-7000-8000-0000000000d3';

export const ENGINEER_A_HOST = '01930000-0000-7000-8000-0000000000e1';
export const ENGINEER_A_PARTNER = '01930000-0000-7000-8000-0000000000e2';
export const ENGINEER_B_HOST = '01930000-0000-7000-8000-0000000000e3';

export const SEED_SQL = `
INSERT INTO tenants (id, name, lifecycle_state) VALUES
  ('${TENANT_A}', 'Tenant A', 'ACTIVE'),
  ('${TENANT_B}', 'Tenant B', 'ACTIVE');

INSERT INTO engineers (id, tenant_id, owner_partner_company_id, display_name) VALUES
  ('${ENGINEER_A_HOST}',    '${TENANT_A}', NULL,             'Engineer A-Host'),
  ('${ENGINEER_A_PARTNER}', '${TENANT_A}', '${PARTNER_A1}',  'Engineer A-Partner'),
  ('${ENGINEER_B_HOST}',    '${TENANT_B}', NULL,             'Engineer B-Host');
`;
