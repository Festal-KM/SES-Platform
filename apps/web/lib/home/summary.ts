// apps/web/lib/home/summary.ts
// 🔴 `S-003` / `S-004` の **KPI カード 4 枚**の件数と差分（`docs/04` §4.1 / §7.2 改訂 23 / `U-24` /
//    docs/05 §6.11.1）。T-22-09 → ✅ 2026-10-02（改訂 23 で指標が入れ替わった）。
//
// ============================================================================
// 🔴 このファイルが守るもの
// ============================================================================
//   ① 🔴 **新しいエンドポイントを作らない。** 件数は `GET /api/home`（#9）の `blocks` に
//      `kind: 'SUMMARY'` として同梱し、**要対応キューと同じ 60 秒ポーリング**に乗る
//      （別の更新周期を作ると、数と行が食い違う瞬間ができる）。
//   ② 🔴 **平常時に増えるトランザクションは +0 本。** 本ファイルの関数は `db`（`TenantDb`）を
//      受け取るだけであり、**`withTenant` を開かない** —— `readActionQueueBlock` と**同じ
//      トランザクションの中**で呼ばれる（`./action-queue-read.ts` / `./blocks.ts` 冒頭の表）。
//   ③ 🔴 **`where` に `tenant_id` / `partner_company_id` / `owner_partner_company_id` を書かない。**
//      母集団は RLS が決める（`projects` = C4 / `engineers` = C3 / `proposals` = C5 /
//      `proposal_requests` = C5 / `project_visibilities` = C5）。
//      **取引先に他社の行が数えられる経路は RLS が塞いでいる。**
//   ④ 🔴 **生 SQL を使わない**（`$queryRaw` は `TenantDb` の型から除去済み。docs/05 §4.3-3）。
//   ⑤ 🔴 **0 件でも `count: 0` を返す**（`items` を空配列にする分岐を作らない ——
//      「まだ読んでいない」と区別できなくなる）。描かない判断は画面側の 1 箇所である。
//   ⑥ 🔴 **他社を示唆する指標を作らない。** 型（`./types.ts`）に `TOTAL_*` / `RANK` /
//      `COMPARISON` / `OTHER_COMPANIES` / `SAME_PROJECT_PROPOSALS` が無く、
//      **フィルタで落とすのではなく存在しない**（`BR-07` / `F-004 AC-4`）。
//   ⑦ 🔴 **氏名を 1 つも読まない**（件数だけ。ホームは 60 秒ごとに読み直されるので、
//      氏名を出すと `engineer.view` の記録が毎分積まれる。`BR-27`）。
//
// ============================================================================
// 🔴 改訂 23 で何が変わったか（指標の入れ替え）
// ============================================================================
// | # | ホスト | 集計 | 差分 |
// |---|---|---|---|
// | 1 | 今日やること | 🔴 **要対応キューの行数そのもの**（`buildSummaryBlock` が受け取る。**クエリ 0 本**） | 🔴 無し（在庫の数であり、前日の在庫を保存していない。下の 🔴） |
// | 2 | 返信待ち | `proposals` の `SUBMITTED`（出して相手の返答を待っている） | 同上 |
// | 3 | 面談予定 | `proposals` の `INTERVIEW_SCHEDULED` | 同上 |
// | 4 | 今週の提案 | `proposals` の `submitted_at >= 当週の月曜 0:00` | ✅ **先週比**（同曜日・同時刻までの差） |
//
// | # | 取引先 | 集計 | 差分 |
// |---|---|---|---|
// | 1 | 返答が必要な依頼 | `proposal_requests` の `REQUESTED`（RLS で自社宛のみ） | 🔴 無し |
// | 2 | 返信待ち | `proposals` の `SUBMITTED`（RLS で自社作成のみ） | 🔴 無し |
// | 3 | 面談予定 | `proposals` の `INTERVIEW_SCHEDULED`（同） | 🔴 無し |
// | 4 | 今週公開された案件 | `project_visibilities` の `published_at >= 当週の月曜 0:00` かつ未解除 | ✅ **先週比** |
//
// 🔴 **在庫（いま残っている件数）に差分を付けない。** §7.2 は「昨日比 = 本日 0:00 起点の当日の値と
//    前日の同時刻までの値の差」と定めるが、**承認待ち・返信待ちは「その時点で残っていた件数」**
//    であり、**過去の残高を保存していない**（`proposals` は現在の状態しか持たない）。現在の行から
//    推定すると「昨日のうちに解消した行」が数に入らず、**必ず増加側に偏る差分**になる。
//    🔴 **それは「比較対象のデータが無い」であって `±0` ではない**（`docs/04` §4.1）ので
//    `delta: null` を返す。**嘘の差分を出すより欄を描かないほうを選ぶ。**
//    ⚠️ 残高の履歴（日次スナップショット）を持てば昨日比が出せる。入れるなら `docs/05` の改訂を
//    経ること（計測の追加であり、本タスクの射程外）。
import type { ProposalState } from '@ses/domain';
import { ENGINEER_LIST_PATH } from '../engineers/list-rows';
import { PROJECT_LIST_PATH } from '../projects/list-rows';
import { PROPOSALS_PATH } from '../proposals/hrefs';
import type { TenantDb } from '../proposals/list';
import { deltaWindowOf } from './periods';
import type {
  HostSummaryMetricKind,
  PartnerSummaryMetricKind,
  SummaryHomeBlock,
  SummaryMetric,
  SummaryMetricDelta,
} from './types';

