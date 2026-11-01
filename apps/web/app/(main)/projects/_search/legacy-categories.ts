// apps/web/app/(main)/projects/_search/legacy-categories.ts
// 🔴 廃止した旧カテゴリ → 移送先（2026-11-01。migration `20261101000000`）の**クライアント側の写し**。
//
// 検索欄はクライアント部品なので `@ses/db` を実行時に import できない（Prisma ごと入ってしまう）。
// 型だけを `@ses/db` から引き、値は `legacy-categories.test.ts` が `@ses/db` の
// `LEGACY_PROJECT_CATEGORY_MAP` と完全一致することを固定する（写しが別々に育たないように）。
import type { ProjectCategory } from '@ses/db';

export const LEGACY_PROJECT_CATEGORY_MAP: Readonly<Record<string, ProjectCategory>> = {
  INFRA: 'CLOUD',
  AI: 'DATA_AI',
  DATA: 'DATA_AI',
};
