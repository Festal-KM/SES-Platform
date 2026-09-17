// apps/web/app/admin/tenants/[id]/contract/_lib/messages.ts
// `A-010` セクション 4「削除完了の確認」の文言（`packages/i18n` → 純粋な描画部品 `DeletionStatusScreen` の props）。T-10-10。
// 🔴 文言は `packages/i18n` にのみ置く（`CLAUDE.md` §3.5）。ここは `t()` の呼び出しの束であり、文言そのものを書かない。
// 🔴 `page.tsx` から分けているのは Next.js のページが任意の名前を export できないため（`*.render.test.tsx` もここから読む）。
import type { TenantLifecycleState } from '@ses/domain';
import { t } from '@ses/i18n';
import { TENANT_LIFECYCLE_STATE_MESSAGE_KEYS } from '../../../_lib/labels';
import type { DeletionStatusScreenMessages } from '../deletion-status-screen';

export function deletionStatusMessages(lifecycleState: TenantLifecycleState): DeletionStatusScreenMessages {
  return {
    eyebrow: t('admin.deletionStatus.eyebrow'),
    title: t('admin.deletionStatus.title'),
    lead: t('admin.deletionStatus.lead'),
    lifecycleStateLabel: t('admin.deletionStatus.field.lifecycleState'),
    lifecycleState: t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[lifecycleState]),
    none: t('admin.deletionStatus.none'),
    noneClosing: t('admin.deletionStatus.none.closing'),
    running: t('admin.deletionStatus.running'),
    runningNote: t('admin.deletionStatus.running.note'),
    completedPrefix: t('admin.deletionStatus.completed.prefix'),
    completedCountPrefix: t('admin.deletionStatus.completed.countPrefix'),
    completedCountSuffix: t('admin.deletionStatus.completed.countSuffix'),
    failed: t('admin.deletionStatus.failed'),
    failedNote: t('admin.deletionStatus.failed.note'),
    failedLink: t('admin.deletionStatus.failed.link'),
    breakdown: {
      section: t('admin.deletionStatus.section.breakdown'),
      kind: t('admin.deletionStatus.breakdown.column.kind'),
      count: t('admin.deletionStatus.breakdown.column.count'),
    },
    history: {
      section: t('admin.deletionStatus.section.history'),
      startedAt: t('admin.deletionStatus.history.column.startedAt'),
      status: t('admin.deletionStatus.history.column.status'),
      completedAt: t('admin.deletionStatus.history.column.completedAt'),
      count: t('admin.deletionStatus.history.column.count'),
    },
    status: {
      RUNNING: t('admin.deletionStatus.status.RUNNING'),
      COMPLETED: t('admin.deletionStatus.status.COMPLETED'),
      FAILED: t('admin.deletionStatus.status.FAILED'),
    },
    cause: {
      TENANT_PURGED: t('admin.deletionStatus.cause.TENANT_PURGED'),
    },
    backToTenant: t('admin.deletionStatus.backToTenant'),
  };
}
