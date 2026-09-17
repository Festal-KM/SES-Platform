// apps/web/app/(main)/engineers/[id]/proposal-sections-props.ts
// `S-006` セクション 4・5 の文言の組み立て（`EngineerProposalSections` の props）。T-12-16。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`engineer-proposal-sections.tsx`）は props だけを
//    受け取り、render テストが文言を差し替えて構造を検証できるようにする（`proposals/[id]/detail-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import type { EngineerProposalSectionsMessages } from './engineer-proposal-sections';

export function engineerProposalSectionsMessages(): EngineerProposalSectionsMessages {
  return {
    sectionProposals: t('engineers.detail.section.proposals'),
    sectionDiff: t('engineers.detail.section.snapshotDiff'),
    proposalsEmpty: t('engineers.proposals.empty'),
    columnRecipient: t('engineers.proposals.column.recipient'),
    columnProject: t('engineers.proposals.column.project'),
    columnState: t('engineers.proposals.column.state'),
    columnCreatedAt: t('engineers.proposals.column.createdAt'),
    columnActions: t('engineers.proposals.column.actions'),
    detailLink: t('engineers.proposals.detailLink'),
    diffLink: t('engineers.proposals.diffLink'),
    diffSelected: t('engineers.proposals.diffSelected'),
    diffLead: t('engineers.snapshotDiff.lead'),
    diffUnavailable: t('engineers.snapshotDiff.unavailable'),
    columnField: t('engineers.snapshotDiff.column.field'),
    columnFrozen: t('engineers.snapshotDiff.column.frozen'),
    columnCurrent: t('engineers.snapshotDiff.column.current'),
    // 🔴 `S-006` セクション 8 / `S-023` セクション 3 と同じ 4 列の語（`docs/04` §S-023「同じ 4 列・同じ並び」）。
    careerColumnPeriod: t('engineers.careers.column.period'),
    careerColumnRole: t('engineers.careers.column.role'),
    careerColumnDescription: t('engineers.careers.column.description'),
    careerColumnTechnologies: t('engineers.careers.column.technologies'),
    careerColumnSource: t('engineers.careers.column.source'),
    careersFrozenTitle: t('engineers.snapshotDiff.careers.frozenTitle'),
    careersCurrentTitle: t('engineers.snapshotDiff.careers.currentTitle'),
    careersNote: t('engineers.snapshotDiff.careers.note'),
  };
}
