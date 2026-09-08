// apps/web/lib/api/existence-contract.types.test.ts
// 🔴 **`docs/05` §4.8「見えない ＝ 存在しない」の API 契約を、SP-06 で追加した全ルートに
//    一括で当てる型テスト**（`docs/sprints/SP-06` T-06-09 の完了判定「型テストで禁止フィールドが
//    存在しないこと」/ `F-004 AC-4`）。対象は **#15 / #17 / #25 / #26 / #27 / #28** の応答型である。
//
// ============================================================================
// 🔴 なぜルートごとの型テストに加えて「横断」を 1 本置くのか
// ============================================================================
// 既存の `projects/detail-view.types.test.ts`（#27）/ `projects/list-view.types.test.ts`（#25）は
// **その型に置いてはならない具体的なフィールド**を 1 つずつ否定する。よく効くが、
//   ①**ルートが増えたときに、そのルートの作者が同じ否定を書き写さなければ穴が開く**
//   ②**名前の集合**（「他に N 件」「あなたは N 番目」に相当する語彙）が 1 箇所にまとまらない
// という 2 つの弱点がある。本ファイルはその 2 点だけを埋める:
//   - 禁止する**名前の集合**を `ExistenceHintKey` / `PartnerForbiddenKey` の 2 つに集約する
//   - スプリントの応答型を `SprintResponseType` の 1 つの表に集め、**表 × 名前の全組み合わせ**を
//     1 つの表明で検査する（ルートを足したら表に 1 行足すだけで全名前が自動的に効く）
// 🔴 したがって本ファイルは既存 2 本の**置き換えではない**。あちらは「この型のこのフィールド」を、
//    こちらは「全ルート × 禁止語彙」を見る（片方だけにしない）。
//
// 🔴 実行時（実 DB + RLS）の固定は `tests/isolation/projects.test.ts` /
//    `tests/isolation/project-population-c4.test.ts` / `tests/isolation/engineers.test.ts` が、
//    ブラウザ経由の固定は `tests/e2e/isolation.spec.ts`（§17.3 #2）が担う。
//    **型は SQL を見ないし、結合テストは「将来足される枝」を見ない。3 枚そろえる。**
//
// 🔴 本ファイルは `import type` だけを使う（`service.ts` / `list.ts` の実行時依存〔`@ses/db`〕を
//    引き込まない。`detail-view.types.test.ts` と同じ規約）。
import { describe, expectTypeOf, it } from 'vitest';
import type * as engineerList from '../engineers/list';
import type * as engineerService from '../engineers/service';
import type * as projectList from '../projects/list';
import type * as projectService from '../projects/service';
import type * as projectVisibility from '../projects/visibility';
// 🔴 T-07-08: SP-07 で足した #39 / #40（`docs/05` §6.5）。表に足すだけで全名前が自動的に効く。
import type * as proposalGate from '../proposals/gate';

// ============================================================================
// 禁止する「名前」の集合
// ============================================================================

/**
 * 🔴 **どの応答型にも置いてはならない名前**（`docs/05` §4.8 の最終行
 * 「『他にも提案があります』『あなたは N 番目』—— そういうフィールドを型に持たない」）。
 *
 * 🔴 いずれも「**境界の外に何かがある**」ことを 1 ビットでも伝える形である:
 *   - 件数系（`hiddenCount` / `otherCount` / `remainingCount` / `totalCount` …）
 *     … 母集団の外を数えた値。`total`（境界適用後の `COUNT`）とは別物である。
 *   - 順位系（`rank` / `position` / `pageNumber` / `totalPages` / `pageCount`）
 *     … 「全 N ページ中 M ページ目」は境界外の行を含む全体件数を前提にした概念であり、
 *       §4.8 の「順位」に当たる（`apps/web/lib/projects/list-props.ts` も同じ理由でページ番号を出さない）。
 * ⚠️ **現時点でこれらの名前を持つ応答型は 1 つも無い。** それが本テストの期待値であり、
 *    価値は「将来この名前のフィールドを足した瞬間に落ちる」ことにある（規約を型で固定する）。
 */
