// packages/db/seed/presets/global-skills.ts
// 🔴 グローバルなスキル辞書（`Skill`）の初期母集団。T-05-01（docs/sprints/SP-05 T-05-01）。
//
// 🔴 なぜプリセット（テナントの母集団）と分けるか:
//    `skills` は `CLAUDE.md` §3.1 の**射程外 4 表**であり `tenant_id` を持たない。したがって
//    `reset()`（`deleteTenantData`。`tenant_id` で絞る削除）の射程外であり、テナントを消しても
//    残る。プリセットの `seed()` に固定 ID の `createMany` で書くと 2 回目の実行で一意制約に
//    当たるため、**`upsert` で冪等にする**（`seedPlatformUsers` と同じ扱い。docs/05 §13.6）。
//
// 🔴 これは「マスタ」であって合成データではない。実在の技術名を並べるのが正しく、
//    `F-053 AC-1`（合成データの担保）が禁じている「実データ由来」には当たらない
//    （個人・企業の情報を 1 つも含まない）。
//
// 🔴 辞書を**アプリから増やせない**ことが `F-010 AC-2` / `BR-02` である。増やす経路はこの
//    ファイル（マイグレーション相当のマスタ投入）だけであり、`app_tenant` には
//    `GRANT SELECT` しか無い（migration 20260906000000）。
//
// 🔴 `sortKey` は「匿名候補のスキル並びの決定的なタイブレーク」（docs/05 §3.4）。
//    配列の並び順をそのまま採番するので、**行を途中に挿し込まず末尾に足す**こと
//    （挿し込むと既存の匿名候補の表示順が理由なく変わる）。
import type { PrismaClient } from '@prisma/client';
import { seedUuid } from '../support.js';

/** 🔴 `skills` は tenant_id を持たない。ID 空間を他プリセットと分けるための固定コード。 */
const SKILL_PRESET_CODE = '5c11';
const SKILL_ENTITY = 0xe0;

export type GlobalSkillSeed = {
  readonly name: string;
  readonly category: string;
};

/**
 * 初期辞書（Phase 1 の最小セット）。
 * 🔴 表記ゆれ（`Java8` / `JavaSE`）はここに置かない。それは `SkillAlias` の仕事であり、
 *    辞書に別名を並べると「同じスキルが 2 件ある」状態になって母集団が割れる（`F-010` の目的）。
 */
export const GLOBAL_SKILLS: readonly GlobalSkillSeed[] = [
  { name: 'Java', category: 'LANGUAGE' },
  { name: 'JavaScript', category: 'LANGUAGE' },
  { name: 'TypeScript', category: 'LANGUAGE' },
  { name: 'Python', category: 'LANGUAGE' },
  { name: 'Go', category: 'LANGUAGE' },
  { name: 'Ruby', category: 'LANGUAGE' },
  { name: 'PHP', category: 'LANGUAGE' },
  { name: 'C#', category: 'LANGUAGE' },
  { name: 'C++', category: 'LANGUAGE' },
  { name: 'Swift', category: 'LANGUAGE' },
  { name: 'Kotlin', category: 'LANGUAGE' },
  { name: 'SQL', category: 'LANGUAGE' },
  { name: 'Spring Boot', category: 'FRAMEWORK' },
  { name: 'React', category: 'FRAMEWORK' },
  { name: 'Vue.js', category: 'FRAMEWORK' },
  { name: 'Next.js', category: 'FRAMEWORK' },
  { name: 'Django', category: 'FRAMEWORK' },
  { name: 'Ruby on Rails', category: 'FRAMEWORK' },
  { name: '.NET', category: 'FRAMEWORK' },
  { name: 'PostgreSQL', category: 'DATABASE' },
  { name: 'MySQL', category: 'DATABASE' },
  { name: 'Oracle Database', category: 'DATABASE' },
  { name: 'SQL Server', category: 'DATABASE' },
  { name: 'MongoDB', category: 'DATABASE' },
  { name: 'AWS', category: 'CLOUD' },
  { name: 'Microsoft Azure', category: 'CLOUD' },
  { name: 'Google Cloud', category: 'CLOUD' },
  { name: 'Docker', category: 'INFRA' },
  { name: 'Kubernetes', category: 'INFRA' },
  { name: 'Terraform', category: 'INFRA' },
  { name: 'Linux', category: 'INFRA' },
  { name: 'Git', category: 'TOOL' },
  { name: 'Jenkins', category: 'TOOL' },
  { name: 'GitHub Actions', category: 'TOOL' },
  { name: 'プロジェクトマネジメント', category: 'PROCESS' },
  { name: '要件定義', category: 'PROCESS' },
  { name: '基本設計', category: 'PROCESS' },
  { name: 'テスト設計', category: 'PROCESS' },
  { name: '運用保守', category: 'PROCESS' },
];

/** 決定的な ID（`seedUuid` と同じ形。再実行で同じ ID になる）。 */
export function globalSkillId(index: number): string {
  return seedUuid({
    presetCode: SKILL_PRESET_CODE,
    // 🔴 tenantIndex = 0 ＝「どのテナントにも属さない」ことを ID の形でも示す
    //    （`ISOLATION_SEED_PLATFORM_USERS` と同じ規約）。
    tenantIndex: 0,
    entityCode: SKILL_ENTITY,
    seq: index + 1,
  });
}

/** 名前から ID を引く（テスト・後続プリセットが参照するため）。 */
export const GLOBAL_SKILL_IDS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(GLOBAL_SKILLS.map((skill, index) => [skill.name, globalSkillId(index)])),
);

/**
 * 🔴 冪等に投入する（`upsert`）。`reset()` の射程外なので、削除 → 投入の 2 段階が使えない。
 *    `sortKey` は配列の並び（＝ ID の連番）と一致させる。
 */
export async function seedGlobalSkills(db: PrismaClient): Promise<void> {
  for (const [index, skill] of GLOBAL_SKILLS.entries()) {
    const values = { name: skill.name, category: skill.category, sortKey: index + 1 };
    await db.skill.upsert({
      where: { id: globalSkillId(index) },
      create: { id: globalSkillId(index), ...values },
      update: values,
    });
  }
}
