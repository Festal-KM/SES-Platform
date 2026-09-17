// apps/web/app/(main)/_home/action-queue-props.ts
// 要対応キュー（`ActionQueueSection`）の文言の組み立て。T-12-15。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。部品本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない（`request-props.ts` / `candidate-props.ts` と同じ規律）。
// 🔴 種別ラベルは `Record<ActionQueueKind, string>` で受ける（種別が増えたとき割り当て漏れがコンパイルエラーになる）。
import { t, type MessageKey } from '@ses/i18n';
import type { ActionQueueKind } from '../../../lib/home/types';
import { remainingLabels } from '../../../lib/proposal-requests/list-rows';
import { elapsedLabels } from '../../../lib/proposals/approval-rows';
import type { ActionQueueMessages } from './action-queue-section';

/** 種別 → 文言キー（`labels.ts` の規律。既存の状態ラベルと同じ語）。 */
export const ACTION_QUEUE_KIND_MESSAGE_KEYS = {
  SEND_FAILED: 'home.actionQueue.kind.SEND_FAILED',
  APPROVAL_PENDING: 'home.actionQueue.kind.APPROVAL_PENDING',
  GATE_FAILED: 'home.actionQueue.kind.GATE_FAILED',
  SEND_HELD: 'home.actionQueue.kind.SEND_HELD',
  PROPOSAL_REQUEST_PENDING: 'home.actionQueue.kind.PROPOSAL_REQUEST_PENDING',
} as const satisfies Record<ActionQueueKind, MessageKey>;

export function actionQueueMessages(): ActionQueueMessages {
  const kinds = Object.fromEntries(
    (Object.entries(ACTION_QUEUE_KIND_MESSAGE_KEYS) as [ActionQueueKind, MessageKey][]).map(([kind, key]) => [kind, t(key)]),
  ) as Record<ActionQueueKind, string>;
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
    kinds,
    valueNone: t('home.actionQueue.valueNone'),
    changed: t('home.actionQueue.changed'),
    pollError: t('home.actionQueue.pollError'),
    elapsed: elapsedLabels(),
    remaining: remainingLabels(),
  };
}