type ExistenceHintKey =
  | 'hiddenCount'
  | 'otherCount'
  | 'othersCount'
  | 'remainingCount'
  | 'restrictedCount'
  | 'outOfScopeCount'
  | 'totalCount'
  | 'overallTotal'
  | 'globalTotal'
  | 'rank'
  | 'position'
  | 'pageNumber'
  | 'pageCount'
  | 'totalPages';

/**
 * 🔴 **取引先が到達しうる応答型に置いてはならない名前**。
 *   - 商流情報（`F-013 AC-2`）… `endClientName` / `internalUnitPrice`
 *   - 他社の存在（`F-014 AC-4` / `BR-07`）… `visibilities` / `visibleToCount` /
 *     `visibleToPartnerCompanyIds` / `otherPartnerCount`
 * 🔴 `visibleToCount` は**ホストの型には存在してよい**（`docs/04` §S-010 の 9 列目 =
 *    「まだどの取引先にも公開されていない」に気づかせる列。`F-014 AC-2`）。したがって
 *    `ExistenceHintKey` ではなくこちらに置く —— **禁止は「名前」ではなく「誰に返すか」で決まる**。
 */
type PartnerForbiddenKey =
  | 'endClientName'
  | 'internalUnitPrice'
  | 'visibilities'
  | 'visibleToCount'
  | 'visibleToPartnerCompanyIds'
  | 'otherPartnerCount';

// ============================================================================
// 検出の道具（🔴 `?: never` を「持っていない」と数える）
// ============================================================================

/**
 * `T` が `K` という名前で**値を運べる**か。
 *
 * 🔴 `?: never`（`PartnerProjectView.visibleToCount` 等）は `false` になる —— 宣言はあるが
 *    `undefined` 以外を代入できず、`JSON` にも現れないためである。むしろこの宣言は
 *    「値を入れた実装がコンパイルで落ちる」ための積極的な防御であり、**持っている扱いにしない**。
 */
type CarriesValue<T, K extends string> = K extends keyof T
  ? [Exclude<T[K], undefined>] extends [never]
    ? false
    : true
  : false;

/** `Keys` のうち `T` が実際に値を運べるものだけ（無ければ `never`）。 */
type CarriedKeys<T, Keys extends string> = {
  [K in Keys]: CarriesValue<T, K> extends true ? K : never;
}[Keys];

/**
 * `Types` の各エントリを `Keys` で検査し、**1 つでも運べる型があればその見出しを返す**。
 * 🔴 落ちたときに「どのルートが」まで分かる形にする（分離の失敗は原因追跡が最重要。
 *    `tests/e2e/support/assertions.ts` の `expectNoMarkers` と同じ思想）。
 */
type RoutesCarrying<Types, Keys extends string> = {
  [Route in keyof Types]: [CarriedKeys<Types[Route], Keys>] extends [never] ? never : Route;
}[keyof Types];

// ============================================================================
// SP-06 で追加した全ルートの応答型（🔴 ルートを足したらここに 1 行足す）
// ============================================================================

/**
 * 🔴 **`docs/05` §6.4 の番号を見出しにする**（表と 1 対 1。番号で引ける形にしておく）。
 *    一覧は「封筒（`{ items, total, nextCursor }`）」と「1 件」の両方を載せる ——
 *    禁止フィールドはどちらの層にも置けるためである。
 */
