// apps/web/lib/proposals/timeline-kind.ts
// 🔴 `ProposalEvent` 1 件の **出来事の種類（`ProposalTimelineKind`）と、その語の出所**（`docs/04` §S-023
//    セクション 2 / §S-003 の `Drawer` の「直近の履歴 3 行」/ docs/05 §6.11.3）。T-22-10。
//
// ============================================================================
// 🔴 なぜ `detail-rows.ts` から切り出すのか（**2 つ目の分類表を作らないため**）
// ============================================================================
// `S-023`（提案の詳細と履歴）は `proposalTimelineRow` が 1 件を「日時 / 主体 / 出来事 / メモ / 添付」に
// 落としている。T-22-10 の `Drawer` は**同じ出来事を 1 行に縮めて 3 件だけ**出す（`docs/04` §4.1 の
// 「直近の履歴 3 行」）。このとき:
//
//   🔴 **分類（どの出来事か）と語（何と呼ぶか）を 2 箇所に持つと、同じイベントが
//      `S-023` と `S-003` で違う語になる。** 一覧と詳細で語が違うのは、`packages/i18n` に
//      集約している理由（`CLAUDE.md` §3.5）がそのまま崩れた状態である。
//
// そこで **分類の関数と kind → 文言キーの写像をこの 1 ファイルに置き**、`detail-rows.ts`（`S-023`）と
// `lib/home/drawer.ts`（`S-003` / `S-004` の `Drawer`）の**両方がここから引く**。
//
// 🔴 **I/O を持たず、`t()` も呼ばない**（文言キーだけを返す）。`Drawer` はクライアント部品から
//    使われるため、`@ses/db` へ辿る値 import を 1 つも持たせない
//    （`tests/static/client-db-boundary.test.ts`）。型のみ import は値の辺にならない。
import type { MessageKey } from '@ses/i18n';
import type { ProposalState } from '@ses/domain';
import type { ProposalEventEntryView } from './views';

/**
 * 履歴 1 件の出来事（`entry.kind` の 7 種 + 遷移の中で語を分ける 2 種 = 9 値）。
 * 🔴 `data-event-kind` に載る値であり、**E2E / render が掴んでいる**（改名しない）。
 */
export type ProposalTimelineKind =
  | 'CREATED'
  | 'TRANSITION'
  | 'REJECT'
  | 'APPROVAL'
  | 'RESEND'
  | 'SEND_FAILURE'
  | 'DRAFT_UPDATED'
  | 'NOTE'
  | 'OTHER';

/** 分類に要る最小の形（`ProposalEventView` の部分集合。他の列で分類しないことを型で示す）。 */
export type ProposalTimelineKindInput = {
  readonly entry: { readonly kind: ProposalEventEntryView['kind'] };
  readonly fromState: ProposalState | null;
  readonly toState: ProposalState | null;
};

/**
 * 🔴 出来事の分類（**唯一の実装**）。
 *
 * `entry.kind` の 7 種はそのまま 1 対 1 で対応し、**`TRANSITION` の中だけ 2 つの語を分ける**:
 *   - `CREATED` … `null → DRAFT`（作成）
 *   - `REJECT` … `APPROVAL_PENDING → DRAFT`（却下。作成者が「なぜ下書きに戻ったか」を読む）
 *
 * 🔴 **状態の組み合わせで分けるのはこの 2 つだけである**（`docs/04` §S-023）。増やすときは
 *    `CLAUDE.md` §4.2 の遷移表を先に読むこと（状態を足す話と混ざる）。
 */
export function proposalTimelineKindOf(event: ProposalTimelineKindInput): ProposalTimelineKind {
  if (event.entry.kind !== 'TRANSITION') return event.entry.kind;
  if (event.fromState === null && event.toState === 'DRAFT') return 'CREATED';
  if (event.fromState === 'APPROVAL_PENDING' && event.toState === 'DRAFT') return 'REJECT';
  return 'TRANSITION';
}

/**
 * 🔴 出来事 → 文言キー（**唯一の写像**）。`S-023` の見出しと `Drawer` の 1 行が同じ語を使う。
 *
 * 🔴 **キーを新設していない** —— `S-023` が既に持っていた 9 キーをそのまま集めただけである
 *    （`packages/i18n` 側の値も 1 文字も変えていない）。
 */
export const PROPOSAL_TIMELINE_KIND_MESSAGE_KEYS = {
  CREATED: 'proposals.detail.timeline.kind.created',
  TRANSITION: 'proposals.detail.timeline.kind.transition',
  REJECT: 'proposals.detail.timeline.kind.reject',
  APPROVAL: 'proposals.detail.timeline.kind.approval',
  RESEND: 'proposals.detail.timeline.kind.resend',
  SEND_FAILURE: 'proposals.detail.timeline.kind.sendFailure',
  DRAFT_UPDATED: 'proposals.detail.timeline.kind.draftUpdated',
  NOTE: 'proposals.detail.timeline.kind.note',
  OTHER: 'proposals.detail.timeline.kind.other',
} as const satisfies Record<ProposalTimelineKind, MessageKey>;

/** 写像の全キー（`Record` を網羅して解決する側が使う）。宣言順 = 上の順。 */
export const PROPOSAL_TIMELINE_KINDS = Object.keys(
  PROPOSAL_TIMELINE_KIND_MESSAGE_KEYS,
) as readonly ProposalTimelineKind[];
