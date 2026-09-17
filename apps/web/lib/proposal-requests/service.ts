// apps/web/lib/proposal-requests/service.ts
// 提案依頼の発行・一覧・取り下げ（docs/05 §6.5 #31 / #32 / #35 / §4.5「T-08-06 の決着」/ `F-018` /
// `F-017 AC-4` / `S-016` / `S-017`）。T-08-06。
//
// ============================================================================
// 🔴 ここは越境経路 4（`CLAUDE.md` §3.1）の「提案依頼」側の**唯一の実装**である
// ============================================================================
//   ① 🔴 **`candidateRef` は capability ではない**（T-08-05 の申し送り）。参照子を知っているだけで依頼は
//      成立しない。呼び出し元がホストであること（`withSharedCandidateScope` の `requireHost` + 本ファイルの
//      `assertHostContext`）、参照子が**この案件**の `MatchCandidate` に一致すること、**その時点で共有中**で
//      あること（`issueProposalRequest` が共有ポリシー越しに `engineers` を再読）を**すべて**通す。
//   ② 🔴 **逆引き（`candidateRef` → `engineer_id`）はサーバ側だけで行い、`engineer_id` を応答に載せない。**
//      HMAC なので総当たりだが、母集団は「この案件の匿名候補」（`listAnonymousCandidateEngineerIds`）に
//      限られ小さい（docs/05 §4.6）。
//   ③ 🔴 **依頼先（`partner_company_id`）をアプリ層で決めない。** 値は共有スコープの中で
//      `packages/db` が `engineers.owner_partner_company_id` から書き、ここには 1 度も返らない（`BR-06`）。
//   ④ 🔴 **共有が解除された候補 / 他案件の参照子 / 改ざんした参照子は 404**（存在を示唆しない断り方。
//      docs/05 §4.8。409 にしない —— 409 は「存在するが状態が合わない」を教える）。
//   ⑤ 🔴 **依頼メッセージに商流情報を含めない**（`F-018` 入力）。共有スコープを開く**前**に
//      `checkProposalRequestMessage` で弾く（422）。落ちた要求は共有スコープを開かない。
//   ⑥ 🔴 **`CLAUDE.md` §4.2 に無い遷移は 422**（`proposalRequestMachine.transition()` + CAS。サイレントに
//      無視しない。`BR-33`）。本ファイルが動かす遷移は `REQUESTED → WITHDRAWN_BY_HOST`（#35）/
//      `REQUESTED → ACCEPTED`（#33）/ `REQUESTED → DECLINED`（#34）の 3 つであり、`EXPIRED` は
//      `packages/db` の `expireProposalRequests`（ジョブ文脈）が持つ。
//   ⑦ 🔴 **応諾（`ACCEPTED`）と `Proposal(DRAFT)` の生成は同一トランザクション**（`docs/02` `program-design`
//      申し送り 12 / `F-018 AC-3`）。片方だけ成立する状態を作らない。生成の実体は `packages/db` の
//      `createProposalDraft`（#36 と同じ 1 実装。docs/05 §6.5「T-08-07 の決着」）。
//   ⑧ 🔴 **辞退の理由はパートナー社内限定**（`BR-57`）。行の `decline_reason` に書き、監査の `summary` にも
//      ホスト向けの型にも載せない。
//
// 🔴 **`withSharedCandidateScope` を import してよいのは本ファイルと `lib/candidates/list.ts` だけ**である
//    （`eslint.config.mjs` の `SHARED_CANDIDATE_CALLER_FILES` / `tests/static/auth-db-callers.test.ts`。
//    docs/05 §4.5）。3 つ目を作るときは同じ手順（ゾーン + 許可リスト）を踏む。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/domain` のみ）。結合テストが
//    サーバを立てずに同じ経路を実行できるようにするため（`lib/engineer-shares/service.ts` と同じ方針）。
import {
  createProposalDraft,
  PROPOSAL_REQUEST_AUDIT_ACTION_UPDATE,
  SharedCandidateProjectNotFoundError,
  withSharedCandidateScope,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  InvalidStateTransitionError as DomainInvalidStateTransitionError,
  proposalRequestMachine,
  type ProposalRequestState,
} from '@ses/domain';
import {
  InternalError,
  NotFoundError,
  ProposalRequestMessageCommerceError,
  ProposalRequestProjectNotSharedError,
  ValidationError,
} from '../api/errors';
import { buildCursorPage, takeForCursorPage } from '../api/pagination';
import type { CandidateReference } from '../anonymize/reference';
import { decimalToNumber } from '../format/db-values';
import {
  PROJECT_VIEW_VIA,
  readProjectCandidateContext,
  recordProjectView,
} from '../projects/service';
import {
  INVALID_TRANSITION_AUDIT_ACTION,
  rethrowWithInvalidTransitionAudit as rethrowWithInvalidTransitionAuditShared,
} from '../state/invalid-transition';
import { checkProposalRequestMessage } from './message-check';
import {
  PROPOSAL_REQUEST_EXPIRY_MAX_DAYS,
  type ProposalRequestCreateBody,
  type ProposalRequestDeclineBody,
  type ProposalRequestListQuery,
} from './schemas';
import {
  toHostProposalRequestView,
  toPartnerProposalRequestDetailView,
  toPartnerProposalRequestView,
  type PartnerProposalRequestDetailView,
  type ProposalRequestEngineerRef,
  type ProposalRequestListView,
  type ProposalRequestProjectRef,
  type ProposalRequestRow,
} from './views';

