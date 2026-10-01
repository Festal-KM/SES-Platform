// apps/web/app/(main)/_home/action-queue-props.ts
// 要対応キュー（`ActionQueueSection`）の文言の組み立て。T-12-15 → T-22-09。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。部品本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない（`request-props.ts` / `candidate-props.ts` と同じ規律）。
// 🔴 種別ラベル・操作の語・不能の理由は `Record<..., string>` で受ける（種別や操作が増えたとき
//    割り当て漏れがコンパイルエラーになる）。
// 🔴 T-22-09: **状態の語は既存の写像を再利用する**（`PROPOSAL_STATE_MESSAGE_KEYS` /
//    `PROPOSAL_REQUEST_STATE_MESSAGE_KEYS`）。ホームのために 2 つ目の状態ラベル表を作らない ——
//    作ると `S-019` と `S-003` で同じ状態が別の語になる。
import { t, type MessageKey } from '@ses/i18n';
import { PROPOSAL_REQUEST_STATES, PROPOSAL_STATES } from '@ses/domain';
import { ACTION_QUEUE_ACTION_KINDS, ACTION_QUEUE_DENIAL_REASON_KEYS } from '../../../lib/home/action-availability';
import type { ActionQueueActionKind, ActionQueueKind } from '../../../lib/home/types';
import { PROPOSAL_REQUEST_STATE_MESSAGE_KEYS, remainingLabels } from '../../../lib/proposal-requests/list-rows';
import { elapsedLabels } from '../../../lib/proposals/approval-rows';
import { PROPOSAL_STATE_MESSAGE_KEYS } from '../../../lib/proposals/editor-rows';
import type { ActionQueueMessages } from './action-queue-section';

/** 種別 → 文言キー（`labels.ts` の規律。既存の状態ラベルと同じ語）。 */
export const ACTION_QUEUE_KIND_MESSAGE_KEYS = {
  SEND_FAILED: 'home.actionQueue.kind.SEND_FAILED',
  APPROVAL_PENDING: 'home.actionQueue.kind.APPROVAL_PENDING',
  GATE_FAILED: 'home.actionQueue.kind.GATE_FAILED',
  SEND_HELD: 'home.actionQueue.kind.SEND_HELD',
  PROPOSAL_REQUEST_PENDING: 'home.actionQueue.kind.PROPOSAL_REQUEST_PENDING',
} as const satisfies Record<ActionQueueKind, MessageKey>;

/**
 * ✅ T-22-09: 操作 → 文言キー（`docs/04` §S-003 セクション 1 の「`承認する` / `修正する` /
 * `再送する` / `返答する`」）。🔴 **1 行につき 1 つ**であり、一括操作の語を持たない。
 */
export const ACTION_QUEUE_ACTION_MESSAGE_KEYS = {
  APPROVE: 'home.actionQueue.action.APPROVE',
  FIX: 'home.actionQueue.action.FIX',
  RESEND: 'home.actionQueue.action.RESEND',
  RESPOND: 'home.actionQueue.action.RESPOND',
} as const satisfies Record<ActionQueueActionKind, MessageKey>;

/**
 * ✅ T-22-09: 操作が不能な理由の語（`actionQueueActionAvailability` が返す `reasonKey` の全体）。
 * 🔴 **サーバが返しうるキーを漏れなく解決する** —— 解決できないキーが来ると理由が空になり、
 *    `U-10` の「何も無い空白にもしない」が破れる。
 */
export const ACTION_QUEUE_DENIAL_MESSAGE_KEYS: readonly MessageKey[] = ACTION_QUEUE_DENIAL_REASON_KEYS;

function resolved<K extends string>(entries: readonly (readonly [K, MessageKey])[]): Readonly<Record<K, string>> {
  return Object.fromEntries(entries.map(([key, messageKey]) => [key, t(messageKey)])) as Readonly<Record<K, string>>;
}

export function actionQueueMessages(): ActionQueueMessages {
  return {
    title: t('home.actionQueue.title'),
    lead: t('home.actionQueue.lead'),
    empty: t('home.actionQueue.empty'),
    scopeLegend: t('home.actionQueue.scope.legend'),
    scopeMine: t('home.actionQueue.scope.mine'),
    scopeAll: t('home.actionQueue.scope.all'),
    columnKind: t('home.actionQueue.column.kind'),
    columnSubject: t('home.actionQueue.column.subject'),
    columnCounterparty: t('home.actionQueue.column.counterparty'),
    columnTime: t('home.actionQueue.column.time'),
    columnDeadline: t('home.actionQueue.column.deadline'),
    columnState: t('home.actionQueue.column.state'),
    columnAction: t('home.actionQueue.column.action'),
    kinds: resolved(
      (Object.entries(ACTION_QUEUE_KIND_MESSAGE_KEYS) as [ActionQueueKind, MessageKey][]).map(
        ([kind, key]) => [kind, key] as const,
      ),
    ),
    actions: resolved(
      ACTION_QUEUE_ACTION_KINDS.map(
        (kind) => [kind, ACTION_QUEUE_ACTION_MESSAGE_KEYS[kind]] as const,
      ),
    ),
    // 🔴 キーをそのまま添字にする（サーバが返した `reasonKey` で引ける形にする）。
    denied: resolved(ACTION_QUEUE_DENIAL_MESSAGE_KEYS.map((key) => [key, key] as const)),
    proposalStates: resolved(PROPOSAL_STATES.map((state) => [state, PROPOSAL_STATE_MESSAGE_KEYS[state]] as const)),
    proposalRequestStates: resolved(
      PROPOSAL_REQUEST_STATES.map((state) => [state, PROPOSAL_REQUEST_STATE_MESSAGE_KEYS[state]] as const),
    ),
    openRequestList: t('proposalRequests.open'),
    valueNone: t('home.actionQueue.valueNone'),
    changed: t('home.actionQueue.changed'),
    pollError: t('home.actionQueue.pollError'),
    elapsed: elapsedLabels(),
    remaining: remainingLabels(),
  };
}
