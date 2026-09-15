// apps/web/lib/candidates/list.ts
// 案件の候補一覧 —— 自社候補と匿名候補の混在（docs/05 §6.5 #30 `GET /api/projects/{id}/candidates` /
// §6.4 #15 `GET /api/engineers?projectId=` / §4.6「自社候補との混在の並びとページング」。
// `F-009` / `F-017 AC-5` / `AC-7` / `docs/03` `program-design` 申し送り 18 / §4.13.2-5）。T-08-05。
//
// ============================================================================
// 🔴 2 本のクエリを別々に走らせ、アプリ層で 1 つの全順序にマージする
// ============================================================================
//   ① 共有スコープ（ホストのみ）… `withSharedCandidateScope` → `listSharedEngineers()`（全件）。
//      🔴 **同じトランザクションで `replaceAnonymousCandidates`** により `MatchCandidate`
//      （`isAnonymous = true`）を案件全体で置き換える。Phase 1 に `match.build` は無く、
//      **この読み取りが `MatchCandidate` の唯一の生成経路**である（`POST /api/proposal-requests`〔#31〕
//      はこの行から `candidateRef` を逆引きする）。共有が解除された行は `listSharedEngineers` に
//      返らない ＝ 置き換えで消える（`F-016 AC-2`。キャッシュを置かない）。
//   ② 自社スコープ … `withTenant`（`engineers` の RLS C3）で案件の共通部分・自社候補のキー
//      （`engineerSearchPlan(criteria).buckets` ごとに `id` / `updatedAt` の全件）・ページ分の詳細を
//      読み、閲覧を `AuditLog` に書く。
//   🔴 1 本の SQL にまとめない（越境の実装が 1 か所に集まらない。`docs/03` §3.7.1）。
//   🔴 パートナー文脈は①を実行しない（`F-017 AC-5`。`withSharedCandidateScope` 自身の `requireHost`
//      と二重）。応答の匿名候補は 0 件である。
//
// ============================================================================
// 🔴 並びとページング（docs/05 §4.6 線引き表 #3 / #8 / #9）
// ============================================================================
//   - キーは **バケット（適合が先）→ `updatedOn`（JST 暦日）降順 → `sortRef` 昇順**。`sortRef` は
//     匿名候補では `candidateRef`、自社候補でも**同じ関数**（`HMAC(secret, projectId ‖ engineerId)`）の値
//     を**並びにだけ**使う（応答に載せない）。共通の比較子が無いと「その日の自社を全部出してから
//     共有を出す」＝ スコープをバケットにする形に戻り、境目から匿名候補の件数が読める。
//   - 🔴 **全件取得 → 並べ直し → キーでカーソル。** 共有スコープに `take` を渡さない（打ち切ると
//     ページに載る集合が `engineer_id` タイブレークで決まり、案件をまたいで一致する。#9）。
//   - 🔴 **匿名候補への検索条件は丸めた後の区分で評価する**（`anonymousCandidateSearchPlan`。#8）。
//     生値の述語を共有スコープに渡すと、条件の当たり方から「7 年」「65 万円」が復元できる。
//   - `index` / `rank` / `score` を持つ中間表現を作らない（`F-017 AC-7` / `AC-2`）。
//
// 🔴 **`withSharedCandidateScope` を import してよいのは本ファイルだけ**である（`eslint.config.mjs` の
//    `SHARED_CANDIDATE_CALLER_ZONE` / `tests/static/auth-db-callers.test.ts`。docs/05 §4.5）。
//    2 つ目の呼び出し元を作るときは同じ手順（専用ゾーン + 許可リスト）を踏む。
import { ANONYMIZE_ROUNDING } from '@ses/config';
import {
  anonymousCandidateSearchPlan,
  engineerSearchPlan,
  SharedCandidateProjectNotFoundError,
  withSharedCandidateScope,
  withTenant,
  type AuthenticatedTenantCtx,
  type EngineerSearchCriteria,
  type EngineerWhereFragment,
  type SharedCandidateSource,
} from '@ses/db';
import { NotFoundError } from '../api/errors';
import { buildCursorPage, takeForCursorPage } from '../api/pagination';
import {
  buildAnonymousCandidateViews,
  type AnonymousCandidateView,
} from '../anonymize/candidate-view';
import type { CandidateReference } from '../anonymize/reference';
import {
  ENGINEER_LIST_SELECT,
  readPrimarySkills,
  toOwnEngineerView,
  type EngineerListDb,
  type OwnEngineerView,
} from '../engineers/list';
import { toJstIsoDay } from '../format/datetime';
import {
  PROJECT_VIEW_VIA,
  projectNotFoundError,
  readProjectCandidateContext,
  recordProjectView,
  type ProjectDetailShared,
  type ProjectViewMeta,
} from '../projects/service';
import { projectCandidateDefaults } from './defaults';
import {
  decodeCandidateCursor,
  encodeCandidateCursor,
  type CandidateSortKey,
  type ProjectCandidateListQuery,
} from './schemas';

