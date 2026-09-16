// apps/web/lib/proposals/events.ts
// `ProposalEvent` の履歴の分類（docs/05 §6.5「#45 / #46 / #47 の実装の決着」/ `docs/04` §S-023 セクション 2 / `F-024`）。T-09-09。
//
// ============================================================================
// 🔴 `note` の接頭辞は**書き手の定数**から引く（文字列を書き写さない）
// ============================================================================
//   - `REVIEW_GATE:<review_gate_id>` … 承認（`approveProposal`。`@ses/db` の `PROPOSAL_APPROVAL_NOTE_PREFIX`）
//   - `RESEND:<理由>`               … 人手再送（#44。`lib/proposals/resend.ts` の `PROPOSAL_RESEND_NOTE_PREFIX`）
//   - `SEND_FAILURE:<failureKind>`  … 送信失敗の確定（送信ジョブの ⑥。`@ses/db` の `PROPOSAL_SEND_FAILURE_NOTE_PREFIX`）
//   - `DRAFT_UPDATED:<keys>`        … 下書きの更新（#37。`lib/proposals/service.ts` の `PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX`）
//   接頭辞の**無い** `NOTE` は人手のメモ（#47）、接頭辞の無い `STATE` は遷移（`note` は却下の理由 / #48 のメモ）。
//   書き手側が接頭辞を変えたらここも同じ定数を読むのでずれない。**新しい印を足すときは書き手の定数を先に置く。**
//
// 🔴 取引先向け（`audience: 'PARTNER'`）には、送信基盤の事情（`RESEND` の理由 / `SEND_FAILURE` の種別）を**伏せる**
//    （docs/05 §4.8 の型の分離と同じ向き。送信試行は取引先向けの型に存在しない）。**出来事そのもの**（再送した / 送信に失敗した）
//    は状態遷移として見えるので隠さない —— 隠すと取引先が自社提案の現在地を読めなくなる。
//
// 🔴 I/O を持たない（結合テストの外でユニットテストできる）。
import { PROPOSAL_APPROVAL_NOTE_PREFIX, PROPOSAL_SEND_FAILURE_NOTE_PREFIX } from '@ses/db';
import { proposalMachine, type ProposalState } from '@ses/domain';
import { PROPOSAL_RESEND_NOTE_PREFIX } from './resend';
import { PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX } from './service';
import type { ProposalEventActorView, ProposalEventEntryView, ProposalEventView } from './views';

/** 分類の入力（`proposal_events` の行のうち履歴に要る列）。 */
export type ProposalEventRow = {
  readonly id: string;
  readonly kind: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly actorUserId: string | null;
  readonly note: string | null;
  readonly attachmentKey: string | null;
  readonly occurredAt: Date;
};

export type ProposalEventAudience = 'HOST' | 'PARTNER';

/** `DRAFT_UPDATED:<keys>` の区切り（`changedProposalFields(...).join(',')` の対）。 */
const DRAFT_UPDATED_SEPARATOR = ',';

function stripPrefix(note: string, prefix: string): string | null {
  return note.startsWith(prefix) ? note.slice(prefix.length) : null;
}

/**
 * 🔴 `note` を `kind` ごとに分類する（純粋関数）。
 * - `STATE` … `REVIEW_GATE:` → `APPROVAL` / `RESEND:` → `RESEND` / `SEND_FAILURE:` → `SEND_FAILURE` / それ以外 → `TRANSITION`
 * - `NOTE`  … `DRAFT_UPDATED:` → `DRAFT_UPDATED` / それ以外 → `NOTE`（空文字は `OTHER` に落とす。人手のメモは `min(1)`）
 * - その他（`ATTACHMENT` / 未知）… `OTHER`
 */
export function classifyProposalEventNote(
  kind: string,
  note: string | null,
  audience: ProposalEventAudience,
): ProposalEventEntryView {
  if (kind === 'STATE') {
    if (note !== null) {
      const reviewGateId = stripPrefix(note, PROPOSAL_APPROVAL_NOTE_PREFIX);
      if (reviewGateId !== null) return { kind: 'APPROVAL', reviewGateId };
      const reason = stripPrefix(note, PROPOSAL_RESEND_NOTE_PREFIX);
      if (reason !== null) return { kind: 'RESEND', reason: audience === 'HOST' ? reason : null };
      const failureKind = stripPrefix(note, PROPOSAL_SEND_FAILURE_NOTE_PREFIX);
      if (failureKind !== null) return { kind: 'SEND_FAILURE', failureKind: audience === 'HOST' ? failureKind : null };
    }
    return { kind: 'TRANSITION', note };
  }
  if (kind === 'NOTE') {
    if (note !== null) {
      const fieldList = stripPrefix(note, PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX);
      if (fieldList !== null) {
        return { kind: 'DRAFT_UPDATED', fields: fieldList.split(DRAFT_UPDATED_SEPARATOR).filter((field) => field.length > 0) };
      }
      if (note.length > 0) return { kind: 'NOTE', note };
    }
    return { kind: 'OTHER', note };
  }
  return { kind: 'OTHER', note };
}

function toKnownState(value: string | null): ProposalState | null {
  if (value === null) return null;
  // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
  if (!proposalMachine.isState(value)) throw new RangeError('proposal_events の状態が未知の値です（docs/05 §3.6）。');
  return value;
}

/**
 * 行 → 履歴の 1 件。`actorNames` は `users`（C8 DIRECTORY）から読んだ表示名（読めなかった ID は `null` の表示名になる）。
 * 🔴 `actorUserId` そのものは応答に載せない（表示名だけ）。
 */
export function toProposalEventView(
  row: ProposalEventRow,
  actorNames: ReadonlyMap<string, string>,
  audience: ProposalEventAudience,
): ProposalEventView {
  const actor: ProposalEventActorView =
    row.actorUserId === null ? { kind: 'SYSTEM' } : { kind: 'USER', displayName: actorNames.get(row.actorUserId) ?? null };
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actor,
    kind: row.kind,
    fromState: toKnownState(row.fromState),
    toState: toKnownState(row.toState),
    entry: classifyProposalEventNote(row.kind, row.note, audience),
    attachmentKey: row.attachmentKey,
  };
}
