// apps/web/app/(main)/projects/[id]/visibility/visibility-props.ts
// `S-013` の文言とプレビューの組み立て（`ProjectVisibilityScreen` の props）。T-06-06。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は
//    `'use client'` であり、`t()` を呼ばせない —— 呼ばせると `*.render.test.tsx` が
//    `@ses/i18n` を読み込むことになり、「文言が無い状態の描画」を試せなくなる
//    （`detail-props.ts` / `form-props.ts` と同じ規律）。
//
// 🔴 **プレビューはホストの view からしか作れない。** 引数の型が `HostProjectDetailView` で
//    あることが、`F-013 AC-2` の担保を画面の手前まで通す最後の 1 枚である
//    （`projectCommerceRows` と同じ手法。取引先の view を渡す実装はコンパイルできない）。
// 🔴 それでも**プレビューに出す値は共通部分だけ**である（`ProjectDetailShared`）。商流情報は
//    「混入していないか」を照合するためにだけ使い、**プレビューの本文には 1 文字も入れない**。
import { REQUIREMENT_KINDS } from '@ses/db';
import { t } from '@ses/i18n';
import type { MessageKey } from '@ses/i18n';
import {
  projectConditionRows,
  projectHeadlineRows,
  projectRequirementRows,
} from '../../../../../lib/projects/detail';
import {
  REQUIREMENT_KIND_EMPTY_KEYS,
  REQUIREMENT_KIND_HEADING_KEYS,
} from '../../../../../lib/projects/labels';
import {
  findCommerceLeakWarnings,
  type CommerceTermKind,
  type PublishedField,
  type PublishedText,
} from '../../../../../lib/projects/publish-preview';
import type { HostProjectDetailView } from '../../../../../lib/projects/service';
import type {
  ProjectVisibilityScreenMessages,
  PublishPreview,
} from './visibility-screen';

/** 混入警告の「欄」の文言（🔴 `Record<PublishedField, …>` で列挙漏れを作れなくする）。 */
const WARNING_FIELD_MESSAGE_KEYS: Readonly<Record<PublishedField, MessageKey>> = {
  name: 'projects.visibilitySettings.preview.warning.field.name',
  publicSummary: 'projects.visibilitySettings.preview.warning.field.publicSummary',
  requirement: 'projects.visibilitySettings.preview.warning.field.requirement',
};

/** 混入警告の「種別」の文言（同上）。 */
const WARNING_KIND_MESSAGE_KEYS: Readonly<Record<CommerceTermKind, MessageKey>> = {
  END_CLIENT_NAME: 'projects.visibilitySettings.preview.warning.kind.endClientName',
  INTERNAL_UNIT_PRICE: 'projects.visibilitySettings.preview.warning.kind.internalUnitPrice',
};

/**
 * 🔴 **公開時に外へ出る文字列の一覧**（照合の対象）。
 *    `PartnerProjectDetailView` に写る値のうち、利用者の自由入力である 3 種だけを見る。
 *    ⚠️ ここに列を足すことは「外に出る欄が増えた」ことを意味する。増やすときは
 *    `PARTNER_PROJECT_DETAIL_SELECT`（`lib/projects/service.ts`）と一緒に見直す。
 */
function publishedTexts(view: HostProjectDetailView): readonly PublishedText[] {
  return [
    { field: 'name', value: view.name },
    { field: 'publicSummary', value: view.publicSummary },
    ...view.requirements.map((requirement) => ({
      field: 'requirement' as const,
      value: requirement.freeText,
    })),
  ];
}

/**
 * `S-013` セクション 3「公開されたときの見え方」。
 * 🔴 出す値は `S-011` の**取引先の枝と同じ組み立て関数**から作る（`lib/projects/detail.ts`）。
 *    プレビュー専用の整形を別に書くと、「プレビューでは出ていないのに実際には出る」ずれが生まれる。
 */
