// apps/web/lib/home/summary.ts
// 🔴 `S-003` / `S-004` の `SummaryStrip` の件数（`docs/04` §4.1 改訂 16 / §7.2 / `Q-04-4` /
//    docs/05 §6.11.1）。T-22-09。
//
// ============================================================================
// 🔴 このファイルが守るもの
// ============================================================================
//   ① 🔴 **新しいエンドポイントを作らない。** 件数は `GET /api/home`（#9）の `blocks` に
//      `kind: 'SUMMARY'` として同梱し、**要対応キューと同じ 60 秒ポーリング**に乗る
//      （別の更新周期を作ると、数と行が食い違う瞬間ができる）。
//   ② 🔴 **平常時に増えるトランザクションは Phase 1 で +0 本。** 本ファイルの関数は
//      `db`（`TenantDb`）を受け取るだけであり、**`withTenant` を開かない** ——
//      `readActionQueueBlock` と**同じトランザクションの中**で呼ばれる
//      （`./action-queue-read.ts` / `./blocks.ts` 冒頭の表）。
//   ③ 🔴 **`where` に `tenant_id` / `partner_company_id` / `owner_partner_company_id` を書かない。**
//      母集団は RLS が決める（`projects` = C4 / `engineers` = C3 / `proposals` = C5 /
//      `engineer_shares` = C3）。**取引先に他社の行が数えられる経路は RLS が塞いでいる。**
//      ⚠️ したがって **ホストの `人材` は自社所属だけの件数**である（C3 OWNER_SCOPED は
//      ホスト文脈で `owner_partner_company_id IS NULL` の行しか通さない。`CLAUDE.md` §3.1 経路 2
//      「パートナーのエンジニア台帳全体をホストが読むことはできない」/ `withTenant` は
//      `app.shared_scope` を `off` にする = 経路 4 の匿名候補も数に入らない）。
//      **これは実装の都合ではなく、境界の定めどおりの数である。**
//   ④ 🔴 **生 SQL を使わない**（`$queryRaw` は `TenantDb` の型から除去済み。docs/05 §4.3-3）。
//   ⑤ 🔴 **0 件でも `count: 0` を返す**（`items` を空配列にする分岐を作らない ——
//      「まだ読んでいない」と区別できなくなる）。描かない判断は画面側の 1 箇所である。
//   ⑥ 🔴 **他社を示唆する指標を作らない。** 型（`./types.ts`）に `TOTAL_*` / `RANK` /
//      `COMPARISON` / `OTHER_COMPANIES` / `SAME_PROJECT_PROPOSALS` が無く、
//      **フィルタで落とすのではなく存在しない**（`BR-07` / `F-004 AC-4`）。
//   ⑦ 🔴 **氏名を 1 つも読まない**（件数だけ。ホームは 60 秒ごとに読み直されるので、
//      氏名を出すと `engineer.view` の記録が毎分積まれる。`BR-27`）。
//
// 🔴 指標の**並び**は `HOST_SUMMARY_METRIC_ORDER` / `PARTNER_SUMMARY_METRIC_ORDER` に固定する
//    （個々の 0 で項目を間引かないので、並びは日によって変わらない。docs/05 §6.11.1）。
import type { ProposalState } from '@ses/domain';
import { ENGINEER_LIST_PATH } from '../engineers/list-rows';
import { ENGINEER_SHARE_PATH } from '../engineer-shares/screen-query';
import { PROJECT_LIST_PATH } from '../projects/list-rows';
import { PROPOSALS_PATH } from '../proposals/hrefs';
import type { TenantDb } from '../proposals/list';
import type {
  HostSummaryMetricKind,
  PartnerSummaryMetricKind,
  SummaryHomeBlock,
  SummaryMetric,
} from './types';

/**
 * 🔴 Phase 1 に出るホストの指標（3 件。`docs/05` §6.11.1 の表）。
 *    `INTERVIEWS_SCHEDULED` / `ASSIGNMENTS_ACTIVE` は Phase 2（`Assignment` と面談セクションと同時）。
 */
export const HOST_SUMMARY_METRIC_ORDER = [
  'PROJECTS',
  'ENGINEERS',
  'PROPOSALS_IN_FLIGHT',
] as const satisfies readonly HostSummaryMetricKind[];

/** 🔴 Phase 1 に出る取引先の指標（4 件。同上）。 */
export const PARTNER_SUMMARY_METRIC_ORDER = [
  'PUBLISHED_PROJECTS',
  'OWN_ENGINEERS',
  'SHARED_ENGINEERS',
  'PROPOSALS_IN_FLIGHT',
] as const satisfies readonly PartnerSummaryMetricKind[];

/**
 * 🔴 「進行中の提案」から除く終端の 3 状態（`docs/04` §S-003 / docs/05 §6.11.1）。
 *    `satisfies` で `ProposalState` に縛るので、状態名が変われば（`CLAUDE.md` §4.2 は人間の
 *    承認事項）コンパイルで落ちる。**`WON` / `LOST` / `WITHDRAWN` は終端であり「進行中」ではない。**
 */
