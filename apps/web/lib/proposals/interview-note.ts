// apps/web/lib/proposals/interview-note.ts
// `S-024` が #48 の `note` を組み立てる規則（docs/04 §S-024 / `F-025` 入力 / docs/05 §6.5「`S-024` の実装の決着（T-09-10）」）。T-09-10。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **`note` に入るのは、利用者が書いたものと状態を表す固定の語だけ**である。単価・本文・氏名・提案先など、画面が
//      持っている他の値を混ぜない（`note` は `S-023` の履歴に自由記述として描かれ、取引先にもホストにも見える）。
//   ② 🔴 **接頭辞ではない。** `events.ts` の分類（`REVIEW_GATE:` / `RESEND:` / `SEND_FAILURE:` / `DRAFT_UPDATED:`）は書き手の定数と
//      一致する `note` だけを拾う。ここで組む語は日本語の自由記述であり、`TRANSITION` の `detail` としてそのまま描かれる
//      （T-09-09 の申し送り 1「接頭辞は付けない」）。
//   ③ 空欄は `undefined`（#48 の `note` は `min(1)` の任意項目。空文字を送らない）。
//   ④ 🔴 **`note` に書く日時は `datetime-local` の壁時計（TZ を持たない記録）である。** `F-041`（面談調整の連絡。Phase 2 SP-15）で
//      日時を構造化して送るときは、`note` を正規表現で読まず別の列 / 型で持つ（T-12-13 ③。docs/05 §6.5「`S-024` の実装の決着」）。
//
// 🔴 外部 import を持たない純粋モジュール（`'use client'` の画面が値 import できる。`tests/static/client-db-boundary.test.ts`）。
//    文言は呼び出し側が `packages/i18n` から渡す（`CLAUDE.md` §3.5）。

/** `S-024` の操作（= #48 の遷移先）。`GATE_FAILED → DRAFT` は `S-020` の範囲であり、ここには無い。 */
export type ProposalInterviewOperationKind = 'SCHEDULE' | 'INTERVIEWED' | 'RESULT_PENDING' | 'WON' | 'LOST' | 'WITHDRAWN';

export const PROPOSAL_INTERVIEW_OPERATION_KINDS = [
  'SCHEDULE',
  'INTERVIEWED',
  'RESULT_PENDING',
  'WON',
  'LOST',
  'WITHDRAWN',
] as const satisfies readonly ProposalInterviewOperationKind[];

/** 🔴 終端（戻れない）。確認ステップを置く操作。 */
export const PROPOSAL_INTERVIEW_TERMINAL_OPERATIONS = ['WON', 'LOST', 'WITHDRAWN'] as const satisfies readonly ProposalInterviewOperationKind[];

export function isTerminalInterviewOperation(kind: ProposalInterviewOperationKind): boolean {
  return (PROPOSAL_INTERVIEW_TERMINAL_OPERATIONS as readonly ProposalInterviewOperationKind[]).includes(kind);
}

/**
 * 自由入力（要点 / 理由）の上限。固定の語（最長でも数十文字）を足しても #48 の `note`（2,000 文字）を超えないように
 * 余裕を持たせる（`interview-note.test.ts` が固定する）。
 */
export const PROPOSAL_INTERVIEW_MEMO_MAX_LENGTH = 1_000;

/** `note` の組み立てに使う語（`packages/i18n` の `proposals.interview.note.*`）。 */
export type ProposalInterviewNoteLabels = {
  readonly scheduled: string;
  readonly interviewed: string;
  readonly won: string;
  readonly lost: string;
  readonly withdrawn: string;
  readonly separator: string;
  readonly reasonOpen: string;
  readonly reasonClose: string;
};

/** 利用者の入力（欄が無い操作では空文字）。 */
export type ProposalInterviewNoteInput = {
  /** `SCHEDULE`: `<input type="datetime-local">` の値（`YYYY-MM-DDTHH:mm`）。 */
  readonly scheduledAt: string;
  /** `INTERVIEWED`: `<input type="date">` の値（`YYYY-MM-DD`）。 */
  readonly interviewedOn: string;
  /** 要点 / 理由（任意）。 */
  readonly memo: string;
};

/** `datetime-local` の値（`2026-10-01T14:00`）を人が読む形（`2026-10-01 14:00`）にする。TZ 変換はしない（入力された壁時計をそのまま記録する）。 */
export function formatInterviewDateTimeInput(value: string): string {
  return value.trim().replace('T', ' ');
}

function withReason(base: string, memo: string, labels: ProposalInterviewNoteLabels): string {
  return memo === '' ? base : `${base}${labels.reasonOpen}${memo}${labels.reasonClose}`;
}

/**
 * 🔴 #48 に渡す `note`。空なら `undefined`（送らない）。
 * - `SCHEDULE`       … `面談日程: 2026-10-01 14:00`（+ ` / 要点`）
 * - `INTERVIEWED`    … `面談実施: 2026-10-01`（+ ` / 要点`）
 * - `RESULT_PENDING` … 要点だけ（無ければ `undefined`）
 * - `WON` / `LOST`   … `結果: 決定` / `結果: 見送り`（+ `（理由）`）
 * - `WITHDRAWN`      … `辞退`（+ `（理由）`）
 */
export function buildProposalInterviewNote(
  kind: ProposalInterviewOperationKind,
  input: ProposalInterviewNoteInput,
  labels: ProposalInterviewNoteLabels,
): string | undefined {
  const memo = input.memo.trim();
  switch (kind) {
    case 'SCHEDULE': {
      const when = formatInterviewDateTimeInput(input.scheduledAt);
      if (when === '') return memo === '' ? undefined : memo;
      return memo === '' ? `${labels.scheduled}${when}` : `${labels.scheduled}${when}${labels.separator}${memo}`;
    }
    case 'INTERVIEWED': {
      const on = input.interviewedOn.trim();
      if (on === '') return memo === '' ? undefined : memo;
      return memo === '' ? `${labels.interviewed}${on}` : `${labels.interviewed}${on}${labels.separator}${memo}`;
    }
    case 'RESULT_PENDING':
      return memo === '' ? undefined : memo;
    case 'WON':
      return withReason(labels.won, memo, labels);
    case 'LOST':
      return withReason(labels.lost, memo, labels);
    case 'WITHDRAWN':
      return withReason(labels.withdrawn, memo, labels);
  }
}

/** 操作ごとに必須の入力（日時 / 日付）が揃っているか。要点 / 理由は常に任意。 */
export function isInterviewInputComplete(kind: ProposalInterviewOperationKind, input: ProposalInterviewNoteInput): boolean {
  switch (kind) {
    case 'SCHEDULE':
      return input.scheduledAt.trim() !== '';
    case 'INTERVIEWED':
      return input.interviewedOn.trim() !== '';
    case 'RESULT_PENDING':
    case 'WON':
    case 'LOST':
    case 'WITHDRAWN':
      return true;
  }
}
