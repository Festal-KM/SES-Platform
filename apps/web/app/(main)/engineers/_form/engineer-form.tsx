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
//
// 🔴 T-09-12: セクション 3「経験内容と従事期間」は**実際に登録できる行エディタ**である（docs/04 §S-007
//    セクション 3 / `F-008 AC-5`。Issue #35 = A）。T-05-01 の暫定表示（`careersComingSoon`）は廃止した。
//    - 1 行 = 期間（開始年月・終了年月。終了は「継続中」）/ 役割 / 業務内容 / 使用技術。行の追加・編集・削除。
//    - 🔴 **0 行での保存を妨げない**（警告色・保存抑止・必須マークを作らない。0 行は正常な状態）。
//    - 🔴 **役割は選択式にしない**（現場ごとに呼び方が違い、辞書化すると入力されなくなる）。
//    - 🔴 編集中は追加順のまま動かさず、**並び替えは保存時にサーバが行う**（応答の配列順に揃える）。
//    - 削除は保存前に限り取り消せる（保存後の復元は持たない —— 監査ログの「削除」が確定した事実か
//      一時的なものか読めなくなる）。
//    - 🔴 `id` は既存行にだけ付けて送る（無いと「編集」と「削除 + 追加」が区別できず監査が嘘になる）。
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@ses/ui';
import { YEAR_MONTH_PATTERN } from '@ses/domain';
// 🔴 経歴 1 行の画面表現。`form-props.ts`（サーバ）と共有するため `'use client'` の外に置く。
import {
  toEngineerFormCareer,
  type EngineerFormCareer,
  type StoredCareerRowLike,
} from './career-values';

export type { EngineerFormCareer } from './career-values';

/** `S-009`（スキル辞書・別名・新語候補）。起票した候補の採否はこの画面で行う。 */
const SKILL_DICTIONARY_HREF = '/skills';

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
  /** 🔴 編集中は追加順のまま。並び替えは保存時にサーバが行う（`docs/04` §S-007「操作と結果」）。 */
  readonly careers: readonly EngineerFormCareer[];
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
  /** 🔴 T-05-03: `S-009` への導線（起票した候補の採否はそちらで行う）。 */
  readonly newAliasDictionaryLink: string;

  readonly careerOrderNote: string;
  readonly careerColumnPeriod: string;
  readonly careerColumnRole: string;
  readonly careerColumnDescription: string;
  readonly careerColumnTechnologies: string;
  readonly careerColumnActions: string;
  readonly careerPeriodFromLabel: string;
  readonly careerPeriodToLabel: string;
  readonly careerOngoingToggle: string;
  readonly careerAdd: string;
  readonly careerRemove: string;
  readonly careerRestore: string;
  readonly careerRemovedNote: string;
  readonly careerEmpty: string;
  readonly careerErrorPeriodFrom: string;
  readonly careerErrorPeriodTo: string;
  readonly careerErrorPeriodOrder: string;
  readonly careerErrorRole: string;
  readonly careerErrorDescription: string;

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

/** 経歴 1 行の項目直下に出す検証エラー（`docs/04` §S-007「バリデーションエラーは項目直下」）。 */
type CareerRowErrors = {
  readonly periodFrom?: string;
  readonly periodTo?: string;
  readonly role?: string;
  readonly description?: string;
};

/**
 * 🔴 送信前の検証（API の Zod / `service.ts` と同じ規則。ここは「項目直下に出す」ための写し）。
 *    開始年月が未入力 / 形式違い、終了年月だけが不正、開始が終了より後、役割・業務内容が空。
 *    🔴 0 行は検証の対象が無い = 何も出ない（0 行の保存を妨げない）。
 */
