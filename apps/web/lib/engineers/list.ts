// apps/web/lib/engineers/list.ts
// エンジニア台帳の一覧（docs/05 §6.4 #15 `GET /api/engineers`。`F-009` / `S-005`）。T-05-09。
//
// 🔴 **本タスクの射程は骨格（ページング + 既定順序）である**（`docs/sprints/SP-05` T-05-09）。
//    検索条件の評価と「検索条件への適合」による並び替えは **SP-06 の T-06-04** が足す。
//    匿名候補（`AnonymousCandidateView`。越境経路 4）の混在は **SP-08** である。
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
import { withTenant, type AuthenticatedTenantCtx, type EngineerAvailability, type RemoteMode } from '@ses/db';
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
 * ⚠️ **`docs/04` §S-005 の結果テーブルにある「経験年数」（1 人あたりの集約値）を出していない。**
 *    docs/05 §3.4 に集約列が無く、集約の定義（最大値か / 代表スキルか / 実務年数か）も
 *    決まっていない —— `S-006` が同じ理由で出していないもの（docs/05 §6.4「#17 の実装の決着」）と
 *    **同一の欠落**であり、定義は `F-009` の `yearsMin` の評価（SP-06 T-06-04）と同時に決める。
 *    スキル別の経験年数は `S-006` に出ているため、判断材料が隠れているわけではない。
 *    画面には「後続のリリースで列に加わる」と明示する（`engineers.careers.comingSoon` と同じ規律）。
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

/**
 * `GET /api/engineers`（#15）と `S-005`（画面）が通る**唯一の経路**。
 *
 * 🔴 **画面と API が同じ関数を通る**（`listSkills` / `readEngineerDetail` と同じ方針）。
 *    2 本あると母集団・並び順・件数が画面と API でずれ、どちらが正か分からなくなる。
 *
 * 🔴 **並び順**（`F-009 AC-1`「実行のたびに同じ並び順」/ docs/05 §4.8）:
 *    `updated_at` の降順 → `id` の降順。`id` は `uuid(7)`（時系列で単調増加）なので、
 *    同時刻の行でも順序が一意に決まる。**`ORDER BY` に「全体件数」「順位」を持ち込まない**
 *    （境界外の行の有無で順位が動くと、並び順そのものが他社の存在を漏らす）。
 *    索引は `@@index([tenantId, updatedAt])`（docs/05 §4.6 / schema.prisma）。
 *    ⚠️ `docs/04` §S-005 は並び順を「更新日（**日単位に丸める**）→ 決定的な内部順」と書いているが、
 *    **丸めるのは表示（`updatedOn`）だけにした**。理由は 2 つ:
 *      ①`date_trunc('day', updated_at)` で並べると式インデックスと **raw SQL** が要り、
 *        「検索 SQL を `packages/db/src/search/**` の 1 箇所に閉じる」（SP-06 T-06-05 / TBD-8）と
 *        衝突する。加えて Prisma の `cursor` は一意な列しか取れず、日単位の複合カーソルを作れない。
 *      ②丸めの目的（`U-06` / `docs/03` §4.13.2-2）は**匿名候補の再識別防止**であり、
 *        実名で表示する自社台帳の並びには当てはまらない。日をまたぐ順序は docs/04 の指定と
 *        一致し、同日内がさらに更新時刻で細分されるだけである（決定性は保たれる）。
 *    ⚠️ この差分は docs/05 §6.4「#15 の実装の決着（T-05-09）」に記録した。
 *    並び順の最終形（「検索条件への適合」を第 1 キーに置く）は T-06-04 が決める。
 */
export async function listEngineers(
  ctx: AuthenticatedTenantCtx,
  query: EngineerListQuery,
): Promise<EngineerListView> {
  // 🔴 業務上の絞り込みは T-06-04 が足す。**境界の条件はここに書かない**（本ファイル冒頭）。
  //    `where` を 1 つの値にしておくのは、一覧と `COUNT` で書き分けられないようにするためである。
  const where = {};

  return withTenant(ctx, async (db) => {
    const [rows, total] = await Promise.all([
      db.engineer.findMany({
        where,
        select: ENGINEER_LIST_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: takeForCursorPage(query.limit),
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      }),
      // 🔴 `where` は上と同一の値である（docs/05 §4.8）。
      db.engineer.count({ where }),
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