/** 🔴 ホストの KPI カードの並び（`docs/04` §4.1 の表の順。日によって並びが変わらない）。 */
export const HOST_SUMMARY_METRIC_ORDER = [
  'ACTION_QUEUE',
  'AWAITING_REPLY',
  'INTERVIEWS',
  'PROPOSALS_THIS_WEEK',
] as const satisfies readonly HostSummaryMetricKind[];

/** 🔴 取引先の KPI カードの並び（同）。 */
export const PARTNER_SUMMARY_METRIC_ORDER = [
  'REQUESTS_TO_ANSWER',
  'AWAITING_REPLY',
  'INTERVIEWS',
  'PUBLISHED_THIS_WEEK',
] as const satisfies readonly PartnerSummaryMetricKind[];

/**
 * 🔴 「返信待ち」の状態（**こちらが出して相手の返答を待っている**）。
 *    `satisfies` で `ProposalState` に縛るので、状態名が変われば（`CLAUDE.md` §4.2 は人間の
 *    承認事項）コンパイルで落ちる。
 */
export const AWAITING_REPLY_PROPOSAL_STATE = 'SUBMITTED' as const satisfies ProposalState;

/** 🔴 「面談予定」の状態。Phase 1 では到達しにくいが、**0 件でもカードは出す**（⑤）。 */
export const INTERVIEW_PROPOSAL_STATE = 'INTERVIEW_SCHEDULED' as const satisfies ProposalState;

/**
 * 件数の読み取りに使うデリゲートだけを要求する（`TenantDb` 全体を要求しない）。
 *
 * 🔴 **`engineer` は `count` のためだけに在る**（`tests/static/home-drawer-no-ledger.test.ts` の
 *    **2 系統目の例外**。初回空の判定に「人材が 1 件でも在るか」が要る）。🔴 **行を返す形は
 *    1 つも許されない**（`count` は身元を運べない）。🔴 **3 系統目の例外を作らない。**
 */
export type SummaryCountDb = Pick<
  TenantDb,
  'project' | 'engineer' | 'proposal' | 'proposalRequest' | 'projectVisibility'
>;

export type SummaryReadOptions = {
  /**
   * 🔴 基準時刻。**`GET /api/home` の `readAt` と同じインスタンス**を渡す（応答に出る
   *    「◯時◯分 時点」と差分の窓が必ず一致する。`./periods.ts` の 🔴）。
   */
  readonly now: Date;
};

