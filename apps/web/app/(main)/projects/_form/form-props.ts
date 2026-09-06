// apps/web/app/(main)/projects/_form/form-props.ts
// `S-012` の 2 つの入口（新規 `/projects/new` / 編集 `/projects/{id}/edit`）が共有する
// props の組み立て。T-06-01。
//
// 🔴 サーバ側でのみ読み込まれる（`'use client'` の `project-form.tsx` はこのファイルを
//    import しない）。`@ses/db` の値（`PROJECT_STATUSES` 等）を使うため、クライアント
//    バンドルへ入る経路を作らない（`tests/static/client-db-boundary.test.ts`）。
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。2 ページに書き写さない
//    —— 書き写すと、新規と編集で文言がずれる。
import { PROJECT_STATUSES, REMOTE_MODES, REQUIREMENT_KINDS } from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { t } from '@ses/i18n';
// 🔴 都道府県は機能に属さない共通語彙（`lib/format/prefectures.ts`）。
//    エンジニアの labels から import しない（機能モジュール間の依存を作らない）。
import { PREFECTURE_MESSAGE_KEYS } from '../../../../lib/format/prefectures';
// 🔴 `S-010` の入口は 1 か所（`lib/projects/list-rows.ts`）から取る。パスを書き写さない。
import { PROJECT_LIST_PATH } from '../../../../lib/projects/list-rows';
import {
  PROJECT_REMOTE_MODE_MESSAGE_KEYS,
  PROJECT_STATUS_MESSAGE_KEYS,
  REQUIREMENT_KIND_EMPTY_KEYS,
  REQUIREMENT_KIND_HEADING_KEYS,
  REQUIREMENT_KIND_NOTE_KEYS,
} from '../../../../lib/projects/labels';
import type { ProjectEditView } from '../../../../lib/projects/service';
// 🔴 `project-form.tsx`（`'use client'`）からは**型しか import しない**。
//    値を import すると、RSC のサーバグラフでは client reference（プロキシ）に置換され、
//    文字列として使った瞬間に壊れる（`./created-href.ts` 冒頭の実測メモを参照）。
import type {
  ProjectFormMessages,
  ProjectFormValues,
  SelectOption,
} from './project-form';

/**
 * キャンセル時・404 境界の戻り先。
 * 🔴 **`S-010`（案件一覧）である**（`docs/04` §S-012 / §S-011 の関連画面「← `S-010`」）。
 *    ⚠️ T-06-01 / T-06-02 の時点では `S-010` が未実装だったため暫定でホーム（`/`）を指していた
 *    （存在しない画面へのリンクを置かない）。**T-06-03 で本来の値にした。**
 * 🔴 値をここ 1 か所に置いてあるので、キャンセル・404 境界（`[id]/not-found.tsx` /
 *    `[id]/edit/not-found.tsx`）・`S-011` の戻り導線が同時に動く。
 *    ⚠️ **登録直後の遷移先は別**である（`lib/projects/created-href.ts`。`S-011` へ送る）。
 */
export const PROJECT_FORM_CANCEL_HREF = PROJECT_LIST_PATH;

// 🔴 登録直後の遷移先（`PROJECT_CREATED_HREF_PATTERN`）は `lib/projects/created-href.ts` にある。
//    このファイル（`@ses/db` に依存するサーバ専用モジュール）にも
//    `project-form.tsx`（`'use client'`）にも置けない —— 両方から読む必要があるためである。
//    ページはそこから直接 import する（re-export は置かない。入口を 2 つ作らない）。

export const projectStatusOptions: readonly SelectOption[] = PROJECT_STATUSES.map((value) => ({
  value,
  label: t(PROJECT_STATUS_MESSAGE_KEYS[value]),
}));

export const projectRemoteModeOptions: readonly SelectOption[] = REMOTE_MODES.map((value) => ({
  value,
  label: t(PROJECT_REMOTE_MODE_MESSAGE_KEYS[value]),
}));

export const projectPrefectureOptions: readonly SelectOption[] = PREFECTURE_CODES.map((value) => ({
  value,
  label: t(PREFECTURE_MESSAGE_KEYS[value]),
}));

/**
 * 🔴 要件ブロックの並び（`MUST` → `NICE`）。値の出所は `@ses/db` の `REQUIREMENT_KINDS` であり、
 *    画面が独自に並べ替えたり文字列を書き写したりしない（`F-013 AC-1` の区分と 1 対 1）。
 */
export const projectRequirementKinds: readonly string[] = [...REQUIREMENT_KINDS];