/**
 * docs/05 §16.1 の `*.update`（取り下げ / 応諾 / 辞退。区別は `summary.operation`）。発行
 * （`proposal_request.create`）は `packages/db` の `PROPOSAL_REQUEST_AUDIT_ACTION_CREATE` が共有スコープの中で書き、
 * 期限切れ（`operation='EXPIRE'`）は `packages/db` の `expireProposalRequests` がジョブ文脈で書く。
 * 🔴 独自 action（`proposal_request.withdraw` / `.accept` / `.decline`）を作らない（`S-041` の操作種別フィルタは
 *    接尾辞一致。`engineer_share.update` / `partner_company.update` と同じ理由）。
 * 🔴 文字列は `@ses/db` の 1 か所から引く（ジョブ側と同じ action であることを型で固定する）。
 */
export const PROPOSAL_REQUEST_AUDIT_ACTIONS = {
  update: PROPOSAL_REQUEST_AUDIT_ACTION_UPDATE,
  /** docs/05 §15.3「`AuditLog(action='state.invalid_transition')` に `{ entity, from, to }` を記録する」。 */
  invalidTransition: INVALID_TRANSITION_AUDIT_ACTION,
} as const;

export const PROPOSAL_REQUEST_OPERATIONS = {
  withdraw: 'WITHDRAW',
  accept: 'ACCEPT',
  decline: 'DECLINE',
} as const;

/** 監査ログに載せる補助情報（IP はリクエストから、端末種別は ctx から）。 */
export type ProposalRequestMeta = {
  readonly ipAddress: string | null;
};

/** `POST /api/proposal-requests`（#31）の応答。🔴 `id` だけ（`engineer_id` / 依頼先を載せない）。 */
export type ProposalRequestIssuedView = {
  readonly id: string;
};

/** 起動時 DI と実行時刻（`bootstrap.ts` の `candidateReference()` / `new Date()`）。 */
export type ProposalRequestIssueDeps = {
  /** 🔴 鍵そのものではなく、鍵を閉じ込めた参照子の生成関数（`lib/candidates/list.ts` と同じ）。 */
  readonly candidateRef: CandidateReference;
  readonly now: () => Date;
  readonly meta: ProposalRequestMeta;
};

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使う部分。 */
type ProposalRequestDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

const DAY_MS = 86_400_000;

/**
 * 🔴 **パートナー文脈からは 1 件も触らせない**（発行・取り下げ。`F-018` 関連ロール）。
 *
 * ルートの `requireRole(PROPOSAL_REQUEST_ISSUER_ROLES)` が先に 403 を返すので通常はここへ到達しない。
 * それでも置くのは、**ロールと所属は別の軸**だからである（`engineer-shares/service.ts` の
 * `assertPartnerContext` と鏡写し）。🔴 **404** にする（403 と区別しない。docs/05 §4.8 —— 経路 4 の
 * 「依頼する側」の業務の存在をパートナーに示唆しない。`HostOnlyContextError` の写像と同じ）。
 */
function assertHostContext(ctx: AuthenticatedTenantCtx): void {
  if (ctx.partnerCompanyId !== null) throw new NotFoundError();
}

