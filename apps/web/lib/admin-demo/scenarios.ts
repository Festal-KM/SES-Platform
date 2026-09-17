// apps/web/lib/admin-demo/scenarios.ts
// `A-012` の実演チェックリスト（`F-053 AC-3` の 2 本）の**開始地点**を、`seed:demo` の ID から組み立てる。T-10-06。
//
// 🔴 純粋関数。値の出所は `@ses/db/seed` の `DEMO_SEED_IDS` / `demoSeedEmails`（= 投入時と同じ式）だけであり、
//    DB を読まない。開始地点の URL は主平面の画面（`S-013` 公開範囲設定 / `S-016` 候補一覧）であり、`docs/04` `UC-21` の順路に従う。
// 🔴 ここに載せるのは **合成の利用者のメールアドレスと、合成データ専用のパスワード**だけである（実演でサインインするために要る）。
//    いずれも `demo` / `development` にしか存在しない（`assertSeedableAppEnv`）。エンジニアの氏名・提案の本文は載せない。
import { DEMO_SEED_IDS, DEMO_SEED_PASSWORD, demoSeedEmails } from '@ses/db/seed';

export type DemoScenarioStartPoints = {
  /** A. 案件の公開 → 提案 → ゲート FAIL → 修正 → 承認 → 送信 → 結果記録。開始 = 未公開案件の公開範囲設定（`S-013`）。 */
  readonly scenarioA: { readonly startUrl: string; readonly projectId: string };
  /** B. 匿名候補の検索結果への混在 → 提案依頼。開始 = 未公開案件の候補一覧（`S-016`）。 */
  readonly scenarioB: { readonly startUrl: string; readonly projectId: string };
  readonly accounts: {
    /** ホストの営業（`SALES`。2 要素認証を要求されない）。 */
    readonly hostSalesEmail: string;
    /** 取引先 1 社目の営業（`PARTNER_SALES`）。シナリオ A の提案側 / シナリオ B の依頼先。 */
    readonly partnerSalesEmail: string;
    readonly password: string;
  };
};

/**
 * @param tenantIndex `1` = `demo-alpha`（取引先 5 社。実演の既定）/ `2` = `demo-beta`（取引先 1 社）。
 */
export function demoScenarioStartPoints(tenantIndex: 1 | 2 = 1): DemoScenarioStartPoints {
  const tenant = DEMO_SEED_IDS.tenants[tenantIndex - 1];
  const emails = demoSeedEmails(tenantIndex);
  return {
    scenarioA: {
      startUrl: `/projects/${tenant.projects.unpublishedReady}/visibility`,
      projectId: tenant.projects.unpublishedReady,
    },
    scenarioB: {
      startUrl: `/projects/${tenant.projects.unpublishedCandidates}/candidates`,
      projectId: tenant.projects.unpublishedCandidates,
    },
    accounts: {
      hostSalesEmail: emails.hostSales[0],
      partnerSalesEmail: emails.partnerSales(1),
      password: DEMO_SEED_PASSWORD,
    },
  };
}
