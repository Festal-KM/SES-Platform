// apps/web/lib/engineers/list.ts
// エンジニア台帳の一覧・複合検索（docs/05 §6.4 #15 `GET /api/engineers`。`F-009` / `S-005`）。
// T-05-09（骨格）→ T-06-04（検索条件の評価と決定的順序）。
//
// 🔴 **検索条件の評価は `@ses/db` の `search/**` に閉じている**（SP-06 T-06-05 / docs/05 TBD-8）。
//    本ファイルが組み立てる述語は 1 つも無く、`engineerSearchPlan` の戻り値をそのまま使う。
//    🔴 **「適合で分割するかどうか」の判定も本ファイルには無い** —— `plan.buckets` を先頭から
//    読むだけである（判定が 2 本になると、述語と読み出しが静かにずれる。T-06-04 の申し送り 2）。
//    匿名候補（`AnonymousCandidateView`。越境経路 4）の混在は **SP-08** である
//    —— そのときも「2 本のクエリをアプリ層で決定的にマージする」（`docs/03` `program-design`
//    申し送り 18）形になるので、本ファイルの `readOrderedRows` がその足場になる
//    （合成のしかたは `packages/db/src/search/plan.ts` の「第 2 軸」）。
//
// ============================================================================
// 🔴 母集団はアプリが決めない（`F-004 AC-3` / `F-009 AC-3` / `CLAUDE.md` §3.1）
// ============================================================================
// `engineers` の RLS は C3 OWNER_SCOPED（docs/05 §4.4）であり、
//   - パートナー文脈: `owner_partner_company_id = app_partner_id()` の行だけ
//   - ホスト文脈:     `owner_partner_company_id IS NULL` の行だけ
// が見える。したがって **`where` に `tenantId` / `partnerCompanyId` / `ownerPartnerCompanyId` を
// 1 つも書かない**。書けば「境界の担保がアプリの条件式に移った」ことになり、条件式を消した
// 瞬間に他社のエンジニアが一覧に出る。ここに書いてよいのは業務上の絞り込みだけである
// （`listPartnerCompanies` と同じ規律）。
//
// 🔴 **`total` は一覧と**同じ `where`** の `COUNT` である**（docs/05 §4.8）。別の条件で数え直すと、
//    「一覧に出ていない行が件数には含まれる」= 境界外の存在を件数で漏らす経路になる。
//    本ファイルでは `where` を 1 つの定数から両方へ渡し、書き分けようがない形にしてある。
//
// 🔴 **監査ログを書かない。** `BR-27` / `F-008 AC-4` の記録対象は「エンジニア**詳細**の閲覧」で
//    あり、docs/04 §S-005 の「操作と結果」も記録を**行クリック（→ `S-006`）**に置いている
//    （docs/05 §16.1 の `engineer.view` のフック箇所も `#17` である）。一覧の描画ごとに
//    50 行分を記録すると、①`S-041` の「誰の経歴を、誰が、いつ見たか」が台帳を開いた記録で
//    埋まって読めなくなり ②1 回の検索で 50 行の書き込みが増えて `F-009 AC-4`（p95 1 秒）を
//    満たせなくなる。**氏名を出す読み取りに記録を伴わせる規律**（`recordEngineerView` の注記）は
//    「経歴・連絡先に到達する読み取り」に対するものであり、その線引きは同注記に明記した。
//    ⚠️ この判断は docs/05 §6.4「#15 の実装の決着（T-05-09）」に記録してある。
import {
  ENGINEER_LIST_ORDER_BY,
  engineerSearchPlan,
  withTenant,
  type AuthenticatedTenantCtx,
  type EngineerAvailability,
  type EngineerSearchPlan,
  type EngineerWhereFragment,
  type RemoteMode,
} from '@ses/db';
import type { PrefectureCode } from '@ses/domain';
import { buildCursorPage, takeForCursorPage } from '../api/pagination';
import { toJstIsoDay } from '../format/datetime';
// 🔴 T-06-01: `decimalToNumber` / `toIsoDay` は `lib/format/db-values.ts` に移した
//    （案件側と共有するため。`service.ts` 冒頭の注記）。詳細と一覧が**同じ変換**を通る点は変わらない。
import { decimalToNumber, toIsoDay } from '../format/db-values';
import { pickPrimarySkills, type EngineerSkillCandidate } from './list-rows';
import type { EngineerListQuery } from './schemas';
import type { EngineerOwnership } from './service';