/**
 * 🔴 **ホスト文脈からは応諾・辞退・`S-018` に到達させない**（T-08-07。`F-018` 関連ロール / `docs/04` §S-018
 *    権限差分「ホスト側ロールはこの画面に到達しない」）。
 *
 * ルートの `requireRole(PROPOSAL_REQUEST_RESPONDER_ROLES)` が先に 403 を返すが、**ロールと所属は別の軸**である
 * （`assertHostContext` と鏡写し）。🔴 **404** にする（403 と区別しない。docs/05 §4.8）。
 * 🔴 ホストが応諾できると「匿名候補を自分で開示する」経路になる（`F-017 AC-6`）。開示の主体は共有元だけである。
 */
function assertPartnerContext(ctx: AuthenticatedTenantCtx): asserts ctx is AuthenticatedTenantCtx & {
  readonly partnerCompanyId: string;
} {
  if (ctx.partnerCompanyId === null) throw new NotFoundError();
}

/**
 * 返答期限の検証（現在より後、かつ `PROPOSAL_REQUEST_EXPIRY_MAX_DAYS` 以内）。
 * 🔴 純粋関数（`now` を受け取る）。スキーマに置かないのは現在時刻を要するため。
 */
export function validateExpiresAt(expiresAtIso: string, now: Date): Date {
  const expiresAt = new Date(expiresAtIso);
  const max = now.getTime() + PROPOSAL_REQUEST_EXPIRY_MAX_DAYS * DAY_MS;
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > max) {
    throw new ValidationError(['body.expiresAt']);
  }
  return expiresAt;
}

/**
 * `POST /api/proposal-requests`（#31。`F-018` 処理①）。
 *
 * 手順（2 トランザクション。docs/05 §6.5「#31 の実装の決着」）:
 *   1. `withTenant`: 案件を読む（見えなければ 404）→ 依頼メッセージの商流検証（422）
 *   2. `withSharedCandidateScope`: 逆引き → 共有中の再確認 → INSERT → 監査（`packages/db`）
 *
 * 🔴 1 と 2 を 1 つのトランザクションにしない —— 共有スコープは `app.shared_scope = 'on'` を立てる
 *    限定経路であり、その中で行う読み書きは `SharedCandidateDb` の専用メソッドに限られる（案件の
 *    商流列を読む素の `project` デリゲートを持たない。docs/05 §4.5 改訂 9）。
 */
export async function issueProposalRequest(
  ctx: AuthenticatedTenantCtx,
  body: ProposalRequestCreateBody,
  deps: ProposalRequestIssueDeps,
): Promise<ProposalRequestIssuedView> {
  assertHostContext(ctx);
  const now = deps.now();
  const expiresAt = validateExpiresAt(body.expiresAt, now);

  // 1. 案件の商流列を読み、依頼メッセージを照合する（🔴 ここに境界の条件を書かない。`projects` の RLS C4 が
  //    母集団を決め、見えない案件は `null` ＝ 404）。
  await withTenant(ctx, async (db) => {
    const project = await db.project.findFirst({
      where: { id: body.projectId },
      select: { id: true, endClientName: true, internalUnitPrice: true, unitPriceMin: true, unitPriceMax: true },
    });
    if (project === null) throw new NotFoundError();
    const check = checkProposalRequestMessage(body.message, {
      endClientName: project.endClientName,
      internalUnitPrice: decimalToNumber(project.internalUnitPrice),
      unitPriceMin: decimalToNumber(project.unitPriceMin),
      unitPriceMax: decimalToNumber(project.unitPriceMax),
    });
    if (!check.ok) throw new ProposalRequestMessageCommerceError(check.categories);
  });

  // 2. 逆引きと発行（共有スコープ）。
  let result: Awaited<ReturnType<typeof issueInSharedScope>>;
  try {
    result = await issueInSharedScope(ctx, body, expiresAt, deps);
  } catch (error: unknown) {
    // 🔴 1 で見えた案件が 2 で見えないのは削除競合だけだが、断り方は同じ 404 に畳む（docs/05 §4.8）。
    if (error instanceof SharedCandidateProjectNotFoundError) throw new NotFoundError();
    throw error;
  }
  // 🔴 「参照子が一致しない」と「共有が解除されている」を区別しない（どちらも 404）。
  if (result === null) throw new NotFoundError();
  return { id: result };
}

/**
 * 共有スコープの中で行う部分。🔴 戻り値は作成した `id` か `null`（`engineer_id` を外へ出さない）。
 */
