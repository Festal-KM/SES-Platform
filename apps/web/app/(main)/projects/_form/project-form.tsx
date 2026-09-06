'use client';

// apps/web/app/(main)/projects/_form/project-form.tsx
// `S-012` 案件の登録・編集 — フォーム本体（docs/04 §S-012 / `F-013` / `F-010`）。T-06-01。
//
// 🔴 **必須要件と尚可要件を別ブロックとして描く**（`F-013 AC-1` / `docs/04` §S-012
//    「必須 / 尚可の 2 ブロックを**視覚的に分ける**」）。同じ部品を `kind` 違いで 2 回使い、
//    送信する body でも `kind` を 1 件ずつ持たせる —— 画面の並び順や見出しに区分の意味を
//    背負わせない（並びが変わった瞬間に区分が失われるため）。
//
// 🔴 **商流情報ブロックには「公開範囲の相手には表示されません」を常時添える**
//    （`F-013 AC-2` / `docs/04` §S-012 主要コンポーネント）。折りたたみの中や
//    ツールチップに隠さない —— 入力している最中に見えていないと意味が無い。
//
// 🔴 **保存だけでは公開されない**（`docs/04` §S-012「操作と結果」/ `F-014 AC-2`）。
//    `S-013`（公開範囲の設定）は T-06-06 で実装されるため、本タスクでは**事実だけを書く**
//    （存在しない画面へのリンクを置かない。`S-003` の `S-012` 導線と同じ判断）。
//
// 🔴 Tier 3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。
//    1 カラムで積み、狭い画面では表を横スクロールで劣化させる。
//
// ⚠️ `docs/04` §S-012 は要件エディタに「行のドラッグで相互に移動できる」と書いているが、
//    本タスクでは**削除して入れ直す**形にした。ドラッグ&ドロップは新規依存かキーボード操作の
//    自前実装を伴い、`CLAUDE.md` §13.3（モバイルで破綻させない）とも噛み合わない。
//    区分の切り替えは「その要件をどちらのブロックに置くか」であり、行数が数件の画面では
//    入れ直しで足りる。**この差分は docs/05 §6.4「#26 の実装の決着（T-06-01）」に記録した。**
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@ses/ui';
// 🔴 差し込み記号と組み立ては `'use client'` を持たない共有モジュールに置く
//    （このファイルの export をサーバ側から値 import すると client reference に置換されて壊れる。
//     `lib/projects/created-href.ts` 冒頭の実測メモ）。**`@ses/db` に依存しないモジュールである**
//     ことが、ここから import してよい条件である（`tests/static/client-db-boundary.test.ts`）。
import { buildCreatedHref } from '../../../../lib/projects/created-href';

export type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type SkillDictionaryOption = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
};

/** 画面上の要件 1 行（数値は入力途中の文字列のまま持つ）。 */
export type ProjectFormRequirement = {
  /** 🔴 画面内だけの一意キー。DB には出ない（`ProjectRequirement` は id を採番される）。 */
  readonly key: string;
  /** `'MUST'` | `'NICE'`。🔴 これが `F-013 AC-1` の区分そのものである。 */
  readonly kind: string;
  /** `''` = スキル指定なし（自由記述だけの要件）。 */
  readonly skillId: string;
  readonly skillName: string;
  readonly freeText: string;
  /** `''` = 未指定。 */
  readonly requiredYears: string;
};

/**
 * フォームの値。
 * 🔴 `tenantId` を持たない（`CLAUDE.md` §3.1）。`originAssignmentId` も持たない
 *    （`F-045` の還流ジョブだけが書く列。`lib/projects/schemas.ts` の注記）。
 */
export type ProjectFormValues = {
  readonly name: string;
  readonly status: string;
  readonly headcount: string;
  readonly startDate: string;
  readonly unitPriceMin: string;
  readonly unitPriceMax: string;
  readonly prefecture: string;
  readonly remoteMode: string;
  /** 🔴 内部限定（`F-013 AC-2`）。 */
  readonly endClientName: string;
  /** 🔴 内部限定（同上）。 */
  readonly internalUnitPrice: string;
  readonly publicSummary: string;
  readonly requirements: readonly ProjectFormRequirement[];
};