/** 一覧に出すスキル（`docs/04` §S-005「主要スキル（上位 3 のみ表示、超過は `+N`）」）。 */
export type OwnEngineerSkillView = {
  readonly skillId: string;
  readonly name: string;
};

/**
 * `GET /api/engineers`（#15）の 1 件（`OwnEngineerView`）。
 *
 * 🔴 **連絡先を持たない**（`EngineerDetailView` と同じ理由。画面が出さない PII を API が返さない）。
 * ⚠️ **「経験年数」（1 人あたりの集約値）を**列としては**まだ出していない。**
 *    ✅ **集約の定義は T-06-04 で決着した** ——「登録されたスキルの経験年数の**最大値**」であり、
 *    `search.ts` の `engineerSkillConditions` が `yearsMin` の評価にその定義を使っている
 *    （docs/05 §6.4「#15 の実装の決着（T-06-04）」）。**列として足すのは `docs/04` §S-005 の
 *    結果テーブル（現在 8 列で、経験年数は更新日と入れ替え済み）の再設計を伴う**ため、
 *    本タスクでは検索の評価だけを入れ、画面には**集約の意味**を 1 行で明示した
 *    （`engineers.list.experienceComingSoon`）。スキル別の経験年数は `S-006` に出ているので、
 *    判断材料が隠れているわけではない。
 */
export type OwnEngineerView = {
  readonly id: string;
  readonly displayName: string;
  /** 🔴 行の `owner_partner_company_id` 由来（RLS の C3 により ctx と必ず一致する）。 */
  readonly ownership: EngineerOwnership;
  /** 経験年数の降順（同順は `skillId` 昇順）で最大 3 件。 */
  readonly primarySkills: readonly OwnEngineerSkillView[];
  /** 🔴 `primarySkills` に載らなかった件数（`docs/04` §S-005 の `+N`）。0 なら表示しない。 */
  readonly moreSkillCount: number;
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly availability: EngineerAvailability;
  /** `YYYY-MM-DD` または `null`。 */
  readonly availableFrom: string | null;
  readonly prefecture: PrefectureCode | null;
  readonly remoteMode: RemoteMode | null;
  /**
   * 🔴 **JST の暦日に丸めた更新日**（`docs/04` `U-06` / §S-005 の並び順の説明）。
   *    生の `updated_at`（時刻つき）を返さないのは、①画面が使わない精度であり
   *    ②`AnonymousCandidateView.updatedOn`（docs/05 §4.6）と粒度を揃えるためである。
   * 🔴 丸めの基準は **JST**（`lib/format/datetime.ts` の `toJstIsoDay`）。UTC で切り出すと
   *    JST の 0:00〜8:59 の更新が**前日**として出る（`formatDateTimeJst` と同じ規約）。
   */
  readonly updatedOn: string;
};

/**
 * `GET /api/engineers`（#15）の応答。
 *
 * 🔴 `total` は**同じ `where` の `COUNT`**（docs/05 §4.8）。
 * 🔴 `nextCursor` は「次ページの起点」だけであり、**残件数を返さない**
 *    （「他にも N 件あります」に相当するフィールドを型に持たない。docs/05 §4.8）。
 */
export type EngineerListView = {
  readonly items: readonly OwnEngineerView[];
  readonly total: number;
  readonly nextCursor: string | null;
};

