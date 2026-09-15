// apps/web/lib/candidates/defaults.ts
// `S-016` の検索条件の初期値 —— **案件の要件を検索条件に引き継ぐ**（`docs/04` §S-011「候補を探す」/
// §S-016 セクション 2「検索条件（案件の要件が初期値として入る）」）。T-08-05。
//
// 🔴 純粋関数である（I/O を持たない。`list-rows.ts` と同じ理由でここに置き、テストで固定する）。
// 🔴 引き継ぐのは**開示 5 項目に対応する条件**だけ: 必須要件のスキル / 開始日 / 勤務地 / リモート可否 /
//    外部公開用の単価レンジ。`yearsMin` は引き継がない（`F-009` の `yearsMin` は 1 値であり、要件の
//    スキル別年数〔Java 5 年・AWS 1 年〕を 1 値に畳むと、どちらかのスキルで**候補を余計に落とす**か
//    **要件を満たさない候補を通す**かのどちらかになる。判断は利用者が条件欄で行う）。
//    `q`（フリーワード）と `availability`（稼働状況）にも既定を置かない。
// 🔴 チェックボックス 2 種は**既定オフのまま**（`F-009 AC-5`。案件の開始日・勤務地を条件に入れても、
//    間に合わない・通えない候補は**消えずに後ろへ回る**）。
import { ENGINEER_SKILL_MODE_DEFAULT } from '@ses/db';
import type { ProjectDetailShared } from '../projects/service';
import type { ProjectCandidateListQuery } from './schemas';

/**
 * 案件の要件から検索条件を組む（`limit` は呼び出し側の既定を渡す）。
 * 🔴 必須（`MUST`）要件のスキルだけを引き継ぐ。尚可（`NICE`）は絞り込みにすると候補を落とす
 *    （`docs/02` A-03: 尚可は Phase 2 の加点であり、Phase 1 では条件にしない）。
 */
export function projectCandidateDefaults(
  project: ProjectDetailShared,
  limit: number,
): ProjectCandidateListQuery {
  const mustSkillIds = [
    ...new Set(
      project.requirements.flatMap((requirement) =>
        requirement.kind === 'MUST' && requirement.skillId !== null ? [requirement.skillId] : [],
      ),
    ),
  ];
  return {
    limit,
    cursor: undefined,
    skills: mustSkillIds.length === 0 ? undefined : mustSkillIds,
    skillMode: ENGINEER_SKILL_MODE_DEFAULT,
    yearsMin: undefined,
    priceMin: project.unitPriceMin ?? undefined,
    priceMax: project.unitPriceMax ?? undefined,
    availableBy: project.startDate ?? undefined,
    prefecture: project.prefecture ?? undefined,
    remote: project.remoteMode ?? undefined,
    availability: undefined,
    q: undefined,
    onlyInTime: false,
    onlyCommutable: false,
  };
}