/** 🔴 件数だけの中間形（**表示の語も `href` も持たない**。写像は `buildSummaryBlock` が行う）。 */
export type SummaryCounts = {
  readonly awaitingReply: number;
  readonly interviews: number;
  /** ホスト = 今週の提案 / 取引先 = 今週公開された案件。 */
  readonly thisWeek: number;
  /** 🔴 先週の同曜日・同時刻までの件数（差分の相手）。 */
  readonly lastWeek: number;
  /** 取引先のみ（ホストでは 0）。`REQUESTED` の依頼。 */
  readonly requestsToAnswer: number;
  /** 🔴 初回空の判定の材料（`./types.ts` の `initialEmpty` の 🔴）。件数は応答に出さない。 */
  readonly ledgerEmpty: boolean;
};

/**
 * 🔴 KPI の件数を読む。**`withTenant` を開かない**（呼び出し側のトランザクションに相乗りする）。
 *
 * 🔴 ホストと取引先で**読む表は同じ**（`proposals` / `projects` / `engineers`）であり、見える行が
 *    違うのは RLS である。取引先だけが `proposal_requests` と `project_visibilities` を追加で数える
 *    （返答期限と新着の公開は取引先の 1 日の主語である。`docs/04` §S-004 の「なぜこの構成か」）。
 */
export async function readSummaryCounts(
  db: SummaryCountDb,
  audience: 'HOST' | 'PARTNER',
  options: SummaryReadOptions,
): Promise<SummaryCounts> {
  // 🔴 差分の窓は `./periods.ts` の 1 実装（§7.2 が義務づけた基準時刻）。
  const week = deltaWindowOf('PREVIOUS_WEEK', options.now);
  const host = audience === 'HOST';
  // 🔴 **1 回の `Promise.all` で撃つ**（同じトランザクションの中で往復を増やさない）。
  const [awaitingReply, interviews, projects, engineers, requestsToAnswer, thisWeek, lastWeek] =
    await Promise.all([
      db.proposal.count({ where: { state: AWAITING_REPLY_PROPOSAL_STATE } }),
      db.proposal.count({ where: { state: INTERVIEW_PROPOSAL_STATE } }),
      // 🔴 初回空の判定の材料（件数そのものは応答に出さない。`./types.ts` の `initialEmpty`）。
      db.project.count({}),
      db.engineer.count({}),
      // 🔴 依頼は取引先の指標である（ホストでは読まない = クエリを 1 本増やさない）。
      host ? Promise.resolve(0) : db.proposalRequest.count({ where: { state: 'REQUESTED' } }),
      host
        ? db.proposal.count({ where: { submittedAt: { gte: week.currentFrom } } })
        : // 🔴 「解除されていない公開」だけを数える（`revoked_at IS NULL`）—— 公開が解除された案件を
          //    「今週公開された」に数え続けると、取引先が当てられない案件を追うことになる。
          db.projectVisibility.count({
            where: { publishedAt: { gte: week.currentFrom }, revokedAt: null },
          }),
      host
        ? db.proposal.count({ where: { submittedAt: { gte: week.previousFrom, lt: week.previousTo } } })
        : db.projectVisibility.count({
            where: { publishedAt: { gte: week.previousFrom, lt: week.previousTo }, revokedAt: null },
          }),
    ]);
  return {
    awaitingReply,
    interviews,
    thisWeek,
    lastWeek,
    requestsToAnswer,
    ledgerEmpty: projects === 0 && engineers === 0,
  };
}

/**
 * 🔴 `SUMMARY` ブロックを組む（**純粋関数**）。
 *
 * 🔴 **「今日やること」は要対応キューの行数そのものである**（`actionQueueCount`）。
 *    クエリを 1 本も増やさないこと以上に重要なのは、**キューの行数とカードの数が食い違わない**
 *    ことである（`docs/04` §7.2 ③ / §4.1 の非同期処理の表現「同じ応答から同時に更新する」）。
 */
