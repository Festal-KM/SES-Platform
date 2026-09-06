// apps/web/app/(main)/engineers/_form/form-props.ts
// `S-007` の 2 つの入口（新規 `/engineers/new` / 編集 `/engineers/{id}/edit`）が共有する
// props の組み立て。T-05-01。
//
// 🔴 サーバ側でのみ読み込まれる（`'use client'` の `engineer-form.tsx` はこのファイルを
//    import しない）。`@ses/db` の値（`ENGINEER_AVAILABILITIES` 等）を使うため、
//    クライアントバンドルへ入る経路を作らない（`tests/static/client-db-boundary.test.ts`）。
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。2 ページに書き写さない
//    —— 書き写すと、新規と編集で文言がずれる。
import { ENGINEER_AVAILABILITIES, REMOTE_MODES } from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { t } from '@ses/i18n';
import {
  ENGINEER_AVAILABILITY_MESSAGE_KEYS,
  ENGINEER_SKILL_LEVELS,
  ENGINEER_SKILL_LEVEL_MESSAGE_KEYS,
  REMOTE_MODE_MESSAGE_KEYS,
} from '../../../../lib/engineers/labels';
// 🔴 T-06-01: 都道府県の写像は機能に属さない共通語彙として `lib/format/prefectures.ts` にある。
import { PREFECTURE_MESSAGE_KEYS } from '../../../../lib/format/prefectures';
import type { EngineerEditView } from '../../../../lib/engineers/service';
import type {
  EngineerFormMessages,
  EngineerFormValues,
  SelectOption,
} from './engineer-form';

/**
 * 保存後・キャンセル時の戻り先。
 * 🔴 T-05-09: `S-005`（一覧）が実装されたので、暫定のホーム（`/`）から差し替えた
 *    （docs/04 §S-007 関連画面「← `S-005`」）。**404 境界（`[id]/not-found.tsx` /
 *    `[id]/edit/not-found.tsx`）も同じ定数を見る**ので、戻り先が 3 箇所でずれない。
 */
export const ENGINEER_FORM_CANCEL_HREF = '/engineers';

export const availabilityOptions: readonly SelectOption[] = ENGINEER_AVAILABILITIES.map(
  (value) => ({ value, label: t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[value]) }),
);

export const remoteModeOptions: readonly SelectOption[] = REMOTE_MODES.map((value) => ({
  value,
  label: t(REMOTE_MODE_MESSAGE_KEYS[value]),
}));

export const prefectureOptions: readonly SelectOption[] = PREFECTURE_CODES.map((value) => ({
  value,
  label: t(PREFECTURE_MESSAGE_KEYS[value]),
}));

export const skillLevelOptions: readonly SelectOption[] = ENGINEER_SKILL_LEVELS.map((value) => ({
  value: String(value),
  label: t(ENGINEER_SKILL_LEVEL_MESSAGE_KEYS[value]),
}));

/** 新規登録の初期値（`docs/04` §S-007「新規は空フォーム（既定値入り）」）。 */
export const EMPTY_ENGINEER_FORM_VALUES: EngineerFormValues = {
  displayName: '',
  // 🔴 DB の既定（`engineers.availability` の `@default("WORKING")`）と一致させる。
  availability: 'WORKING',
  availableFrom: '',
  unitPriceMin: '',
  unitPriceMax: '',
  prefecture: '',
  remoteMode: '',
  preferenceNote: '',
  contactEmail: '',
  contactPhone: '',
  skills: [],
  newSkillLabels: [],
};

