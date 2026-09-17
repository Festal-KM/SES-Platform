// apps/web/lib/proposals/list.ts
// 提案一覧（docs/05 §6.5 #45 `GET /api/proposals`「#45 / #46 / #47 の実装の決着」/ `F-024 AC-2` `AC-3` / `docs/04` §S-019 / §4.8）。T-09-09。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **母集団はアプリが決めない。** `proposals` は RLS の C5（ホストは全件、取引先は自社が作成した行）。`where` に
//      `tenantId` / `ownerPartnerCompanyId` を書かない（`F-024 AC-3`「パートナーが参照できる提案履歴は自社が作成した提案に限られる」
//      は RLS + Prisma 拡張の二重防御が担う）。フィルタ（状態 / 案件 / エンジニア / `q`）は**業務上の絞り込み**である。
//   ② 🔴 **`byState` は境界適用後**（docs/05 §4.8「集計・KPI は分母・分子とも境界適用後」）。一覧と**同じ接続・同じ RLS** で
//      `GROUP BY state` する。ホストは全提案、取引先は自社作成分だけを数える。**14 状態のキーを必ず全部持つ**（0 件も `0`）——
//      `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` / `WITHDRAWN` が**別のキー**であることを型（`ProposalCountByState`）が固定する
//      （`F-024 AC-2` / `BR-23` / `BR-60`。4 つの「うまくいかなかった」を 1 つの区分に畳む経路を作らない）。
//   ③ 🔴 **`DECLINED` は `ProposalRequest` の状態であり `Proposal` の状態ではない。** `S-019` が出す「提案依頼の 5 状態」は
//      `requestsByState`（`proposal_requests` の C5 で `GROUP BY`）として**別のブロック**で返し、`byState` に混ぜない
//      （`docs/04` §S-019「14 状態 + 提案依頼の 5 状態」/ `F-024` 処理③）。`ProposalState` と `ProposalRequestState` が値を
//      共有しないことは `@ses/domain` の `PROPOSAL_AND_PROPOSAL_REQUEST_STATES_ARE_DISJOINT` が固定している。
//   ④ 🔴 **保留中の `APPROVED`（`sendHoldReasonKey` あり）は `SUBMIT_FAILED` ではない**（docs/05 §10.4「失敗率の指標に混入させない」）。
//      `byState` では `APPROVED` に数え、行には `sendHold` を載せて画面が**別の表示**にする。`SUBMIT_FAILED` の行に保留は残らない
//      （`settleProposalSubmission` が確定時に保留列を NULL に揃える）。
//   ⑤ 🔴 **`total` は一覧と同じ `where` の `COUNT`**（docs/05 §4.8 / `lib/api/pagination.ts`）。`byState` の母集団は**状態フィルタを
//      外した**同じ `where`（状態のチップの件数を切り替えの判断材料にするため）。境界外の行は両方に現れない。
//   ⑥ 🔴 **列を選んで写す**（`row` を spread しない）。本文・凍結のスキル・`contentHash` を一覧に載せない。エンジニア名は凍結側
//      （`EngineerSnapshot.displayName`。越境経路 2 でホストが読める唯一の実体）。取引先向けの行の型に `owner` / `sendHold` /
//      送信試行 / 失敗理由は**存在しない**（`toPartnerProposalListItem`）。
//   ⑦ 🔴 `S-022`（送信失敗一覧）は本関数を `state: ['SUBMIT_FAILED']` で呼ぶ（`send-failures.ts`。T-09-08 の `listProposalSendFailures`
//      を統合した = **1 実装**）。送信試行（`send_attempts`。C2 HOST_ONLY）は同じトランザクションで `entity_id IN (...)` で引く
//      （行ごとに引く N+1 にしない）。取引先の文脈では 0 行 = 型に載せない。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できる。`service.ts` と同方針）。
import { freeWordFilter, PROPOSAL_SEND_ENTITY_TYPE, withTenant, type AuthenticatedTenantCtx, type FreeWordFilter } from '@ses/db';
import { PROPOSAL_REQUEST_STATES, PROPOSAL_STATES, type ProposalRequestState, type ProposalState } from '@ses/domain';
import { buildCursorPage, takeForCursorPage } from '../api/pagination';
import type { ProposalListQuery } from './schemas';
import {
  toHostProposalListItem,
  toPartnerProposalListItem,
  type HostProposalListItem,
  type HostProposalOwnerView,
  type PartnerProposalListItem,
  type ProposalCountByState,
  type ProposalListItemDeps,
  type ProposalListRow,
  type ProposalProjectRef,
  type ProposalRequestCountByState,
  type ProposalSendAttemptView,
} from './views';

/** `withTenant` が `fn` に渡すクライアント。 */
export type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

