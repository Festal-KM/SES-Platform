// tests/static/career-not-anonymous.test.ts
// 🔴 T-09-12（docs/05 §17.2 #28。Issue #35 = A）: **経験内容（`EngineerCareer`）が匿名候補の経路に
//    「型として」現れない**（`F-008 AC-7` / `F-017 AC-1` / `BR-55` / `docs/04` 申し送り 17-③）。
//
// 🔴 フィルタの有無ではなく**型と参照**を検査するのが要点である。フィルタは書き忘れるが、型に無いものは
//    書けない。`AnonymizeEngineerInput` は `city` のような「受け取って落とす」形にすらしない —— 受け取る形が
//    あれば、いつか出力に写す実装が紛れ込んでも型では落ちない。
//
// 5 本立て（docs/05 §17.2 #28）:
//   ① 匿名候補の 3 型（応答 / 丸め後 / 丸めの入力）が経歴のキーを持たない（型テスト）
//   ② AI ロールの入出力（`packages/ai/src/roles/**` / `prompts/roles/**`）に経歴の語が現れない
//      （`match-explainer` の `RoleSpec` は Phase 2 でここに生える。生えたときに `career` を含めば落ちる）
//   ③ `SharedCandidateDb` 型に `engineerCareer` デリゲートが無い（型テスト）
//   ④ `engineerCareer` デリゲートを参照するファイルの集合を、台帳の読み書きと凍結に限る（走査）
//   ⑤ 匿名候補・共有スコープ・エクスポートの区画（`apps/web/lib/anonymize/**` / `lib/candidates/**` /
//      `packages/db/src/shared-candidate.ts`）のソースに `career` が 1 文字も現れない（走査）
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SharedCandidateDb } from '@ses/db';
import type { AnonymousCandidateView } from '../../apps/web/lib/anonymize/candidate-view';
import type {
  AnonymizeEngineerInput,
  RoundedAnonymousAttributes,
} from '../../packages/domain/src/anonymize/rounding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/** コメントを落としたソース（設計意図を書いた行で落ちないようにする）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

function sourcesUnder(...roots: readonly string[]): string[] {
  return roots
    .flatMap((root) => listSourceFiles(path.join(repoRoot, root)))
    .filter((file) => !isTestFile(file));
}

/** 🔴 経歴を表すキー（型に 1 つも無いことを固定する）。 */
const CAREER_KEYS = ['careers', 'careerCount', 'hasCareers', 'careerSummary', 'latestRole'] as const;

describe('① 匿名候補の型は経歴のキーを持たない（F-008 AC-7 / BR-55）', () => {
  it('AnonymousCandidateView / RoundedAnonymousAttributes / AnonymizeEngineerInput のキー集合', () => {
    // 🔴 `not.toHaveProperty` は型レベルで評価される（値は要らない）。
    expectTypeOf<AnonymousCandidateView>().not.toHaveProperty('careers');
    expectTypeOf<AnonymousCandidateView>().not.toHaveProperty('careerCount');
    expectTypeOf<AnonymousCandidateView>().not.toHaveProperty('hasCareers');
    expectTypeOf<AnonymousCandidateView>().not.toHaveProperty('careerSummary');
    expectTypeOf<AnonymousCandidateView>().not.toHaveProperty('latestRole');
    expectTypeOf<RoundedAnonymousAttributes>().not.toHaveProperty('careers');
    expectTypeOf<RoundedAnonymousAttributes>().not.toHaveProperty('careerCount');
    expectTypeOf<RoundedAnonymousAttributes>().not.toHaveProperty('hasCareers');
    expectTypeOf<RoundedAnonymousAttributes>().not.toHaveProperty('careerSummary');
    expectTypeOf<RoundedAnonymousAttributes>().not.toHaveProperty('latestRole');
    // 🔴 入力側にも無い（「受け取って落とす」形にすらしない）。
    expectTypeOf<AnonymizeEngineerInput>().not.toHaveProperty('careers');
    expectTypeOf<AnonymizeEngineerInput>().not.toHaveProperty('careerCount');
    expectTypeOf<AnonymizeEngineerInput>().not.toHaveProperty('hasCareers');
    expectTypeOf<AnonymizeEngineerInput>().not.toHaveProperty('careerSummary');
    expectTypeOf<AnonymizeEngineerInput>().not.toHaveProperty('latestRole');
    expect(CAREER_KEYS.length).toBe(5); // 対照（上の列挙と同じ数を見ている）
  });

  it('対照: 匿名候補の応答型は 5 項目 + 参照子 + 更新日の 8 キーである', () => {
    expectTypeOf<keyof AnonymousCandidateView>().toEqualTypeOf<
      | 'candidateRef'
      | 'skills'
      | 'yearsBand'
      | 'priceBand'
      | 'availabilityBand'
      | 'prefecture'
      | 'remoteMode'
      | 'updatedOn'
    >();
  });
});