/** 編集の初期値（`null` は空文字にする。フォームは文字列だけを扱う）。 */
export function toEngineerFormValues(view: EngineerEditView): EngineerFormValues {
  return {
    displayName: view.displayName,
    availability: view.availability,
    availableFrom: view.availableFrom ?? '',
    unitPriceMin: view.unitPriceMin === null ? '' : String(view.unitPriceMin),
    unitPriceMax: view.unitPriceMax === null ? '' : String(view.unitPriceMax),
    prefecture: view.prefecture ?? '',
    remoteMode: view.remoteMode ?? '',
    preferenceNote: view.preferenceNote ?? '',
    contactEmail: view.contactEmail ?? '',
    contactPhone: view.contactPhone ?? '',
    skills: view.skills.map((skill) => ({
      skillId: skill.skillId,
      name: skill.name,
      yearsOfExperience: String(skill.yearsOfExperience),
      level: skill.level === null ? '' : String(skill.level),
    })),
    // 🔴 起票済みの新語候補はここに載せない（採否は `S-009` の仕事であり、
    //    編集画面で再送すると同じ表記を何度も起票しようとすることになる）。
    newSkillLabels: [],
  };
}

/**
 * 🔴 所属区分の表示（`F-008 AC-2`）。実体は `lib/engineers/labels.ts` にある
 *    （T-05-02 で `S-006` と共有した。2 画面で文言がずれない形にするため）。
 */
export { engineerOwnershipLabel as ownershipLabel } from '../../../../lib/engineers/labels';

export function engineerFormMessages(ownershipValue: string): EngineerFormMessages {
  return {
    sectionBasic: t('engineers.section.basic'),
    sectionSkills: t('engineers.section.skills'),
    sectionCareers: t('engineers.section.careers'),
    sectionAvailability: t('engineers.section.availability'),
    sectionConditions: t('engineers.section.conditions'),
    sectionContact: t('engineers.section.contact'),

    displayNameLabel: t('engineers.displayName.label'),
    ownershipLabel: t('engineers.ownership.label'),
    ownershipValue,
    ownershipReadOnlyNote: t('engineers.ownership.readOnlyNote'),
    collectionScope: t('engineers.collectionScope'),

    skillSearchLabel: t('engineers.skills.search.label'),
    skillAdd: t('engineers.skills.add'),
    skillColumnSkill: t('engineers.skills.column.skill'),
    skillColumnYears: t('engineers.skills.column.years'),
    skillColumnLevel: t('engineers.skills.column.level'),
    skillColumnActions: t('engineers.skills.column.actions'),
    skillRemove: t('engineers.skills.remove'),
    skillEmpty: t('engineers.skills.empty'),
    skillDuplicate: t('engineers.skills.duplicate'),
    skillLevelUnset: t('engineers.skills.level.unset'),
    newAliasLabel: t('engineers.skills.newAlias.label'),
    newAliasAdd: t('engineers.skills.newAlias.add'),
    newAliasNote: t('engineers.skills.newAlias.note'),
    newAliasEmpty: t('engineers.skills.newAlias.empty'),
    newAliasDictionaryLink: t('engineers.skills.newAlias.dictionaryLink'),

    careersComingSoon: t('engineers.careers.comingSoon'),

    availabilityLabel: t('engineers.availability.label'),
    availableFromLabel: t('engineers.availableFrom.label'),

    unitPriceLabel: t('engineers.unitPrice.label'),
    unitPriceMin: t('engineers.unitPrice.min'),
    unitPriceMax: t('engineers.unitPrice.max'),
    unitPriceUnit: t('engineers.unitPrice.unit'),
    prefectureLabel: t('engineers.prefecture.label'),
    remoteModeLabel: t('engineers.remoteMode.label'),
    preferenceNoteLabel: t('engineers.preferenceNote.label'),
    valueUnset: t('engineers.value.unset'),

    contactEmailLabel: t('engineers.contact.email.label'),
    contactPhoneLabel: t('engineers.contact.phone.label'),
    contactMinimumNote: t('engineers.contact.minimumNote'),

    save: t('engineers.save'),
    saving: t('engineers.saving'),
    saved: t('engineers.saved'),
    saveError: t('engineers.error.save'),
    cancel: t('engineers.cancel'),
    leaveConfirm: t('engineers.leaveConfirm'),
  };
}
