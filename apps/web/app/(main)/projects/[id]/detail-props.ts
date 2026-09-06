// apps/web/app/(main)/projects/[id]/detail-props.ts
// `S-011` の文言の組み立て（`ProjectDetailScreen` の props）。T-06-02。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）に
//    `t()` を散らさない —— 散らすと `*.render.test.tsx` が `@ses/i18n` を読み込むことになり、
//    「文言が無い状態の描画」を試せなくなる（`engineers` / `partner-companies` と同じ形）。
// 🔴 ホストと取引先で**言葉が変わるのは 2 つだけ**である（提案セクションの見出しと空文言。
//    `docs/04` §S-011 / §10.1）。それ以外は同じ語を使う。
import { t } from '@ses/i18n';
import {
  REQUIREMENT_KIND_EMPTY_KEYS,
  REQUIREMENT_KIND_HEADING_KEYS,
  REQUIREMENT_KIND_NOTE_KEYS,
} from '../../../../lib/projects/labels';
import type { ProjectDetailView } from '../../../../lib/projects/service';
import type { ProjectDetailScreenMessages } from './project-detail-screen';

function messageRecord<K extends string>(
  keys: Readonly<Record<K, Parameters<typeof t>[0]>>,
): Readonly<Record<K, string>> {
  return Object.fromEntries(
    Object.entries<Parameters<typeof t>[0]>(keys).map(([kind, key]) => [kind, t(key)]),
  ) as Readonly<Record<K, string>>;
}

export function projectDetailScreenMessages(
  audience: ProjectDetailView['audience'],
): ProjectDetailScreenMessages {
  const isHost = audience === 'HOST';
  return {
    sectionRequirements: t('projects.detail.section.requirements'),
    sectionConditions: t('projects.detail.section.conditions'),
    sectionCommerce: t('projects.detail.section.commerce'),
    sectionPublicSummary: t('projects.detail.section.publicSummary'),
    sectionVisibility: t('projects.detail.section.visibility'),
    // 🔴 取引先には母集団を添える（`docs/04` §S-011「（御社が作成した提案）」）。
    sectionProposals: isHost
      ? t('projects.detail.section.proposals')
      : t('projects.detail.section.ownProposals'),

    requirementHeadings: messageRecord(REQUIREMENT_KIND_HEADING_KEYS),
    requirementNotes: messageRecord(REQUIREMENT_KIND_NOTE_KEYS),
    requirementEmpties: messageRecord(REQUIREMENT_KIND_EMPTY_KEYS),
    requirementColumnRequirement: t('projects.requirements.column.requirement'),
    requirementColumnYears: t('projects.requirements.column.years'),

    publicSummaryEmpty: t('projects.detail.valueNone'),
    commerceNotice: t('projects.commerce.notice'),
    visibilityEmpty: t('projects.detail.visibility.empty'),
    visibilityColumnPartner: t('projects.detail.visibility.column.partner'),
    visibilityColumnPublishedOn: t('projects.detail.visibility.column.publishedOn'),
    visibilityProposalCountComingSoon: t('projects.detail.visibility.proposalCountComingSoon'),
    visibilitySettingsComingSoon: t('projects.detail.visibility.settingsComingSoon'),
    partnerPublished: t('projects.detail.partner.published'),
    // 🔴 `docs/04` §10.1 `S-011`「提案 0 件 → ホスト / 取引先で別文言」。
    proposalsEmpty: isHost
      ? t('projects.detail.proposals.emptyHost')
      : t('projects.detail.proposals.emptyPartner'),
    proposalsComingSoon: t('projects.detail.proposals.comingSoon'),
    candidatesComingSoon: t('projects.detail.candidates.comingSoon'),
    edit: t('projects.detail.edit'),
    viewRecorded: t('projects.detail.viewRecorded'),
  };
}
