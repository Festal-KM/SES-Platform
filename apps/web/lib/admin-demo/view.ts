// apps/web/lib/admin-demo/view.ts
// `A-012` / API-A16 の応答の形（純粋な型。T-10-06）。
//
// 🔴 `'use client'` の描画部品（`apps/web/app/admin/demo/admin-demo-view.tsx`）が参照するのはこのファイルだけである
//    （`@ses/db/platform` の型を client 側に持ち込まない。`tests/static/client-db-boundary.test.ts` と同じ整理）。
//    サーバ側（`app/api/admin/demo/_lib/service.ts`）は `@ses/db/platform` の `DemoSeedStatus` をそのまま写す
//    （構造的に同じ形。ずれれば型エラーになる）。
// 🔴 件数・状態・日時と合成の商号だけ。エンジニアの氏名・提案の本文・単価はフィールドとして存在しない（`CLAUDE.md` §10.5）。

export type DemoSeedTenantStatusView = {
  readonly tenantId: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly partnerCompanyCount: number;
  readonly engineerCount: number;
  readonly projectCount: number;
  readonly proposalInProgressCount: number;
  readonly assignmentExpiringCount: number;
  readonly gateFailedProposalCount: number;
  readonly sharedEngineerCount: number;
};

export type DemoSeedStatusView =
  | { readonly seeded: false; readonly tenants: readonly [] }
  | { readonly seeded: true; readonly seededAt: string; readonly tenants: readonly DemoSeedTenantStatusView[] };

export type DemoSeedOutcome = 'SEEDED' | 'ALREADY_SEEDED';

/** API-A16 の応答（`GET` / `POST` 共通）。 */
export type DemoSeedResponseView = {
  readonly appEnv: string;
  readonly available: true;
  readonly configured: boolean;
  readonly outcome: DemoSeedOutcome | null;
  readonly status: DemoSeedStatusView;
};
