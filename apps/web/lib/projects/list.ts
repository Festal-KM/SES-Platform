// apps/web/lib/projects/list.ts
// 案件の検索と一覧（docs/05 §6.4 #25 `GET /api/projects`。`F-015` / `S-010`）。T-06-03。
//
// 🔴 **検索条件の評価と既定の並びは `@ses/db` の `search/projects.ts` に移した**
//    （SP-06 T-06-05 / docs/05 TBD-8）。本ファイルに残るのは
//    「一覧が読む列 / `COUNT` / カーソルページング / 応答型の組み立て（射影）」だけである
//    —— `docs/03` §3.7.3 の代替（段階 1〜4）で差し替わるのは前者だけであり、
//    後者（射影の判断 = `F-013 AC-2`）を `packages/db` へ移すと**議論の置き場所が 2 つになる**。
//
// ============================================================================
// 🔴 母集団はアプリが決めない（`F-015 AC-1` / `F-014 AC-1` / `CLAUDE.md` §3.1）
// ============================================================================
// `projects` の RLS は **C4 VISIBILITY**（docs/05 §4.4 / migration 20260903050000）であり、
//   - ホスト文脈:     `tenant_id = app_tenant_id()` の全件
//   - パートナー文脈: **自社宛の `project_visibilities` の行が生きている案件だけ**
//                     （`partner_company_id = app_partner_id() AND revoked_at IS NULL`）
// が見える。したがって本ファイルの `where` に **`tenantId` / `partnerCompanyId` /
// `visibilities` の条件を 1 つも書かない**。書けば「越境の判断がアプリの条件式に移った」ことに
// なり（`CLAUDE.md` §3.1「アプリの `if` に越境の判断を書かない」）、条件式を消した瞬間に
// 他社にだけ公開された案件が一覧に出る。ここに書いてよいのは**業務上の絞り込み**だけである
// （`listEngineers` と同じ規律）。
//
// 🔴 **`total` は一覧と同じ `where` の `COUNT` である**（docs/05 §4.8 / `F-015 AC-1`
//    「総件数の表示も同じ母集団から算出される」）。本ファイルは `where` を 1 つの値に束ね、
//    `findMany` と `count` の両方に**同じ変数**を渡す —— 書き分けようがない形にしてある。
//
// 🔴 **監査ログを書かない。** `BR-27` / `F-013 AC-3` の記録対象は「案件**詳細**の閲覧」であり、
//    docs/04 §S-010 の「操作と結果」も記録を**行クリック（→ `S-011`）**に置いている
//    （docs/05 §16.1 の `project.view` のフック箇所も `#27` と `S-012` の編集フォームである）。
//    一覧の描画ごとに 50 行を記録すると `S-041` が台帳を開いた記録で埋まる（`listEngineers` の
//    冒頭に書いた理由と同一）。
//
// ============================================================================
// 🔴 応答の型をロールで分ける（docs/05 §6.4 #25 / §4.8 / `F-014 AC-4` / `BR-07`）
// ============================================================================
// 共通SELECTは内部単価を含まない。2026-10-26の人間指示で仕入単価を追加したが、
// 内部単価と公開先の設定状況の問い合わせはホストの枝だけで発行する。
// `PartnerProjectView` は `visibleToCount` を `?: never` で持ち、値を入れた実装はコンパイルで
// 落ちる（`PartnerProjectDetailView` と同じ手法）。
import {
  PROJECT_LIST_ORDER_BY,
  projectSearchWhere,
  resolveStartWindow,
  withTenant,
  type AuthenticatedTenantCtx,
  type ProjectStatus,
  type RemoteMode,
  type ProjectVisibilityRevokeReason,
  type RequirementKind,
} from '@ses/db';
import {
  // 🔴 T-12-10: 一覧の 3 値（`docs/04` §S-010）。詳細（`#27`）と**同じ規則**を通す。
  projectPublishListStatus,
  type PrefectureCode,
  type ProjectPublishListStatus,
} from '@ses/domain';
import { buildCursorPage, takeForCursorPage } from '../api/pagination';
import { toJstIsoDay } from '../format/datetime';
import { decimalToNumber, toDateOnlyString } from '../format/db-values';
import type { ProjectListQuery } from './schemas';

/**
 * 一覧に出す必須要件の件数（`docs/04` §S-010「必須要件の要約」/ §11 の省略方針で
 * 「切り詰める列」に挙げられている）。超過は `+N` で示す（`S-005` の主要スキルと同じ形）。
 */
export const MUST_REQUIREMENT_SUMMARY_LIMIT = 3;

