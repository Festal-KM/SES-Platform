// apps/web/lib/projects/list.ts
// 案件の検索と一覧（docs/05 §6.4 #25 `GET /api/projects`。`F-015` / `S-010`）。T-06-03。
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
// 一覧に商流情報（エンド企業名・内部単価）の列は無いので、**両者の `select` は 1 本**である
// （`PROJECT_LIST_SELECT` に `endClientName` / `internalUnitPrice` という識別子が 1 度も
// 現れない ＝ SQL としても取得していない）。分かれるのは **公開先の設定状況**（`docs/04`
// §S-010「ホストのみ 9 列目」）であり、これは**ホストの枝でしか問い合わせを発行しない**。
// `PartnerProjectView` は `visibleToCount` を `?: never` で持ち、値を入れた実装はコンパイルで
// 落ちる（`PartnerProjectDetailView` と同じ手法）。
import {
  PROJECT_STATUSES,
  withTenant,
  type AuthenticatedTenantCtx,
  type ProjectStatus,
  type RemoteMode,
  type RequirementKind,
} from '@ses/db';
import type { PrefectureCode } from '@ses/domain';
import { buildCursorPage, takeForCursorPage } from '../api/pagination';
import { toJstIsoDay } from '../format/datetime';
import { decimalToNumber, toDateOnly, toDateOnlyString } from '../format/db-values';
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

/**
 * 🔴 **既定の並びの第 1 キー**（`docs/04` §S-010 状態バッジ「`後任募集` は `F-045` の還流で
 *    自動生成される。**既定の並びで上位に置く**（放置すると還流が無意味になる）」）。
 *
 * `CLAUDE.md` §1.3 の「⑥ → ① の還流がこのプロダクトの中核」を一覧の既定の見え方で担保する。
 * 🔴 実装は `ORDER BY status DESC` である（`PROJECT_LIST_ORDER_BY`）。`CASE` 式で優先度を
 *    書くには raw SQL が要り、「検索 SQL を `packages/db/src/search/**` の 1 箇所に閉じる」
 *    （SP-06 T-06-05 / docs/05 TBD-8）と衝突するためこの形を採った。
 * 🔴 したがって**値の綴りに順序が依存している**。依存を偶然のままにせず、本モジュールの
 *    読み込み時に「降順に並べた `PROJECT_STATUSES` がこの優先順位と一致すること」を検査する
 *    （`assertStatusPriority`）。状態を増やすと**その場で落ちる**ので、気づかないまま
 *    後任募集が沈むことはない。DB 側（照合順序）での実際の並びは
 *    `tests/isolation/projects.test.ts` が実データで固定する。
 */
export const PROJECT_STATUS_LIST_PRIORITY: readonly ProjectStatus[] = [
  'SUCCESSOR_WANTED',
  'OPEN',
  'FILLED',
];

/**
 * 🔴 既定の並び（`F-015 AC-3`「同一条件・同一データで並び順が常に同じ」/ docs/05 §4.8）。
 *
 *   ①`status` 降順   … 後任募集 → 募集中 → 充足（`docs/04` §S-010。上記）
 *   ②`updated_at` 降順 … `F-015` 処理③「更新日時」
 *   ③`start_date` 昇順（NULL 最後）… 同処理③「開始日」。同じ更新時刻の案件は開始日の近い順
 *   ④`id` 降順        … `uuid(7)` は時系列で単調増加するので、ここで順序が**一意**に決まる
 *
 * 🔴 **`ORDER BY` に「全体件数」「順位」を持ち込まない**（docs/05 §4.8）。境界外の行の有無で
 *    順位が動くと、並び順そのものが他社の存在を漏らす。①〜④はすべて**その行の列の値**だけで
 *    決まり、母集団の大きさに依存しない。
 * 🔴 スコア・重みの概念を持たない（`F-009 AC-2` と同じ Phase 1 の規律。スコアは `F-029`）。
 */
export const PROJECT_LIST_ORDER_BY = [
  { status: 'desc' },
  { updatedAt: 'desc' },
  { startDate: { sort: 'asc', nulls: 'last' } },
  { id: 'desc' },
] as const;

/**
 * 🔴 **`ORDER BY status DESC` が `PROJECT_STATUS_LIST_PRIORITY` を与えることの検査。**
 *
 * 🔴 照合するのは**値集合の出所（`PROJECT_STATUSES`）**であって、優先順位の配列自身ではない。
 *    自身と照合すると「この配列が綴りの降順に並んでいる」ことしか言えず、
 *    **`PROJECT_STATUSES` に状態が増えても落ちない**（優先順位の側が古いまま残り、
 *    新しい状態が `後任募集` より上に来ても気づけない）。
 * 🔴 読み込み時に落とす（`assertNoIsolationKeys` と同じ形）。テストだけに置くと、
 *    状態を足した変更が「テストを直せば通る」ものに見えてしまう。
 * 🔴 これで**値集合の増減と並び替えの両方**が起動時に検出される。
 * ⚠️ export しているのは、**検査そのものが実際に落ちること**をユニットテストで示すためである
 *    （`PROJECT_LIST_SELECT_KEYS` と同じ理由。「落ちるはず」を注釈だけで主張しない）。
 */