/**
 * `S-016` の自社候補 1 件（docs/05 §6.5「#30 の実装の決着」）。
 * 🔴 `OwnEngineerView`（`S-005` / #15 と同じ変換）に **`yearsMax`**（登録スキルの経験年数の最大。
 *    T-06-04 で決着した集約の定義）だけを足す —— `docs/04` §S-016 の「経験年数」列を自社候補にも出すため。
 */
export type OwnCandidateView = OwnEngineerView & {
  readonly yearsMax: number | null;
};

/** `items` の 1 件。🔴 判別子は置かず、`isAnonymousCandidateView` で見分ける（docs/05 §6.4 #15 の決着）。 */
export type CandidateListItem = OwnCandidateView | AnonymousCandidateView;

/**
 * 匿名候補か。`AnonymousCandidateView` は `candidateRef` を持ち `id` を持たない（型で固定。
 * `apps/web/lib/anonymize/candidate-view.ts`）ので、`in` 演算子で判別できる。
 */
export function isAnonymousCandidateView(item: CandidateListItem): item is AnonymousCandidateView {
  return 'candidateRef' in item;
}

/** 案件の共通部分（`#27` のホスト・取引先で共通の列。商流情報を型として持たない）。 */
export type ProjectCandidateContextView = ProjectDetailShared;

/**
 * `GET /api/projects/{id}/candidates`（#30）の応答（`phase` は Route Handler が足す）。
 * 🔴 `total` は**手元で数えた混在の総件数**（自社の `plan.where` の全件 + 匿名候補で評価を通ったもの）。
 *    匿名候補の件数を別に持たない（`docs/04` §S-016 空状態）。
 * 🔴 `nextCursor` は並びのキー。残件数・ページ番号・順位は返さない（docs/05 §4.8）。
 */
export type ProjectCandidateListView = {
  readonly project: ProjectCandidateContextView;
  /**
   * 実際に効いた検索条件。`PROJECT_DEFAULTS` で呼んだときは案件の要件から組んだ値が入る
   * （画面はこれをフォームの初期値とページングの URL に使う）。
   */
  readonly query: ProjectCandidateListQuery;
  readonly items: readonly CandidateListItem[];
  readonly total: number;
  readonly nextCursor: string | null;
};

/**
 * 検索条件の与え方。
 * - `CRITERIA` … 明示された条件（API #30 / #15 と、条件を 1 つでも指定した画面）
 * - `PROJECT_DEFAULTS` … **案件の要件を初期値にする**（`S-016` の初回表示。`docs/04` §S-016 セクション 2）。
 *   🔴 案件を読む 1 回のトランザクションの中で条件を組む —— 初期値のためだけに案件を**記録なしで**
 *   読む別経路を作らない（読んだ記録は `project.view` / `CANDIDATES` の 1 行に揃う）。
 */
export type ProjectCandidateListRequest =
  | { readonly kind: 'CRITERIA'; readonly query: ProjectCandidateListQuery }
  | { readonly kind: 'PROJECT_DEFAULTS'; readonly limit: number };

/** 起動時 DI と実行時刻（`bootstrap.ts` の `candidateReference()` / `new Date()`）。 */
export type ProjectCandidateListDeps = {
  /** 🔴 鍵を閉じ込めた参照子の生成関数。鍵そのものは受け取らない。 */
  readonly candidateRef: CandidateReference;
  /** 現在時刻。丸めの基準日（JST 暦日）と `MatchCandidate.computedAt` に使う。 */
  readonly now: () => Date;
  /** 監査ログに残す実行環境。 */
  readonly meta: ProjectViewMeta;
};

/**
 * 並びの比較子（docs/05 §4.6）。**バケット昇順 → `updatedOn` 降順 → `sortRef` 昇順**。
 * 🔴 `sortRef` は案件ごとに違う HMAC なので全順序であり、安定ソートに頼らない。
 * 🔴 `updatedOn` は `YYYY-MM-DD` なので辞書順 = 日付順（`Date` を作らない）。
 */
export function compareCandidateSortKeys(a: CandidateSortKey, b: CandidateSortKey): number {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  if (a.updatedOn !== b.updatedOn) return a.updatedOn < b.updatedOn ? 1 : -1;
  if (a.sortRef !== b.sortRef) return a.sortRef < b.sortRef ? -1 : 1;
  return 0;
}