export const PROPOSAL_TERMINAL_STATES = [
  'WON',
  'LOST',
  'WITHDRAWN',
] as const satisfies readonly ProposalState[];

/** 件数の読み取りに使うデリゲートだけを要求する（`TenantDb` 全体を要求しない）。 */
export type SummaryCountDb = Pick<TenantDb, 'project' | 'engineer' | 'proposal' | 'engineerShare'>;

export type SummaryReadOptions = {
  /** 🔴 `共有中` の値を `S-015` へのリンクにできるロールか（到達できない導線を出さない）。 */
  readonly canManageShares: boolean;
};

/**
 * 🔴 `SUMMARY` ブロックを読む。**`withTenant` を開かない**（呼び出し側のトランザクションに相乗りする）。
 *
 * 🔴 ホストと取引先で**読む表は同じ**（`projects` / `engineers` / `proposals`）であり、
 *    見える行が違うのは RLS である。取引先だけが `engineer_shares` を追加で数える
 *    （`共有中` は取引先にしか意味が無い指標。ホストには「どの会社が何人共有しているか」を出さない）。
 */
export async function readSummaryBlock(
  db: SummaryCountDb,
  audience: 'HOST' | 'PARTNER',
  options: SummaryReadOptions,
): Promise<SummaryHomeBlock> {
  const inFlightWhere = { state: { notIn: [...PROPOSAL_TERMINAL_STATES] } };
  if (audience === 'HOST') {
    const [projects, engineers, proposals] = await Promise.all([
      db.project.count({}),
      db.engineer.count({}),
      db.proposal.count({ where: inFlightWhere }),
    ]);
    const counts: Readonly<Record<(typeof HOST_SUMMARY_METRIC_ORDER)[number], number>> = {
      PROJECTS: projects,
      ENGINEERS: engineers,
      PROPOSALS_IN_FLIGHT: proposals,
    };
    return {
      kind: 'SUMMARY',
      audience: 'HOST',
      items: HOST_SUMMARY_METRIC_ORDER.map(
        (kind): SummaryMetric<HostSummaryMetricKind> => ({
          kind,
          count: counts[kind],
          href: HOST_METRIC_HREFS[kind],
        }),
      ),
    };
  }
  const [projects, engineers, shares, proposals] = await Promise.all([
    db.project.count({}),
    db.engineer.count({}),
    // 🔴 「有効な共有」= 解除されていない行（`revoked_at IS NULL`。`F-016 AC-2`「解除で即時に消える」）。
    db.engineerShare.count({ where: { revokedAt: null } }),
    db.proposal.count({ where: inFlightWhere }),
  ]);
  const counts: Readonly<Record<(typeof PARTNER_SUMMARY_METRIC_ORDER)[number], number>> = {
    PUBLISHED_PROJECTS: projects,
    OWN_ENGINEERS: engineers,
    SHARED_ENGINEERS: shares,
    PROPOSALS_IN_FLIGHT: proposals,
  };
  return {
    kind: 'SUMMARY',
    audience: 'PARTNER',
    items: PARTNER_SUMMARY_METRIC_ORDER.map(
      (kind): SummaryMetric<PartnerSummaryMetricKind> => ({
        kind,
        count: counts[kind],
        href:
          kind === 'SHARED_ENGINEERS' && !options.canManageShares
            ? // 🔴 `S-015` に到達できないロール（パートナー所属の閲覧専用）には導線を出さない。
              //    **指標そのものは消さない** —— 項目を間引くと並びがロールで変わる（docs/05 §6.11.1）。
              null
            : PARTNER_METRIC_HREFS[kind],
      }),
    ),
  };
}

/**
 * 🔴 指標 → 遷移先。**既存の URL だけ**を使う（新しいルートを作らない）。
 *    Phase 2 の 2 指標は遷移先の画面（`S-024` / `S-029`）が未実装なので `null` である
 *    （`tests/static/page-heading-single.test.ts` ③「未実装画面への導線を作らない」）。
 */
const HOST_METRIC_HREFS: Readonly<Record<HostSummaryMetricKind, string | null>> = {
  PROJECTS: PROJECT_LIST_PATH,
  ENGINEERS: ENGINEER_LIST_PATH,
  PROPOSALS_IN_FLIGHT: PROPOSALS_PATH,
  INTERVIEWS_SCHEDULED: null,
  ASSIGNMENTS_ACTIVE: null,
};

const PARTNER_METRIC_HREFS: Readonly<Record<PartnerSummaryMetricKind, string | null>> = {
  PUBLISHED_PROJECTS: PROJECT_LIST_PATH,
  OWN_ENGINEERS: ENGINEER_LIST_PATH,
  SHARED_ENGINEERS: ENGINEER_SHARE_PATH,
  PROPOSALS_IN_FLIGHT: PROPOSALS_PATH,
  ASSIGNMENTS_ACTIVE: null,
};
