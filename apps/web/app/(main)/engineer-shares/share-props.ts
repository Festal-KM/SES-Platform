// apps/web/app/(main)/engineer-shares/share-props.ts
// `S-015` の文言と行の組み立て（`EngineerShareScreen` の props）。T-08-02。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は
//    `'use client'` であり、`t()` を呼ばせない —— 呼ばせると `*.render.test.tsx` が
//    `@ses/i18n` を読み込むことになり、「文言が無い状態の描画」を試せなくなる
//    （`visibility-props.ts` / `form-props.ts` と同じ規律）。
//
// 🔴 **行に出せる値は `EngineerShareCandidateView` にあるものだけ**である。
//    丸める前の値（生の単価・稼働可能日・市区町村）を受け取る引数が無いことが、
//    「プレビューでは出ていないのに一覧には出る」ずれを作れない理由になる（`docs/04` §5-2）。
import { t } from '@ses/i18n';
import { anonymizedAttributeRows } from '../../../lib/anonymize/labels';
import { formatThousands } from '../../../lib/format/number';
import type { EngineerShareCandidateView, EngineerShareListView } from '../../../lib/engineer-shares/service';
import type { EngineerShareRowView, EngineerShareScreenMessages } from './engineer-share-screen';

/** 未設定（台帳と同じく空欄にせず `—` を置く）。 */
function none(): string {
  return t('anonymousCandidate.valueNone');
}

export function engineerShareRow(view: EngineerShareCandidateView): EngineerShareRowView {
  const preview = anonymizedAttributeRows(view.previewedFields);
  return {
    engineerId: view.engineerId,
    displayName: view.displayName,
    shared: view.shared,
    sharedOn: view.sharedOn ?? none(),
    // 🔴 `0` を空欄に畳まない。「まだ 1 件も来ていない」ことも判断材料である。
    proposalRequestCount: `${formatThousands(view.proposalRequestCount)} ${t('engineerShares.countUnit')}`,
    // 🔴 一覧の「稼働可能時期」も**丸めた区分**を出す（生の日付を並置しない。`docs/04` §5-2）。
    availability: preview.availabilityBand,
    preview,
  };
}

export function engineerShareRows(
  view: EngineerShareListView,
): readonly EngineerShareRowView[] {
  return view.items.map(engineerShareRow);
}

export function engineerShareScreenMessages(): EngineerShareScreenMessages {
  return {
    lead: t('engineerShares.lead'),
    sectionShared: t('engineerShares.section.shared'),
    sectionNotShared: t('engineerShares.section.notShared'),
    sectionPreview: t('engineerShares.section.preview'),
    columnName: t('engineerShares.column.name'),
    columnSharedOn: t('engineerShares.column.sharedOn'),
    columnProposalRequestCount: t('engineerShares.column.proposalRequestCount'),
    columnAvailability: t('engineerShares.column.availability'),
    columnAction: t('engineerShares.column.action'),
    sharedEmpty: t('engineerShares.shared.empty'),
    notSharedEmpty: t('engineerShares.notShared.empty'),
    ledgerEmpty: t('engineerShares.ledger.empty'),
    ledgerRegister: t('engineerShares.ledger.register'),
    previewSelect: t('engineerShares.preview.select'),
    previewNote: t('engineerShares.preview.note'),
    previewCareersNote: t('engineerShares.preview.careersNote'),
    fieldSkills: t('anonymousCandidate.field.skills'),
    fieldYears: t('anonymousCandidate.field.years'),
    fieldPrice: t('anonymousCandidate.field.price'),
    fieldAvailability: t('anonymousCandidate.field.availability'),
    fieldLocation: t('anonymousCandidate.field.location'),
    fieldUpdatedOn: t('anonymousCandidate.field.updatedOn'),
    valueNone: none(),
    share: t('engineerShares.share'),
    shareConfirmTitle: t('engineerShares.share.confirmTitle'),
    shareConfirmSubmit: t('engineerShares.share.confirmSubmit'),
    shareConfirmCancel: t('engineerShares.share.confirmCancel'),
    shareSubmitting: t('engineerShares.share.submitting'),
    revoke: t('engineerShares.revoke'),
    revokeConfirmTitle: t('engineerShares.revoke.confirmTitle'),
    revokeConfirmLead: t('engineerShares.revoke.confirmLead'),
    revokeConfirmSubmit: t('engineerShares.revoke.confirmSubmit'),
    revokeConfirmCancel: t('engineerShares.revoke.confirmCancel'),
    revokeSubmitting: t('engineerShares.revoke.submitting'),
    errorSave: t('engineerShares.error.save'),
    errorRetryNote: t('engineerShares.error.retryNote'),
    deniedTitle: t('engineerShares.deniedTitle'),
  };
}