/**
 * 🔴 要約に出すのは**必須要件だけ**である（`docs/04` §S-010 の列名が「必須要件の要約」）。
 *    尚可要件を混ぜると、`F-013 AC-1` で切り分けた区分が一覧の上で溶ける。
 */
const MUST_KIND: RequirementKind = 'MUST';

/** 一覧に出す必須要件 1 件（表示の組み立ては `list-rows.ts` が行う）。 */
export type ProjectMustRequirementView = {
  /** 辞書名（`skillId` が `null` のときは `null`）。 */
  readonly skillName: string | null;
  readonly freeText: string | null;
  readonly requiredYears: number | null;
};

/**
 * ホスト・取引先の双方に出す項目（`docs/04` §S-010 の結果テーブル 8 列）。
 *
 * 商流情報は共通項目に含めない。仕入単価はHostProjectViewだけに置く。
 */
type ProjectListShared = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly headcount: number;
  /** `YYYY-MM-DD` または `null`。 */
  readonly startDate: string | null;
  /** 🔴 **外部公開用**の単価レンジ（内部限定の `internalUnitPrice` とは別の列。docs/05 §3.5）。 */
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly prefecture: PrefectureCode | null;
  readonly remoteMode: RemoteMode | null;
  /** 必須要件の要約（最大 `MUST_REQUIREMENT_SUMMARY_LIMIT` 件）。 */
  readonly mustRequirements: readonly ProjectMustRequirementView[];
  /** 🔴 要約に載らなかった必須要件の件数（`docs/04` §11 の `+N`）。0 なら表示しない。 */
  readonly moreMustRequirementCount: number;
  /**
   * 🔴 **JST の暦日に丸めた更新日**（`docs/04` §S-010 の「更新日」列）。
   *    生の `updated_at`（時刻つき）を返さない理由と丸めの基準は `OwnEngineerView.updatedOn` と同じ。
   */
  readonly updatedOn: string;
};

/**
 * ホスト向けの 1 件（`docs/04` §S-010 の 8 列 + ホストのみの 9 列目）。
 *
 * 🔴 `visibleToCount` は **`docs/04` §S-010「ホストのみ 9 列目に公開先の設定状況
 *    （`未設定` / `N 社に公開中`）」**である。0 は「まだどの取引先にも公開されていない」
 *    （`F-014 AC-2` の既定）を意味し、**登録しただけでは誰にも届かないことに気づかせる**唯一の列。
 */
export type HostProjectView = ProjectListShared & {
  readonly audience: 'HOST';
  /** 仕入単価。ホストの分岐でのみ取得し、取引先には返さない。 */
  readonly internalUnitPrice: number | null;
  /** 現在公開中の取引先の社数（解除済みは数えない）。 */
  readonly visibleToCount: number;
  /**
   * 🔴 T-12-10: 公開状況の 1 語（`docs/04` §S-010 の 3 値列。`F-014 AC-9`）。
   *
   * 🔴 **3 値目（`AUTO_REVOKED`）を足した理由**: 再検査の FAIL で自動解除された案件は公開先が
   *    0 社になるため、2 値のままだと `未設定`（一度も公開していない）と同じ表示になる。
   *    **同じ 0 社を一覧と詳細が別の言葉で説明すると、営業は「設定し忘れた」と読んで
   *    原因の欄に辿り着けない。**
   * 🔴 **保留は一覧で区別しない**（公開は維持されているので `PUBLISHED`）。したがって一覧は
   *    `project_publish_requests` も `review_gates` も読まない（`docs/04` §S-010）。
   * 🔴 **理由・原因の欄・指摘を一覧に出さない**（列は 1 語である。読むのは `S-011`）。
   */
  readonly publishStatus: ProjectPublishListStatus;
};

/**
 * 取引先向けの 1 件。
 *
 * 🔴 **公開先の社数・社名を型として持たない**（`F-014 AC-4` / `BR-07` / `docs/04` §S-010
 *    「🔴 取引先にはこの列を出さない」）。`?: never` を置くのは、うっかり値を入れた実装が
 *    **コンパイルで落ちる**ようにするためである（`PartnerProjectDetailView` と同じ手法）。
 * 🔴 商流情報の 2 フィールドも同じ扱いにしておく —— 一覧の型にはそもそも無いが、
 *    「取引先の応答型に足せない」ことを型テストで数えられる形に揃える。
 */
export type PartnerProjectView = ProjectListShared & {
  readonly audience: 'PARTNER';
  readonly endClientName?: never;
  readonly internalUnitPrice?: never;
  readonly visibleToCount?: never;
  /**
   * 🔴 T-12-10（`F-014 AC-10`）: **公開状況を取引先の型として持たない。** 自動解除の事実が
   *    一覧の列・件数・並び順のいずれからも読めない（はじめから非公開の案件と区別がつかない）。
   */
  readonly publishStatus?: never;
};