export type ProjectFormMessages = {
  readonly sectionBasic: string;
  readonly sectionConditions: string;
  readonly sectionCommerce: string;
  readonly sectionPublicSummary: string;

  readonly nameLabel: string;
  readonly headcountLabel: string;
  readonly headcountUnit: string;
  readonly startDateLabel: string;
  readonly statusLabel: string;
  readonly statusNote: string;

  /** 必須 / 尚可の 2 ブロック（`kind` をキーにした写像）。 */
  readonly requirementHeadings: Readonly<Record<string, string>>;
  readonly requirementNotes: Readonly<Record<string, string>>;
  readonly requirementEmpties: Readonly<Record<string, string>>;
  readonly requirementSkillLabel: string;
  readonly requirementSkillSearch: string;
  readonly requirementYearsLabel: string;
  readonly requirementFreeTextLabel: string;
  readonly requirementAdd: string;
  readonly requirementRemove: string;
  readonly requirementColumnRequirement: string;
  readonly requirementColumnYears: string;
  readonly requirementColumnActions: string;
  readonly requirementYearsUnit: string;
  readonly requirementErrorEmpty: string;
  readonly requirementErrorDuplicate: string;

  readonly unitPriceLabel: string;
  readonly unitPriceMin: string;
  readonly unitPriceMax: string;
  readonly unitPriceUnit: string;
  readonly prefectureLabel: string;
  readonly remoteModeLabel: string;
  readonly valueUnset: string;

  readonly commerceNotice: string;
  readonly endClientNameLabel: string;
  readonly internalUnitPriceLabel: string;

  readonly publicSummaryLabel: string;
  readonly publicSummaryNote: string;

  readonly visibilityComingSoon: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveError: string;
  readonly cancel: string;
  readonly leaveConfirm: string;
};

export type ProjectFormProps = {
  readonly mode: 'CREATE' | 'EDIT';
  /** `EDIT` のときだけ非 null。`PATCH /api/projects/{id}` の対象。 */
  readonly projectId: string | null;
  readonly initial: ProjectFormValues;
  readonly skillDictionary: readonly SkillDictionaryOption[];
  readonly statusOptions: readonly SelectOption[];
  readonly remoteModeOptions: readonly SelectOption[];
  readonly prefectureOptions: readonly SelectOption[];
  /** 要件の 2 区分（`'MUST'` / `'NICE'`）。順序がそのままブロックの並びになる。 */
  readonly requirementKinds: readonly string[];
  readonly cancelHref: string;
  /**
   * 登録直後の遷移先（`{id}` を採番された ID で置き換える）。
   * 🔴 **関数ではなく文字列で受け取る。** サーバコンポーネントからクライアント
   *    コンポーネントへ渡す props は直列化できなければならず、関数は渡せない
   *    （Server Actions を除く。docs/05 §6.1「すべて Route Handler。Server Actions を使わない」）。
   * 🔴 値の出所は `lib/projects/created-href.ts` の 1 か所である（`PROJECT_CREATED_HREF_PATTERN`）。
   *    サーバ側の `form-props.ts` には置けない（このファイルからも読むため）。
   */
  readonly createdHrefPattern: string;
  readonly messages: ProjectFormMessages;
};

type Phase = 'idle' | 'submitting' | 'error' | 'saved';

type RequirementError = 'EMPTY' | 'DUPLICATE' | null;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 送信する body（docs/05 §6.4 #26 の `ProjectInput`）。
 * 🔴 `kind` を 1 件ずつ持たせる（`F-013 AC-1`）。ブロックの並び順に意味を持たせない。
 */