describe('② AI ロールの入出力に経歴が現れない（docs/05 §7.1「match-explainer の入力に経歴を渡さない」）', () => {
  /**
   * 🔴 `proposal-drafter`（Phase 2）は経歴を渡してよい唯一のロールである（docs/05 §7.1）。
   *    生えたときはここへ**ファイル名を明示して**足す。それ以外（特に `match-explainer`）が
   *    `career` を含めば落ちる。
   */
  const ALLOWED_CAREER_ROLE_FILES: readonly string[] = [];

  it('packages/ai/src/roles/** と prompts/roles/** に career を含むファイルが無い', () => {
    const offenders = sourcesUnder('packages/ai/src/roles', 'prompts/roles')
      .filter((file) => /career/i.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)
      .sort();
    expect(offenders).toEqual([...ALLOWED_CAREER_ROLE_FILES].sort());
  });
});

describe('③ SharedCandidateDb に engineerCareer デリゲートが無い（docs/05 §4.5）', () => {
  it('型に無い（実 DB 側の証明は tests/isolation/double-defense-matrix.test.ts #11 と shared-candidate-scope.test.ts）', () => {
    expectTypeOf<SharedCandidateDb>().not.toHaveProperty('engineerCareer');
    expectTypeOf<SharedCandidateDb>().not.toHaveProperty('engineerCareers');
    // 対照: 用途ごとの専用メソッドだけを持つ（素の Prisma デリゲートを置かない。T-08-03）。
    expectTypeOf<SharedCandidateDb>().toHaveProperty('listSharedEngineers');
  });
});

describe('④ engineerCareer デリゲートを参照するファイルは台帳の読み書きと凍結に限る', () => {
  /**
   * 🔴 許可は 3 ファイル:
   *   - `apps/web/lib/engineers/careers.ts` … 台帳の読み書き（#16 / #17）
   *   - `packages/db/src/proposal-draft.ts` … 凍結（`freezeCareers`。値の複製）
   *   - `packages/db/src/platform.ts` … 運営者の読み取り可能モデルの列挙（列レベル GRANT と 1 対 1）
   * 匿名候補（`lib/anonymize` / `lib/candidates`）・共有スコープ（`shared-candidate.ts`）・
   * ワーカー（`apps/worker`）から参照されていたら FAIL。
   */
  const ALLOWED_DELEGATE_FILES = [
    'apps/web/lib/engineers/careers.ts',
    'packages/db/src/platform.ts',
    'packages/db/src/proposal-draft.ts',
    // 🔴 T-10-09: 返却データ（docs/05 §9.6 `export.generate`。`F-064 AC-5`）。**自社台帳の読み出し**（`withTenant` と同じ RLS C3 =
    //    ホスト文脈では自社所有の行だけ）であり、`engineer_careers.csv`（1 行 1 経歴）に写す。匿名候補の経路ではない
    //    （返却に匿名候補のファイルは存在しない。`packages/domain/src/export/closing-return.ts`）。
    'packages/db/src/data-export.ts',
  ];

  it('apps/** と packages/db/src/** の参照元が許可リストと一致する', () => {
    const referencing = sourcesUnder('apps', 'packages/db/src')
      .filter((file) => /\bengineerCareer\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)
      .sort();
    expect(referencing).toEqual([...ALLOWED_DELEGATE_FILES].sort());
  });
});

describe('⑤ 匿名候補・共有スコープの区画に career が 1 文字も現れない', () => {
  const ZONES = ['apps/web/lib/anonymize', 'apps/web/lib/candidates'];
  const FILES = ['packages/db/src/shared-candidate.ts'];

  it('ソース（コメントを除く）に career が無い', () => {
    const offenders = [
      ...sourcesUnder(...ZONES),
      ...FILES.map((file) => path.join(repoRoot, file)),
    ]
      .filter((file) => /career/i.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative);
    expect(offenders).toEqual([]);
  });

  it('対照: 区画のソースが存在する（走査が空振りしていない）', () => {
    expect(sourcesUnder(...ZONES).length).toBeGreaterThan(0);
  });
});