/** マージ前の 1 件。🔴 `index` / `rank` を持たない（並びは比較子だけが決める）。 */
type MergeEntry =
  | { readonly kind: 'OWN'; readonly key: CandidateSortKey; readonly id: string }
  | { readonly kind: 'ANONYMOUS'; readonly key: CandidateSortKey; readonly view: AnonymousCandidateView };

/**
 * 🔴 全順序に並べたエントリからページを切る（純粋関数。`list.test.ts` が 10 回実行の一致を固定する）。
 *
 * カーソルは並びのキーであり、「そのキーより**後ろ**」から `limit + 1` 件を取る。境目の行が
 * 消えていても次ページは決まる。カーソルより前に戻る要求（先頭ページ）は `cursor` を省く。
 */
export function sliceCandidatePage<T extends { readonly key: CandidateSortKey }>(
  entries: readonly T[],
  cursor: CandidateSortKey | undefined,
  limit: number,
): { readonly items: readonly T[]; readonly nextCursor: string | null } {
  const sorted = [...entries].sort((a, b) => compareCandidateSortKeys(a.key, b.key));
  const start =
    cursor === undefined
      ? 0
      : sorted.findIndex((entry) => compareCandidateSortKeys(entry.key, cursor) > 0);
  const rest = start === -1 ? [] : sorted.slice(start, start + takeForCursorPage(limit));
  return buildCursorPage(rest, limit, (entry) => encodeCandidateCursor(entry.key));
}

/**
 * 共有候補の全件を読み、**同じトランザクションで** `MatchCandidate` を置き換える（ホストのみ）。
 * 🔴 `take` を渡さない（docs/05 §4.6 線引き表 #9）。
 * 🔴 案件が見つからなければ 404 に畳む（`SharedCandidateProjectNotFoundError` → `NotFoundError`。
 *    docs/05 §4.5 / §4.8。この型を握るのは本ファイルだけである）。
 */
async function readSharedCandidates(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  computedAt: Date,
): Promise<readonly SharedCandidateSource[]> {
  if (ctx.partnerCompanyId !== null) return [];
  try {
    return await withSharedCandidateScope(ctx, projectId, async (db) => {
      const rows = await db.listSharedEngineers();
      await db.replaceAnonymousCandidates(
        rows.map((row) => ({ engineerId: row.engineerId, computedAt })),
      );
      return rows;
    });
  } catch (error: unknown) {
    if (error instanceof SharedCandidateProjectNotFoundError) throw new NotFoundError();
    throw error;
  }
}

/**
 * 自社候補のキー（バケットごとに `id` / `updatedAt` の**全件**）。
 * 🔴 ここにも境界の条件を書かない（`engineers` の RLS C3 が母集団を決める。`listEngineers` と同じ規律）。
 * 🔴 `take` を掛けない（全件を手元で並べる。docs/05 §4.6 線引き表 #9）。
 */
async function readOwnEntries(
  db: Pick<EngineerListDb, 'engineer'>,
  projectId: string,
  buckets: readonly EngineerWhereFragment[],
  candidateRef: CandidateReference,
): Promise<readonly MergeEntry[]> {
  const entries: MergeEntry[] = [];
  for (const [index, bucket] of buckets.entries()) {
    const rows = await db.engineer.findMany({ where: bucket, select: { id: true, updatedAt: true } });
    for (const row of rows) {
      entries.push({
        kind: 'OWN',
        id: row.id,
        key: {
          bucket: index === 0 ? 0 : 1,
          updatedOn: toJstIsoDay(row.updatedAt),
          sortRef: candidateRef(projectId, row.id),
        },
      });
    }
  }
  return entries;
}

/**
 * ページ分の自社候補の詳細（`S-005` / #15 と**同じ列・同じ変換**。`lib/engineers/list.ts`）に
 * `yearsMax` を足す。
 * 🔴 `yearsMax` は `readPrimarySkills` が経験年数の降順で返す先頭の値である（集約の定義 = 最大値）。
 */
async function readOwnCandidateViews(
  db: Pick<EngineerListDb, 'engineer' | 'engineerSkill'>,
  ids: readonly string[],
): Promise<ReadonlyMap<string, OwnCandidateView>> {
  const result = new Map<string, OwnCandidateView>();
  if (ids.length === 0) return result;
  const [rows, skills] = await Promise.all([
    db.engineer.findMany({ where: { id: { in: [...ids] } }, select: ENGINEER_LIST_SELECT }),
    readPrimarySkills(db, ids),
  ]);
  for (const row of rows) {
    const entry = skills.get(row.id);
    result.set(row.id, {
      ...toOwnEngineerView(row, entry),
      yearsMax: entry?.shown[0]?.yearsOfExperience ?? null,
    });
  }
  return result;
}

