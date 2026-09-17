// apps/web/lib/admin-demo/scenarios.test.ts
// `A-012` の実演チェックリストの開始地点が `seed:demo` の ID と一致し、主平面の画面（`S-013` / `S-016`）を指すこと。T-10-06。
import { describe, expect, it } from 'vitest';
import { DEMO_SEED_IDS, DEMO_SEED_PASSWORD, demoSeedEmails } from '@ses/db/seed';
import { demoScenarioStartPoints } from './scenarios';

describe('demoScenarioStartPoints（F-053 AC-3 の 2 本の開始地点）', () => {
  it('A は未公開案件の公開範囲設定（S-013）、B は匿名候補が混在する案件の候補一覧（S-016）を指す', () => {
    const points = demoScenarioStartPoints(1);
    const tenant = DEMO_SEED_IDS.tenants[0];
    expect(points.scenarioA.startUrl).toBe(`/projects/${tenant.projects.unpublishedReady}/visibility`);
    expect(points.scenarioB.startUrl).toBe(`/projects/${tenant.projects.unpublishedCandidates}/candidates`);
    // 2 本の開始地点は別の案件である（A は公開の実演、B は未公開のまま候補を探す実演）。
    expect(points.scenarioA.projectId).not.toBe(points.scenarioB.projectId);
  });

  it('サインイン情報は投入時と同じ式（demoSeedEmails）から導かれ、合成ドメイン（.example）だけを使う', () => {
    const points = demoScenarioStartPoints(1);
    expect(points.accounts.hostSalesEmail).toBe(demoSeedEmails(1).hostSales[0]);
    expect(points.accounts.partnerSalesEmail).toBe(demoSeedEmails(1).partnerSales(1));
    expect(points.accounts.hostSalesEmail.endsWith('.example')).toBe(true);
    expect(points.accounts.partnerSalesEmail.endsWith('.example')).toBe(true);
    expect(points.accounts.password).toBe(DEMO_SEED_PASSWORD);
  });

  it('既定は demo-alpha（取引先 5 社）で、beta を指定すると別テナントの案件になる', () => {
    expect(demoScenarioStartPoints().scenarioA.projectId).toBe(DEMO_SEED_IDS.tenants[0].projects.unpublishedReady);
    expect(demoScenarioStartPoints(2).scenarioA.projectId).toBe(DEMO_SEED_IDS.tenants[1].projects.unpublishedReady);
  });
});
