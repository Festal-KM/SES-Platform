// apps/web/lib/proposals/notes.ts
// 履歴へのメモ（docs/05 §6.5 #47 `POST /api/proposals/{id}/events`「#45 / #46 / #47 の実装の決着」/ `F-024` 入力「`ProposalEvent`
// （日時・担当者・メモ・添付）」/ `docs/04` §S-023 セクション 2 / §16.2）。T-09-09。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **状態を動かさない。** `ProposalEvent(kind='NOTE', fromState = toState = 現在の状態)` を 1 行書くだけで、`proposals` は
//      **一切 UPDATE しない**（`updated_at` も動かさない —— 一覧の並びと `S-022` の `failedAt` は `updated_at` を状態の確定時刻として
//      読んでおり、メモで動くと「送信失敗が新しくなった」ように見える）。遷移の経路は #39 / #41 / #42 / #43 / #44 / #48 とジョブだけ
//      （`CLAUDE.md` §4.2 の遷移表に無い書き込みをここから作らない）。
//   ② 🔴 **立場の判定は行を読んでから**（`canAddProposalNote` = 作成者 / ホストの `OWNER`・`ADMIN`・`SALES`。`VIEWER` は不可。
//      外れたら 403 `PROPOSAL_NOTE_FORBIDDEN`）。ロールだけでは「取引先の非作成者が他人の提案にメモを残す」を止められない。
//   ③ 🔴 監査は `AuditLog(proposal_event.create, summary = { kind })` を**同じトランザクション**で書く（`writeAuditLog`。`withApiRoute` の
//      `audit` を使わないのは 403 / 404 で記録を残さないため）。**`summary` に `note` を載せない**（自由入力 = PII を含みうる。§16.2。
//      #42 の理由 / #44 の理由 / #48 の `note` と同じ扱い）。action は `<entity>.create` の形（`engineer_career.create` /
//      `proposal_request.create` と同じ整理 —— `S-041` の `CREATE_UPDATE_DELETE` は接尾辞一致であり、独自 action にすると検索から漏れる）。
//   ④ 🔴 `kind` は `'NOTE'` の 1 値（`createProposalEventBodySchema`）。`STATE` / `ATTACHMENT` をここから書ける置き場所を作らない。
//
// 🔴 母集団はアプリが決めない —— `proposals` は RLS の C5。見えなければ 404（docs/05 §4.8）。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できる）。
import { PROPOSAL_AUDIT_TARGET_TYPE, withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import { proposalMachine, type ProposalState } from '@ses/domain';
import { InternalError, NotFoundError, ProposalNoteForbiddenError } from '../api/errors';
import { canAddProposalNote } from './policy';
import type { CreateProposalEventBody } from './schemas';
import type { ProposalActionMeta } from './service';

/** docs/05 §16.1 の `*.create`（`S-041` の操作種別フィルタは接尾辞一致）。🔴 独自 action（`proposal.note`）を作らない。 */
export const PROPOSAL_EVENT_AUDIT_ACTION_CREATE = 'proposal_event.create';

export type ProposalNoteDeps = {
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: () => Date;
  readonly meta: ProposalActionMeta;
};

/** `#47` の応答（docs/05 §6.5 #47 の `{ id }`）。 */
export type ProposalEventCreatedView = {
  readonly id: string;
};

function requireKnownState(state: string): ProposalState {
  // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
  if (!proposalMachine.isState(state)) throw new InternalError(`proposals.state が未知の値です（${state}）。`);
  return state;
}

/**
 * `POST /api/proposals/{id}/events`（#47）。人間のメモを履歴に残す。
 *
 * 手順は 1 トランザクション（`withTenant`）:
 *   ① 行を読む（C5。見えなければ 404）→ `canAddProposalNote`（外れたら 403）
 *   ② `ProposalEvent(kind='NOTE', fromState = toState = 現在の状態, actorUserId = ctx.userId, note)`
 *   ③ `AuditLog(proposal_event.create, summary = { kind })`
 * 🔴 `proposals` を UPDATE しない（状態も `updated_at` も動かない）。
 */
export async function createProposalNote(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  body: CreateProposalEventBody,
  deps: ProposalNoteDeps,
): Promise<ProposalEventCreatedView> {
  const now = deps.now();
  return withTenant(ctx, async (db) => {
    const row = await db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, state: true, createdBy: true } });
    if (row === null) throw new NotFoundError();
    // ① 🔴 行を読んでから認可する。
    if (!canAddProposalNote(ctx, { createdBy: row.createdBy })) throw new ProposalNoteForbiddenError();
    const state = requireKnownState(row.state);

    // ② 状態を動かさない印: `fromState = toState = 現在の状態`。
    const event = await db.proposalEvent.create({
      data: {
        tenantId: ctx.tenantId,
        proposalId: row.id,
        kind: body.kind,
        fromState: state,
        toState: state,
        actorUserId: ctx.userId,
        note: body.note,
        occurredAt: now,
      },
      select: { id: true },
    });

    // ③ 監査（🔴 `note` を載せない）。
    await writeAuditLog(db, {
      action: PROPOSAL_EVENT_AUDIT_ACTION_CREATE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: row.id,
      summary: { kind: body.kind },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    return { id: event.id };
  });
}
