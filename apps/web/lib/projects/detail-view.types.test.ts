// apps/web/lib/projects/detail-view.types.test.ts
// 🔴 `docs/sprints/SP-06` T-06-02 の完了判定の片方 ——「**型テスト**（`PartnerProjectDetailView` に
//    商流フィールドが無い）」。`F-013 AC-2` / `F-014 AC-4` / `BR-07` / docs/05 §4.8。
//
// 🔴 なぜ型で固定するのか: `undefined` を返す実装は**動くまで気づけない**（`JSON.stringify` が
//    落とすので手元では正しく見え、シリアライザを 1 つ変えた日に漏れる）。「フィールドが存在
//    しない」を型で言い切っておけば、うっかり値を入れた実装は**コンパイルで落ちる**
//    （docs/05 §6.4 #14 の `ProductionInvitationView.inviteUrl?: never` と同じ手法）。
// 🔴 実行時の固定は `tests/isolation/projects.test.ts`（実 DB + RLS）が担う。**片方だけにしない**
//    —— 型は SQL を見ないし、結合テストは「将来足される枝」を見ない。
//
// 🔴 本ファイルは `import type` だけを使う（`service.ts` の実行時依存〔`@ses/db`〕を引き込まない）。
import { describe, expectTypeOf, it } from 'vitest';
import type { ProjectStatus, RemoteMode, RequirementKind } from '@ses/db';
import type { PrefectureCode } from '@ses/domain';
import type {
  HostProjectDetailView,
  PartnerProjectDetailView,
  ProjectDetailView,
  ProjectRequirementView,
  ProjectVisibilityView,
} from './service';

/** `docs/04` §S-011 のセクション 1〜3 に相当する、両者に共通の項目。 */
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
  readonly publicSummary: string | null;
  readonly requirements: readonly ProjectRequirementView[];
};

describe('🔴 F-013 AC-2: PartnerProjectDetailView に商流情報のフィールドが存在しない', () => {
  it('取引先向けの型は「共通項目 + audience」だけである（商流情報も公開範囲も無い）', () => {
    expectTypeOf<PartnerProjectDetailView>().toEqualTypeOf<
      ExpectedShared & {
        readonly audience: 'PARTNER';
        readonly endClientName?: never;
        readonly internalUnitPrice?: never;
        readonly visibilities?: never;
        readonly visibleToCount?: never;
      }
    >();
  });

  it('🔴 `endClientName` / `internalUnitPrice` に値を入れた実装はコンパイルできない', () => {
    const shared: ExpectedShared = {
      id: '01930000-0000-7000-8000-0000000000a1',
      name: '合成案件',
      status: 'OPEN',
      headcount: 1,
      startDate: '2026-10-01',
      unitPriceMin: 600_000,
      unitPriceMax: 800_000,
      prefecture: '13',
      remoteMode: 'PARTIAL_REMOTE',
      publicSummary: '公開用の概要',
      requirements: [],
    };

    const withEndClient: PartnerProjectDetailView = {
      ...shared,
      audience: 'PARTNER',
      // @ts-expect-error 🔴 取引先の応答にエンド企業名を入れられない（`F-013 AC-2`）。
      endClientName: '架空エンド株式会社',
    };
    const withInternalPrice: PartnerProjectDetailView = {
      ...shared,
      audience: 'PARTNER',
      // @ts-expect-error 🔴 取引先の応答に内部単価を入れられない（同上）。
      internalUnitPrice: 900_000,
    };
    const withVisibilities: PartnerProjectDetailView = {
      ...shared,
      audience: 'PARTNER',
      // @ts-expect-error 🔴 取引先の応答に他社の存在（公開先）を入れられない（`F-014 AC-4` / `BR-07`）。
      visibilities: [],
    };
    const withVisibleToCount: PartnerProjectDetailView = {
      ...shared,
      audience: 'PARTNER',
      // @ts-expect-error 🔴 「他に N 社に公開されています」に相当する件数も型に無い（docs/05 §4.8）。
      visibleToCount: 3,
    };

    // 値を「使う」ことでコンパイラに型検査を強制する（未使用変数の除去で消えないように）。
    expectTypeOf(withEndClient).toExtend<PartnerProjectDetailView>();
    expectTypeOf(withInternalPrice).toExtend<PartnerProjectDetailView>();
    expectTypeOf(withVisibilities).toExtend<PartnerProjectDetailView>();
    expectTypeOf(withVisibleToCount).toExtend<PartnerProjectDetailView>();
  });

  it('🔴 判別子で絞り込むまで商流情報のプロパティに触れられない（合併の使い方の固定）', () => {
    expectTypeOf<ProjectDetailView>().toEqualTypeOf<
      HostProjectDetailView | PartnerProjectDetailView
    >();
    // 🔴 `audience` で絞り込んだ後だけ、ホストの 3 フィールドに到達できる。
    expectTypeOf<Extract<ProjectDetailView, { audience: 'HOST' }>>().toEqualTypeOf<
      ExpectedShared & {
        readonly audience: 'HOST';
        readonly endClientName: string | null;
        readonly internalUnitPrice: number | null;
        readonly visibilities: readonly ProjectVisibilityView[];
      }
    >();
  });

  it('🔴 公開先 1 件に含まれるのは会社名・ID・公開日だけ（提案数や他社の件数を持たない）', () => {
    expectTypeOf<ProjectVisibilityView>().toEqualTypeOf<{
      readonly partnerCompanyId: string;
      readonly partnerCompanyName: string;
      readonly publishedOn: string;
    }>();
  });

  it('要件は区分（`kind`）を 1 件ごとに持つ（`F-013 AC-1` の区分が view にも残る）', () => {
    expectTypeOf<ProjectRequirementView['kind']>().toEqualTypeOf<RequirementKind>();
  });
});
