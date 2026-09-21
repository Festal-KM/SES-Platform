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
import {
  Button,
  Field,
  Input,
  SECONDARY_LINK_CLASSES,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@ses/ui';
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

  /**
   * 🔴 T-12-10（`docs/04` 改訂 14 §S-012 / `F-014 AC-6`）: **公開欄 3 欄に添える印**。
   *    既存の商流情報ブロックの注記（`commerceNotice`）と**同じ位置・同じ体裁で、向きだけが逆**である
   *    —— 2 つを 1 画面に並べることで「外に出る欄 / 出ない欄」が入力中に読める。
   */
  readonly publicFieldNotice: string;
  /** 🔴 公開中の案件を編集しているときの事前表示（**編集開始時から常時**。押した後ではない）。 */
  readonly recheckPublishedToPrefix: string;
  readonly recheckPublishedToSuffix: string;
  readonly recheckWillRun: string;
  /** 🔴 **走らない条件も同じ帯に書く**（書かないと編集が避けられ、台帳が更新されなくなる）。 */
  readonly recheckWillNotRun: string;
  /** 🔴 保存の完了表示（再検査が積まれたとき）。**保存の成否と再検査の結果を混ぜない。** */
  readonly savedRecheckQueued: string;

  readonly visibilityNotice: string;
  /** ✅ T-06-06: `S-013` への導線のラベル（`docs/04` §S-012「操作と結果」の secondary）。 */
  readonly visibilitySettings: string;
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
  /**
   * ✅ T-06-06: `S-013`（公開範囲の設定）への導線（`docs/04` §S-012「保存だけでは公開されない」）。
   * 🔴 **`EDIT` のときだけ非 `null`。** 新規登録では案件がまだ存在せず `S-013` に渡す ID が無い
   *    （保存後に遷移する `S-011` に同じ導線がある）。**存在しない画面・ID へのリンクを作らない。**
   */
  readonly visibilityHref: string | null;
  /**
   * 🔴 T-12-10（`F-014 AC-6` / `docs/04` 改訂 14 §S-012）: **現在公開中の取引先の社数**。
   *    0（または新規登録）なら事前表示の帯を出さない —— 再検査が走らない画面に出すと
   *    「何も起きない警告」に慣れてしまう。
   */
  readonly publishedToCount: number;
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
  visibilityHref,
  publishedToCount,
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
  /** 🔴 T-12-10: 直前の保存で再検査が積まれたか（`#26` の応答の `recheck.queued`）。 */
  const [recheckQueued, setRecheckQueued] = useState(false);

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
      // 🔴 T-12-10: `#26` の応答は `{ id, recheck }`（docs/05 §6.4 #26）。
      //    `recheck.queued` が「保存しました」と「保存しました。公開中の内容を再検査しています」を
      //    書き分ける**唯一の材料**である（`docs/04` 改訂 14 §S-012）。
      const created = (await response.json()) as {
        readonly id: string;
        readonly recheck?: { readonly queued: boolean };
      };
      setRecheckQueued(created.recheck?.queued === true);
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
          {/* 🔴 T-12-10: 保存は同期で成功しており、再検査はこれからである。
              **1 つの表示に混ぜない**（混ぜると「保存できなかった」と誤読される）。 */}
          {recheckQueued ? messages.savedRecheckQueued : messages.saved}
        </p>
      ) : null}

      {/* 🔴 T-12-10: 公開中の案件を編集しているときの事前表示（`docs/04` 改訂 14 §S-012 /
          `F-014 AC-6` / `UC-26` 手順 2）。**編集開始時から常時**であり、保存ボタンを押した後ではない。
          🔴 **走る条件と走らない条件の両方**を書く —— 走らない条件を書かないと、利用者は
          「保存のたびに公開が消えるかもしれない」と読んで編集を避け、台帳が更新されなくなる
          （`docs/01` 章 1.1-1 の再発）。
          🔴 **未公開の案件・新規登録では出さない**（「何も起きない警告」に慣れさせない）。
          🔴 **確認ダイアログを挟まない**（止めるべきは外へ出す操作であり、外へ出るものを減らす
          方向の編集ではない。`docs/04` §S-012）。 */}
      {mode === 'EDIT' && publishedToCount > 0 ? (
        <section
          className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="project-form-recheck-notice"
        >
          <p>
            {messages.recheckPublishedToPrefix}
            {publishedToCount}
            {messages.recheckPublishedToSuffix}
          </p>
          <p className="mt-1">{messages.recheckWillRun}</p>
          <p className="mt-1" data-testid="project-form-recheck-notice-will-not-run">
            {messages.recheckWillNotRun}
          </p>
        </section>
      ) : null}

      {/* --- 1. 基本 ------------------------------------------------------- */}
      <section data-testid="project-section-basic">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.sectionBasic}</h2>
        <Field className="mb-4" label={messages.nameLabel}>
          <Input
            name="name"
            type="text"
            required
            value={values.name}
            onChange={(event) => update({ name: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-name"
          />
          {/* 🔴 T-12-10: 「この欄は公開先が読む」印（`docs/04` 改訂 14 §S-012 / `F-014 AC-6`）。 */}
          <p className="mt-1 text-xs text-slate-600" data-testid="project-public-field-notice-name">
            {messages.publicFieldNotice}
          </p>
        </Field>
        <Field
          className="mb-4"
          label={
            <>
              {messages.headcountLabel}（{messages.headcountUnit}）
            </>
          }
        >
          <Input
            name="headcount"
            type="number"
            inputMode="numeric"
            min={1}
            value={values.headcount}
            onChange={(event) => update({ headcount: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-headcount"
          />
        </Field>
        <Field className="mb-4" label={messages.startDateLabel}>
          <Input
            name="startDate"
            type="date"
            value={values.startDate}
            onChange={(event) => update({ startDate: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-start-date"
          />
        </Field>
        <Field className="mb-4" label={messages.statusLabel}>
          <Select
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
          </Select>
        </Field>
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
              <Field width="auto" label={messages.requirementSkillSearch}>
                <Input
                  type="search"
                  value={skillFilters[kind] ?? ''}
                  onChange={(event) =>
                    setSkillFilters((current) => ({ ...current, [kind]: event.target.value }))
                  }
                  disabled={phase === 'submitting'}
                  data-testid={`project-requirement-skill-filter-${kind}`}
                />
              </Field>
              <Field width="auto" label={messages.requirementSkillLabel}>
                <Select
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
                </Select>
              </Field>
              <Field width="auto" label={messages.requirementYearsLabel}>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={draft.requiredYears}
                  onChange={(event) => setDraft(kind, { requiredYears: event.target.value })}
                  disabled={phase === 'submitting'}
                  data-testid={`project-requirement-years-${kind}`}
                />
              </Field>
              <Field width="auto" label={messages.requirementFreeTextLabel}>
                <Input
                  type="text"
                  value={draft.freeText}
                  onChange={(event) => setDraft(kind, { freeText: event.target.value })}
                  disabled={phase === 'submitting'}
                  data-testid={`project-requirement-free-text-${kind}`}
                />
                {/* 🔴 T-12-10: 自由記述だけが公開先に届く（スキル指定は辞書の名前である）。 */}
                <p
                  className="mt-1 text-xs text-slate-600"
                  data-testid={`project-public-field-notice-requirement-${kind}`}
                >
                  {messages.publicFieldNotice}
                </p>
              </Field>
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
              <Table data-testid={`project-requirements-table-${kind}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{messages.requirementColumnRequirement}</TableHead>
                    <TableHead>{messages.requirementColumnYears}</TableHead>
                    <TableHead>{messages.requirementColumnActions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.key}
                      data-testid={`project-requirement-row-${kind}-${row.key}`}
                      data-kind={row.kind}
                    >
                      <TableCell whitespace="normal">
                        {row.skillName === '' ? row.freeText : row.skillName}
                        {row.skillName !== '' && row.freeText !== '' ? (
                          <span className="ml-2 text-slate-600">{row.freeText}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.requiredYears === ''
                          ? '—'
                          : `${row.requiredYears}${messages.requirementYearsUnit}`}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => removeRequirement(row.key)}
                          disabled={phase === 'submitting'}
                          data-testid={`project-requirement-remove-${row.key}`}
                        >
                          {messages.requirementRemove}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
          <Field className="mb-4" label={messages.unitPriceMin}>
            <Input
              name="unitPriceMin"
              type="number"
              inputMode="numeric"
              min={0}
              value={values.unitPriceMin}
              onChange={(event) => update({ unitPriceMin: event.target.value })}
              disabled={phase === 'submitting'}
              data-testid="project-unit-price-min"
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
              data-testid="project-unit-price-max"
            />
          </Field>
        </fieldset>
        <Field className="mb-4" label={messages.prefectureLabel}>
          <Select
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
          </Select>
        </Field>
        <Field className="mb-4" label={messages.remoteModeLabel}>
          <Select
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
          </Select>
        </Field>
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
        <Field className="mb-4" label={messages.endClientNameLabel}>
          <Input
            name="endClientName"
            type="text"
            value={values.endClientName}
            onChange={(event) => update({ endClientName: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-end-client-name"
          />
        </Field>
        <Field
          className="mb-4"
          label={
            <>
              {messages.internalUnitPriceLabel}（{messages.unitPriceUnit}）
            </>
          }
        >
          <Input
            name="internalUnitPrice"
            type="number"
            inputMode="numeric"
            min={0}
            value={values.internalUnitPrice}
            onChange={(event) => update({ internalUnitPrice: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-internal-unit-price"
          />
        </Field>
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
        {/* 🔴 T-12-10: 「この欄は公開先が読む」印（3 欄で同じ語・同じ体裁）。 */}
        <p
          className="mb-2 text-xs text-slate-600"
          data-testid="project-public-field-notice-public-summary"
        >
          {messages.publicFieldNotice}
        </p>
        <Field className="mb-4" label={messages.publicSummaryLabel}>
          {/* ⚠️ `Textarea` は `field-sizing-content` を持つため、`rows` は**初期値ではなく
              下限の目安**として働き、入力量に応じて伸びる（`min-h-20` が下限）。 */}
          <Textarea
            name="publicSummary"
            rows={5}
            value={values.publicSummary}
            onChange={(event) => update({ publicSummary: event.target.value })}
            disabled={phase === 'submitting'}
            data-testid="project-public-summary"
          />
        </Field>
      </section>

      {/* 🔴 docs/04 §S-012「保存だけでは公開されない」（`F-014 AC-2`）。 */}
      <p
        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        data-testid="project-visibility-notice"
      >
        {messages.visibilityNotice}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={phase === 'submitting'} data-testid="project-submit">
          {phase === 'submitting' ? messages.saving : messages.save}
        </Button>
        {/* ✅ T-06-06: `S-013` への secondary（編集時のみ。新規は ID が無いので出さない）。 */}
        {visibilityHref === null ? null : (
          <a
            className={SECONDARY_LINK_CLASSES}
            href={visibilityHref}
            data-testid="project-visibility-link"
          >
            {messages.visibilitySettings}
          </a>
        )}
        <a className={SECONDARY_LINK_CLASSES} href={cancelHref} data-testid="project-cancel">
          {messages.cancel}
        </a>
      </div>
    </form>
  );
}