type ProposalListShared = {
  /** 🔴 一覧と同じ `where` の `COUNT`（境界適用後）。 */
  readonly total: number;
  /** 🔴 境界適用後・状態フィルタ抜きの状態別件数（14 キー）。 */
  readonly byState: ProposalCountByState;
  /** 🔴 `ProposalRequest` の 5 状態の件数（別ブロック。`byState` に混ぜない）。 */
  readonly requestsByState: ProposalRequestCountByState;
  /** 次ページが無ければ `null`。残件数は返さない（§4.8）。 */
  readonly nextCursor: string | null;
};

export type HostProposalListView = ProposalListShared & {
  readonly audience: 'HOST';
  readonly items: readonly HostProposalListItem[];
};

export type PartnerProposalListView = ProposalListShared & {
  readonly audience: 'PARTNER';
  readonly items: readonly PartnerProposalListItem[];
};

export type ProposalListView = HostProposalListView | PartnerProposalListView;

/**
 * 並び。既定は**最終更新が新しい順**（`S-019` の「最終更新」列。`id` は uuid(7) なので同時刻のタイブレークも時系列）。
 * `UPDATED_ASC` は `S-022` 専用（失敗が古い順 = 放置が長いものを先に）。🔴 query（URL）からは受けない。
 */
export type ProposalListOrder = 'UPDATED_DESC' | 'UPDATED_ASC';

export type ProposalListOptions = {
  readonly order?: ProposalListOrder;
};

/**
 * 🔴 `proposals` の `select`。`ProposalListRow` の型がこの集合を固定する（本文 / 凍結の中身 / `contentHash` を読まない）。
 * ✅ T-12-15: `S-003` / `S-004` の要対応キュー（`lib/home/action-queue-read.ts`）が**同じ `select` と同じ写像**
 *    （`projectProposalListItems`）を使う —— `S-019` の行と同じ出所にし、ホーム固有の射影を作らない（2 実装にすると
 *    片方だけ境界を見ない経路になる。T-09-09 が `listProposalSendFailures` を統合したのと同じ理由）。
 */
export const PROPOSAL_LIST_SELECT = {
  id: true,
  state: true,
  proposalRequestId: true,
  sendHoldReasonKey: true,
  sendHoldSince: true,
  recipientCompanyName: true,
  recipientEmail: true,
  offeredUnitPrice: true,
  lastFailureReason: true,
  createdAt: true,
  updatedAt: true,
  // 一覧の組み立てにだけ使う参照（view には渡さない）。
  projectId: true,
  ownerPartnerCompanyId: true,
  createdBy: true,
  engineerSnapshot: { select: { displayName: true } },
} as const;

/**
 * 業務上の絞り込み（境界の絞り込みではない。ファイル冒頭の 🔴 ①）。🔴 Prisma の `WhereInput` から `Parameters<>` で導出せず、
 * **使う形だけ**を構造的に書く（`partner-companies/service.ts` の `BusinessFilter` と同じ。導出型は `groupBy` / `select` の推論を落とす）。
 */
type ProposalListWhere = {
  projectId?: string;
  engineerId?: string;
  state?: { in: ProposalState[] };
  OR?: ({ recipientCompanyName: FreeWordFilter } | { project: { name: FreeWordFilter } })[];
};

type ProposalRequestWhere = {
  projectId?: string;
  engineerId?: string;
  project?: { name: FreeWordFilter };
};

/**
 * 状態以外の絞り込み（`byState` の母集団にも使う）。
 * 🔴 `q` の対象は**提案先の社名と案件名**だけ（`schemas.ts` の注記）。案件名はリレーション越し（`projects` の RLS C4 が効くので、
 *    取引先に公開されていない案件の名前では一致しない）。
 */
function baseWhere(query: ProposalListQuery): ProposalListWhere {
  return {
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    ...(query.engineerId === undefined ? {} : { engineerId: query.engineerId }),
    ...(query.q === undefined
      ? {}
      : { OR: [{ recipientCompanyName: freeWordFilter(query.q) }, { project: { name: freeWordFilter(query.q) } }] }),
  };
}

function requestWhere(query: ProposalListQuery): ProposalRequestWhere {
  return {
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    ...(query.engineerId === undefined ? {} : { engineerId: query.engineerId }),
    ...(query.q === undefined ? {} : { project: { name: freeWordFilter(query.q) } }),
  };
}

function emptyCountByState(): Record<ProposalState, number> {
  return Object.fromEntries(PROPOSAL_STATES.map((state) => [state, 0])) as Record<ProposalState, number>;
}

function emptyRequestCountByState(): Record<ProposalRequestState, number> {
  return Object.fromEntries(PROPOSAL_REQUEST_STATES.map((state) => [state, 0])) as Record<ProposalRequestState, number>;
}