/** 一覧が読む列（`docs/04` §S-005 の結果テーブルに出るものだけ）。 */
const ENGINEER_LIST_SELECT = {
  id: true,
  ownerPartnerCompanyId: true,
  displayName: true,
  availability: true,
  availableFrom: true,
  unitPriceMin: true,
  unitPriceMax: true,
  prefecture: true,
  remoteMode: true,
  updatedAt: true,
} as const;

type EngineerListRow = {
  readonly id: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly displayName: string;
  readonly availability: string;
  readonly availableFrom: Date | null;
  readonly unitPriceMin: { toString(): string } | null;
  readonly unitPriceMax: { toString(): string } | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
  readonly updatedAt: Date;
};

type SkillRow = EngineerSkillCandidate & {
  readonly engineerId: string;
  readonly name: string;
};

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使うデリゲートだけ。 */
type EngineerListDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * 1 ページ分のエンジニアのスキルを 1 往復で読む（エンジニアごとに引くと N+1 になり、
 * `F-009 AC-4` の p95 1 秒を満たせない）。
 *
 * 🔴 ここにも `where` の境界条件を書かない（親と同じ RLS が `engineer_skills` にも効く。
 *    C3 OWNER_SCOPED + 継承トリガ。docs/05 §4.4.1）。
 */
async function readPrimarySkills(
  db: EngineerListDb,
  engineerIds: readonly string[],
): Promise<ReadonlyMap<string, { shown: readonly SkillRow[]; more: number }>> {
  const result = new Map<string, { shown: readonly SkillRow[]; more: number }>();
  if (engineerIds.length === 0) return result;

  const rows = await db.engineerSkill.findMany({
    where: { engineerId: { in: [...engineerIds] } },
    select: {
      engineerId: true,
      skillId: true,
      yearsOfExperience: true,
      skill: { select: { name: true } },
    },
  });

  const byEngineer = new Map<string, SkillRow[]>();
  for (const row of rows) {
    const entry: SkillRow = {
      engineerId: row.engineerId,
      skillId: row.skillId,
      name: row.skill.name,
      yearsOfExperience: Number(row.yearsOfExperience.toString()),
    };
    const bucket = byEngineer.get(row.engineerId);
    if (bucket === undefined) byEngineer.set(row.engineerId, [entry]);
    else bucket.push(entry);
  }

  for (const [engineerId, skills] of byEngineer) {
    result.set(engineerId, pickPrimarySkills(skills));
  }
  return result;
}

function toOwnEngineerView(
  row: EngineerListRow,
  skills: { shown: readonly SkillRow[]; more: number } | undefined,
): OwnEngineerView {
  return {
    id: row.id,
    displayName: row.displayName,
    ownership: row.ownerPartnerCompanyId === null ? 'HOST' : 'PARTNER',
    primarySkills: (skills?.shown ?? []).map((skill) => ({
      skillId: skill.skillId,
      name: skill.name,
    })),
    moreSkillCount: skills?.more ?? 0,
    unitPriceMin: decimalToNumber(row.unitPriceMin),
    unitPriceMax: decimalToNumber(row.unitPriceMax),
    availability: row.availability as EngineerAvailability,
    // 🔴 `available_from` は `@db.Date`（時刻を持たない）。UTC 切り出しが正確であり、
    //    ここに TZ 変換を掛けると日付が 1 日ずれる（`toIsoDay` の JSDoc）。
    availableFrom: row.availableFrom === null ? null : toIsoDay(row.availableFrom),
    prefecture: row.prefecture as PrefectureCode | null,
    remoteMode: row.remoteMode as RemoteMode | null,
    // 🔴 `updated_at` は `timestamptz`。**JST の暦日**に丸める（`toIsoDay` を使わない）。
    updatedOn: toJstIsoDay(row.updatedAt),
  };
}