function validateCareers(
  careers: readonly EngineerFormCareer[],
  messages: EngineerFormMessages,
): Readonly<Record<string, CareerRowErrors>> {
  const errors: Record<string, CareerRowErrors> = {};
  for (const row of careers) {
    if (row.removed) continue;
    const rowErrors: { -readonly [K in keyof CareerRowErrors]: CareerRowErrors[K] } = {};
    const from = row.periodFrom.trim();
    const to = row.periodTo.trim();
    if (!YEAR_MONTH_PATTERN.test(from)) rowErrors.periodFrom = messages.careerErrorPeriodFrom;
    if (!row.ongoing) {
      if (!YEAR_MONTH_PATTERN.test(to)) rowErrors.periodTo = messages.careerErrorPeriodTo;
      else if (rowErrors.periodFrom === undefined && to < from) {
        rowErrors.periodTo = messages.careerErrorPeriodOrder;
      }
    }
    if (row.role.trim() === '') rowErrors.role = messages.careerErrorRole;
    if (row.description.trim() === '') rowErrors.description = messages.careerErrorDescription;
    if (Object.keys(rowErrors).length > 0) errors[row.key] = rowErrors;
  }
  return errors;
}

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
    // 🔴 削除印の行は送らない（＝ 置き換え保存で消える）。継続中は `periodTo: null`（空文字にしない）。
    //    `id` は既存行にだけ付ける。
    careers: values.careers
      .filter((career) => !career.removed)
      .map((career) => ({
        ...(career.id === null ? {} : { id: career.id }),
        periodFrom: career.periodFrom.trim(),
        periodTo: career.ongoing ? null : career.periodTo.trim(),
        role: career.role.trim(),
        description: career.description.trim(),
        technologies: career.technologies.trim(),
      })),
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
  const [careerErrors, setCareerErrors] = useState<Readonly<Record<string, CareerRowErrors>>>({});
  // 追加した行の React key（`Math.random` を使わず連番。行の同一性は保存後に `id` へ置き換わる）。
  const [careerSequence, setCareerSequence] = useState(0);

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

  /** 🔴 末尾に空行を足し、その場で編集できる（追加順のまま動かさない。`docs/04` §S-007）。 */
  function addCareer(): void {
    const next = careerSequence + 1;
    setCareerSequence(next);
    update({
      careers: [
        ...values.careers,
        {
          key: `new-${next}`,
          id: null,
          periodFrom: '',
          periodTo: '',
          ongoing: false,
          role: '',
          description: '',
          technologies: '',
          removed: false,
        },
      ],
    });
  }

  function updateCareer(key: string, patch: Partial<EngineerFormCareer>): void {
    update({
      careers: values.careers.map((career) =>
        career.key === key ? { ...career, ...patch } : career,
      ),
    });
  }

  /**
   * 削除。既存行は「削除印」を付けて保存前に限り取り消せる形にし、追加したばかりの行はその場で消す
   * （まだ台帳に無いので取り消す対象が無い）。🔴 行の追加・削除も未保存の変更として数える（`dirty`）。
   */
  function removeCareer(key: string): void {
    const target = values.careers.find((career) => career.key === key);
    if (target === undefined) return;
    if (target.id === null) {
      update({ careers: values.careers.filter((career) => career.key !== key) });
      return;
    }
    updateCareer(key, { removed: true });
  }

  function restoreCareer(key: string): void {
    updateCareer(key, { removed: false });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase === 'submitting') return;
    // 🔴 経歴の項目直下の検証。落ちたら送らない（値は保持する）。0 行なら何も出ない。
    const nextCareerErrors = validateCareers(values.careers, messages);
    setCareerErrors(nextCareerErrors);
    if (Object.keys(nextCareerErrors).length > 0) return;
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
      const created = (await response.json()) as {
        readonly id: string;
        readonly careers: readonly StoredCareerRowLike[];
      };
      // 🔴 離脱確認を先に解除してから遷移する（保存できているのに確認を出さない）。
      setDirty(false);
      if (mode === 'CREATE') {
        // 🔴 T-05-02: 登録後は `S-006`（詳細）へ送る（docs/04 §S-007 関連画面「→ `S-006`」）。
        //    以前は編集画面へ送り返していたが、それは `S-006` が未実装だったための暫定である。
        //    詳細を開いた時点で `engineer.view` が記録される（`BR-27`）。
        window.location.assign(`/engineers/${created.id}`);
        return;
      }
      // 🔴 保存後は**サーバが確定した並び**（期間の降順、同期間は登録順）に揃える。削除印の行は消え、
      //    追加した行は台帳の `id` を持つ既存行になる（応答の配列順 = 表示順。画面は並べ替えない）。
      setValues((current) => ({ ...current, careers: created.careers.map(toEngineerFormCareer) }));
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
        <Field className="mb-4" label={messages.displayNameLabel}>
          <Input
            name="displayName"
            type="text"
            required
            value={values.displayName}
            onChange={(event) => update({ displayName: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-display-name"
          />
        </Field>
        {/* 🔴 F-008 AC-2: 所属区分は読み取り専用。input / select を置かない。 */}
        <Field as="p" className="mb-4" label={messages.ownershipLabel}>
          <output data-testid="engineer-ownership">{messages.ownershipValue}</output>
        </Field>
        <p className="text-sm text-slate-500" data-testid="engineer-ownership-note">
          {messages.ownershipReadOnlyNote}
        </p>
      </section>

      {/* --- 2. スキル ----------------------------------------------------- */}
      <section data-testid="engineer-section-skills">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionSkills}</h2>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field width="auto" label={messages.skillSearchLabel}>
            <Input
              type="search"
              value={skillFilter}
              onChange={(event) => setSkillFilter(event.target.value)}
              disabled={phase === 'submitting'}
              data-testid="engineer-skill-filter"
            />
          </Field>
          <Field width="auto" label={messages.skillColumnSkill}>
            <Select
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
            </Select>
          </Field>
          <Field width="auto" label={messages.skillColumnYears}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={skillDraftYears}
              onChange={(event) => setSkillDraftYears(event.target.value)}
              disabled={phase === 'submitting'}
              data-testid="engineer-skill-years"
            />
          </Field>
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
          <Table data-testid="engineer-skill-table">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.skillColumnSkill}</TableHead>
                <TableHead>{messages.skillColumnYears}</TableHead>
                <TableHead>{messages.skillColumnLevel}</TableHead>
                <TableHead>{messages.skillColumnActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {values.skills.map((skill) => (
                <TableRow
                  key={skill.skillId}
                  data-testid={`engineer-skill-row-${skill.skillId}`}
                >
                  <TableCell whitespace="normal">{skill.name}</TableCell>
                  <TableCell>
                    <Input
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
                  </TableCell>
                  <TableCell>
                    <Select
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
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => removeSkill(skill.skillId)}
                      disabled={phase === 'submitting'}
                      data-testid={`engineer-skill-remove-${skill.skillId}`}
                    >
                      {messages.skillRemove}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 🔴 F-010 AC-1: 辞書に無い表記は起票のみ。採用されるまで検索に使われないと明示する。 */}
        <div className="mt-4">
          <p className="mb-2 text-sm text-slate-600" data-testid="engineer-new-alias-note">
            {messages.newAliasNote}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field width="auto" label={messages.newAliasLabel}>
              <Input
                type="text"
                value={aliasDraft}
                onChange={(event) => setAliasDraft(event.target.value)}
                disabled={phase === 'submitting'}
                data-testid="engineer-new-alias-input"
              />
            </Field>
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
                  <Badge variant="outline">{label}</Badge>
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
          {/* 🔴 T-05-03: 起票した候補の行き先（`S-009`）。`docs/04` §S-007 関連画面「→ `S-009`」。
              全ロールが到達してよい画面であり、採否の可否は `S-009` 側が判断する。 */}
          <p className="mt-2 text-sm">
            <Link
              className={SECONDARY_LINK_STACKED_CLASSES}
              href={SKILL_DICTIONARY_HREF}
              data-testid="engineer-new-alias-dictionary-link"
            >
              {messages.newAliasDictionaryLink}
            </Link>
          </p>
        </div>
      </section>

      {/* --- 3. 経験内容と従事期間（T-09-12。docs/04 §S-007 セクション 3）------------------ */}
      {/* 🔴 4 列 + 操作列のテーブルをその場で編集する（カードで囲まない / モーダルを介さない）。
          🔴 0 行で開き、空行を初期表示しない（空行があると「埋めるべきもの」に見え、0 行が正常であることと矛盾する）。
          🔴 「未入力です」の警告・注意色・保存の抑止を作らない。 */}
      <section data-testid="engineer-section-careers">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionCareers}</h2>
        <p className="mb-3 text-sm text-slate-600" data-testid="engineer-career-order-note">
          {messages.careerOrderNote}
        </p>
        {values.careers.length === 0 ? (
          <p className="mb-3 text-sm text-slate-600" data-testid="engineer-career-empty">
            {messages.careerEmpty}
          </p>
        ) : (
          <Table data-testid="engineer-career-table">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.careerColumnPeriod}</TableHead>
                <TableHead>{messages.careerColumnRole}</TableHead>
                <TableHead>{messages.careerColumnDescription}</TableHead>
                <TableHead>{messages.careerColumnTechnologies}</TableHead>
                <TableHead>{messages.careerColumnActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {values.careers.map((career) => {
                const rowErrors = careerErrors[career.key] ?? {};
                const locked = phase === 'submitting' || career.removed;
                return (
                  <TableRow
                    key={career.key}
                    align="top"
                    data-testid={`engineer-career-row-${career.key}`}
                    data-removed={career.removed ? 'true' : undefined}
                    className={career.removed ? 'opacity-60' : undefined}
                  >
                    <TableCell>
                      <div className="flex min-w-48 flex-col gap-2">
                        <Field as="div" label={messages.careerPeriodFromLabel}>
                          <Input
                            type="text"
                            inputMode="numeric"
                            placeholder="YYYY-MM"
                            maxLength={7}
                            value={career.periodFrom}
                            onChange={(event) => updateCareer(career.key, { periodFrom: event.target.value })}
                            disabled={locked}
                            aria-invalid={rowErrors.periodFrom === undefined ? undefined : true}
                            data-testid={`engineer-career-period-from-${career.key}`}
                          />
                        </Field>
                        {rowErrors.periodFrom === undefined ? null : (
                          <p role="alert" className="text-sm text-red-700" data-testid={`engineer-career-error-period-from-${career.key}`}>
                            {rowErrors.periodFrom}
                          </p>
                        )}
                        <Field as="div" label={messages.careerPeriodToLabel}>
                          <Input
                            type="text"
                            inputMode="numeric"
                            placeholder="YYYY-MM"
                            maxLength={7}
                            value={career.ongoing ? '' : career.periodTo}
                            onChange={(event) => updateCareer(career.key, { periodTo: event.target.value })}
                            disabled={locked || career.ongoing}
                            aria-invalid={rowErrors.periodTo === undefined ? undefined : true}
                            data-testid={`engineer-career-period-to-${career.key}`}
                          />
                        </Field>
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <Checkbox
                            checked={career.ongoing}
                            onChange={(event) => updateCareer(career.key, { ongoing: event.target.checked })}
                            disabled={locked}
                            data-testid={`engineer-career-ongoing-${career.key}`}
                          />
                          {messages.careerOngoingToggle}
                        </label>
                        {rowErrors.periodTo === undefined ? null : (
                          <p role="alert" className="text-sm text-red-700" data-testid={`engineer-career-error-period-to-${career.key}`}>
                            {rowErrors.periodTo}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* 🔴 役割は自由入力（選択式にしない）。 */}
                      <Input
                        type="text"
                        className="min-w-32"
                        value={career.role}
                        onChange={(event) => updateCareer(career.key, { role: event.target.value })}
                        disabled={locked}
                        aria-invalid={rowErrors.role === undefined ? undefined : true}
                        data-testid={`engineer-career-role-${career.key}`}
                      />
                      {rowErrors.role === undefined ? null : (
                        <p role="alert" className="mt-1 text-sm text-red-700" data-testid={`engineer-career-error-role-${career.key}`}>
                          {rowErrors.role}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={3}
                        className="min-w-64"
                        value={career.description}
                        onChange={(event) => updateCareer(career.key, { description: event.target.value })}
                        disabled={locked}
                        aria-invalid={rowErrors.description === undefined ? undefined : true}
                        data-testid={`engineer-career-description-${career.key}`}
                      />
                      {rowErrors.description === undefined ? null : (
                        <p role="alert" className="mt-1 text-sm text-red-700" data-testid={`engineer-career-error-description-${career.key}`}>
                          {rowErrors.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* 🔴 使用技術は自由入力（Skill 辞書に正規化しない。docs/05 §3.4.1）。 */}
                      <Input
                        type="text"
                        className="min-w-40"
                        value={career.technologies}
                        onChange={(event) => updateCareer(career.key, { technologies: event.target.value })}
                        disabled={locked}
                        data-testid={`engineer-career-technologies-${career.key}`}
                      />
                    </TableCell>
                    <TableCell>
                      {career.removed ? (
                        <div className="flex flex-col gap-1">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => restoreCareer(career.key)}
                            disabled={phase === 'submitting'}
                            data-testid={`engineer-career-restore-${career.key}`}
                          >
                            {messages.careerRestore}
                          </Button>
                          <span className="text-xs text-slate-500">{messages.careerRemovedNote}</span>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => removeCareer(career.key)}
                          disabled={phase === 'submitting'}
                          data-testid={`engineer-career-remove-${career.key}`}
                        >
                          {messages.careerRemove}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <div className="mt-3">
          <Button
            type="button"
            onClick={addCareer}
            disabled={phase === 'submitting'}
            data-testid="engineer-career-add"
          >
            {messages.careerAdd}
          </Button>
        </div>
      </section>

      {/* --- 4. 稼働 ------------------------------------------------------- */}
      <section data-testid="engineer-section-availability">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionAvailability}</h2>
        <Field className="mb-4" label={messages.availabilityLabel}>
          <Select
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
          </Select>
        </Field>
        <Field className="mb-4" label={messages.availableFromLabel}>
          <Input
            name="availableFrom"
            type="date"
            value={values.availableFrom}
            onChange={(event) => update({ availableFrom: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-available-from"
          />
        </Field>
      </section>

      {/* --- 5. 条件 ------------------------------------------------------- */}
      <section data-testid="engineer-section-conditions">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionConditions}</h2>
        <fieldset className="mb-2">
          <legend className="text-sm text-slate-700">
            {messages.unitPriceLabel}（{messages.unitPriceUnit}）
          </legend>
          <Field className="mb-4" label={messages.unitPriceMin}>
            <Input
              name="unitPriceMin"
              type="number"
              inputMode="numeric"
              min={0}
              value={values.unitPriceMin}
              onChange={(event) => update({ unitPriceMin: event.target.value })}
              disabled={phase === 'submitting'}
              data-testid="engineer-unit-price-min"
            />
          </Field>
          <Field className="mb-4" label={messages.unitPriceMax}>
            <Input
              name="unitPriceMax"
              type="number"
              inputMode="numeric"
              min={0}
              value={values.unitPriceMax}
              onChange={(event) => update({ unitPriceMax: event.target.value })}
              disabled={phase === 'submitting'}
              data-testid="engineer-unit-price-max"
            />
          </Field>
        </fieldset>
        <Field className="mb-4" label={messages.prefectureLabel}>
          <Select
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
          </Select>
        </Field>
        <Field className="mb-4" label={messages.remoteModeLabel}>
          <Select
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
          </Select>
        </Field>
        <Field className="mb-4" label={messages.preferenceNoteLabel}>
          {/* ⚠️ `Textarea` は `field-sizing-content` を持つため、`rows` は**初期値ではなく
              下限の目安**として働き、入力量に応じて伸びる（`min-h-20` が下限）。
              意図した挙動であり、`rows` を落とすと未対応ブラウザでの高さが失われる。 */}
          <Textarea
            name="preferenceNote"
            rows={3}
            value={values.preferenceNote}
            onChange={(event) => update({ preferenceNote: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-preference-note"
          />
        </Field>
      </section>

      {/* --- 6. 連絡先 ----------------------------------------------------- */}
      <section data-testid="engineer-section-contact">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionContact}</h2>
        <Field className="mb-4" label={messages.contactEmailLabel}>
          <Input
            name="contactEmail"
            type="email"
            value={values.contactEmail}
            onChange={(event) => update({ contactEmail: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-contact-email"
          />
        </Field>
        <Field className="mb-4" label={messages.contactPhoneLabel}>
          <Input
            name="contactPhone"
            type="tel"
            value={values.contactPhone}
            onChange={(event) => update({ contactPhone: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="engineer-contact-phone"
          />
        </Field>
        <p className="text-sm text-slate-500" data-testid="engineer-contact-note">
          {messages.contactMinimumNote}
        </p>
      </section>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={phase === 'submitting'} data-testid="engineer-submit">
          {phase === 'submitting' ? messages.saving : messages.save}
        </Button>
        <a className={SECONDARY_LINK_CLASSES} href={cancelHref} data-testid="engineer-cancel">
          {messages.cancel}
        </a>
      </div>
    </form>
  );
}
