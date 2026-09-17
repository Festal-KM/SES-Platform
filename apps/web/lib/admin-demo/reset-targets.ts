// apps/web/lib/admin-demo/reset-targets.ts
// 🔴 T-10-07: リセット（API-A16 `POST …/reset`）が対象にする `demo` プリセットのテナント名の**唯一の出所**。
//
// 🔴 値は `@ses/db/seed` の `demoSeedCompanyNames`（= 投入時と同じ式）から導く。DB を読まない（未投入・途中で止まった状態でも、
//    確認入力の照合先が要る —— `SeedIncompleteError` からの回復手段はリセットだけである。docs/05 §13.6）。
// 🔴 サーバ専用（`@ses/db/seed` を値 import する）。`'use client'` の部品には `page.tsx` が props で渡す
//    （`tests/static/client-db-boundary.test.ts`）。
// 🔴 ここに載せるのは**合成の商号**だけである。エンジニアの氏名・提案の本文は載せない（`CLAUDE.md` §10.5）。
import { DEMO_SEED_IDS, demoSeedCompanyNames } from '@ses/db/seed';

/** `demo` プリセットの 2 テナントのホスト商号（`株式会社サンプルアルファ` / `株式会社サンプルブラボー`）。 */
export function demoResetTargetTenantNames(): readonly string[] {
  return DEMO_SEED_IDS.tenants.map((_tenant, index) => demoSeedCompanyNames(index + 1).host);
}
