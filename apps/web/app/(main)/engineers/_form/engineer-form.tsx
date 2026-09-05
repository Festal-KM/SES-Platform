'use client';

// apps/web/app/(main)/engineers/_form/engineer-form.tsx
// `S-007` エンジニアの登録・編集 — フォーム本体（docs/04 §S-007 / `F-008` / `F-010`）。T-05-01。
//
// 🔴 **所属区分は読み取り専用の値である**（`docs/04` §S-007「操作と結果」/ `F-008 AC-2`）。
//    入力欄・セレクトを持たず、送信する body にもキーが無い。入力できると
//    「境界が入力で決まる」ことになる。担保の本体は API 側（スキーマ・RLS・トリガ）であり、
//    この画面はその事実を利用者に**説明する**（`organization-form.tsx` の `lifecycleState` と同じ形）。
//
// 🔴 **`BR-52` の範囲外の入力欄を作らない**（`F-008 AC-1`）。本籍・家族構成・健康情報・信条に
//    あたる欄が無いだけでなく、`希望条件`（自由記述）の**推奨用途としても求めない** ——
//    セクション冒頭に「書かないでほしい」ことを明示する（集めていない情報は漏れない）。
//
// 🔴 辞書に無いスキル表記は**新語候補として起票**するだけで、その場では検索に使われない
//    （`F-010 AC-1`）。画面にその旨を必ず出す（起票したのに効かない、と受け取られないため）。
//
// 🔴 Tier 3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。
//    1 カラムで積み、狭い画面では表を横スクロールで劣化させる。
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@ses/ui';

export type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type SkillDictionaryOption = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
};

/** 画面上のスキル 1 行（数値は入力途中の文字列のまま持つ）。 */
export type EngineerFormSkill = {
  readonly skillId: string;
  readonly name: string;
  readonly yearsOfExperience: string;
  /** `''` = 未設定。 */
  readonly level: string;
};

/**
 * フォームの値。
 * 🔴 `ownerPartnerCompanyId` / `tenantId` を**持たない**（`F-008 AC-2` / `CLAUDE.md` §3.1）。
 * 🔴 `birthDate` / `本籍` / `家族構成` / `健康` / `信条` に相当する項目も持たない（`BR-52`）。
 */
export type EngineerFormValues = {
  readonly displayName: string;
  readonly availability: string;
  readonly availableFrom: string;
  readonly unitPriceMin: string;
  readonly unitPriceMax: string;
  readonly prefecture: string;
  readonly remoteMode: string;
  readonly preferenceNote: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly skills: readonly EngineerFormSkill[];
  readonly newSkillLabels: readonly string[];
};

export type EngineerFormMessages = {
  readonly sectionBasic: string;
  readonly sectionSkills: string;
  readonly sectionCareers: string;
  readonly sectionAvailability: string;
  readonly sectionConditions: string;
  readonly sectionContact: string;

  readonly displayNameLabel: string;
  readonly ownershipLabel: string;
  readonly ownershipValue: string;
  readonly ownershipReadOnlyNote: string;
  readonly collectionScope: string;

  readonly skillSearchLabel: string;
  readonly skillAdd: string;
  readonly skillColumnSkill: string;
  readonly skillColumnYears: string;
  readonly skillColumnLevel: string;
  readonly skillColumnActions: string;
  readonly skillRemove: string;
  readonly skillEmpty: string;
  readonly skillDuplicate: string;
  readonly skillLevelUnset: string;
  readonly newAliasLabel: string;
  readonly newAliasAdd: string;
  readonly newAliasNote: string;
  readonly newAliasEmpty: string;

  readonly careersComingSoon: string;

  readonly availabilityLabel: string;
  readonly availableFromLabel: string;

  readonly unitPriceLabel: string;
  readonly unitPriceMin: string;
  readonly unitPriceMax: string;
  readonly unitPriceUnit: string;
  readonly prefectureLabel: string;
  readonly remoteModeLabel: string;
  readonly preferenceNoteLabel: string;
  readonly valueUnset: string;

  readonly contactEmailLabel: string;
  readonly contactPhoneLabel: string;
  readonly contactMinimumNote: string;

  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveError: string;
  readonly cancel: string;
  readonly leaveConfirm: string;
};

export type EngineerFormProps = {
  readonly mode: 'CREATE' | 'EDIT';
  /** `EDIT` のときだけ非 null。`PATCH /api/engineers/{id}` の対象。 */
  readonly engineerId: string | null;
  readonly initial: EngineerFormValues;
  readonly skillDictionary: readonly SkillDictionaryOption[];
  readonly availabilityOptions: readonly SelectOption[];
  readonly remoteModeOptions: readonly SelectOption[];
  readonly prefectureOptions: readonly SelectOption[];
  readonly levelOptions: readonly SelectOption[];
  /** 保存後に戻る先（一覧が実装されるまではホーム）。 */
  readonly cancelHref: string;
  readonly messages: EngineerFormMessages;
};

