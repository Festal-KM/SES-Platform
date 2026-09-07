// packages/db/src/search/index.ts
// 🔴 **検索の実装の唯一の置き場所**（SP-06 T-06-05 / docs/05 TBD-8 / `docs/03` §3.7）。
//
// ここに閉じるもの（＝ `tests/static/search-sql-single-path.test.ts` の検査対象）:
//   1. フリーワード（自由文）を列に照合する述語（`free-word.ts`）
//   2. 検索条件 → 述語の変換（`engineers.ts` / `projects.ts`）
//   3. 決定的な `ORDER BY` の定義と、その前提の自己検査
//   4. 生 SQL の検索式（`ILIKE` / `to_tsvector` / `similarity()` 等）。**現時点で 0 件**
//
// ここに置かないもの:
//   - 母集団（境界）の決定 …… RLS と `withTenant` / `scope-injection`。**検索は母集団を狭めるだけ**
//   - 一覧の `select` / `count` / ページング / 応答型の組み立て …… `apps/web/lib/**`
//
// 🔴 `docs/03` §3.7.3 の代替（段階 1 インデックス見直し → 2 非正規化テーブル → 3 マテビュー →
//    4 OpenSearch）に進むとき、書き換えるのはこのディレクトリと
//    `packages/db/prisma/migrations/**` だけで済むこと —— それが本ディレクトリの存在理由である。
// 🔴 **段階 1 で `pg_trgm` の GIN は採れない**ことが実測で分かっている（RLS 下では `ILIKE` を
//    索引条件に降ろせない。`free-word.ts` 冒頭 / `docs/03` §3.7.2 懸念 4）。段階を上げるときは
//    ここから読み始めること。
//    🔴 段階 4（RLS を経由しない検索エンジン）へ移す場合は、`docs/03` §5.3 の指示どおり
//    **「検索は ID のリストだけを返し、本体は必ず RLS 越しに取り直す」**構造にすること。
export { freeWordFilter, freeWordOr } from './free-word.js';
export type { FreeWordFilter } from './free-word.js';
export type { SearchPlan, SoftCondition } from './plan.js';
export {
  ENGINEER_LIST_ORDER_BY,
  ENGINEER_SKILL_MODE_DEFAULT,
  ENGINEER_SKILL_MODES,
  engineerPriceConditions,
  engineerSearchPlan,
  engineerSkillConditions,
  ordersByFit,
} from './engineers.js';
export type {
  EngineerSearchCriteria,
  EngineerSearchPlan,
  EngineerSkillMode,
  EngineerWhereFragment,
} from './engineers.js';
export {
  assertStatusPriority,
  PROJECT_LIST_ORDER_BY,
  PROJECT_STATUS_LIST_PRIORITY,
  projectSearchWhere,
} from './projects.js';
export type { ProjectSearchCriteria, ProjectWhereFragment } from './projects.js';