/** 1 バケット分を、決定的な順序（`ENGINEER_LIST_ORDER_BY`）で読む。 */
function findOrderedPage(
  db: EngineerListDb,
  where: EngineerWhereFragment,
  cursor: string | undefined,
  take: number,
): Promise<EngineerListRow[]> {
  return db.engineer.findMany({
    where,
    select: ENGINEER_LIST_SELECT,
    orderBy: [...ENGINEER_LIST_ORDER_BY],
    take,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
}

/**
 * カーソル行がどのバケットに属するかを引き当てる（`readOrderedRows` の前段）。
 *
 * 🔴 **カーソルはどのバケットの行かを判定してから使う。** 先のバケットの続きを後のバケットの
 *    カーソルで読むと、ページの境目で行が重複・欠落する。
 * 🔴 判定は「そのカーソル行がそのバケットの母集団に居るか」を 1 件引くだけである。
 *    **最後のバケットは引かない**（そこに居ないなら、どこにも居ない ＝ 境界外か母集団を
 *    外れた行であり、いずれにせよ最後のバケットをカーソル付きで読んで 0 件になる。
 *    docs/05 §4.8「見えない ＝ 存在しない」。500 にしない）。
 *    バケットが 2 つのときの問い合わせ回数は T-06-04 実装（`fit` に居るかを 1 回引く）と同じである。
 */
async function locateCursorBucket(
  db: EngineerListDb,
  buckets: readonly EngineerWhereFragment[],
  cursor: string,
): Promise<number> {
  for (const [index, bucket] of buckets.slice(0, -1).entries()) {
    const found = await db.engineer.findFirst({
      where: { AND: [bucket, { id: cursor }] },
      select: { id: true },
    });
    if (found !== null) return index;
  }
  return buckets.length - 1;
}

/**
 * 🔴 **Phase 1 の並び順そのもの**（`F-009 AC-1` / `docs/02` `F-009` 処理②
 * 「検索条件への適合と更新日時による決定的な順序」）。
 *
 * `plan.buckets` は母集団を**過不足なく分割**したものなので（`packages/db/src/search/plan.ts`）、
 * **先頭のバケットを読み切ってから次のバケットを読む**だけで「適合 → 更新日時 → id」の
 * 3 段の並びになる。各バケットの中は `ENGINEER_LIST_ORDER_BY` で一意に決まるため、
 * **同じ条件・同じデータなら何度実行しても同じ並び**である。
 *
 * 🔴 なぜバケットに分けるか: 「適合」は列の値ではなく**述語**であり、`ORDER BY` に載せるには
 *    `CASE` 式（＝ raw SQL）が要る。それは「検索の実装を `packages/db/src/search/**` の 1 箇所に
 *    閉じる」（T-06-05 / docs/05 TBD-8）と衝突する。**アプリ層で決定的にマージする**形は
 *    SP-08（自社スコープ + 共有スコープ）でも使う（`docs/03` `program-design` 申し送り 18）。
 * 🔴 **本関数はバケットの中身を見ない。** 「分割するかどうか」の判定は `engineerSearchPlan` に
 *    しか無く（`buckets.length`）、ここには `fit` / `miss` という語すら現れない。
 * 🔴 バケットが 1 つ（ソフト条件が無い）のときは**そのまま 1 クエリ**である
 *    ＝ T-05-09 の骨格と同じ経路であり、既定の一覧に余計な問い合わせを足さない。
 */
async function readOrderedRows(
  db: EngineerListDb,
  plan: EngineerSearchPlan,
  cursor: string | undefined,
  take: number,
): Promise<EngineerListRow[]> {
  const { buckets } = plan;
  if (buckets.length === 1) return findOrderedPage(db, buckets[0], cursor, take);

  const startIndex = cursor === undefined ? 0 : await locateCursorBucket(db, buckets, cursor);

  const rows: EngineerListRow[] = [];
  for (const [offset, bucket] of buckets.slice(startIndex).entries()) {
    if (rows.length >= take) break;
    // 🔴 カーソルは「続きから読む」最初のバケットにだけ効く。以降のバケットは**先頭から**継ぐ。
    const bucketCursor = offset === 0 ? cursor : undefined;
    rows.push(...(await findOrderedPage(db, bucket, bucketCursor, take - rows.length)));
  }
  return rows;
}

/**
 * `GET /api/engineers`（#15）と `S-005`（画面）が通る**唯一の経路**。
 *
 * 🔴 **画面と API が同じ関数を通る**（`listSkills` / `readEngineerDetail` と同じ方針）。
 *    2 本あると母集団・並び順・件数が画面と API でずれ、どちらが正か分からなくなる。
 *
 * 🔴 **並び順**（`F-009 AC-1`「実行のたびに同じ並び順」/ docs/05 §4.8）:
 *    **①検索条件への適合 → ②`updated_at` の降順 → ③`id` の降順**。①の定義（1 ビットであり、
 *    重み・順位ではないこと）は `packages/db/src/search/engineers.ts` 冒頭に、
 *    ②③は `ENGINEER_LIST_ORDER_BY` にある。
 *    `id` は `uuid(7)`（時系列で単調増加）なので、同時刻の行でも順序が一意に決まる。
 *    **`ORDER BY` に「全体件数」「順位」を持ち込まない**（境界外の行の有無で順位が動くと、
 *    並び順そのものが他社の存在を漏らす）。索引は
 *    `@@index([tenantId, updatedAt(sort: Desc), id(sort: Desc)])`（T-06-05）。
 *    ⚠️ `docs/04` §S-005 は並び順を「…→ 更新日（**日単位に丸める**）→ 決定的な内部順」と
 *    書いているが、**丸めるのは表示（`updatedOn`）だけにした**。理由は 2 つ:
 *      ①`date_trunc('day', updated_at)` で並べると式インデックスと **raw SQL** が要り、
 *        「検索の実装を `packages/db/src/search/**` の 1 箇所に閉じる」（SP-06 T-06-05 / TBD-8）と
 *        衝突する。加えて Prisma の `cursor` は一意な列しか取れず、日単位の複合カーソルを作れない。
 *      ②丸めの目的（`U-06` / `docs/03` §4.13.2-2）は**匿名候補の再識別防止**であり、
 *        実名で表示する自社台帳の並びには当てはまらない。日をまたぐ順序は docs/04 の指定と
 *        一致し、同日内がさらに更新時刻で細分されるだけである（決定性は保たれる）。
 *    ⚠️ この差分は docs/05 §6.4「#15 の実装の決着」に記録した。
 */
export async function listEngineers(
  ctx: AuthenticatedTenantCtx,
  query: EngineerListQuery,
): Promise<EngineerListView> {
  // 🔴 **述語の出所は `engineerSearchPlan` の 1 本だけ**である（本ファイル冒頭）。
  //    `plan.where` を 1 つの値にしておくのは、一覧と `COUNT` で書き分けられないようにするため
  //    である（`plan.buckets` は `plan.where` を過不足なく分割するだけなので、
  //    **並びの都合で母集団が変わらない**）。
  const plan = engineerSearchPlan(query);

  return withTenant(ctx, async (db) => {
    const [rows, total] = await Promise.all([
      readOrderedRows(db, plan, query.cursor, takeForCursorPage(query.limit)),
      // 🔴 `where` は一覧と同一の値である（docs/05 §4.8）。
      db.engineer.count({ where: plan.where }),
    ]);

    const page = buildCursorPage<EngineerListRow>(rows, query.limit, (row) => row.id);
    const skills = await readPrimarySkills(
      db,
      page.items.map((row) => row.id),
    );

    return {
      items: page.items.map((row) => toOwnEngineerView(row, skills.get(row.id))),
      total,
      nextCursor: page.nextCursor,
    };
  });
}
