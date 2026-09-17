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

/** API-A16 の応答（`GET` / `POST …/seed` 共通）。 */
export type DemoSeedResponseView = {
  readonly appEnv: string;
  readonly available: true;
  readonly configured: boolean;
  readonly outcome: DemoSeedOutcome | null;
  readonly status: DemoSeedStatusView;
};

/**
 * 🔴 T-10-07: API-A16 `POST …/reset` の帰結。`RESET` = `demo` プリセットのテナントを消した / `NOTHING_TO_RESET` = 消す前から
 *    無かった（**エラーにしない**。2 回目のリセットは正常終了 = 冪等）。
 */
export type DemoResetOutcome = 'RESET' | 'NOTHING_TO_RESET';

/**
 * 🔴 T-10-07: `POST …/reset` の request body（確認ステップ = 環境名 + テナント名の入力。docs/04 §A-012）。
 *    🔴 `tenantId` は無い —— 対象は `demo` プリセットの `tenantIds` に閉じており、任意のテナントを指す入力を受け付けない
 *    （`CLAUDE.md` §10.5。管理平面は read-only であり、合成データの外に射程を広げる入力を持たない）。
 */
export type DemoResetRequestView = {
  readonly confirmEnv: string;
  readonly confirmTenantName: string;
};

/** API-A16 `POST …/reset` の応答。`status` は `GET` と同じ形（直後は `seeded: false`）。 */
export type DemoResetResponseView = {
  readonly appEnv: string;
  readonly available: true;
  readonly configured: boolean;
  readonly outcome: DemoResetOutcome;
  readonly status: DemoSeedStatusView;
};