/**
 * 🔴 `GET /api/projects/{id}/candidates`（#30）と `S-016`、`GET /api/engineers?projectId=`（#15）が通る
 *    **唯一の経路**（画面と API で母集団・並び・件数がずれないように）。
 *
 * 手順:
 *   ① 共有候補の全件を読み、`MatchCandidate` を置き換える（ホストのみ。別トランザクション）
 *   ② `withTenant`: 案件の共通部分（見えなければ 404）→ 自社候補のキー（全件）→ 匿名候補の
 *      丸め・評価 → マージ → ページ → 自社候補の詳細 → **監査**（`project.view` / `CANDIDATES`）
 *
 * 🔴 監査を業務トランザクションの内側で書くのは `readProjectDetail` と同じ理由（画面経路でも
 *    漏れない / 404 では「閲覧した」記録を残さない / 書けなければ内容が返らない）。
 */
export async function listProjectCandidates(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  request: ProjectCandidateListRequest,
  deps: ProjectCandidateListDeps,
): Promise<ProjectCandidateListView> {
  const now = deps.now();
  const referenceDate = toJstIsoDay(now);

  // ① 共有スコープ（ホストのみ。パートナーは空配列 = 匿名候補 0 件）。条件に依存しないので先に読む。
  const sharedRows = await readSharedCandidates(ctx, projectId, now);
  const anonymousViews = buildAnonymousCandidateViews({
    projectId,
    rows: sharedRows,
    referenceDate,
    candidateRef: deps.candidateRef,
  });

  // ② 自社スコープ。
  return withTenant(ctx, async (db) => {
    const project = await readProjectCandidateContext(db, projectId);
    if (project === null) throw await projectNotFoundError(db, ctx, projectId);

    const query =
      request.kind === 'CRITERIA' ? request.query : projectCandidateDefaults(project, request.limit);
    // 🔴 検索条件の評価は `@ses/db` の `search/**` に閉じている（`listEngineers` と同じ。`cursor` / `limit` は
    //    `EngineerSearchCriteria` に無いので読まれない）。
    const criteria: EngineerSearchCriteria = query;
    const plan = engineerSearchPlan(criteria);
    const cursor = query.cursor === undefined ? undefined : decodeCandidateCursor(query.cursor);

    // 🔴 匿名候補への条件は丸め後の区分で評価する（docs/05 §4.6 線引き表 #8）。
    //    辞書名は `Skill`（グローバルな射程外表）から引く。条件に無ければ引かない。
    const skillIds = criteria.skills ?? [];
    const skillRows =
      skillIds.length === 0
        ? []
        : await db.skill.findMany({ where: { id: { in: [...skillIds] } }, select: { id: true, name: true } });
    const anonymousPlan = anonymousCandidateSearchPlan(criteria, {
      skillNames: new Map(skillRows.map((skill) => [skill.id, skill.name])),
      referenceDate,
      rounding: ANONYMIZE_ROUNDING,
    });
    const anonymousEntries: readonly MergeEntry[] = anonymousViews
      .filter((view) => anonymousPlan.matches(view))
      .map((view) => ({
        kind: 'ANONYMOUS',
        view,
        key: { bucket: anonymousPlan.bucketOf(view), updatedOn: view.updatedOn, sortRef: view.candidateRef },
      }));

    const ownEntries = await readOwnEntries(db, projectId, plan.buckets, deps.candidateRef);
    const entries: readonly MergeEntry[] = [...ownEntries, ...anonymousEntries];
    const page = sliceCandidatePage(entries, cursor, query.limit);

    const ownViews = await readOwnCandidateViews(
      db,
      page.items.flatMap((entry) => (entry.kind === 'OWN' ? [entry.id] : [])),
    );

    await recordProjectView(db, ctx, project.id, PROJECT_VIEW_VIA.candidates, deps.meta);

    const items: CandidateListItem[] = [];
    for (const entry of page.items) {
      if (entry.kind === 'ANONYMOUS') {
        items.push(entry.view);
        continue;
      }
      const own = ownViews.get(entry.id);
      // 🔴 キーを読んだ後に行が消えた（同時削除）場合だけ起こる。黙って詰めずに落とさず、その行を飛ばす
      //    （次ページのカーソルは並びのキーなので影響しない）。
      if (own !== undefined) items.push(own);
    }

    return { project, query, items, total: entries.length, nextCursor: page.nextCursor };
  });
}