type SprintResponseType = {
  '#15 GET /api/engineers': engineerList.EngineerListView;
  '#15 GET /api/engineers（items の 1 件）': engineerList.OwnEngineerView;
  '#17 GET /api/engineers/{id}': engineerService.EngineerDetailView;
  '#25 GET /api/projects': projectList.ProjectListView;
  '#25 GET /api/projects（items の 1 件・ホスト）': projectList.HostProjectView;
  '#25 GET /api/projects（items の 1 件・取引先）': projectList.PartnerProjectView;
  '#26 POST /api/projects': Awaited<ReturnType<typeof projectService.createProject>>;
  '#26 PATCH /api/projects/{id}': Awaited<ReturnType<typeof projectService.updateProject>>;
  '#27 GET /api/projects/{id}（ホスト）': projectService.HostProjectDetailView;
  '#27 GET /api/projects/{id}（取引先）': projectService.PartnerProjectDetailView;
  '#28 PUT /api/projects/{id}/visibility': projectVisibility.ProjectVisibilityUpdateView;
  // 🔴 T-07-08（`docs/05` §6.5）。#40 は**取引先も到達する**（自社が当事者の提案のゲート結果）。
  '#39 POST /api/proposals/{id}/gate': proposalGate.ProposalGateRequestView;
  '#40 GET /api/proposals/{id}/gate': Awaited<
    ReturnType<typeof proposalGate.readProposalGateResult>
  >;
};

/**
 * 🔴 **取引先が到達しうる応答型**（`PartnerForbiddenKey` を当てる対象）。
 *
 * 🔴 #26 / #28 はホスト専用（`PROJECT_EDITOR_ROLES` + `requireHost`）なのでここに無い。
 *    #15 / #17 は所属で母集団が変わるだけで**取引先も到達する**ため対象に含める
 *    （`apps/web/app/api/(main)/engineers/route.ts` の `guards: []`）。
 * 🔴 一覧の封筒（`ProjectListView` / `EngineerListView`）も含める —— 封筒に
 *    `visibleToCount` を足す形の漏れ方があるため。
 */
type PartnerReachableResponseType = Pick<
  SprintResponseType,
  | '#15 GET /api/engineers'
  | '#15 GET /api/engineers（items の 1 件）'
  | '#17 GET /api/engineers/{id}'
  | '#25 GET /api/projects'
  | '#25 GET /api/projects（items の 1 件・取引先）'
  | '#27 GET /api/projects/{id}（取引先）'
  // 🔴 T-07-08: 取引先は**自社が作った提案**のゲート結果に到達する（`review_gates` は C5）。
  //    指摘の抜粋（`excerpt`）は伏せ字であり原文を含まない（`docs/05` §11.9 ③）。
  | '#39 POST /api/proposals/{id}/gate'
  | '#40 GET /api/proposals/{id}/gate'
>;

describe('🔴 docs/05 §4.8: 「他にも N 件」「あなたは N 番目」に相当するフィールドを型に持たない', () => {
  it('SP-06 / SP-07 の全ルート（#15 / #17 / #25〜#28 / #39 / #40）の応答型が、件数・順位の示唆を 1 つも運べない', () => {
    expectTypeOf<RoutesCarrying<SprintResponseType, ExistenceHintKey>>().toEqualTypeOf<never>();
  });

  it('🔴 取引先が到達する応答型が、商流情報と他社の存在を 1 つも運べない（F-013 AC-2 / F-014 AC-4）', () => {
    expectTypeOf<
      RoutesCarrying<PartnerReachableResponseType, PartnerForbiddenKey>
    >().toEqualTypeOf<never>();
  });

  it('対照: ホストの型は `visibleToCount` / 商流情報を運べる（禁止が「名前」ではなく「誰に返すか」で決まる）', () => {
    // 🔴 この対照が無いと、上の 2 本は「そもそも検出できていない」場合にも green になる。
    expectTypeOf<CarriesValue<projectList.HostProjectView, 'visibleToCount'>>().toEqualTypeOf<true>();
    expectTypeOf<
      CarriesValue<projectService.HostProjectDetailView, 'endClientName'>
    >().toEqualTypeOf<true>();
    expectTypeOf<
      CarriesValue<projectService.HostProjectDetailView, 'visibilities'>
    >().toEqualTypeOf<true>();
  });

  it('対照: `?: never` の宣言は「運べない」と数える（取引先向けの型の防御を無効化しない）', () => {
    expectTypeOf<
      CarriesValue<projectList.PartnerProjectView, 'visibleToCount'>
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CarriesValue<projectService.PartnerProjectDetailView, 'endClientName'>
    >().toEqualTypeOf<false>();
  });

  it('対照: 検出ロジックが実際に禁止フィールドを見つける（見出しつきで返る）', () => {
    type Offender = { readonly items: readonly string[]; readonly rank: number };
    type Sample = { '#99 GET /api/sample': Offender; '#98 GET /api/clean': { readonly id: string } };
    expectTypeOf<CarriedKeys<Offender, ExistenceHintKey>>().toEqualTypeOf<'rank'>();
    expectTypeOf<RoutesCarrying<Sample, ExistenceHintKey>>().toEqualTypeOf<'#99 GET /api/sample'>();
  });
});

