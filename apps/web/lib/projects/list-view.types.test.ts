// apps/web/lib/projects/list-view.types.test.ts
// 🔴 `docs/sprints/SP-06` T-06-03 /  T-06-08 / T-06-09 の型側の担保 ——
//    **一覧の取引先向け応答型に、商流情報と「他社の存在」を示すフィールドが無い**
//    （`F-013 AC-2` / `F-014 AC-4` / `BR-07` / docs/05 §4.8）。
//
// 🔴 なぜ型で固定するのか（`detail-view.types.test.ts` と同じ理由）: `undefined` を返す実装は
//    `JSON.stringify` が落とすので手元では正しく見え、シリアライザを 1 つ変えた日に漏れる。
//    「フィールドが存在しない」を型で言い切っておけば、値を入れた実装は**コンパイルで落ちる**。
// 🔴 実行時の固定は `tests/isolation/projects.test.ts`（実 DB + RLS）が担う。片方だけにしない。
//
// 🔴 本ファイルは `import type` だけを使う（`list.ts` の実行時依存〔`@ses/db`〕を引き込まない）。
import { describe, expectTypeOf, it } from 'vitest';
import type { ProjectStatus, RemoteMode } from '@ses/db';
import type { PrefectureCode } from '@ses/domain';
import type {
  HostProjectView,
  PartnerProjectView,
  ProjectListView,
  ProjectMustRequirementView,
  ProjectView,
} from './list';

/** `docs/04` §S-010 の結果テーブル 8 列に相当する、両者に共通の項目。 */
type ExpectedShared = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly headcount: number;
  readonly startDate: string | null;
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly prefecture: PrefectureCode | null;
  readonly remoteMode: RemoteMode | null;
  readonly mustRequirements: readonly ProjectMustRequirementView[];
  readonly moreMustRequirementCount: number;
  readonly updatedOn: string;
};

const shared: ExpectedShared = {
  id: '01930000-0000-7000-8000-0000000000c1',
  name: '合成案件',
  status: 'OPEN',
  headcount: 1,
  startDate: '2026-10-01',
  unitPriceMin: 600_000,
  unitPriceMax: 800_000,
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  mustRequirements: [],
  moreMustRequirementCount: 0,
  updatedOn: '2026-09-05',
};

describe('🔴 F-014 AC-4 / BR-07: PartnerProjectView に他社の存在を示すフィールドが無い', () => {
  it('取引先向けの型は「共通 8 列 + audience」だけである', () => {
    expectTypeOf<PartnerProjectView>().toEqualTypeOf<
      ExpectedShared & {
        readonly audience: 'PARTNER';
        readonly endClientName?: never;
        readonly internalUnitPrice?: never;
        readonly visibleToCount?: never;
      }
    >();
  });

  it('🔴 公開先の社数を入れた実装はコンパイルできない', () => {
    const withVisibleToCount: PartnerProjectView = {
      ...shared,
      audience: 'PARTNER',
      // @ts-expect-error 🔴 「この案件は他に N 社に公開されています」を型に持たない（`F-014 AC-4`）。
      visibleToCount: 3,
    };
    const withEndClient: PartnerProjectView = {
      ...shared,
      audience: 'PARTNER',
      // @ts-expect-error 🔴 一覧の取引先向け応答にエンド企業名を入れられない（`F-013 AC-2`）。
      endClientName: '架空エンド株式会社',
    };
    const withInternalPrice: PartnerProjectView = {
      ...shared,
      audience: 'PARTNER',
      // @ts-expect-error 🔴 内部単価も同じ（同上）。
      internalUnitPrice: 900_000,
    };

    expectTypeOf(withVisibleToCount).toExtend<PartnerProjectView>();
    expectTypeOf(withEndClient).toExtend<PartnerProjectView>();
    expectTypeOf(withInternalPrice).toExtend<PartnerProjectView>();
  });

  it('🔴 判別子で絞り込むまで公開先の社数に到達できない（合併の使い方の固定）', () => {
    expectTypeOf<ProjectView>().toEqualTypeOf<HostProjectView | PartnerProjectView>();
    expectTypeOf<Extract<ProjectView, { audience: 'HOST' }>>().toEqualTypeOf<
      ExpectedShared & {
        readonly audience: 'HOST';
        readonly visibleToCount: number;
      }
    >();
  });

  it('🔴 一覧の応答は `items` / `total` / `nextCursor` だけである（docs/05 §4.8）', () => {
    // 「他にも N 件あります」「あなたは N 番目」に相当するフィールドを持たない。
    expectTypeOf<ProjectListView>().toEqualTypeOf<{
      readonly items: readonly ProjectView[];
      readonly total: number;
      readonly nextCursor: string | null;
    }>();
  });

  it('🔴 ホストの一覧にも商流情報のフィールドが無い（一覧では 2 列を取得しない）', () => {
    expectTypeOf<HostProjectView>().not.toHaveProperty('endClientName');
    expectTypeOf<HostProjectView>().not.toHaveProperty('internalUnitPrice');
  });
});