async function issueInSharedScope(
  ctx: AuthenticatedTenantCtx,
  body: ProposalRequestCreateBody,
  expiresAt: Date,
  deps: ProposalRequestIssueDeps,
): Promise<string | null> {
  return withSharedCandidateScope(ctx, body.projectId, async (db) => {
    // 🔴 逆引きの母集団は**この案件の** `MatchCandidate`（C2）だけ。他案件の参照子は一致しない
    //    （参照子は案件スコープ。docs/05 §4.6）。
    const engineerIds = await db.listAnonymousCandidateEngineerIds();
    const engineerId = engineerIds.find((id) => deps.candidateRef(db.projectId, id) === body.candidateRef);
    if (engineerId === undefined) return null;

    // 🔴 `issueProposalRequest` が共有ポリシー越しに `engineers` を読み直す ＝ いま共有中かの再確認。
    //    解除済みなら `NOT_SHARED`（`MatchCandidate` の行が古くても発行されない。`F-016 AC-2`）。
    const issued = await db.issueProposalRequest({
      engineerId,
      message: body.message,
      expiresAt,
      ipAddress: deps.meta.ipAddress,
    });
    return issued.kind === 'ISSUED' ? issued.id : null;
  });
}

/** `proposal_requests` の並び（新しい依頼が先。`id` は uuid(7) なので同時刻のタイブレークも時系列）。 */
const PROPOSAL_REQUEST_ORDER_BY = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/**
 * 🔴 両 view が読む列だけを `select` する（`declineReason` / `engineerId` / `partnerCompanyId` / `issuedBy` /
 *    `respondedBy` を **`select` に書かない**）。`ProposalRequestRow` の型がこの集合を固定する。
 */
const PROPOSAL_REQUEST_ROW_SELECT = {
  id: true,
  projectId: true,
  state: true,
  message: true,
  expiresAt: true,
  createdAt: true,
  respondedAt: true,
} as const;

/** 🔴 T-12-15 指摘 5: `lib/home/action-queue-read.ts` の `readProjectNames` と同じ実装だったため、ここへ寄せて再利用する。 */
export async function readProjectRefs(
  db: Pick<ProposalRequestDb, 'project'>,
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, ProposalRequestProjectRef>> {
  if (projectIds.length === 0) return new Map();
  // 🔴 リレーション `select` ではなく別クエリ: 取引先では `projects` の C4 が行を消すため、必須リレーションが
  //    `null` になると Prisma が例外を投げる。無い案件は view で `null` になる（docs/05 §6.5 #32 の決着）。
  const rows = await db.project.findMany({
    where: { id: { in: [...new Set(projectIds)] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }]));
}

/** 🔴 T-12-15 指摘 5: `lib/home/action-queue-read.ts` の `readEngineerNames` と同じ実装だったため、ここへ寄せて再利用する。 */
export async function readEngineerRefs(
  db: Pick<ProposalRequestDb, 'engineer'>,
  engineerIds: readonly string[],
): Promise<ReadonlyMap<string, ProposalRequestEngineerRef>> {
  if (engineerIds.length === 0) return new Map();
  const rows = await db.engineer.findMany({
    where: { id: { in: [...new Set(engineerIds)] } },
    select: { id: true, displayName: true },
  });
  return new Map(rows.map((row) => [row.id, { id: row.id, displayName: row.displayName }]));
}

/**
 * `GET /api/proposal-requests`（#32 / `S-017`）。
 *
 * 🔴 母集団は `proposal_requests` の RLS（C5 PARTY）が決める —— ホストは自社テナントの全件、取引先は
 *    **依頼先が自社の行だけ**。本モジュールは `where` に `tenantId` / `partnerCompanyId` を書かない。
 * 🔴 応答の型は所属で分岐する（`HostProposalRequestView` / `PartnerProposalRequestView`。`views.ts`）。
 *    分岐の出所は `ctx.partnerCompanyId`（認証コンテキスト）だけである。
 * 🔴 取引先の `engineerId` の読み取りは**取引先の枝でだけ**行う（ホストの枝は `engineerId` を `select` に
 *    含めず、行の型（`ProposalRequestRow`）にも無い）。
 */
export async function listProposalRequests(
  ctx: AuthenticatedTenantCtx,
  query: ProposalRequestListQuery,
): Promise<ProposalRequestListView> {
  return withTenant(ctx, async (db) => {
    const where = query.state === undefined ? {} : { state: query.state };
    const take = takeForCursorPage(query.limit);
    const cursor = query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 };

    if (ctx.partnerCompanyId === null) {
      const rows: readonly ProposalRequestRow[] = await db.proposalRequest.findMany({
        where,
        select: PROPOSAL_REQUEST_ROW_SELECT,
        orderBy: [...PROPOSAL_REQUEST_ORDER_BY],
        take,
        ...cursor,
      });
      const page = buildCursorPage(rows, query.limit, (row) => row.id);
      const projects = await readProjectRefs(db, page.items.map((row) => row.projectId));
      return {
        audience: 'HOST',
        items: page.items.map((row) => toHostProposalRequestView(row, projects.get(row.projectId) ?? null)),
        nextCursor: page.nextCursor,
      };
    }

    const rows = await db.proposalRequest.findMany({
      where,
      // 🔴 取引先の枝だけ `engineerId` を読む（自社の台帳の実名を出すため。`docs/04` §S-017）。
      select: { ...PROPOSAL_REQUEST_ROW_SELECT, engineerId: true },
      orderBy: [...PROPOSAL_REQUEST_ORDER_BY],
      take,
      ...cursor,
    });
    const page = buildCursorPage(rows, query.limit, (row) => row.id);
    const [projects, engineers] = await Promise.all([
      readProjectRefs(db, page.items.map((row) => row.projectId)),
      readEngineerRefs(db, page.items.map((row) => row.engineerId)),
    ]);
    return {
      audience: 'PARTNER',
      items: page.items.map((row) =>
        toPartnerProposalRequestView(
          row,
          projects.get(row.projectId) ?? null,
          engineers.get(row.engineerId) ?? null,
        ),
      ),
      nextCursor: page.nextCursor,
    };
  });
}

