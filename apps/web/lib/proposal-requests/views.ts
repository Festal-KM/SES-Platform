// apps/web/lib/proposal-requests/views.ts
// 提案依頼の応答型（docs/05 §6.5 #32 / `F-018 AC-1` / `S-017`）。T-08-06。
//
// ============================================================================
// 🔴 ホスト向けと取引先向けで**型が違う**（`undefined` ではなく、フィールドが存在しない）
// ============================================================================
// docs/05 §4.8「見えない ＝ 存在しない」の型の分離を `ProposalRequest` に適用する（`HostProposalView` /
// `PartnerProposalView` と同じ整理）。**シリアライザは列を選んで写す**（`row` を spread しない）ので、
// `proposal_requests` に列が増えても応答には現れない。
//
//   - `HostProposalRequestView` に**無い**もの: `declineReason`（`F-018 AC-1` / `BR-57`）/ `engineerId` /
//     `partnerCompanyId`（依頼先。社名も ID も出さない —— 開示は応諾で `Proposal` ができた時点。経路 2）/
//     `respondedBy`（取引先の担当者）/ `issuedBy`。
//   - `PartnerProposalRequestView` に**無い**もの: 他社に関する一切（母集団は C5 が自社の行に閉じる）。
//     `declineReason` は **T-08-07 が辞退を実装するときに取引先側の型にだけ足す**（自社の記録である）。
//
// 🔴 本ファイルは I/O を持たない（`@ses/db` に依存しない）。型テスト（`views.types.test.ts`）と
//    画面の行組み立て（`list-rows.ts`）が `@ses/db` を読み込まずに参照できるようにするため。
import { proposalRequestMachine, type ProposalRequestState } from '@ses/domain';

/** 案件の参照（一覧の「案件」列）。🔴 `id` / `name` だけ（商流情報を持たない）。 */
export type ProposalRequestProjectRef = {
  readonly id: string;
  readonly name: string;
};

/**
 * ホストが読む 1 件（`S-017` ホスト視点）。
 *
 * 🔴 `project` が `null` になるのは、同一トランザクション内で案件が削除された競合のときだけである
 *    （`projects` の C4 はホストに自社の全案件を見せる）。取引先側の `null`（自社に公開されていない案件）
 *    とは意味が違うが、「案件名を出せない」という扱いは同じなので形を揃えた。
 */
export type HostProposalRequestView = {
  readonly id: string;
  readonly project: ProposalRequestProjectRef | null;
  readonly state: ProposalRequestState;
  /** ホスト自身が書いた依頼文。 */
  readonly message: string;
  /** ISO 8601（UTC）。 */
  readonly expiresAt: string;
  readonly createdAt: string;
  /**
   * `REQUESTED` を離れた時刻（応諾・辞退・取り下げ・期限切れ）。`REQUESTED` のあいだは `null`。
   * 🔴 誰が応答したか（`respondedBy`）は持たない。
   */
  readonly respondedAt: string | null;
};

/** 取引先が読む対象エンジニア（自社の台帳。実名でよい）。 */
export type ProposalRequestEngineerRef = {
  readonly id: string;
  readonly displayName: string;
};

/**
 * 取引先が読む 1 件（`S-017` 取引先視点。`S-018` の入口）。
 *
 * 🔴 `project` は**自社に公開されていない案件なら `null`**（`projects` の C4 が行を消す。
 *    リレーション `select` ではなく別クエリで引くのは、必須リレーションが RLS で消えると Prisma が
 *    例外を投げるため）。画面は「案件名は公開されていません」と出す。
 * 🔴 `engineer` が `null` になるのは自社の台帳から行が消えた競合のときだけである。
 */
export type PartnerProposalRequestView = {
  readonly id: string;
  readonly project: ProposalRequestProjectRef | null;
  readonly engineer: ProposalRequestEngineerRef | null;
  readonly state: ProposalRequestState;
  readonly message: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly respondedAt: string | null;
};

/**
 * `GET /api/proposal-requests`（#32）の応答。🔴 `audience` は応答に載せない（呼び出し側は自分の所属を
 * 知っている）。`items` の型は ctx の所属で決まり、1 つの応答に両方が混ざることは無い。
 */
export type ProposalRequestListView =
  | {
      readonly audience: 'HOST';
      readonly items: readonly HostProposalRequestView[];
      readonly nextCursor: string | null;
    }
  | {
      readonly audience: 'PARTNER';
      readonly items: readonly PartnerProposalRequestView[];
      readonly nextCursor: string | null;
    };

/**
 * 🔴 `HostProposalRequestView` のキー集合（実応答の深さ走査と型の突合に使う。
 *    `ANONYMOUS_CANDIDATE_VIEW_KEYS` と同じ役割）。型を変えたらここも変える —— `satisfies` が固定する。
 */
export const HOST_PROPOSAL_REQUEST_VIEW_KEYS = [
  'id',
  'project',
  'state',
  'message',
  'expiresAt',
  'createdAt',
  'respondedAt',
] as const satisfies readonly (keyof HostProposalRequestView)[];

/** `proposal_requests` の行のうち、両方の view が読む列（🔴 `declineReason` / `engineerId` / `partnerCompanyId` を含まない）。 */
export type ProposalRequestRow = {
  readonly id: string;
  readonly projectId: string;
  readonly state: string;
  readonly message: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
};

function requireState(value: string): ProposalRequestState {
  // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
  // 🔴 状態の一覧は `@ses/domain` の 1 か所（新しい配列を作らない。schema.prisma のコメント）。
  if (!proposalRequestMachine.isState(value)) {
    throw new RangeError('proposal_requests.state が未知の値です（docs/05 §3.6）。');
  }
  return value;
}

/**
 * ホスト向けの写像。🔴 列を選んで写す（`row` に `declineReason` があっても**型として受け取れない**）。
 */
export function toHostProposalRequestView(
  row: ProposalRequestRow,
  project: ProposalRequestProjectRef | null,
): HostProposalRequestView {
  return {
    id: row.id,
    project,
    state: requireState(row.state),
    message: row.message,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt === null ? null : row.respondedAt.toISOString(),
  };
}

/** 取引先向けの写像（自社の行だけが渡ってくる。母集団は C5）。 */
export function toPartnerProposalRequestView(
  row: ProposalRequestRow,
  project: ProposalRequestProjectRef | null,
  engineer: ProposalRequestEngineerRef | null,
): PartnerProposalRequestView {
  return {
    id: row.id,
    project,
    engineer,
    state: requireState(row.state),
    message: row.message,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt === null ? null : row.respondedAt.toISOString(),
  };
}