/** `#25` の 1 件（🔴 判別子は `audience`。`#27` と同じ規約）。 */
export type ProjectView = HostProjectView | PartnerProjectView;

/**
 * `GET /api/projects`（#25）の応答。
 *
 * 🔴 `total` は**同じ `where` の `COUNT`**（docs/05 §4.8 / `F-015 AC-1`）。
 * 🔴 `nextCursor` は「次ページの起点」だけであり、**残件数を返さない**
 *    （「他にも N 件あります」に相当するフィールドを型に持たない。docs/05 §4.8）。
 */
export type ProjectListView = {
  readonly items: readonly ProjectView[];
  readonly total: number;
  readonly nextCursor: string | null;
};

/**
 * 共通の取得列。内部単価は含めず、ホストの分岐でのみ追加取得する。
 */
const PROJECT_LIST_SELECT = {
  id: true,
  name: true,
  status: true,
  headcount: true,
  startDate: true,
  unitPriceMin: true,
  unitPriceMax: true,
  prefecture: true,
  remoteMode: true,
  updatedAt: true,
} as const;

/** 🔴 レビューが「増えていないこと」を数えられるように export する（`#27` と同じ）。 */
export const PROJECT_LIST_SELECT_KEYS = Object.keys(PROJECT_LIST_SELECT);

type ProjectListRow = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly headcount: number;
  readonly startDate: Date | null;
  readonly unitPriceMin: { toString(): string } | null;
  readonly unitPriceMax: { toString(): string } | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
  readonly updatedAt: Date;
};

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使うデリゲートだけ。 */
type ProjectListDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

type MustSummary = {
  readonly shown: readonly ProjectMustRequirementView[];
  readonly more: number;
};

/**
 * 🔴 T-12-10: 公開状況の材料（ホストの枝だけが読む）。
 *    判定そのものは `projectPublishListStatus`（`packages/domain`）が行い、**詳細（`#27` の
 *    `deriveProjectPublishState`）と同じ 1 つの規則**を通る。
 */
type VisibilitySummary = {
  readonly liveCount: number;
  readonly lastRevokedReason: ProjectVisibilityRevokeReason | null;
};

/**
 * 1 ページ分の案件の**必須要件**を 1 往復で読む（案件ごとに引くと N+1 になり、
 * `F-015 AC-2` の p95 1 秒を満たせない）。
 *
 * 🔴 ここにも境界条件を書かない。`project_requirements` にも同じ C4 が効く
 *    （migration 20260903050000 の `project_requirements_c4_select`）。
 * 🔴 並びは `readProjectRequirements`（`#27`）と**同じ規則**（`skillId` 昇順 → `id` 昇順）。
 *    詳細と一覧で「上から 3 件」が食い違わないようにするためである。
 */