export function toRequestBody(values: ProjectFormValues) {
  return {
    name: values.name.trim(),
    status: values.status,
    headcount: numberOrNull(values.headcount) ?? 1,
    startDate: emptyToNull(values.startDate),
    unitPriceMin: numberOrNull(values.unitPriceMin),
    unitPriceMax: numberOrNull(values.unitPriceMax),
    prefecture: emptyToNull(values.prefecture),
    remoteMode: emptyToNull(values.remoteMode),
    endClientName: emptyToNull(values.endClientName),
    internalUnitPrice: numberOrNull(values.internalUnitPrice),
    publicSummary: emptyToNull(values.publicSummary),
    requirements: values.requirements.map((requirement) => ({
      kind: requirement.kind,
      skillId: emptyToNull(requirement.skillId),
      freeText: emptyToNull(requirement.freeText),
      requiredYears: numberOrNull(requirement.requiredYears),
    })),
  };
}

export function ProjectForm({
  mode,
  projectId,
  initial,
  skillDictionary,
  statusOptions,
  remoteModeOptions,
  prefectureOptions,
  requirementKinds,
  cancelHref,
  createdHrefPattern,
  messages,
}: ProjectFormProps) {
  const [values, setValues] = useState<ProjectFormValues>(initial);
  const [dirty, setDirty] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  /**
   * 辞書の絞り込み語。🔴 **区分ごとに別々に持つ**（1 つにすると、必須ブロックで絞った語が
   * 尚可ブロックの候補まで消し、利用者からは「候補が出てこない」不具合に見える）。
   */
  const [skillFilters, setSkillFilters] = useState<Readonly<Record<string, string>>>({});
  /** 追加フォームの下書き（区分ごとに別々に持つ）。 */
  const [drafts, setDrafts] = useState<Readonly<Record<string, ProjectFormRequirement>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, RequirementError>>>({});
  const [sequence, setSequence] = useState(0);

  // 🔴 `docs/04` §10.1 `S-012`「未保存の状態で離脱しようとすると確認」。
  //    ブラウザの標準ダイアログを使う（自前のモーダルでは戻る・タブを閉じるを捕まえられない）。
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = messages.leaveConfirm;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, messages.leaveConfirm]);

  function update(patch: Partial<ProjectFormValues>): void {
    setValues((current) => ({ ...current, ...patch }));
    setDirty(true);
    // 保存済み表示は入力を再開した時点で消す（古い成功表示を残さない）。
    setPhase((current) => (current === 'saved' ? 'idle' : current));
  }

  function draftOf(kind: string): ProjectFormRequirement {
    return (
      drafts[kind] ?? { key: '', kind, skillId: '', skillName: '', freeText: '', requiredYears: '' }
    );
  }

  function setDraft(kind: string, patch: Partial<ProjectFormRequirement>): void {
    setDrafts((current) => ({ ...current, [kind]: { ...draftOf(kind), ...patch } }));
  }

  function filteredDictionaryOf(kind: string): readonly SkillDictionaryOption[] {
    const query = (skillFilters[kind] ?? '').trim().toLowerCase();
    if (query === '') return skillDictionary;
    return skillDictionary.filter((entry) => entry.name.toLowerCase().includes(query));
  }

  /**
   * 🔴 追加時の検証は API 側（`normalizeRequirements`）と**同じ 2 つの規則**である。
   *    ①スキルも自由記述も無い行は作れない ②同じスキルを 2 回置けない（**区分をまたいでも**）。
   *    ⚠️ 画面の判定は入力の手戻りを減らすためのものであり、拒否の本体はサーバ側である
   *    （`F-004 AC-9`「API を直接呼んでも拒否される」）。
   */
  function addRequirement(kind: string): void {
    const draft = draftOf(kind);
    const skillId = draft.skillId.trim();
    const freeText = draft.freeText.trim();
    if (skillId === '' && freeText === '') {
      setErrors((current) => ({ ...current, [kind]: 'EMPTY' }));
      return;
    }
    if (skillId !== '' && values.requirements.some((entry) => entry.skillId === skillId)) {
      setErrors((current) => ({ ...current, [kind]: 'DUPLICATE' }));
      return;
    }
    const entry = skillDictionary.find((candidate) => candidate.id === skillId);
    const key = `r${String(sequence)}`;
    setSequence((current) => current + 1);
    setErrors((current) => ({ ...current, [kind]: null }));
    setDrafts((current) => ({
      ...current,
      [kind]: { key: '', kind, skillId: '', skillName: '', freeText: '', requiredYears: '' },
    }));
    update({
      requirements: [
        ...values.requirements,
        {
          key,
          kind,
          skillId,
          skillName: entry === undefined ? '' : entry.name,
          freeText,
          requiredYears: draft.requiredYears.trim(),
        },
      ],
    });
  }

  function removeRequirement(key: string): void {
    setErrors({});
    update({ requirements: values.requirements.filter((entry) => entry.key !== key) });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase === 'submitting') return;
    setPhase('submitting');

    try {
      const response = await fetch(
        mode === 'CREATE' ? '/api/projects' : `/api/projects/${projectId ?? ''}`,
        {
          method: mode === 'CREATE' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(toRequestBody(values)),
        },
      );
      if (!response.ok) {
        // 🔴 `docs/04` §10.1 `S-012`「保存失敗は入力値保持で再試行」。値を捨てない。
        setPhase('error');
        return;
      }
      const created = (await response.json()) as { readonly id: string };
      // 🔴 離脱確認を先に解除してから遷移する（保存できているのに確認を出さない）。
      setDirty(false);
      if (mode === 'CREATE') {
        window.location.assign(buildCreatedHref(createdHrefPattern, created.id));
        return;
      }
      setPhase('saved');
    } catch {
      setPhase('error');
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      data-testid="project-form"
      data-mode={mode}
      className="flex flex-col gap-8"
    >
      {phase === 'error' ? (
        <p role="alert" className="text-sm text-red-700" data-testid="project-form-error">
          {messages.saveError}
        </p>
      ) : null}
      {phase === 'saved' ? (
        <p role="status" className="text-sm text-emerald-700" data-testid="project-form-saved">
          {messages.saved}
        </p>
      ) : null}

      {/* --- 1. 基本 ------------------------------------------------------- */}
      <section data-testid="project-section-basic">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionBasic}</h2>
        <label className="ses-field">
          <span>{messages.nameLabel}</span>
          <input
            name="name"
            type="text"
            required
            value={values.name}
            onChange={(event) => update({ name: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-name"
          />
        </label>
        <label className="ses-field">
          <span>
            {messages.headcountLabel}（{messages.headcountUnit}）
          </span>
          <input
            name="headcount"
            type="number"
            inputMode="numeric"
            min={1}
            value={values.headcount}
            onChange={(event) => update({ headcount: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-headcount"
          />
        </label>
        <label className="ses-field">
          <span>{messages.startDateLabel}</span>
          <input
            name="startDate"
            type="date"
            value={values.startDate}
            onChange={(event) => update({ startDate: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-start-date"
          />
        </label>
        <label className="ses-field">
          <span>{messages.statusLabel}</span>
          <select
            name="status"
            value={values.status}
            onChange={(event) => update({ status: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-status"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-slate-500" data-testid="project-status-note">
          {messages.statusNote}
        </p>
      </section>

      {/* --- 2 / 3. 必須要件 / 尚可要件 ------------------------------------- */}
      {/* 🔴 F-013 AC-1: 区分ごとに独立したブロックで描く（見出し・説明・空状態が別物）。 */}
      {requirementKinds.map((kind) => {
        const rows = values.requirements.filter((entry) => entry.kind === kind);
        const draft = draftOf(kind);
        const error = errors[kind] ?? null;
        return (
          <section key={kind} data-testid={`project-section-requirements-${kind}`}>
            <h2 className="mb-3 text-base font-bold text-slate-900">
              {messages.requirementHeadings[kind]}
            </h2>
            <p
              className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              data-testid={`project-requirements-note-${kind}`}
            >
              {messages.requirementNotes[kind]}
            </p>

            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="ses-field">
                <span>{messages.requirementSkillSearch}</span>
                <input
                  type="search"
                  value={skillFilters[kind] ?? ''}
                  onChange={(event) =>
                    setSkillFilters((current) => ({ ...current, [kind]: event.target.value }))
                  }
                  disabled={phase === 'submitting'}
                  data-testid={`project-requirement-skill-filter-${kind}`}
                />
              </label>
              <label className="ses-field">
                <span>{messages.requirementSkillLabel}</span>
                <select
                  value={draft.skillId}
                  onChange={(event) => setDraft(kind, { skillId: event.target.value })}
                  disabled={phase === 'submitting'}
                  data-testid={`project-requirement-skill-${kind}`}
                >
                  <option value="">{messages.valueUnset}</option>
                  {filteredDictionaryOf(kind).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ses-field">
                <span>{messages.requirementYearsLabel}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={draft.requiredYears}
                  onChange={(event) => setDraft(kind, { requiredYears: event.target.value })}
                  disabled={phase === 'submitting'}
                  data-testid={`project-requirement-years-${kind}`}
                />
              </label>
              <label className="ses-field">
                <span>{messages.requirementFreeTextLabel}</span>
                <input
                  type="text"
                  value={draft.freeText}
                  onChange={(event) => setDraft(kind, { freeText: event.target.value })}
                  disabled={phase === 'submitting'}
                  data-testid={`project-requirement-free-text-${kind}`}
                />
              </label>
              <Button
                type="button"
                onClick={() => addRequirement(kind)}
                disabled={phase === 'submitting'}
                data-testid={`project-requirement-add-${kind}`}
              >
                {messages.requirementAdd}
              </Button>
            </div>

            {error === null ? null : (
              <p
                role="alert"
                className="mb-2 text-sm text-red-700"
                data-testid={`project-requirement-error-${kind}`}
              >
                {error === 'EMPTY'
                  ? messages.requirementErrorEmpty
                  : messages.requirementErrorDuplicate}
              </p>
            )}

            {rows.length === 0 ? (
              // 🔴 `docs/04` §10.1 `S-012`: 必須 0 件は**警告**（保存は許す）。尚可 0 件は通常の空状態。
              <p
                className={
                  kind === 'MUST' ? 'text-sm text-amber-700' : 'text-sm text-slate-600'
                }
                data-testid={`project-requirements-empty-${kind}`}
              >
                {messages.requirementEmpties[kind]}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="w-full border-collapse text-sm"
                  data-testid={`project-requirements-table-${kind}`}
                >
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="p-2">{messages.requirementColumnRequirement}</th>
                      <th className="p-2">{messages.requirementColumnYears}</th>
                      <th className="p-2">{messages.requirementColumnActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.key}
                        className="border-b border-slate-100"
                        data-testid={`project-requirement-row-${kind}-${row.key}`}
                        data-kind={row.kind}
                      >
                        <td className="p-2">
                          {row.skillName === '' ? row.freeText : row.skillName}
                          {row.skillName !== '' && row.freeText !== '' ? (
                            <span className="ml-2 text-slate-600">{row.freeText}</span>
                          ) : null}
                        </td>
                        <td className="p-2">
                          {row.requiredYears === ''
                            ? '—'
                            : `${row.requiredYears}${messages.requirementYearsUnit}`}
                        </td>
                        <td className="p-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => removeRequirement(row.key)}
                            disabled={phase === 'submitting'}
                            data-testid={`project-requirement-remove-${row.key}`}
                          >
                            {messages.requirementRemove}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {/* --- 4. 条件 ------------------------------------------------------- */}
      <section data-testid="project-section-conditions">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionConditions}</h2>
        <fieldset className="mb-2">
          <legend className="text-sm text-slate-700">
            {messages.unitPriceLabel}（{messages.unitPriceUnit}）
          </legend>
          <label className="ses-field">
            <span>{messages.unitPriceMin}</span>
            <input
              name="unitPriceMin"
              type="number"
              inputMode="numeric"
              min={0}
              value={values.unitPriceMin}
              onChange={(event) => update({ unitPriceMin: event.target.value })}
              disabled={phase === 'submitting'}
              data-testid="project-unit-price-min"
            />
          </label>
          <label className="ses-field">
            <span>{messages.unitPriceMax}</span>
            <input
              name="unitPriceMax"
              type="number"
              inputMode="numeric"
              min={0}
              value={values.unitPriceMax}
              onChange={(event) => update({ unitPriceMax: event.target.value })}
              disabled={phase === 'submitting'}
              data-testid="project-unit-price-max"
            />
          </label>
        </fieldset>
        <label className="ses-field">
          <span>{messages.prefectureLabel}</span>
          <select
            name="prefecture"
            value={values.prefecture}
            onChange={(event) => update({ prefecture: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-prefecture"
          >
            <option value="">{messages.valueUnset}</option>
            {prefectureOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ses-field">
          <span>{messages.remoteModeLabel}</span>
          <select
            name="remoteMode"
            value={values.remoteMode}
            onChange={(event) => update({ remoteMode: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-remote-mode"
          >
            <option value="">{messages.valueUnset}</option>
            {remoteModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* --- 5. 商流情報（内部用）------------------------------------------- */}
      {/* 🔴 F-013 AC-2: 「公開範囲の相手には表示されません」を**常時**添える。 */}
      <section
        data-testid="project-section-commerce"
        className="rounded-md border border-amber-200 bg-amber-50 p-4"
      >
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionCommerce}</h2>
        <p className="mb-3 text-sm text-slate-800" data-testid="project-commerce-notice">
          {messages.commerceNotice}
        </p>
        <label className="ses-field">
          <span>{messages.endClientNameLabel}</span>
          <input
            name="endClientName"
            type="text"
            value={values.endClientName}
            onChange={(event) => update({ endClientName: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-end-client-name"
          />
        </label>
        <label className="ses-field">
          <span>
            {messages.internalUnitPriceLabel}（{messages.unitPriceUnit}）
          </span>
          <input
            name="internalUnitPrice"
            type="number"
            inputMode="numeric"
            min={0}
            value={values.internalUnitPrice}
            onChange={(event) => update({ internalUnitPrice: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-internal-unit-price"
          />
        </label>
      </section>

      {/* --- 6. 外部公開用の記載 -------------------------------------------- */}
      <section data-testid="project-section-public-summary">
        <h2 className="mb-3 text-base font-bold text-slate-900">
          {messages.sectionPublicSummary}
        </h2>
        {/* 🔴 docs/04 §S-012: 入力中に商流層の観点を注意書きで示す（合否はここで判定しない）。 */}
        <p className="mb-2 text-sm text-slate-600" data-testid="project-public-summary-note">
          {messages.publicSummaryNote}
        </p>
        <label className="ses-field">
          <span>{messages.publicSummaryLabel}</span>
          <textarea
            name="publicSummary"
            rows={5}
            value={values.publicSummary}
            onChange={(event) => update({ publicSummary: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-public-summary"
          />
        </label>
      </section>

      {/* 🔴 docs/04 §S-012「保存だけでは公開されない」。`S-013` は T-06-06。 */}
      <p
        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        data-testid="project-visibility-coming-soon"
      >
        {messages.visibilityComingSoon}
      </p>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={phase === 'submitting'} data-testid="project-submit">
          {phase === 'submitting' ? messages.saving : messages.save}
        </Button>
        <a className="ses-secondary-link" href={cancelHref} data-testid="project-cancel">
          {messages.cancel}
        </a>
      </div>
    </form>
  );
}