type Phase = 'idle' | 'submitting' | 'error' | 'saved';

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
 * 送信する body（docs/05 §6.4 #16 の `EngineerInput`）。
 * 🔴 ここに `ownerPartnerCompanyId` を組み立てる余地が無い（値そのものを画面が知らない）。
 */
function toRequestBody(values: EngineerFormValues) {
  return {
    displayName: values.displayName.trim(),
    availability: values.availability,
    availableFrom: emptyToNull(values.availableFrom),
    unitPriceMin: numberOrNull(values.unitPriceMin),
    unitPriceMax: numberOrNull(values.unitPriceMax),
    prefecture: emptyToNull(values.prefecture),
    remoteMode: emptyToNull(values.remoteMode),
    preferenceNote: emptyToNull(values.preferenceNote),
    contactEmail: emptyToNull(values.contactEmail),
    contactPhone: emptyToNull(values.contactPhone),
    skills: values.skills.map((skill) => ({
      skillId: skill.skillId,
      yearsOfExperience: numberOrNull(skill.yearsOfExperience) ?? 0,
      level: skill.level === '' ? null : Number(skill.level),
    })),
    newSkillLabels: [...values.newSkillLabels],
  };
}

export function EngineerForm({
  mode,
  engineerId,
  initial,
  skillDictionary,
  availabilityOptions,
  remoteModeOptions,
  prefectureOptions,
  levelOptions,
  cancelHref,
  messages,
}: EngineerFormProps) {
  const [values, setValues] = useState<EngineerFormValues>(initial);
  const [dirty, setDirty] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [skillFilter, setSkillFilter] = useState('');
  const [skillDraftId, setSkillDraftId] = useState('');
  const [skillDraftYears, setSkillDraftYears] = useState('');
  const [skillDuplicate, setSkillDuplicate] = useState(false);
  const [aliasDraft, setAliasDraft] = useState('');

  // 🔴 `docs/04` §10.1 `S-007`「未保存の状態で離脱しようとすると確認」。
  //    ブラウザの標準ダイアログを使う（自前のモーダルでは戻る・タブを閉じるを捕まえられない）。
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // 🔴 近年のブラウザは文言を無視して標準文を出すが、`returnValue` の設定が
      //    ダイアログを出す条件である実装が残っている。両方を行う。
      event.returnValue = messages.leaveConfirm;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, messages.leaveConfirm]);

  function update(patch: Partial<EngineerFormValues>): void {
    setValues((current) => ({ ...current, ...patch }));
    setDirty(true);
    // 保存済み表示は入力を再開した時点で消す（古い成功表示を残さない）。
    setPhase((current) => (current === 'saved' ? 'idle' : current));
  }

  const filteredDictionary =
    skillFilter.trim() === ''
      ? skillDictionary
      : skillDictionary.filter((entry) =>
          entry.name.toLowerCase().includes(skillFilter.trim().toLowerCase()),
        );

  function addSkill(): void {
    if (skillDraftId === '') return;
    if (values.skills.some((skill) => skill.skillId === skillDraftId)) {
      setSkillDuplicate(true);
      return;
    }
    const entry = skillDictionary.find((candidate) => candidate.id === skillDraftId);
    if (entry === undefined) return;
    setSkillDuplicate(false);
    update({
      skills: [
        ...values.skills,
        {
          skillId: entry.id,
          name: entry.name,
          yearsOfExperience: skillDraftYears.trim() === '' ? '0' : skillDraftYears.trim(),
          level: '',
        },
      ],
    });
    setSkillDraftId('');
    setSkillDraftYears('');
  }

  function updateSkill(skillId: string, patch: Partial<EngineerFormSkill>): void {
    update({
      skills: values.skills.map((skill) =>
        skill.skillId === skillId ? { ...skill, ...patch } : skill,
      ),
    });
  }

  function removeSkill(skillId: string): void {
    setSkillDuplicate(false);
    update({ skills: values.skills.filter((skill) => skill.skillId !== skillId) });
  }

  function addAlias(): void {
    const label = aliasDraft.trim();
    if (label === '' || values.newSkillLabels.includes(label)) return;
    update({ newSkillLabels: [...values.newSkillLabels, label] });
    setAliasDraft('');
  }

  function removeAlias(label: string): void {
    update({ newSkillLabels: values.newSkillLabels.filter((entry) => entry !== label) });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase === 'submitting') return;
    setPhase('submitting');

    try {
      const response = await fetch(
        mode === 'CREATE' ? '/api/engineers' : `/api/engineers/${engineerId ?? ''}`,
        {
          method: mode === 'CREATE' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(toRequestBody(values)),
        },
      );
      if (!response.ok) {
        // 🔴 `docs/04` §10.1 `S-007`「保存失敗は入力値を保持したまま再試行」。値を捨てない。
        setPhase('error');
        return;
      }
      const created = (await response.json()) as { readonly id: string };
      // 🔴 離脱確認を先に解除してから遷移する（保存できているのに確認を出さない）。
      setDirty(false);
      if (mode === 'CREATE') {
        window.location.assign(`/engineers/${created.id}/edit`);
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
      data-testid="engineer-form"
      data-mode={mode}
      className="flex flex-col gap-8"
    >
      {phase === 'error' ? (
        <p role="alert" className="text-sm text-red-700" data-testid="engineer-form-error">
          {messages.saveError}
        </p>
      ) : null}
      {phase === 'saved' ? (
        <p role="status" className="text-sm text-emerald-700" data-testid="engineer-form-saved">
          {messages.saved}
        </p>
      ) : null}

      {/* 🔴 BR-52: 集めない情報を先に明示する（自由記述欄の推奨用途にもしない）。 */}
      <p
        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        data-testid="engineer-collection-scope"
      >
        {messages.collectionScope}
      </p>

      {/* --- 1. 基本 ------------------------------------------------------- */}
      <section data-testid="engineer-section-basic">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionBasic}</h2>
        <label className="ses-field">
          <span>{messages.displayNameLabel}</span>
          <input
            name="displayName"
            type="text"
            required
            value={values.displayName}
            onChange={(event) => update({ displayName: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-display-name"
          />
        </label>
        {/* 🔴 F-008 AC-2: 所属区分は読み取り専用。input / select を置かない。 */}
        <p className="ses-field">
          <span>{messages.ownershipLabel}</span>
          <output data-testid="engineer-ownership">{messages.ownershipValue}</output>
        </p>
        <p className="text-sm text-slate-500" data-testid="engineer-ownership-note">
          {messages.ownershipReadOnlyNote}
        </p>
      </section>

      {/* --- 2. スキル ----------------------------------------------------- */}
      <section data-testid="engineer-section-skills">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionSkills}</h2>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="ses-field">
            <span>{messages.skillSearchLabel}</span>
            <input
              type="search"
              value={skillFilter}
              onChange={(event) => setSkillFilter(event.target.value)}
              disabled={phase === 'submitting'}
              data-testid="engineer-skill-filter"
            />
          </label>
          <label className="ses-field">
            <span>{messages.skillColumnSkill}</span>
            <select
              value={skillDraftId}
              onChange={(event) => setSkillDraftId(event.target.value)}
              disabled={phase === 'submitting'}
              data-testid="engineer-skill-select"
            >
              <option value="">{messages.valueUnset}</option>
              {filteredDictionary.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ses-field">
            <span>{messages.skillColumnYears}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={skillDraftYears}
              onChange={(event) => setSkillDraftYears(event.target.value)}
              disabled={phase === 'submitting'}
              data-testid="engineer-skill-years"
            />
          </label>
          <Button
            type="button"
            onClick={addSkill}
            disabled={phase === 'submitting'}
            data-testid="engineer-skill-add"
          >
            {messages.skillAdd}
          </Button>
        </div>
        {skillDuplicate ? (
          <p role="alert" className="mb-2 text-sm text-red-700" data-testid="engineer-skill-duplicate">
            {messages.skillDuplicate}
          </p>
        ) : null}

        {values.skills.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="engineer-skill-empty">
            {messages.skillEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="engineer-skill-table">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="p-2">{messages.skillColumnSkill}</th>
                  <th className="p-2">{messages.skillColumnYears}</th>
                  <th className="p-2">{messages.skillColumnLevel}</th>
                  <th className="p-2">{messages.skillColumnActions}</th>
                </tr>
              </thead>
              <tbody>
                {values.skills.map((skill) => (
                  <tr
                    key={skill.skillId}
                    className="border-b border-slate-100"
                    data-testid={`engineer-skill-row-${skill.skillId}`}
                  >
                    <td className="p-2">{skill.name}</td>
                    <td className="p-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.5}
                        value={skill.yearsOfExperience}
                        onChange={(event) =>
                          updateSkill(skill.skillId, { yearsOfExperience: event.target.value })
                        }
                        disabled={phase === 'submitting'}
                        data-testid={`engineer-skill-years-${skill.skillId}`}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={skill.level}
                        onChange={(event) =>
                          updateSkill(skill.skillId, { level: event.target.value })
                        }
                        disabled={phase === 'submitting'}
                        data-testid={`engineer-skill-level-${skill.skillId}`}
                      >
                        <option value="">{messages.skillLevelUnset}</option>
                        {levelOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => removeSkill(skill.skillId)}
                        disabled={phase === 'submitting'}
                        data-testid={`engineer-skill-remove-${skill.skillId}`}
                      >
                        {messages.skillRemove}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 🔴 F-010 AC-1: 辞書に無い表記は起票のみ。採用されるまで検索に使われないと明示する。 */}
        <div className="mt-4">
          <p className="mb-2 text-sm text-slate-600" data-testid="engineer-new-alias-note">
            {messages.newAliasNote}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="ses-field">
              <span>{messages.newAliasLabel}</span>
              <input
                type="text"
                value={aliasDraft}
                onChange={(event) => setAliasDraft(event.target.value)}
                disabled={phase === 'submitting'}
                data-testid="engineer-new-alias-input"
              />
            </label>
            <Button
              type="button"
              onClick={addAlias}
              disabled={phase === 'submitting'}
              data-testid="engineer-new-alias-add"
            >
              {messages.newAliasAdd}
            </Button>
          </div>
          {values.newSkillLabels.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600" data-testid="engineer-new-alias-empty">
              {messages.newAliasEmpty}
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2" data-testid="engineer-new-alias-list">
              {values.newSkillLabels.map((label) => (
                <li key={label} className="flex items-center gap-1 text-sm">
                  <span>{label}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removeAlias(label)}
                    disabled={phase === 'submitting'}
                  >
                    {messages.skillRemove}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* --- 3. 経験内容と従事期間 ----------------------------------------- */}
      {/* 🔴 台帳側の保存先が docs/05 §3.4 に無い（申し送り）。実装していないことを隠さない。 */}
      <section data-testid="engineer-section-careers">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionCareers}</h2>
        <p className="text-sm text-slate-600" data-testid="engineer-careers-coming-soon">
          {messages.careersComingSoon}
        </p>
      </section>

      {/* --- 4. 稼働 ------------------------------------------------------- */}
      <section data-testid="engineer-section-availability">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionAvailability}</h2>
        <label className="ses-field">
          <span>{messages.availabilityLabel}</span>
          <select
            name="availability"
            value={values.availability}
            onChange={(event) => update({ availability: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-availability"
          >
            {availabilityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ses-field">
          <span>{messages.availableFromLabel}</span>
          <input
            name="availableFrom"
            type="date"
            value={values.availableFrom}
            onChange={(event) => update({ availableFrom: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-available-from"
          />
        </label>
      </section>

      {/* --- 5. 条件 ------------------------------------------------------- */}
      <section data-testid="engineer-section-conditions">
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
              data-testid="engineer-unit-price-min"
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
              data-testid="engineer-unit-price-max"
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
            data-testid="engineer-prefecture"
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
            data-testid="engineer-remote-mode"
          >
            <option value="">{messages.valueUnset}</option>
            {remoteModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ses-field">
          <span>{messages.preferenceNoteLabel}</span>
          <textarea
            name="preferenceNote"
            rows={3}
            value={values.preferenceNote}
            onChange={(event) => update({ preferenceNote: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-preference-note"
          />
        </label>
      </section>

      {/* --- 6. 連絡先 ----------------------------------------------------- */}
      <section data-testid="engineer-section-contact">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionContact}</h2>
        <label className="ses-field">
          <span>{messages.contactEmailLabel}</span>
          <input
            name="contactEmail"
            type="email"
            value={values.contactEmail}
            onChange={(event) => update({ contactEmail: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-contact-email"
          />
        </label>
        <label className="ses-field">
          <span>{messages.contactPhoneLabel}</span>
          <input
            name="contactPhone"
            type="tel"
            value={values.contactPhone}
            onChange={(event) => update({ contactPhone: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-contact-phone"
          />
        </label>
        <p className="text-sm text-slate-500" data-testid="engineer-contact-note">
          {messages.contactMinimumNote}
        </p>
      </section>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={phase === 'submitting'} data-testid="engineer-submit">
          {phase === 'submitting' ? messages.saving : messages.save}
        </Button>
        <a className="ses-secondary-link" href={cancelHref} data-testid="engineer-cancel">
          {messages.cancel}
        </a>
      </div>
    </form>
  );
}