/** 新規登録の初期値（`docs/04` §S-012「新規は空フォーム」）。 */
export const EMPTY_PROJECT_FORM_VALUES: ProjectFormValues = {
  name: '',
  // 🔴 DB の既定（`projects.status` の `@default("OPEN")`）と一致させる。
  status: 'OPEN',
  headcount: '1',
  startDate: '',
  unitPriceMin: '',
  unitPriceMax: '',
  prefecture: '',
  remoteMode: '',
  endClientName: '',
  internalUnitPrice: '',
  publicSummary: '',
  requirements: [],
};

/** 編集の初期値（`null` は空文字にする。フォームは文字列だけを扱う）。 */
export function toProjectFormValues(view: ProjectEditView): ProjectFormValues {
  return {
    name: view.name,
    status: view.status,
    headcount: String(view.headcount),
    startDate: view.startDate ?? '',
    unitPriceMin: view.unitPriceMin === null ? '' : String(view.unitPriceMin),
    unitPriceMax: view.unitPriceMax === null ? '' : String(view.unitPriceMax),
    prefecture: view.prefecture ?? '',
    remoteMode: view.remoteMode ?? '',
    endClientName: view.endClientName ?? '',
    internalUnitPrice: view.internalUnitPrice === null ? '' : String(view.internalUnitPrice),
    publicSummary: view.publicSummary ?? '',
    requirements: view.requirements.map((requirement, index) => ({
      // 🔴 画面内の一意キー。行の並びは `readProjectRequirements` が決定的に返すため、
      //    添字を使っても再描画で入れ替わらない（DB の id は画面に出さない）。
      key: `r${String(index)}`,
      kind: requirement.kind,
      skillId: requirement.skillId ?? '',
      skillName: requirement.skillName ?? '',
      freeText: requirement.freeText ?? '',
      requiredYears: requirement.requiredYears === null ? '' : String(requirement.requiredYears),
    })),
  };
}

function messageRecord(
  keys: Readonly<Record<string, Parameters<typeof t>[0]>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(keys).map(([kind, key]) => [kind, t(key)]));
}

export function projectFormMessages(): ProjectFormMessages {
  return {
    sectionBasic: t('projects.section.basic'),
    sectionConditions: t('projects.section.conditions'),
    sectionCommerce: t('projects.section.commerce'),
    sectionPublicSummary: t('projects.section.publicSummary'),

    nameLabel: t('projects.name.label'),
    headcountLabel: t('projects.headcount.label'),
    headcountUnit: t('projects.headcount.unit'),
    startDateLabel: t('projects.startDate.label'),
    statusLabel: t('projects.status.label'),
    statusNote: t('projects.status.note'),

    requirementHeadings: messageRecord(REQUIREMENT_KIND_HEADING_KEYS),
    requirementNotes: messageRecord(REQUIREMENT_KIND_NOTE_KEYS),
    requirementEmpties: messageRecord(REQUIREMENT_KIND_EMPTY_KEYS),
    requirementSkillLabel: t('projects.requirements.skill.label'),
    requirementSkillSearch: t('projects.requirements.skill.search'),
    requirementYearsLabel: t('projects.requirements.years.label'),
    requirementFreeTextLabel: t('projects.requirements.freeText.label'),
    requirementAdd: t('projects.requirements.add'),
    requirementRemove: t('projects.requirements.remove'),
    requirementColumnRequirement: t('projects.requirements.column.requirement'),
    requirementColumnYears: t('projects.requirements.column.years'),
    requirementColumnActions: t('projects.requirements.column.actions'),
    requirementYearsUnit: t('projects.requirements.years.unit'),
    requirementErrorEmpty: t('projects.requirements.error.empty'),
    requirementErrorDuplicate: t('projects.requirements.error.duplicate'),

    unitPriceLabel: t('projects.unitPrice.label'),
    unitPriceMin: t('projects.unitPrice.min'),
    unitPriceMax: t('projects.unitPrice.max'),
    unitPriceUnit: t('projects.unitPrice.unit'),
    prefectureLabel: t('projects.prefecture.label'),
    remoteModeLabel: t('projects.remoteMode.label'),
    valueUnset: t('projects.value.unset'),

    commerceNotice: t('projects.commerce.notice'),
    endClientNameLabel: t('projects.endClientName.label'),
    internalUnitPriceLabel: t('projects.internalUnitPrice.label'),

    publicSummaryLabel: t('projects.publicSummary.label'),
    publicSummaryNote: t('projects.publicSummary.note'),

    visibilityComingSoon: t('projects.visibility.comingSoon'),
    save: t('projects.save'),
    saving: t('projects.saving'),
    saved: t('projects.saved'),
    saveError: t('projects.error.save'),
    cancel: t('projects.cancel'),
    leaveConfirm: t('projects.leaveConfirm'),
  };
}