describe('🔴 docs/05 §4.8: 一覧の封筒は `items` / `total` / `nextCursor` だけである', () => {
  /**
   * 🔴 `total` は**一覧と同じ `where` の `COUNT`**（実装側の担保は `list.ts` が `where` を
   *    1 つの値から `findMany` と `count` の両方へ渡すこと。実行時の固定は
   *    `tests/isolation/projects.test.ts` / `engineers.test.ts`）。型側では
   *    **「他に何も付いていない」**ことだけを言う（`nextCursor` は起点であって残件数ではない）。
   * ⚠️ `#25` の同じ表明は `projects/list-view.types.test.ts` にもある（意図的に重ねてある。
   *    あちらはルートの型定義の隣で、こちらは全一覧をそろえて見るため）。
   */
  it('#15 GET /api/engineers（T-05-09 以降、型テストが無かった側）', () => {
    expectTypeOf<engineerList.EngineerListView>().toEqualTypeOf<{
      readonly items: readonly engineerList.OwnEngineerView[];
      readonly total: number;
      readonly nextCursor: string | null;
    }>();
  });

  it('#25 GET /api/projects', () => {
    expectTypeOf<projectList.ProjectListView>().toEqualTypeOf<{
      readonly items: readonly projectList.ProjectView[];
      readonly total: number;
      readonly nextCursor: string | null;
    }>();
  });
});

describe('🔴 docs/05 §4.8: 書き込み系（#26 / #28）の応答も「境界の外」を語らない', () => {
  it('#26 の応答は採番された `id` だけである（作成・更新とも）', () => {
    // 🔴 「作成後の全項目」を返すと、商流情報を含む型がもう 1 つ増える（`ProjectEditView` は
    //    ホスト専用であり、応答型として流用すると射影の担保が 2 本になる。`service.ts` の注記）。
    expectTypeOf<
      Awaited<ReturnType<typeof projectService.createProject>>
    >().toEqualTypeOf<{ readonly id: string }>();
    expectTypeOf<
      Awaited<ReturnType<typeof projectService.updateProject>>
    >().toEqualTypeOf<{ readonly id: string }>();
  });

  it('🔴 #28 の応答は `reviewGateId` / `verdict` だけで、公開先の件数を返さない', () => {
    // 🔴 「N 社に公開しました」を応答に持たせない —— 公開はゲート通過後に成立するため
    //    件数が事実と食い違ううえ（`publish-gate.ts`）、`S-013` はホスト専用なので
    //    §4.8 の観点では無害に見えるが、**応答型は監査ログ・通知の材料にもなる**。
    expectTypeOf<projectVisibility.ProjectVisibilityUpdateView>().toEqualTypeOf<{
      readonly reviewGateId: string | null;
      readonly verdict: projectVisibility.ProjectVisibilityVerdict;
    }>();
    expectTypeOf<projectVisibility.ProjectVisibilityVerdict>().toEqualTypeOf<
      'PENDING_GATE' | 'NO_PUBLISH_REQUESTED'
    >();
  });
});