export function buildSummaryBlock(
  counts: SummaryCounts,
  audience: 'HOST' | 'PARTNER',
  actionQueueCount: number,
): SummaryHomeBlock {
  const weekDelta: SummaryMetricDelta = {
    basis: 'PREVIOUS_WEEK',
    count: counts.thisWeek - counts.lastWeek,
  };
  if (audience === 'HOST') {
    const values: Readonly<Record<HostSummaryMetricKind, number>> = {
      ACTION_QUEUE: actionQueueCount,
      AWAITING_REPLY: counts.awaitingReply,
      INTERVIEWS: counts.interviews,
      PROPOSALS_THIS_WEEK: counts.thisWeek,
    };
    return {
      kind: 'SUMMARY',
      audience: 'HOST',
      initialEmpty: counts.ledgerEmpty,
      items: HOST_SUMMARY_METRIC_ORDER.map(
        (kind): SummaryMetric<HostSummaryMetricKind> => ({
          kind,
          count: values[kind],
          href: HOST_METRIC_HREFS[kind],
          // 🔴 在庫の数には差分を付けない（ファイル冒頭の 🔴）。
          delta: kind === 'PROPOSALS_THIS_WEEK' ? weekDelta : null,
        }),
      ),
    };
  }
  const values: Readonly<Record<PartnerSummaryMetricKind, number>> = {
    REQUESTS_TO_ANSWER: counts.requestsToAnswer,
    AWAITING_REPLY: counts.awaitingReply,
    INTERVIEWS: counts.interviews,
    PUBLISHED_THIS_WEEK: counts.thisWeek,
  };
  return {
    kind: 'SUMMARY',
    audience: 'PARTNER',
    initialEmpty: counts.ledgerEmpty,
    items: PARTNER_SUMMARY_METRIC_ORDER.map(
      (kind): SummaryMetric<PartnerSummaryMetricKind> => ({
        kind,
        count: values[kind],
        href: PARTNER_METRIC_HREFS[kind],
        delta: kind === 'PUBLISHED_THIS_WEEK' ? weekDelta : null,
      }),
    ),
  };
}

/**
 * 🔴 指標 → 遷移先。**既存の URL だけ**を使う（新しいルートを作らない）。
 *
 * ⚠️ **`KpiCard` は `href` を受け取らない**（`packages/ui` の部品が「カード全体をリンクにする」口を
 *    持たない。`docs/04` §4.1 は「カードは数値から遷移してよい」= 任意である）。値は**応答の契約**
 *    として残す —— 画面が遷移先を自分で決めると、§6.11.1 の「数の意味を 2 箇所で決めない」が崩れる。
 * 🔴 `null` = その指標から遷移しない（`面談予定` の `S-024` は未実装であり、404 を作らない）。
 */
const HOST_METRIC_HREFS: Readonly<Record<HostSummaryMetricKind, string | null>> = {
  // 🔴 「今日やること」はこの画面の中（要対応タブ）であり、別画面への遷移を持たない。
  ACTION_QUEUE: null,
  AWAITING_REPLY: PROPOSALS_PATH,
  INTERVIEWS: null,
  PROPOSALS_THIS_WEEK: PROPOSALS_PATH,
};

const PARTNER_METRIC_HREFS: Readonly<Record<PartnerSummaryMetricKind, string | null>> = {
  REQUESTS_TO_ANSWER: null,
  AWAITING_REPLY: PROPOSALS_PATH,
  INTERVIEWS: null,
  PUBLISHED_THIS_WEEK: PROJECT_LIST_PATH,
};

/**
 * ⚠️ 旧 `SummaryStrip` の指標が参照していた `S-005` の URL。
 * 🔴 **消さない** —— `人材` タブの `すべて見る` が同じ値を使う（出所を 2 つにしない）。
 */
export const HOME_ENGINEER_LIST_HREF = ENGINEER_LIST_PATH;
export const HOME_PROJECT_LIST_HREF = PROJECT_LIST_PATH;
