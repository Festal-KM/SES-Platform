// apps/web/lib/proposal-requests/detail-rows.ts
// `S-018` 提案依頼の詳細と応諾・辞退（取引先）の表示値の組み立て（docs/04 §S-018）。T-08-07。
//
// 🔴 画面（`app/(main)/proposal-requests/[id]/**`）ではなくここに置く理由は `list-rows.ts` と同じ:
//    `app/**` はユニットテストの対象外であり、「判断材料（案件の要件・条件・依頼メッセージ・期限・開示される
//    項目）が省略されないこと」「案件が公開されていなければ応諾の導線が無いこと」「状態ごとの操作の有無」を
//    固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 案件の見出し・条件・要件の行は `lib/projects/detail.ts` の**同じ関数**で作る（`S-011` / `S-016` と
//    同じ見え方。書式を 2 本にしない）。
import { t } from '@ses/i18n';
import type { ProposalRequestState } from '@ses/domain';
import { formatDateTimeJst } from '../format/datetime';
import {
  projectConditionRows,
  projectHeadlineRows,
  projectRequirementRows,
  type ProjectDetailRow,
  type ProjectRequirementRow,
} from '../projects/detail';
import { PROPOSAL_REQUEST_STATE_MESSAGE_KEYS, PROPOSAL_REQUESTS_PATH } from './list-rows';
import type { PartnerProposalRequestDetailView } from './views';

/** 応諾で開示される 3 項目（`docs/04` §S-018「開示される項目を列挙した確認」/ `F-018 AC-3`）。 */
export function disclosureItems(): readonly string[] {
  return [
    t('proposalRequests.respond.disclosure.item.name'),
    t('proposalRequests.respond.disclosure.item.company'),
    t('proposalRequests.respond.disclosure.item.skillSheet'),
  ];
}

/**
 * 案件の判断材料（`docs/04` §S-018 セクション 1: 案件名 / 必須・尚可要件 / 単価レンジ / 開始日 / 勤務地）。
 * 🔴 自社に公開されていない案件は `null`（画面は「応諾できない」を明示し、応諾の導線を描かない）。
 */
export type ProposalRequestProjectRows = {
  readonly id: string;
  readonly name: string;
  readonly headline: readonly ProjectDetailRow[];
  readonly conditions: readonly ProjectDetailRow[];
  readonly mustRequirements: readonly ProjectRequirementRow[];
  readonly niceRequirements: readonly ProjectRequirementRow[];
  readonly publicSummary: string | null;
  /** `S-011` への導線。 */
  readonly href: string;
};

/** 依頼そのものの表示値（セクション 1 の依頼メッセージ・期限、状態）。 */
export type ProposalRequestDetailRows = {
  readonly id: string;
  readonly state: ProposalRequestState;
  readonly stateLabel: string;
  readonly message: string;
  /** ISO 8601。残り時間（`formatRemaining`）の入力。 */
  readonly expiresAtIso: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly respondedAt: string | null;
  readonly project: ProposalRequestProjectRows | null;
  readonly engineer: { readonly id: string; readonly displayName: string; readonly href: string } | null;
  /** 🔴 自社の記録（`F-018 AC-1`）。辞退していなければ `null`。 */
  readonly declineReason: string | null;
  readonly proposalId: string | null;
  /**
   * 🔴 応諾できるか（状態が `REQUESTED` × 案件が公開されている）。ロール・テナント状態の判定は画面側
   *    （`canRespond` / `denialMessage`）が持ち、**拒否の本体は #33 のガードと `transition()` + CAS** である。
   */
  readonly canAccept: boolean;
  /** 🔴 辞退できるか（状態が `REQUESTED`。案件の公開は要らない。`BR-57`）。 */
  readonly canDecline: boolean;
  /** 終端状態の専用文言（`REQUESTED` なら `null`）。 */
  readonly closedNotice: string | null;
  /** `S-017` へ戻る。 */
  readonly listHref: string;
};

/** 終端状態 → 専用文言のキー（`Record` で割り当て漏れをコンパイラに強制させる）。 */
const CLOSED_NOTICE_KEYS = {
  ACCEPTED: 'proposalRequests.respond.closed.ACCEPTED',
  DECLINED: 'proposalRequests.respond.closed.DECLINED',
  EXPIRED: 'proposalRequests.respond.closed.EXPIRED',
  WITHDRAWN_BY_HOST: 'proposalRequests.respond.closed.WITHDRAWN_BY_HOST',
} as const satisfies Record<Exclude<ProposalRequestState, 'REQUESTED'>, string>;

export function proposalRequestDetailRows(view: PartnerProposalRequestDetailView): ProposalRequestDetailRows {
  const project: ProposalRequestProjectRows | null =
    view.project === null
      ? null
      : {
          id: view.project.id,
          name: view.project.name,
          headline: projectHeadlineRows(view.project),
          conditions: projectConditionRows(view.project),
          mustRequirements: projectRequirementRows(view.project.requirements, 'MUST'),
          niceRequirements: projectRequirementRows(view.project.requirements, 'NICE'),
          publicSummary: view.project.publicSummary,
          href: `/projects/${view.project.id}`,
        };
  const isRequested = view.state === 'REQUESTED';
  return {
    id: view.id,
    state: view.state,
    stateLabel: t(PROPOSAL_REQUEST_STATE_MESSAGE_KEYS[view.state]),
    message: view.message,
    expiresAtIso: view.expiresAt,
    expiresAt: formatDateTimeJst(view.expiresAt),
    createdAt: formatDateTimeJst(view.createdAt),
    respondedAt: view.respondedAt === null ? null : formatDateTimeJst(view.respondedAt),
    project,
    engineer:
      view.engineer === null
        ? null
        : { id: view.engineer.id, displayName: view.engineer.displayName, href: `/engineers/${view.engineer.id}` },
    declineReason: view.declineReason,
    proposalId: view.proposalId,
    canAccept: isRequested && project !== null,
    canDecline: isRequested,
    closedNotice: view.state === 'REQUESTED' ? null : t(CLOSED_NOTICE_KEYS[view.state]),
    listHref: PROPOSAL_REQUESTS_PATH,
  };
}