/** `GROUP BY state` の結果を 14 キーの `Record` に畳む。🔴 未知の状態（CHECK が保証するので到達しない）は握り潰さず落とす。 */
function toCountByState(groups: readonly { readonly state: string; readonly _count: { readonly _all: number } }[]): ProposalCountByState {
  const counts = emptyCountByState();
  for (const group of groups) {
    if (!(PROPOSAL_STATES as readonly string[]).includes(group.state)) {
      throw new RangeError(`proposals.state が未知の値です（${group.state}）。`);
    }
    counts[group.state as ProposalState] = group._count._all;
  }
  return counts;
}

function toRequestCountByState(
  groups: readonly { readonly state: string; readonly _count: { readonly _all: number } }[],
): ProposalRequestCountByState {
  const counts = emptyRequestCountByState();
  for (const group of groups) {
    if (!(PROPOSAL_REQUEST_STATES as readonly string[]).includes(group.state)) {
      throw new RangeError(`proposal_requests.state が未知の値です（${group.state}）。`);
    }
    counts[group.state as ProposalRequestState] = group._count._all;
  }
  return counts;
}

async function readProjectRefs(db: Pick<TenantDb, 'project'>, ids: readonly string[]): Promise<ReadonlyMap<string, ProposalProjectRef>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  // 🔴 リレーション `select` ではなく別クエリ: 取引先では `projects` の C4 が行を消すため、必須リレーションが `null` になると
  //    Prisma が例外を投げる（`service.ts` の `readProjectRef` と同じ判断）。
  const projects = await db.project.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(projects.map((project) => [project.id, { id: project.id, name: project.name }]));
}

async function readUserNames(db: Pick<TenantDb, 'user'>, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  // `users` は C8 DIRECTORY（ホスト所属の行は全員に見える。他パートナーの利用者は見えない = 名前が `null` になる）。
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
  return new Map(users.map((user) => [user.id, user.displayName]));
}

async function readOwnerNames(
  db: Pick<TenantDb, 'partnerCompany'>,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const companies = await db.partnerCompany.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(companies.map((company) => [company.id, company.name]));
}

/** 送信試行（C2 HOST_ONLY）を提案 ID ごとに畳む。取引先の文脈では呼ばない（型に載せない）。 */
export async function readSendAttemptsByProposal(
  db: Pick<TenantDb, 'sendAttempt'>,
  proposalIds: readonly string[],
): Promise<ReadonlyMap<string, readonly ProposalSendAttemptView[]>> {
  if (proposalIds.length === 0) return new Map();
  const attempts = await db.sendAttempt.findMany({
    where: { entityType: PROPOSAL_SEND_ENTITY_TYPE, entityId: { in: [...proposalIds] } },
    orderBy: [{ entityId: 'asc' }, { attemptSeq: 'asc' }],
    select: { entityId: true, attemptSeq: true, status: true, failureKind: true, startedAt: true, settledAt: true, externalId: true },
  });
  const byProposal = new Map<string, ProposalSendAttemptView[]>();
  for (const attempt of attempts) {
    const list = byProposal.get(attempt.entityId) ?? [];
    list.push({
      attemptSeq: attempt.attemptSeq,
      status: attempt.status,
      failureKind: attempt.failureKind,
      startedAt: attempt.startedAt.toISOString(),
      settledAt: attempt.settledAt?.toISOString() ?? null,
      externalId: attempt.externalId,
    });
    byProposal.set(attempt.entityId, list);
  }
  return byProposal;
}

/**
 * `GET /api/proposals`（#45）。`S-019` と `S-022` が読む。
 *
 * 手順は 1 トランザクション（`withTenant`）:
 *   ① `byState`（状態フィルタ抜き）/ `requestsByState` / `total`（一覧と同じ `where`）
 *   ② 行（`take = limit + 1` で次ページの有無を判定。カーソルは行の ID）
 *   ③ 参照の解決（案件名 / 作成者名 / ホストだけ: 作成会社名 + 送信試行）
 * 🔴 応答の型は所属で分岐する（`HostProposalListView` / `PartnerProposalListView`）。分岐の出所は `ctx.partnerCompanyId`。
 */
