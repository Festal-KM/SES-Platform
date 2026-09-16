// apps/web/lib/proposals/detail.ts
// 提案詳細と履歴（docs/05 §6.5 #46 `GET /api/proposals/{id}`「#45 / #46 / #47 の実装の決着」/ `F-024 AC-3` / `F-037 AC-1` /
// `docs/04` §S-023 / §4.8）。T-09-09。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **エンジニアの情報は凍結側（`EngineerSnapshot`）だけ**（`F-019 AC-1`。`readProposalViewInTx` と同じ）。経歴は凍結行
//      （`snapshot.careers`。`FrozenCareer[]`）を**行単位でそのまま**返し、`engineers` / `engineer_careers` を 1 度も読まない
//      （docs/05 §6.5「`S-023` は凍結側だけを返す API で描く」）。現在値との比較は #46b（別エンドポイント。SP-09 の範囲外）。
//   ② 🔴 **応答の型は所属で分岐する**（`HostProposalDetailView` / `PartnerProposalDetailView`）。取引先向けには `owner` / `sendHold` /
//      `approval`（承認記録・承認者）/ `sendAttempts`（送信試行）/ `lastFailureReason` / `duplicateFindings` が**型として存在しない**
//      （`F-037 AC-1` / `BR-08` / docs/05 §4.8）。ホストだけの値（送信試行 = C2 HOST_ONLY / 承認者名）は取引先の枝では**読まない**。
//   ③ 🔴 **履歴（`proposal_events`）の母集団は RLS の C5**（`proposals` から継承）。取引先は自社が作成した提案の履歴だけを読む
//      （`F-024 AC-3`）。主体の表示名は `users`（C8 DIRECTORY。ホスト所属の行は全員に見える）から読み、`actorUserId` は載せない。
//      `note` は `lib/proposals/events.ts` で書き手の接頭辞ごとに分類し、取引先には送信基盤の事情（再送の理由 / 失敗の種別）を伏せる。
//   ④ 🔴 **境界外・不存在はどちらも 404**（docs/05 §4.8）。母集団は `proposals` の RLS（C5）—— 他社が作成した提案・他テナントの ID は
//      `null` になり、区別しない。
//   ⑤ ゲート結果（`gate`）は #40 と同じ `readProposalGateResult` の 1 実装（`S-021` と同じ形。3 値の `execution`）。取引先も自社提案の
//      結果を読める（`S-021` の権限差分「内容とゲート結果の確認まで」と同じ線）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できる。`approval.ts` と同方針）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import type { GateResultView } from '@ses/domain';
import { NotFoundError } from '../api/errors';
import { toProposalApprovalRecordView } from './approval';
import { toProposalEventView, type ProposalEventRow } from './events';
import { readProposalGateResult } from './gate';
import { readSendAttemptsByProposal } from './list';
import { canAddProposalNote } from './policy';
import { readProposalViewInTx } from './service';
import {
  toHostProposalDetailView,
  toPartnerProposalDetailView,
  type ProposalDetailView,
  type ProposalEventView,
} from './views';

/** `withTenant` が `fn` に渡すクライアント。 */
type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** `S-023` の読み取り（#46 の応答 + 画面の導線の判定材料）。 */
export type ProposalDetailScreenView = {
  readonly detail: ProposalDetailView;
  /** ゲート結果（#40 と同じ 1 つの形）。`S-023` セクション 4。 */
  readonly gate: GateResultView;
  /** 🔴 立場としてメモ（#47）を残せるか（`canAddProposalNote`。行を読んでから判定）。テナントの実行可否は別に見る。 */
  readonly canAddNote: boolean;
};

/**
 * 履歴（`proposal_events`）を古い順に読む。🔴 母集団は RLS（C5）。`actorUserId` は表示名に解決してから捨てる。
 */
async function readEvents(
  db: Pick<TenantDb, 'proposalEvent' | 'user'>,
  proposalId: string,
  audience: 'HOST' | 'PARTNER',
): Promise<readonly ProposalEventView[]> {
  const rows: readonly ProposalEventRow[] = await db.proposalEvent.findMany({
    where: { proposalId },
    // 🔴 `id`（uuidv7 = 採番順）を第 2 キーにする。`occurred_at` はジョブの固定時刻と人間の実時刻が前後しうる（`proposal-approval.test.ts` の注記）。
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      kind: true,
      fromState: true,
      toState: true,
      actorUserId: true,
      note: true,
      attachmentKey: true,
      occurredAt: true,
    },
  });
  const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => id !== null))];
  const users =
    actorIds.length === 0
      ? []
      : await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return rows.map((row) => toProposalEventView(row, names, audience));
}

/**
 * `GET /api/proposals/{id}`（#46）と `S-023` が読む経路。
 *
 * 手順は 1 トランザクション（`withTenant`）: ①基底の view（`readProposalViewInTx`。凍結側だけ）②凍結の `careers` ③履歴
 * ④作成者名 ⑤ホストだけ: 承認者名 + 送信試行。続けてゲート結果（#40 の 1 実装）。
 */
export async function readProposalDetail(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  meta: { readonly now: Date },
): Promise<ProposalDetailScreenView> {
  const read = await withTenant(ctx, async (db) => {
    const found = await readProposalViewInTx(ctx, db, proposalId);
    if (found === null) return null;
    const audience = found.view.audience;

    // ② 凍結の経歴（行単位）。`readProposalViewInTx` は行数だけを写しているので、ここで凍結コピーの `careers` を読み直す。
    //    🔴 `engineer_careers`（台帳の現在値）ではなく `engineer_snapshots.careers`（凍結側）である。
    const snapshot = await db.engineerSnapshot.findUnique({ where: { proposalId: found.view.id }, select: { careers: true } });
    const careers: unknown = snapshot?.careers ?? [];

    const [events, creator] = await Promise.all([
      readEvents(db, found.view.id, audience),
      db.user.findFirst({ where: { id: found.createdBy }, select: { displayName: true } }),
    ]);
    const shared = { careers, events, createdByName: creator?.displayName ?? null, submittedAt: found.submittedAt };

    if (found.view.audience === 'PARTNER') {
      return {
        detail: toPartnerProposalDetailView(found.view, shared),
        canAddNote: canAddProposalNote(ctx, { createdBy: found.createdBy }),
      };
    }

    // ⑤ ホストだけ: 承認者名（C8）と送信試行（C2 HOST_ONLY）。
    const [approver, attempts, lastFailure] = await Promise.all([
      found.approval.approvedBy === null
        ? Promise.resolve(null)
        : db.user.findFirst({ where: { id: found.approval.approvedBy }, select: { displayName: true } }),
      readSendAttemptsByProposal(db, [found.view.id]),
      db.proposal.findUnique({ where: { id: found.view.id }, select: { lastFailureReason: true } }),
    ]);
    return {
      detail: toHostProposalDetailView(found.view, {
        ...shared,
        approval: toProposalApprovalRecordView(found.approval, approver?.displayName ?? null),
        sendAttempts: attempts.get(found.view.id) ?? [],
        lastFailureReason: lastFailure?.lastFailureReason ?? null,
      }),
      canAddNote: canAddProposalNote(ctx, { createdBy: found.createdBy }),
    };
  });
  if (read === null) throw new NotFoundError();

  const gate = await readProposalGateResult(ctx, proposalId, meta);
  return { detail: read.detail, gate, canAddNote: read.canAddNote };
}