export function assertStatusPriority(priority: readonly ProjectStatus[]): void {
  // DB は `status` を値の綴りで並べる。その降順が優先順位そのものでなければならない。
  const byDescendingValue = [...PROJECT_STATUSES].sort().reverse();
  if (byDescendingValue.join(',') !== priority.join(',')) {
    throw new Error(
      '案件一覧の既定の並び（ORDER BY status DESC）が PROJECT_STATUS_LIST_PRIORITY と一致しません' +
        `（期待: ${byDescendingValue.join(',')} / 宣言: ${priority.join(',')}）。` +
        '状態を追加・改名したときは docs/04 §S-010 の「後任募集を上位に置く」を満たす手段を' +
        '選び直してください（CLAUDE.md §8.6 / §8.7）。',
    );
  }
}

assertStatusPriority(PROJECT_STATUS_LIST_PRIORITY);

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
 * 🔴 **商流情報のフィールドが 1 つも無い。** 一覧は取得の時点で 2 列を読んでいない
 *    （`PROJECT_LIST_SELECT`）ので、ホスト向けの型にも現れない —— 一覧で必要になったら
 *    まず `docs/04` §S-010 の列定義を変えることになる（`F-013 AC-2`）。
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
  /** 現在公開中の取引先の社数（解除済みは数えない）。 */
  readonly visibleToCount: number;
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
 * 🔴 **一覧が読む列の全部**（`docs/04` §S-010 の結果テーブルに出るものだけ）。
 *    `endClientName` / `internalUnitPrice` という識別子が本ファイルに 1 度も現れないことが
 *    `F-013 AC-2` の一覧側の担保である（`PARTNER_PROJECT_DETAIL_SELECT` と同じ考え方だが、
 *    一覧では**ホストの列も無い**ので `select` を 2 本に分ける必要がない）。
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
 * 🔴 **検索条件 → 述語の組み立て（`F-015` の入力）。これが一覧と `COUNT` の唯一の `where` である。**
 *
 * 🔴 ここに境界の条件を書かない（本ファイル冒頭）。返す述語はすべて**業務上の絞り込み**であり、
 *    条件が 1 つも指定されなければ `{}`（= 母集団そのもの）になる。
 * 🔴 **フリーワードは `packages/db/src/search/**` へ移す前提の seam である**（SP-06 T-06-05 /
 *    docs/05 TBD-8）。現状は Prisma の `contains`（`ILIKE '%…%'`）であり、
 *    ①`pg_trgm` の GIN を使わない ②`%` / `_` を含む入力がワイルドカードとして働く
 *    という 2 点の限界がある。**いずれも母集団の外へは出ない**（RLS が先に効く）ため
 *    情報境界の問題ではなく、T-06-05 が実装ごと差し替える。
 * 🔴 探索先は `name` と `public_summary` の 2 列だけである。**`end_client_name` を検索対象に
 *    しない** —— ホストだけが一致する検索を作ると、`where` がロールで分岐して
 *    「一覧と `COUNT` が同じ述語」という担保が崩れる（`F-013 AC-2` の趣旨にも反する）。
 */
export function projectListWhere(query: ProjectListQuery) {
  return {
    ...(query.status === undefined ? {} : { status: query.status }),
    // 🔴 `start_date` が未設定の案件は「開始日 X 以降」に一致しない（NULL は比較で偽）。
    //    絞り込みを掛けたときだけ落ちる挙動であり、既定（未指定）では全件が出る。
    ...(query.startFrom === undefined ? {} : { startDate: { gte: toDateOnly(query.startFrom) } }),
    ...(query.prefecture === undefined ? {} : { prefecture: query.prefecture }),
    ...(query.q === undefined
      ? {}
      : {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { publicSummary: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }),
  };
}

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
async function readVisibleToCounts(
  db: ProjectListDb,
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const result = new Map<string, number>();
  if (projectIds.length === 0) return result;

  const rows = await db.projectVisibility.groupBy({
    by: ['projectId'],
    where: { projectId: { in: [...projectIds] }, revokedAt: null },
    _count: { _all: true },
  });
  for (const row of rows) {
    result.set(row.projectId, row._count._all);
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
export async function listProjects(
  ctx: AuthenticatedTenantCtx,
  query: ProjectListQuery,
): Promise<ProjectListView> {
  // 🔴 `where` を 1 つの値にしておくのは、一覧と `COUNT` で書き分けられないようにするためである。
  const where = projectListWhere(query);
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

    const visibleToCounts = await readVisibleToCounts(db, projectIds);
    return {
      items: page.items.map((row) => ({
        ...toSharedView(row, summaries.get(row.id)),
        audience: 'HOST' as const,
        visibleToCount: visibleToCounts.get(row.id) ?? 0,
      })),
      total,
      nextCursor: page.nextCursor,
    };
  });
}
