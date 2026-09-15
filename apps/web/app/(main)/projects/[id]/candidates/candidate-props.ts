// apps/web/app/(main)/projects/[id]/candidates/candidate-props.ts
// `S-016` の文言の組み立て（`CandidateScreen` の props）。T-08-05。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない —— 呼ばせると `*.render.test.tsx` が `@ses/i18n` を読み込むことになり、
//    「文言が無い状態の描画」を試せなくなる（`share-props.ts` / `list-props.ts` と同じ規律）。
// 🔴 検索条件の文言・選択肢は `S-005` のもの（`engineers/list-props.ts` / `engineers.list.search.*`）を
//    そのまま使う —— 同じ条件が画面ごとに別の語で呼ばれない。
import { t } from '@ses/i18n';
import { candidatePopulationLabel } from '../../../../../lib/candidates/list-rows';
import {
  REQUIREMENT_KIND_EMPTY_KEYS,
  REQUIREMENT_KIND_HEADING_KEYS,
} from '../../../../../lib/projects/labels';
import type { CandidateScreenMessages } from './candidate-screen';

export function candidateScreenMessages(params: {
  readonly partnerCompanyId: string | null;
  readonly total: number;
  /** 絞り込みが効いているか（初回空と絞込 0 件で文言と導線が違う。`docs/04` §S-016 空状態）。 */
  readonly filtered: boolean;
  /** 並びの第 1 キー（適合）が効いているか（`@ses/db` の `ordersByFit`。`S-005` と同じ判定）。 */
  readonly ordersByFit: boolean;
  readonly checkboxOn: boolean;
}): CandidateScreenMessages {
  const { partnerCompanyId, total, filtered, ordersByFit, checkboxOn } = params;
  const isHost = partnerCompanyId === null;
  return {
    lead: isHost ? t('candidates.lead.host') : t('candidates.lead.partner'),
    sectionProject: t('candidates.section.project'),
    sectionDetail: t('candidates.section.detail'),
    projectOpen: t('candidates.project.open'),
    requirementHeadingMust: t(REQUIREMENT_KIND_HEADING_KEYS.MUST),
    requirementHeadingNice: t(REQUIREMENT_KIND_HEADING_KEYS.NICE),
    requirementEmptyMust: t(REQUIREMENT_KIND_EMPTY_KEYS.MUST),
    requirementEmptyNice: t(REQUIREMENT_KIND_EMPTY_KEYS.NICE),
    requirementColumnRequirement: t('projects.requirements.column.requirement'),
    requirementColumnYears: t('projects.requirements.column.years'),
    populationLabel: candidatePopulationLabel(partnerCompanyId, total),
    orderNote: ordersByFit ? t('candidates.orderNote.fit') : t('candidates.orderNote'),
    // 🔴 取引先の画面には共有候補が存在しないので、その効き方の説明も出さない。
    anonymousFilterNote: isHost ? t('candidates.anonymousFilterNote') : null,
    searchLegend: t('engineers.list.search.legend'),
    searchQ: t('engineers.list.search.q'),
    searchSkills: t('engineers.list.search.skills'),
    searchSkillsHint: t('engineers.list.search.skillsHint'),
    searchSkillMode: t('engineers.list.search.skillMode'),
    searchYearsMin: t('engineers.list.search.yearsMin'),
    searchPriceMin: t('engineers.list.search.priceMin'),
    searchPriceMax: t('engineers.list.search.priceMax'),
    searchAvailableBy: t('engineers.list.search.availableBy'),
    searchPrefecture: t('engineers.list.search.prefecture'),
    searchRemote: t('engineers.list.search.remote'),
    searchAvailability: t('engineers.list.search.availability'),
    searchOnlyInTime: t('engineers.list.search.onlyInTime'),
    searchOnlyCommutable: t('engineers.list.search.onlyCommutable'),
    searchCheckboxNote: t('engineers.list.search.checkboxNote'),
    searchSubmit: t('engineers.list.search.submit'),
    searchReset: t('candidates.search.reset'),
    activeFiltersTitle: t('engineers.list.filtered.activeTitle'),
    removeFilterSuffix: t('engineers.list.filtered.remove'),
    columnKind: t('candidates.column.kind'),
    columnName: t('candidates.column.name'),
    columnSkills: t('candidates.column.skills'),
    columnYears: t('candidates.column.years'),
    columnUnitPrice: t('candidates.column.unitPrice'),
    columnAvailability: t('candidates.column.availability'),
    columnLocation: t('candidates.column.location'),
    columnUpdatedOn: t('candidates.column.updatedOn'),
    kindOwn: t('candidates.kind.own'),
    kindAnonymous: t('candidates.kind.anonymous'),
    emptyTitle: filtered ? t('candidates.filtered.empty.title') : t('candidates.empty.title'),
    emptyLead: filtered ? t('candidates.filtered.empty.lead') : t('candidates.empty.lead'),
    emptyRegister: filtered ? null : t('candidates.empty.register'),
    emptyCheckboxNotice:
      filtered && checkboxOn ? t('engineers.list.filtered.checkboxNotice') : null,
    detailSelect: t('candidates.detail.select'),
    detailOpenEngineer: t('candidates.detail.openEngineer'),
    detailCreateProposal: t('candidates.detail.createProposal'),
    detailAnonymousNote: t('candidates.detail.anonymousNote'),
    // 提案依頼フォーム（T-08-06。`F-018` / #31）。🔴 単価に関する語は無い（`F-017 AC-4`）。
    requestOpen: t('candidates.request.open'),
    requestTitle: t('candidates.request.title'),
    requestLead: t('candidates.request.lead'),
    requestMessageLabel: t('candidates.request.message.label'),
    requestMessageHint: t('candidates.request.message.hint'),
    requestExpiresAtLabel: t('candidates.request.expiresAt.label'),
    requestExpiresAtHint: t('candidates.request.expiresAt.hint'),
    requestSubmit: t('candidates.request.submit'),
    requestSubmitting: t('candidates.request.submitting'),
    requestCancel: t('candidates.request.cancel'),
    requestSent: t('candidates.request.sent'),
    requestOpenList: t('candidates.request.openList'),
    requestErrorNotFound: t('candidates.request.error.notFound'),
    requestErrorExpiresAt: t('candidates.request.error.expiresAt'),
    // 🔴 API の `messageKey`（`error.proposalRequest.*`）と同じ文言を出す（サーバの判定に画面の語を揃える）。
    requestErrorCommerce: t('error.proposalRequest.messageCommerce'),
    requestErrorAlreadyExists: t('error.proposalRequest.alreadyExists'),
    requestErrorGeneric: t('candidates.request.error.generic'),
    fieldSkills: t('anonymousCandidate.field.skills'),
    fieldYears: t('anonymousCandidate.field.years'),
    fieldPrice: t('anonymousCandidate.field.price'),
    fieldAvailability: t('anonymousCandidate.field.availability'),
    fieldLocation: t('anonymousCandidate.field.location'),
    fieldUpdatedOn: t('anonymousCandidate.field.updatedOn'),
    fieldAvailabilityStatus: t('candidates.detail.field.availabilityStatus'),
    valueNone: t('anonymousCandidate.valueNone'),
    nextPage: t('candidates.nextPage'),
    firstPage: t('candidates.firstPage'),
  };
}