async function readMustRequirementSummaries(
  db: ProjectListDb,
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, MustSummary>> {
  const result = new Map<string, MustSummary>();
  if (projectIds.length === 0) return result;

  const rows = await db.projectRequirement.findMany({
    where: { projectId: { in: [...projectIds] }, kind: MUST_KIND },
    select: {
      projectId: true,
      skillId: true,
      freeText: true,
      requiredYears: true,
      skill: { select: { name: true } },
    },
    orderBy: [{ projectId: 'asc' }, { skillId: 'asc' }, { id: 'asc' }],
  });

  const byProject = new Map<string, ProjectMustRequirementView[]>();
  for (const row of rows) {
    const entry: ProjectMustRequirementView = {
      skillName: row.skill === null ? null : row.skill.name,
      freeText: row.freeText,
      requiredYears: row.requiredYears === null ? null : Number(row.requiredYears.toString()),
    };
    const bucket = byProject.get(row.projectId);
    if (bucket === undefined) byProject.set(row.projectId, [entry]);
    else bucket.push(entry);
  }

  for (const [projectId, requirements] of byProject) {
    result.set(projectId, {
      shown: requirements.slice(0, MUST_REQUIREMENT_SUMMARY_LIMIT),
      more: Math.max(requirements.length - MUST_REQUIREMENT_SUMMARY_LIMIT, 0),
    });
  }
  return result;
}

/**
 * 1 ページ分の案件の**現在の公開先の社数**を 1 往復で読む（🔴 **ホストの枝だけが呼ぶ**）。
 *
 * 🔴 `revokedAt: null` に絞る。解除済みは「現在の公開先」ではない（`readProjectVisibilities`
 *    と同じ述語であり、RLS の C4 が `revoked_at IS NULL` を見るのと鏡写しである）。
 * 🔴 取引先の枝はこの関数を**呼ばない**。呼ばないので、取引先の経路では
 *    `project_visibilities` への問い合わせが 1 回も発行されない（「取得後に隠す」実装にしない。
 *    `F-014 AC-4`）。なお仮に呼んでも RLS の C5 が自社宛の 1 行しか通さないため、
 *    他社の存在は**二重に**届かない。
 */
async function readVisibilitySummaries(
  db: ProjectListDb,
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, VisibilitySummary>> {
  const result = new Map<string, VisibilitySummary>();
  if (projectIds.length === 0) return result;

  // 🔴 T-12-10: 1 本の問い合わせで**生存件数**と**最後に解除された行の理由**の両方を作る
  //    （`groupBy` を 2 本に増やさない。ページあたり定数本 = 行数に比例しない）。
  const rows = await db.projectVisibility.findMany({
    where: { projectId: { in: [...projectIds] } },
    select: { id: true, projectId: true, revokedAt: true, revokedReason: true },
  });

  const revokedLatest = new Map<string, { at: number; id: string; reason: string | null }>();
  for (const row of rows) {
    const current = result.get(row.projectId) ?? { liveCount: 0, lastRevokedReason: null };
    if (row.revokedAt === null) {
      result.set(row.projectId, { ...current, liveCount: current.liveCount + 1 });
      continue;
    }
    result.set(row.projectId, current);
    // 🔴 「最後に解除された行」は `revoked_at DESC → id DESC`（詳細〔`readProjectPublishState`〕と
    //    同じ決定的順序。docs/05 §4.8）。
    const latest = revokedLatest.get(row.projectId);
    const at = row.revokedAt.getTime();
    if (latest === undefined || at > latest.at || (at === latest.at && row.id > latest.id)) {
      revokedLatest.set(row.projectId, { at, id: row.id, reason: row.revokedReason });
    }
  }
  for (const [projectId, latest] of revokedLatest) {
    const current = result.get(projectId) ?? { liveCount: 0, lastRevokedReason: null };
    result.set(projectId, {
      ...current,
      lastRevokedReason: latest.reason as ProjectVisibilityRevokeReason | null,
    });
  }
  return result;
}

function toSharedView(row: ProjectListRow, summary: MustSummary | undefined): ProjectListShared {
  return {
    id: row.id,
    name: row.name,
    status: row.status as ProjectStatus,
    headcount: row.headcount,
    // 🔴 `start_date` は `@db.Date`（時刻を持たない）。UTC 切り出しが正確である（`toIsoDay` の JSDoc）。
    startDate: toDateOnlyString(row.startDate),
    unitPriceMin: decimalToNumber(row.unitPriceMin),
    unitPriceMax: decimalToNumber(row.unitPriceMax),
    prefecture: row.prefecture as PrefectureCode | null,
    remoteMode: row.remoteMode as RemoteMode | null,
    mustRequirements: summary?.shown ?? [],
    moreMustRequirementCount: summary?.more ?? 0,
    // 🔴 `updated_at` は `timestamptz`。**JST の暦日**に丸める（`toIsoDay` を使わない）。
    updatedOn: toJstIsoDay(row.updatedAt),
  };
}

/**
 * `GET /api/projects`（#25）と `S-010`（画面）が通る**唯一の経路**。T-06-03。
 *
 * 🔴 **画面と API が同じ関数を通る**（`listEngineers` / `readProjectDetail` と同じ方針）。
 *    2 本あると母集団・並び順・件数が画面と API でずれ、どちらが正か分からなくなる。
 * 🔴 **母集団は `projects` の RLS（C4）だけが決める**（本ファイル冒頭）。パートナーが API を
 *    直接叩いても、自社に公開されていない案件は `items` にも `total` にも現れない
 *    （`F-015 AC-1` / `F-014 AC-1`）。
 * 🔴 **並び順は決定的**（`PROJECT_LIST_ORDER_BY`。`F-015 AC-3`）。
 * 🔴 応答の型は `ctx.partnerCompanyId`（🔴 認証コンテキスト）だけで決まる。リクエスト入力は見ない。
 */
/**
 * ✅ 2026-10-16（CI の分離テスト `projects.test.ts`「開始時期の区分で絞れる」で発覚）: 開始時期の区分
 * （`startWithin`）を日付の範囲（`startFrom` / `startTo`）に直してから述語に渡す。
 * 🔴 これが無いと、区分を選んでも**絞り込みが黙って効かない**（`resolveStartWindow` がどこからも呼ばれていなかった）。
 * 🔴 「今日」は日本時間の日付で決める（`resolveStartWindow` は UTC の年月日として読むので、JST の日付を UTC の 0 時で渡す）。
 * 🔴 区分が指定されたときは区分が勝つ（旧 `startFrom` の URL は区分が無いときだけ効く）。
 */
export function withStartWindow(query: ProjectListQuery, now: Date): ProjectListQuery {
  if (query.startWithin === undefined) return query;
  const range = resolveStartWindow(query.startWithin, new Date(`${toJstIsoDay(now)}T00:00:00.000Z`));
  // 🔴 旧 `startFrom` は区分の範囲で上書きする（区分が無い範囲の端は `undefined` で消す）。
  return {
    ...query,
    startFrom: range.startFrom,
    ...(range.startTo === undefined ? {} : { startTo: range.startTo }),
  } as ProjectListQuery;
}

export async function listProjects(
  ctx: AuthenticatedTenantCtx,
  query: ProjectListQuery,
): Promise<ProjectListView> {
  // ============================================================================
  // ✅✅ **2026-10-16: 開始時期の区分 → 開始日の範囲は、ここで変換する**
  // ============================================================================
  // 🔴🔴 **当初は画面（`(list)/page.tsx`）だけで変換していた。CI の結合テストが捕まえた** ——
  //    `GET /api/projects?startWithin=IMMEDIATE` は**条件を受け取って黙って捨て**、
  //    絞り込まれていない一覧を返していた（`docs/05` §6.4「受け取って捨てるキーを置かない」）。
  //    画面は正しく動いていたので、**ユニットでも画面の実測でも見つからなかった。**
  // 🔴 **読み取りの経路はこの 1 本である**（API も画面もここを通る）。変換をここに置けば、
  //    呼び手が増えても落ちない。
  // 🔴 **現在時刻をこの 1 行でだけ読む** —— 一覧と `COUNT` が同じ `where` を使うので、
  //    日付の境目で件数と行がずれない（`resolveStartWindow` は純粋関数である）。
  // 🔴 `where` を 1 つの値にしておくのは、一覧と `COUNT` で書き分けられないようにするためである。
  //    🔴 述語の出所は `projectSearchWhere`（`@ses/db` の `search/projects.ts`）の 1 本だけである。
  const where = projectSearchWhere({ ...withStartWindow(query, new Date()), searchInternalRemarks: ctx.partnerCompanyId === null });
  const isHost = ctx.partnerCompanyId === null;

  return withTenant(ctx, async (db) => {
    const [rows, total] = await Promise.all([
      db.project.findMany({
        where,
        select: PROJECT_LIST_SELECT,
        orderBy: [...PROJECT_LIST_ORDER_BY],
        take: takeForCursorPage(query.limit),
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      }),
      // 🔴 `where` は上と同一の値である（docs/05 §4.8 / `F-015 AC-1`）。
      db.project.count({ where }),
    ]);

    const page = buildCursorPage<ProjectListRow>(rows, query.limit, (row) => row.id);
    const projectIds = page.items.map((row) => row.id);
    const summaries = await readMustRequirementSummaries(db, projectIds);

    if (!isHost) {
      return {
        items: page.items.map((row) => ({
          ...toSharedView(row, summaries.get(row.id)),
          audience: 'PARTNER' as const,
        })),
        total,
        nextCursor: page.nextCursor,
      };
    }

    const visibilitySummaries = await readVisibilitySummaries(db, projectIds);
    // 共通SELECTには内部単価を追加しない。取引先の分岐はこの取得前に返す。
    const purchaseRows = projectIds.length === 0
      ? []
      : await db.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, internalUnitPrice: true },
        });
    const purchasePrices = new Map(
      purchaseRows.map((row) => [row.id, decimalToNumber(row.internalUnitPrice)]),
    );
    return {
      items: page.items.map((row) => {
        const summary = visibilitySummaries.get(row.id);
        const liveVisibilityCount = summary?.liveCount ?? 0;
        return {
          ...toSharedView(row, summaries.get(row.id)),
          audience: 'HOST' as const,
          internalUnitPrice: purchasePrices.get(row.id) ?? null,
          visibleToCount: liveVisibilityCount,
          // 🔴 T-12-10: 判定は `packages/domain` の 1 関数（詳細と規則が食い違わない）。
          publishStatus: projectPublishListStatus({
            liveVisibilityCount,
            lastRevokedReason: summary?.lastRevokedReason ?? null,
          }),
        };
      }),
      total,
      nextCursor: page.nextCursor,
    };
  });
}