export function projectPublishPreview(view: HostProjectDetailView): PublishPreview {
  const warnings = findCommerceLeakWarnings({
    texts: publishedTexts(view),
    endClientName: view.endClientName,
    internalUnitPrice: view.internalUnitPrice,
  });

  return {
    name: view.name,
    headline: projectHeadlineRows(view),
    conditions: projectConditionRows(view),
    requirements: REQUIREMENT_KINDS.map((kind) => ({
      kind,
      heading: t(REQUIREMENT_KIND_HEADING_KEYS[kind]),
      empty: t(REQUIREMENT_KIND_EMPTY_KEYS[kind]),
      rows: projectRequirementRows(view.requirements, kind),
    })),
    publicSummary: view.publicSummary ?? t('projects.detail.valueNone'),
    requirementColumnRequirement: t('projects.requirements.column.requirement'),
    requirementColumnYears: t('projects.requirements.column.years'),
    warnings: warnings.map((warning) => ({
      key: `${warning.field}-${warning.kind}`,
      field: t(WARNING_FIELD_MESSAGE_KEYS[warning.field]),
      kind: t(WARNING_KIND_MESSAGE_KEYS[warning.kind]),
    })),
  };
}

export function projectVisibilityScreenMessages(): ProjectVisibilityScreenMessages {
  return {
    lead: t('projects.visibilitySettings.lead'),
    sectionCurrent: t('projects.visibilitySettings.section.current'),
    sectionSelect: t('projects.visibilitySettings.section.select'),
    sectionPreview: t('projects.visibilitySettings.section.preview'),
    sectionGate: t('projects.visibilitySettings.section.gate'),
    sectionExecute: t('projects.visibilitySettings.section.execute'),
    currentEmpty: t('projects.visibilitySettings.current.empty'),
    currentColumnPartner: t('projects.visibilitySettings.current.column.partner'),
    currentColumnPublishedOn: t('projects.visibilitySettings.current.column.publishedOn'),
    selectLegend: t('projects.visibilitySettings.select.legend'),
    selectNote: t('projects.visibilitySettings.select.note'),
    selectPublishedBadge: t('projects.visibilitySettings.select.publishedBadge'),
    selectSuspendedBadge: t('projects.visibilitySettings.select.suspendedBadge'),
    selectSuspendedNote: t('projects.visibilitySettings.select.suspendedNote'),
    selectEmptyTitle: t('projects.visibilitySettings.select.empty.title'),
    selectEmptyLead: t('projects.visibilitySettings.select.empty.lead'),
    selectEmptyLink: t('projects.visibilitySettings.select.empty.link'),
    previewNote: t('projects.visibilitySettings.preview.note'),
    previewWarningTitle: t('projects.visibilitySettings.preview.warning.title'),
    previewWarningLead: t('projects.visibilitySettings.preview.warning.lead'),
    gatePendingTitle: t('projects.visibilitySettings.gate.pending.title'),
    gatePendingLead: t('projects.visibilitySettings.gate.pending.lead'),
    submit: t('projects.visibilitySettings.submit'),
    submitting: t('projects.visibilitySettings.submitting'),
    revokeConfirmTitle: t('projects.visibilitySettings.revoke.confirm.title'),
    revokeConfirmLead: t('projects.visibilitySettings.revoke.confirm.lead'),
    revokeConfirmSubmit: t('projects.visibilitySettings.revoke.confirm.submit'),
    revokeConfirmCancel: t('projects.visibilitySettings.revoke.confirm.cancel'),
    resultPendingGate: t('projects.visibilitySettings.result.pendingGate'),
    resultNoPublish: t('projects.visibilitySettings.result.noPublish'),
    errorSave: t('projects.visibilitySettings.error.save'),
    deniedTitle: t('projects.visibilitySettings.denied.title'),
    backToDetail: t('projects.visibilitySettings.backToDetail'),
    editProject: t('projects.visibilitySettings.editProject'),
    leaveConfirm: t('projects.visibilitySettings.leaveConfirm'),
  };
}