/** 取り下げの実行時刻と監査の補助情報。 */
export type ProposalRequestWithdrawDeps = {
  readonly now: () => Date;
  readonly meta: ProposalRequestMeta;
};

/**
 * `POST /api/proposal-requests/{id}/withdraw`（#35。`F-018` 処理⑤ / `CLAUDE.md` §4.2
 * `REQUESTED ──ホストが取り下げ──> WITHDRAWN_BY_HOST`）。
 *
 * 🔴 遷移の判定は `proposalRequestMachine.transition()` の 1 か所（状態をここに列挙しない）。
 *    `REQUESTED` 以外からは `InvalidStateTransitionError`（422）。**サイレントに無視しない**（`BR-33`）。
 * 🔴 更新は **CAS**（`WHERE state = 'REQUESTED'`）。読んでから書くまでの間に取引先が応諾していれば 0 件になり、
 *    現在の状態を読み直して 422 と一緒に返す（docs/05 §15.3「状態を変えない」）。応諾済みの依頼を
 *    取り下げ済みに上書きすることは、DB レベルで起こり得ない。
 * 🔴 `responded_at` / `responded_by` に取り下げの時刻と実行者を書く（意味は「`REQUESTED` を離れた時刻と主体」。
 *    docs/05 §6.5「#35 の実装の決着」）。
 * 🔴 監査は**業務トランザクションの内側**（`writeAuditLog`）。書けなければ取り下げも成立しない。
 *    `withApiRoute` の `audit` を使わないのは、起きなかった操作（404 / 422）まで残るため。
 * 🔴 遷移表に無い遷移を要求されたら `state.invalid_transition` を**別トランザクション**で記録する
 *    （docs/05 §15.3。業務トランザクションは巻き戻るので、その中には書けない）。
 */