export async function listProposals(
  ctx: AuthenticatedTenantCtx,
  query: ProposalListQuery,
  options: ProposalListOptions = {},
): Promise<ProposalListView> {
  const order = options.order ?? 'UPDATED_DESC';
  const orderBy = order === 'UPDATED_DESC' ? [{ updatedAt: 'desc' as const }, { id: 'desc' as const }] : [{ updatedAt: 'asc' as const }, { id: 'asc' as const }];
  const base = baseWhere(query);
  const where: ProposalListWhere = { ...base, ...(query.state === undefined ? {} : { state: { in: [...query.state] } }) };
  const take = takeForCursorPage(query.limit);
  const cursor = query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 };

  return withTenant(ctx, async (db) => {
    // 🔴 4 本とも同じトランザクション（同じ RLS 文脈）で読む。`Promise.all` に束ねると Prisma の `groupBy` / `select` の型推論が
    //    落ちるため（`{}[]` / 全列に広がる）、順に await する。
    const groups = await db.proposal.groupBy({ by: ['state'], where: base, _count: { _all: true } });
    const requestGroups = await db.proposalRequest.groupBy({ by: ['state'], where: requestWhere(query), _count: { _all: true } });
    const total = await db.proposal.count({ where });
    const rows = await db.proposal.findMany({ where, select: PROPOSAL_LIST_SELECT, orderBy, take, ...cursor });
    const byState = toCountByState(groups);
    const requestsByState = toRequestCountByState(requestGroups);
    const page = buildCursorPage(rows, query.limit, (row) => row.id);
    const projected = await projectProposalListItems(ctx, db, page.items);

    return { ...projected, total, byState, requestsByState, nextCursor: page.nextCursor };
  });
}

/** `PROPOSAL_LIST_SELECT` で読んだ `proposals` の 1 行（Prisma の推論に依存しない構造的な型）。 */
export type ProposalListSelectedRow = ProposalListRow & {
  readonly projectId: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly createdBy: string;
  readonly engineerSnapshot: { readonly displayName: string } | null;
};

/** 所属で型が分かれる一覧の行（`listProposals` の `items` と同じ）。 */
export type ProposalListItemsByAudience =
  | { readonly audience: 'HOST'; readonly items: readonly HostProposalListItem[] }
  | { readonly audience: 'PARTNER'; readonly items: readonly PartnerProposalListItem[] };

/**
 * 🔴 `PROPOSAL_LIST_SELECT` で読んだ行を `S-019` の行（`HostProposalListItem` / `PartnerProposalListItem`）に写す**唯一の実装**。
 *    `listProposals`（#45 / `S-019` / `S-022`）と要対応キュー（`S-003` / `S-004`。T-12-15）が同じ関数を通る。
 *
 * - 参照の解決（案件名 / 作成者名 / ホストだけ: 作成会社名 + 送信試行）は**呼び出し側と同じトランザクション**（`db`）で行う。
 * - 🔴 分岐の出所は `ctx.partnerCompanyId` だけ（リクエスト入力を見ない）。取引先の枝では `owner` / `sendHold` / 送信試行を**読まない**。
 */
export async function projectProposalListItems(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'project' | 'user' | 'partnerCompany' | 'sendAttempt'>,
  rows: readonly ProposalListSelectedRow[],
): Promise<ProposalListItemsByAudience> {
  const [projects, userNames] = await Promise.all([
    readProjectRefs(db, rows.map((row) => row.projectId)),
    readUserNames(db, rows.map((row) => row.createdBy)),
  ]);
  const depsOf = (row: ProposalListSelectedRow): ProposalListItemDeps => ({
    project: projects.get(row.projectId) ?? null,
    engineerDisplayName: row.engineerSnapshot?.displayName ?? null,
    createdByName: userNames.get(row.createdBy) ?? null,
  });
  const rowOf = (row: ProposalListSelectedRow): ProposalListRow => ({
    id: row.id,
    state: row.state,
    proposalRequestId: row.proposalRequestId,
    sendHoldReasonKey: row.sendHoldReasonKey,
    sendHoldSince: row.sendHoldSince,
    recipientCompanyName: row.recipientCompanyName,
    recipientEmail: row.recipientEmail,
    offeredUnitPrice: row.offeredUnitPrice,
    lastFailureReason: row.lastFailureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  if (ctx.partnerCompanyId !== null) {
    return {
      audience: 'PARTNER',
      items: rows.map((row) => toPartnerProposalListItem(rowOf(row), depsOf(row))),
    };
  }

  const [ownerNames, attempts] = await Promise.all([
    readOwnerNames(db, rows.map((row) => row.ownerPartnerCompanyId)),
    readSendAttemptsByProposal(db, rows.map((row) => row.id)),
  ]);
  const ownerOf = (ownerPartnerCompanyId: string | null): HostProposalOwnerView => {
    if (ownerPartnerCompanyId === null) return { kind: 'HOST' };
    const name = ownerNames.get(ownerPartnerCompanyId);
    // FK（Restrict）が保証しているので到達しない。握り潰さず落とす。
    if (name === undefined) throw new RangeError(`partner_companies が見つかりません（id=${ownerPartnerCompanyId}）。`);
    return { kind: 'PARTNER', partnerCompanyName: name };
  };
  return {
    audience: 'HOST',
    items: rows.map((row) =>
      toHostProposalListItem(rowOf(row), depsOf(row), {
        owner: ownerOf(row.ownerPartnerCompanyId),
        sendAttempts: attempts.get(row.id) ?? [],
      }),
    ),
  };
}
