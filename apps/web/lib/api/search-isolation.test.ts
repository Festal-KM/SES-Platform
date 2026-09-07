// apps/web/lib/api/search-isolation.test.ts
// 🔴 **検索の述語に分離キーが 1 つも現れないこと**（`F-009 AC-3` / `F-015 AC-1` / `BR-56` /
//    `CLAUDE.md` §3.1）。T-06-05。
//
// 🔴 なぜ `packages/db` 側ではなくここに置くか:
//    禁止キーの一覧（`ISOLATION_KEYS`）は **API 境界の語彙**であり `apps/web/lib/api` にある。
//    `packages/db` から `apps/web` は import できない（`CLAUDE.md` §2.1）ので、
//    一覧を `packages/db` 側へ**複製**すると 2 つの出所ができ、片方だけが古くなる。
//    検索の実装（`@ses/db` の `search/**`）を**こちらから import して**照合する。
//
// 🔴 これは「述語を見るテスト」であって「越境しないことの証明」ではない。母集団を決めるのは
//    RLS（`engineers` = C3 / `projects` = C4）であり、その実データでの検証は
//    `tests/isolation/engineers.test.ts` / `projects.test.ts` が行う。
import { describe, expect, it } from 'vitest';
import {
  ENGINEER_SKILL_MODE_DEFAULT,
  engineerSearchPlan,
  projectSearchWhere,
  type EngineerSearchCriteria,
} from '@ses/db';
import { ISOLATION_KEYS } from './isolation-keys';

/** 条件を「全部」指定した計画（キーが 1 つでも増えたら述語に出うる、の最大集合）。 */
const FULLY_SPECIFIED_ENGINEER_CRITERIA: EngineerSearchCriteria = {
  skills: ['01930000-0000-7000-8000-0000000000a1', '01930000-0000-7000-8000-0000000000a2'],
  skillMode: 'OR',
  yearsMin: 5,
  priceMin: 600_000,
  priceMax: 800_000,
  availableBy: '2026-11-01',
  prefecture: '13',
  remote: 'FULL_REMOTE',
  availability: 'STANDBY',
  q: '架空',
  onlyInTime: false,
  onlyCommutable: false,
};

const engineerPlanJson = JSON.stringify(engineerSearchPlan(FULLY_SPECIFIED_ENGINEER_CRITERIA));
const projectWhereJson = JSON.stringify(
  projectSearchWhere({ q: '基幹', status: 'OPEN', startFrom: '2026-10-01', prefecture: '13' }),
);

describe('🔴 F-009 AC-3: エンジニア検索の述語に境界の条件が 1 つも無い（母集団は C3 が決める）', () => {
  it.each([...ISOLATION_KEYS])('🔴 `%s` が計画に現れない', (key) => {
    expect(engineerPlanJson).not.toContain(key);
  });

  it('既定の組み合わせは AND である（境界とは無関係だが、この最大集合の前提を明示する）', () => {
    expect(ENGINEER_SKILL_MODE_DEFAULT).toBe('AND');
  });
});

describe('🔴 F-015 AC-1: 案件検索の述語に境界の条件が 1 つも無い（母集団は C4 が決める）', () => {
  it.each([...ISOLATION_KEYS])('🔴 `%s` が述語に現れない', (key) => {
    expect(projectWhereJson).not.toContain(key);
  });

  it('🔴 公開範囲（`visibilities`）を述語に持たない（越境の判断をアプリの条件式に書かない）', () => {
    expect(projectWhereJson).not.toContain('visibilit');
  });
});