export async function withdrawProposalRequest(
  ctx: AuthenticatedTenantCtx,
  proposalRequestId: string,
  deps: ProposalRequestWithdrawDeps,
): Promise<void> {
  assertHostContext(ctx);
  const now = deps.now();

  try {
    await withTenant(ctx, async (db) => {
      // 🔴 母集団は `proposal_requests` の RLS（C5）。見えない ID は `null` ＝ 404（docs/05 §4.8）。
      const row = await db.proposalRequest.findFirst({
        where: { id: proposalRequestId },
        select: { id: true, state: true },
      });
      if (row === null) throw new NotFoundError();
      if (!proposalRequestMachine.isState(row.state)) {
        // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
        throw new InternalError(`proposal_requests.state が未知の値です（${row.state}）。`);
      }

      // 🔴 遷移表の判定（`REQUESTED` 以外はここで `InvalidStateTransitionError`）。
      const to = proposalRequestMachine.transition(row.state, 'WITHDRAWN_BY_HOST');

      const updated = await db.proposalRequest.updateMany({
        where: { id: row.id, state: 'REQUESTED' },
        data: { state: to, respondedAt: now, respondedBy: ctx.userId },
      });
      if (updated.count !== 1) {
        // 読んでから今までの間に他の遷移が確定した。現在の状態を読み直して 422 に載せる（§15.3）。
        const current = await db.proposalRequest.findFirst({
          where: { id: row.id },
          select: { state: true },
        });
        throw new DomainInvalidStateTransitionError(
          proposalRequestMachine.entity,
          current?.state ?? row.state,
          'WITHDRAWN_BY_HOST',
        );
      }

      await writeAuditLog(db, {
        action: PROPOSAL_REQUEST_AUDIT_ACTIONS.update,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: 'ProposalRequest',
        targetId: row.id,
        // 🔴 `engineer_id` / 依頼先 / 参照子 / 本文を載せない（`CLAUDE.md` §10.5 / docs/05 §16.2）。
        summary: {
          operation: PROPOSAL_REQUEST_OPERATIONS.withdraw,
          fromState: 'REQUESTED',
          toState: to,
        },
        ipAddress: deps.meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });
    });
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(ctx, proposalRequestId, error, deps.meta);
  }
}

/**
 * 🔴 遷移表に無い遷移を要求されたら `state.invalid_transition` を**別トランザクション**で記録してから、
 *    API の 422 型に写して投げ直す（docs/05 §15.3。業務トランザクションは巻き戻るので、その中には書けない）。
 *    それ以外の例外はそのまま投げ直す。**常に throw する**（戻り値は無い）。
 * 🔴 T-09-02: 実体は `lib/state/invalid-transition.ts` の 1 実装（提案 #48 / #39 と同じ関数）。
 */
async function rethrowWithInvalidTransitionAudit(
  ctx: AuthenticatedTenantCtx,
  proposalRequestId: string,
  error: unknown,
  meta: ProposalRequestMeta,
): Promise<never> {
  return rethrowWithInvalidTransitionAuditShared(
    ctx,
    { targetType: 'ProposalRequest', targetId: proposalRequestId, ipAddress: meta.ipAddress },
    error,
  );
}

/**
 * 取引先の応答（応諾 / 辞退）の共通部分: 自社宛の行を読み、遷移表で判定し、CAS で `REQUESTED` を離れる。
 *
 * 🔴 母集団は `proposal_requests` の RLS（C5。取引先は依頼先 = 自社の行だけ）。`where` に
 *    `partnerCompanyId` を書かない。見えない ID は 404（docs/05 §4.8）。
 * 🔴 CAS が 0 件なら現在の状態を読み直して `InvalidStateTransitionError`（§15.3「状態を変えない」）。
 *    読んでから書くまでの間にホストが取り下げていれば、応諾は成立しない（`docs/04` §S-018「応諾の競合」）。
 */
type PartnerRespondDb = Pick<ProposalRequestDb, 'proposalRequest'>;

async function readRequestedRowForPartner(
  db: PartnerRespondDb,
  proposalRequestId: string,
): Promise<{ readonly id: string; readonly projectId: string; readonly engineerId: string; readonly state: ProposalRequestState }> {
  const row = await db.proposalRequest.findFirst({
    where: { id: proposalRequestId },
    select: { id: true, projectId: true, engineerId: true, state: true },
  });
  if (row === null) throw new NotFoundError();
  if (!proposalRequestMachine.isState(row.state)) {
    // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
    throw new InternalError(`proposal_requests.state が未知の値です（${row.state}）。`);
  }
  return { id: row.id, projectId: row.projectId, engineerId: row.engineerId, state: row.state };
}

async function leaveRequestedByCas(
  db: PartnerRespondDb,
  ctx: AuthenticatedTenantCtx,
  row: { readonly id: string; readonly state: ProposalRequestState },
  to: 'ACCEPTED' | 'DECLINED',
  data: { readonly respondedAt: Date; readonly declineReason: string | null },
): Promise<void> {
  // 🔴 遷移表の判定はここ 1 か所（`REQUESTED` 以外はここで `InvalidStateTransitionError`）。
  const next = proposalRequestMachine.transition(row.state, to);
  const updated = await db.proposalRequest.updateMany({
    where: { id: row.id, state: 'REQUESTED' },
    data: {
      state: next,
      respondedAt: data.respondedAt,
      respondedBy: ctx.userId,
      declineReason: data.declineReason,
    },
  });
  if (updated.count !== 1) {
    const current = await db.proposalRequest.findFirst({ where: { id: row.id }, select: { state: true } });
    throw new DomainInvalidStateTransitionError(proposalRequestMachine.entity, current?.state ?? row.state, to);
  }
}

/** 応諾・辞退の実行時刻と監査の補助情報。 */
export type ProposalRequestRespondDeps = {
  readonly now: () => Date;
  readonly meta: ProposalRequestMeta;
};

/** `POST /api/proposal-requests/{id}/accept`（#33）の応答。 */
export type ProposalRequestAcceptedView = {
  readonly proposalId: string;
};

/**
 * `POST /api/proposal-requests/{id}/accept`（#33。`F-018` 処理③ / `AC-3` / `CLAUDE.md` §4.2
 * `REQUESTED ──パートナーが応諾──> ACCEPTED ──> Proposal を DRAFT で生成`）。T-08-07。
 *
 * 🔴 **1 トランザクション**（docs/05 §6.5「T-08-07 の決着」）:
 *   ① 自社宛の行を読む（C5。見えなければ 404）
 *   ② 遷移表の判定（`REQUESTED` 以外は 422）—— CAS の前に一度判定し、無駄な読み取りを避ける
 *   ③ 案件の共通部分を読む（C4。**自社に公開されていなければ 422 `PROPOSAL_REQUEST_PROJECT_NOT_SHARED`**。
 *      自動公開はしない。案件を読んだ記録 `project.view` / `via='PROPOSAL_REQUEST'` を同じトランザクションで書く）
 *   ④ CAS で `ACCEPTED` へ（0 件なら 422。ホストの取り下げと競合した場合）
 *   ⑤ `createProposalDraft`（`Proposal(DRAFT)` + `EngineerSnapshot` + `ProposalEvent` + `proposal.create`）
 *      🔴 **ここで初めて実名・所属会社名・スキルシートがホストに開示される**（経路 2 に合流）
 *   ⑥ `proposal_request.update` / `operation='ACCEPT'`（`summary` に `proposalId` を載せる。`engineer_id` は載せない）
 * 🔴 ④〜⑥のどれが失敗しても全部が巻き戻る（`ACCEPTED` だけ / `Proposal` だけ、のどちらも DB に現れない）。
 * 🔴 提案先は空文字で保存する（#33 は提案先を決められる主体を持たない。`S-020` / #37 が埋める。docs/05 §6.5）。
 */
export async function acceptProposalRequest(
  ctx: AuthenticatedTenantCtx,
  proposalRequestId: string,
  deps: ProposalRequestRespondDeps,
): Promise<ProposalRequestAcceptedView> {
  assertPartnerContext(ctx);
  const now = deps.now();

  try {
    return await withTenant(ctx, async (db) => {
      const row = await readRequestedRowForPartner(db, proposalRequestId);
      // ② 先に遷移表で判定する（終端の依頼で案件を読みに行かない）。
      proposalRequestMachine.transition(row.state, 'ACCEPTED');

      // ③ 🔴 案件が見えるか（C4）。`where` に公開範囲の条件を書かない。
      const project = await readProjectCandidateContext(db, row.projectId);
      if (project === null) throw new ProposalRequestProjectNotSharedError();
      await recordProjectView(db, ctx, project.id, PROJECT_VIEW_VIA.proposalRequest, deps.meta);

      // ④ CAS。
      await leaveRequestedByCas(db, ctx, row, 'ACCEPTED', { respondedAt: now, declineReason: null });

      // ⑤ 凍結と DRAFT（同じトランザクション）。
      const draft = await createProposalDraft(db, ctx, {
        projectId: row.projectId,
        engineerId: row.engineerId,
        proposalRequestId: row.id,
        recipient: { companyName: '', email: '' },
        frozenAt: now,
        ipAddress: deps.meta.ipAddress,
      });

      // ⑥ 監査（同じトランザクション）。
      await writeAuditLog(db, {
        action: PROPOSAL_REQUEST_AUDIT_ACTIONS.update,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: 'ProposalRequest',
        targetId: row.id,
        // 🔴 `engineer_id` / 依頼先 / 本文を載せない（`CLAUDE.md` §10.5 / docs/05 §16.2）。
        summary: {
          operation: PROPOSAL_REQUEST_OPERATIONS.accept,
          fromState: 'REQUESTED',
          toState: 'ACCEPTED',
          proposalId: draft.id,
        },
        ipAddress: deps.meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });

      return { proposalId: draft.id };
    });
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(ctx, proposalRequestId, error, deps.meta);
  }
}

/**
 * `POST /api/proposal-requests/{id}/decline`（#34。`F-018` 処理④ / `AC-1` / `BR-57`）。T-08-07。
 *
 * 🔴 `REQUESTED → DECLINED` を遷移表 + CAS で確定し、`decline_reason` に理由（任意。空なら `NULL`）を書く。
 * 🔴 理由は**パートナー社内限定**: 監査の `summary` に載せず、ホスト向けの型にも無い（`F-018 AC-1`）。
 * 🔴 案件が公開されていなくても辞退はできる（辞退に案件の内容は要らない。`BR-57`「断る自由」）。
 */
export async function declineProposalRequest(
  ctx: AuthenticatedTenantCtx,
  proposalRequestId: string,
  body: ProposalRequestDeclineBody,
  deps: ProposalRequestRespondDeps,
): Promise<void> {
  assertPartnerContext(ctx);
  const now = deps.now();
  const reason = body.reason === undefined || body.reason === '' ? null : body.reason;

  try {
    await withTenant(ctx, async (db) => {
      const row = await readRequestedRowForPartner(db, proposalRequestId);
      await leaveRequestedByCas(db, ctx, row, 'DECLINED', { respondedAt: now, declineReason: reason });

      await writeAuditLog(db, {
        action: PROPOSAL_REQUEST_AUDIT_ACTIONS.update,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: 'ProposalRequest',
        targetId: row.id,
        // 🔴 理由を載せない（運営者が横断検索する。理由は行にだけ在る）。
        summary: {
          operation: PROPOSAL_REQUEST_OPERATIONS.decline,
          fromState: 'REQUESTED',
          toState: 'DECLINED',
        },
        ipAddress: deps.meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });
    });
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(ctx, proposalRequestId, error, deps.meta);
  }
}

/**
 * `S-018` の読み取り（T-08-07）。取引先専用。
 *
 * 🔴 ホスト文脈は 404（`assertPartnerContext`）。母集団は `proposal_requests` の RLS（C5）。
 * 🔴 案件の共通部分（`ProjectDetailShared`。商流情報を型として持たない）は `readProjectCandidateContext`
 *    で読み、**読めたときだけ** `project.view` / `via='PROPOSAL_REQUEST'` を同じトランザクションで書く
 *    （`BR-27`。見えなかった案件の「閲覧」は記録しない）。自社に公開されていなければ `project: null`。
 * 🔴 `declineReason` はここでだけ返す（自社の記録。`F-018 AC-1`）。
 * 🔴 `proposalId` は `Proposal.proposalRequestId` の逆引き（自社が作成した行なので C5 で読める）。
 */
export async function readPartnerProposalRequestDetail(
  ctx: AuthenticatedTenantCtx,
  proposalRequestId: string,
  meta: ProposalRequestMeta,
): Promise<PartnerProposalRequestDetailView> {
  assertPartnerContext(ctx);
  return withTenant(ctx, async (db) => {
    const row = await db.proposalRequest.findFirst({
      where: { id: proposalRequestId },
      select: { ...PROPOSAL_REQUEST_ROW_SELECT, engineerId: true, declineReason: true },
    });
    if (row === null) throw new NotFoundError();

    const project = await readProjectCandidateContext(db, row.projectId);
    if (project !== null) {
      await recordProjectView(db, ctx, project.id, PROJECT_VIEW_VIA.proposalRequest, meta);
    }
    const engineers = await readEngineerRefs(db, [row.engineerId]);
    const proposal =
      row.state === 'ACCEPTED'
        ? await db.proposal.findFirst({ where: { proposalRequestId: row.id }, select: { id: true } })
        : null;

    return toPartnerProposalRequestDetailView(
      row,
      project,
      engineers.get(row.engineerId) ?? null,
      proposal?.id ?? null,
    );
  });
}
