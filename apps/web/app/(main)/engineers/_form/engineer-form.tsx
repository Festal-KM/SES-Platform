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
// ============================================================================
// 🔴 2026-10-05: 枠を新しくした（**人間提示のワイヤーフレーム「SES Hub 新規人材登録
//    ダッシュボード.png」**）。🔴 **項目の集合・バリデーション・送信先は 1 つも変えていない。**
// ============================================================================
// | 変えたもの | 🔴 変えていないもの |
// |---|---|
// | 1 列（720px）→ **3 カラム**（左: 縦ステッパー + 登録のポイント / 中央: 書類 + 基本情報・スキル・経歴 / 右: 諸条件 + 登録内容の確認 + 操作） | 🔴 **6 セクションの集合と `data-testid`**（`engineer-section-*`）、入力欄の `name`、`toRequestBody`、送信先（`POST /api/engineers` / `PATCH /api/engineers/{id}`） |
// | 書類の取り込み枠（ドラッグ & ドロップ）を**編集のときだけ**出す | 🔴 **アップロードの経路**（`S-008` と同じ `uploadSkillSheet` = `#18` → S3 → `#19`。新しい API を作っていない） |
// | 保存・キャンセルを右カラムの「登録内容の確認」の下へ | 🔴 **`engineer-submit` / `engineer-cancel` の testid と挙動** |
//
// 🔴 **ワイヤーフレームから意図して作らなかったもの**（[Issue #87] に記録）:
//   - **AI が氏名 / フリガナ / 性別 / 生年月日 / 年齢を読み取る** —— `CLAUDE.md` §3.2 が
//     「氏名・生年月日・連絡先・顔写真・現所属会社名は送信前にマスキングする」と定めており、
//     **マスキングした以上 AI はそれらを返せない**。性別・年齢・生年月日は `BR-52` で収集しないと
//     決めており **DB に列が無い**。
//   - **「AI で情報を読み取る」ボタン** —— `sheet-parser`（§12.2）の配線は本タスクの範囲外であり、
//     🔴 **押して何も起きないボタンを置かない**（`UI_GUIDELINES.md` §7）。**枠も出さない。**
//   - **「読み取った書類（抜粋）」のプレビュー** —— 抽出結果が無い（上と同じ理由）。
//   - **ステータス / 担当者 / 区分 / 並行状況** —— DB にも API にも列が無い
//     （`EngineerInput` は `docs/05` §6.4 #16 のとおりで、🔴 **項目を 1 つも増やしていない**）。
//   - **抽出結果のタブ 5 本** —— 抽出が無いので面が無い。セクションの縦積みのままにした。
// 🔴 **縦ステッパーは `packages/ui` の部品にしていない**（画面の中の `<ol>` である）。理由は
//    ①`docs/04` §5-13 の 26 部品に「手順の現在地」を表す器が無く、`RankedList` は**順位**
//    （無彩色の数字。並べ替えない契約）で `done` / `current` / `todo` を取れず、`NavIndex` は
//    **行に状態の口を作らない**ことを型で守っている ②部品を足すのは §5-13 への追記
//    （= 人間の判断。`CLAUDE.md` §8.6）であり実装側で決めない ③いま手順を持つ画面はここだけである。
//    ⚠️ `S-002` / `A-007`（ウィザード）が同じ形を要るようになったら、**そのときに部品へ上げる**
//    （画面ごとに 2 つ目を書かない。完了報告で申し送る）。
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
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
  SELECTED_CLASSES,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
} from '@ses/ui';
import { YEAR_MONTH_PATTERN } from '@ses/domain';
// 🔴 ステッパーの状態は純関数（`lib/engineers/registration-steps.ts`）。画面は結果を描くだけである。
import {
  canImportDocuments,
  registrationSteps,
  type RegistrationStepKey,
  type RegistrationStepState,
} from '../../../../lib/engineers/registration-steps';
// 🔴 **アップロードは `S-008` と同じ 1 本の経路**（`#18` → S3 → `#19`）。新しい API を作らない。
//    失敗の分類も同じ関数（`skillSheetUploadErrorKind`）であり、`if` の写しを作らない。
import {
  skillSheetUploadErrorKind,
  uploadSkillSheet,
} from '../../../../lib/skill-sheets/upload-client';
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

  // --- 2026-10-05: 左レール（縦ステッパー 4 段 + 登録のポイント）-------------------
  readonly stepsTitle: string;
  readonly stepLabelDocuments: string;
  readonly stepLabelProfile: string;
  readonly stepLabelConditions: string;
  readonly stepLabelReview: string;
  /** 🔴 書類の段の注記はモードで変わる（新規は登録後にしか取り込めない）。 */
  readonly stepNoteDocumentsCreate: string;
  readonly stepNoteDocumentsEdit: string;
  readonly stepNoteProfile: string;
  readonly stepNoteConditions: string;
  readonly stepNoteReview: string;
  readonly stepStateDone: string;
  readonly stepStateCurrent: string;
  readonly stepStateTodo: string;
  readonly stepStateOptional: string;
  readonly pointsTitle: string;
  /** 🔴 段落の配列（`RailCard` と同じ形。任意の JSX を入れる口を作らない）。 */
  readonly points: readonly string[];

  // --- 2026-10-05: 書類の取り込み（`S-008` と同じ経路）--------------------------
  readonly documentsTitle: string;
  readonly documentsDropHint: string;
  readonly documentsAcceptedTitle: string;
  readonly documentsVersionPrefix: string;
  readonly documentsManageLink: string;
  /** 🔴 対応形式・画像の注記・検査の注記は `S-008` と**同じ文言キー**から来る（語を 2 本持たない）。 */
  readonly uploadFormats: string;
  readonly uploadImageNotice: string;
  readonly uploadScanNotice: string;
  readonly uploadFileLabel: string;
  readonly uploadSubmit: string;
  readonly uploadSubmitting: string;
  readonly uploadDone: string;
  readonly uploadError: string;
  readonly uploadErrorTooLarge: string;
  readonly uploadErrorQuota: string;
  readonly uploadErrorTransfer: string;
  /** 🔴 取り込んだ直後の版の状態（`SCANNING`）。`CLEAN` になるまで共有できない。 */
  readonly scanStatusScanning: string;

  // --- 2026-10-05: 登録内容の確認（右カラム）-----------------------------------
  readonly reviewTitle: string;
  readonly reviewDisplayName: string;
  readonly reviewSkills: string;
  readonly reviewCareers: string;
  readonly reviewUnit: string;
  readonly reviewNotEntered: string;
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

/**
 * 書類の取り込みの進行（2026-10-05）。
 * 🔴 **フォームの保存（`Phase`）と別の型である** —— 終端の語が違う（保存は `saved` =「台帳に入った」、
 *    取り込みは `done` =「版が採番され、検査が始まった」）。同じ型にすると、取り込みの成功が
 *    「保存しました」と表示されうる。`S-008` の `Phase` と同じ 4 値であり、語も合わせてある。
 */
type UploadPhase = 'idle' | 'submitting' | 'error' | 'done';

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
  // --- 書類の取り込み（編集のときだけ使う。`S-008` と同じ経路）-----------------------
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [uploadErrorCode, setUploadErrorCode] = useState<string | null>(null);
  /**
   * 🔴 **このページで取り込んだ版だけ**（既存の版の一覧は読まない）。読むと `S-008` と
   *    2 つ目の版一覧になり、スキャン状態の見え方が 2 実装になる（`F-011 AC-2` の担保が割れる）。
   */
  const [acceptedVersions, setAcceptedVersions] = useState<readonly number[]>([]);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

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

  /**
   * 🔴 書類の取り込み（`S-008` と**同じ 1 本の経路**: `#18` 署名 → S3 → `#19` 確定）。
   *
   * 🔴 **確定まで通って初めて成功である**（`uploadSkillSheet` の 🔴）。版が採番された直後の状態は
   *    必ず `SCANNING` であり、**`CLEAN` になるまでダウンロードも外部への添付もできない**
   *    （`CLAUDE.md` §3.4 / `F-011 AC-1`）。したがってここでは **状態を「検査中」と出すだけ**で、
   *    閲覧・ダウンロード・共有の導線を 1 つも置かない（それらは `S-008` に在り、監査ログの
   *    記録と結び付いている。`BR-28`）。
   * 🔴 **フォームの保存とは別の操作である**（`<form>` の submit に相乗りさせない —— 相乗りさせると
   *    「保存したら送られる」「送信に失敗したら保存も失敗」という 2 つの失敗が混ざる）。
   */
  async function onUploadDocument(): Promise<void> {
    if (engineerId === null || documentFile === null || uploadPhase === 'submitting') return;
    setUploadPhase('submitting');
    setUploadErrorCode(null);
    try {
      const outcome = await uploadSkillSheet(
        {
          engineerId,
          fileName: documentFile.name,
          contentType: documentFile.type,
          byteSize: documentFile.size,
          // 🔴 版のメモはこの画面では受け取らない（`S-008` の項目であり、入力欄を増やさない）。
          note: null,
          body: documentFile,
        },
        { fetch: globalThis.fetch.bind(globalThis) },
      );
      if (!outcome.ok) {
        setUploadErrorCode(outcome.code);
        setUploadPhase('error');
        return;
      }
      setAcceptedVersions((current) => [...current, outcome.version]);
      setDocumentFile(null);
      if (documentInputRef.current !== null) documentInputRef.current.value = '';
      setUploadPhase('done');
    } catch {
      setUploadErrorCode(null);
      setUploadPhase('error');
    }
  }

  function pickDocument(file: File | null): void {
    setDocumentFile(file);
    // 🔴 直前の結果表示を消す（古い「取り込みました」を次のファイルに引き継がない）。
    setUploadPhase('idle');
    setUploadErrorCode(null);
  }

  function onDropDocument(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    pickDocument(event.dataTransfer.files.item(0));
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

  // ==========================================================================
  // 🔴 枠（3 カラム）を描くための導出値。**いずれも型で網羅が強制される写像**である
  //    （段やモードが増えたらコンパイルが通らない）。
  // ==========================================================================
  const canImport = canImportDocuments(mode, engineerId);
  const steps = registrationSteps({ mode, displayName: values.displayName });
  const stepLabelOf: Readonly<Record<RegistrationStepKey, string>> = {
    documents: messages.stepLabelDocuments,
    profile: messages.stepLabelProfile,
    conditions: messages.stepLabelConditions,
    review: messages.stepLabelReview,
  };
  const stepNoteOf: Readonly<Record<RegistrationStepKey, string>> = {
    // 🔴 新規では「登録した後に取り込めます」と書く（できないことを `disabled` で表さない）。
    documents: canImport ? messages.stepNoteDocumentsEdit : messages.stepNoteDocumentsCreate,
    profile: messages.stepNoteProfile,
    conditions: messages.stepNoteConditions,
    review: messages.stepNoteReview,
  };
  const stepStateLabelOf: Readonly<Record<RegistrationStepState, string>> = {
    DONE: messages.stepStateDone,
    CURRENT: messages.stepStateCurrent,
    TODO: messages.stepStateTodo,
    OPTIONAL: messages.stepStateOptional,
  };
  // 🔴 失敗の分類は `S-008` と同じ関数（`if` の写しを作らない）。文言だけこの画面が持つ。
  const uploadErrorOf: Readonly<Record<ReturnType<typeof skillSheetUploadErrorKind>, string>> = {
    TOO_LARGE: messages.uploadErrorTooLarge,
    QUOTA: messages.uploadErrorQuota,
    TRANSFER: messages.uploadErrorTransfer,
    OTHER: messages.uploadError,
  };
  const activeCareerCount = values.careers.filter((career) => !career.removed).length;

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      data-testid="engineer-form"
      data-mode={mode}
      className="flex flex-col gap-6"
    >
      {phase === 'error' ? (
        <p role="alert" className="text-body text-danger" data-testid="engineer-form-error">
          {messages.saveError}
        </p>
      ) : null}
      {phase === 'saved' ? (
        <p role="status" className="text-body text-success" data-testid="engineer-form-saved">
          {messages.saved}
        </p>
      ) : null}

      {/* ============================================================================
          🔴 3 カラム（左: 手引き / 中央: 台帳の中身 / 右: 営業の条件と確認）。
          ============================================================================
          🔴 **器を入れ子にしてあるのは、中央カラムを狭くしないためである。**
             素朴に 3 カラムを `xl:flex-row` 1 本で並べると、1280px（Playwright の
             `Desktop Chrome` でもあり、最も多い実機幅の 1 つ）で
             **中央 = 1280 − 柱 224 − gutter 48 − 左 224 − 右 320 − gap 48 ≈ 416px** になり、
             経歴の行エディタ（min-content ≈ 736px）がほとんど読めなくなる。
             🔴 `HANDOFF.md` §6-9 と `PageBody` の `'main-min'` の実測が残した教訓は
             **「見える量を削ってまでパネルを横に置かない」**である。
          したがって段を 2 つに分ける:
            - `< xl` … 1 列（左レール → 中央 → 右。**保存が最後に来る** = モバイルで先に押せない）
            - `xl 〜 2xl` … 左レールは上段の全幅、下に 中央 | 右(320) → **中央 ≈ 664px**
            - `2xl 〜` … 左(224) | 中央 | 右(320) → **中央 ≈ 672px 以上**（1920px で ≈ 1056px）
          🔴 どの幅でも「広げると中央が狭くなる」が起きない。
          🔴 段は Tailwind 既定のみ（独自ブレークポイントを作らない。`CLAUDE.md` §13.3）。 */}
      <div className="flex flex-col gap-6 2xl:flex-row">
        {/* ============ 左レール: 縦ステッパー + 登録のポイント ============ */}
        <div className="flex w-full flex-col gap-4 2xl:w-56 2xl:shrink-0">
          <Card data-testid="engineer-form-steps-card">
            <CardHeader>
              <CardTitle>{messages.stepsTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* 🔴 画面の中の `<ol>` であり、部品ではない（ファイル冒頭の 🔴）。
                  🔴 全段で左端 2px を場所取りする（現在地が移ったときに行がずれない）。 */}
              <ol className="m-0 flex list-none flex-col p-0" data-testid="engineer-form-steps">
                {steps.map((step) => (
                  <li
                    key={step.key}
                    data-testid={`engineer-form-step-${step.key}`}
                    data-state={step.state}
                    aria-current={step.state === 'CURRENT' ? 'step' : undefined}
                    className={cn(
                      'flex gap-3 border-l-2 border-l-transparent py-2 pl-2',
                      step.state === 'CURRENT' ? SELECTED_CLASSES : null,
                    )}
                  >
                    <span className="shrink-0 text-xs text-fg-muted tabular-nums">{step.order}</span>
                    <span className="min-w-0">
                      <span className="block text-body text-fg">{stepLabelOf[step.key]}</span>
                      <span className="block text-xs text-fg-muted">{stepNoteOf[step.key]}</span>
                      <span className="block text-micro text-fg-muted">
                        {stepStateLabelOf[step.state]}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card data-testid="engineer-form-points-card">
            <CardHeader>
              <CardTitle>{messages.pointsTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="engineer-form-points">
                {messages.points.map((line, index) => (
                  <li
                    key={`${String(index)}-${line}`}
                    className="text-body text-fg-muted"
                    data-testid={`engineer-form-point-${index}`}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* 🔴 中央と右だけを `xl` で並べる内側の器（上の 🔴）。`min-w-0` を落とすと、
            経歴の表の min-content が器を押し広げてページ全体が横スクロールする。 */}
        <div className="flex min-w-0 flex-1 flex-col gap-6 xl:flex-row">
        {/* ============ 中央: 書類 + 基本情報・スキル・経歴 ============ */}
        <div className="flex min-w-0 flex-1 flex-col gap-8">
      {/* --- 0. 書類の取り込み（2026-10-05。ワイヤーフレーム中央の ①）------------------
          🔴 **新しいアップロード API を作っていない。** 経路は `S-008` と同じ
             `uploadSkillSheet`（`#18` → S3 → `#19`）である。
          🔴 **新規では枠を出さない** —— 既存の API は版をエンジニアに紐づけて採番するため、
             登録前に取り込む経路が存在しない。**押して何も起きない枠を置かず、いつできるかを書く**。
          🔴 **ウイルス検査の状態を正しく出す**（`CLAUDE.md` §3.4 / `F-011 AC-1`）: 取り込んだ直後は
             必ず `SCANNING` であり、`CLEAN` になるまで共有・ダウンロードはできない。
             したがって**この画面には閲覧・ダウンロード・共有の導線を 1 つも置かない**
             （それらは `S-008` に在り、監査ログの記録と結び付いている。`BR-28`）。 */}
      <section data-testid="engineer-section-documents">
        <h2 className="mb-3 text-lg font-semibold text-fg">{messages.documentsTitle}</h2>
        <p className="mb-1 text-body text-fg-muted" data-testid="engineer-document-formats">
          {messages.uploadFormats}
        </p>
        <p className="mb-1 text-body text-fg-muted" data-testid="engineer-document-image-notice">
          {messages.uploadImageNotice}
        </p>
        <p className="mb-3 text-body text-fg-muted" data-testid="engineer-document-scan-notice">
          {messages.uploadScanNotice}
        </p>

        {!canImport ? (
          // 🔴 導線を消すだけにせず「いつできるか」を書く（行き止まりにしない）。
          <p className="text-body text-fg-muted" data-testid="engineer-document-after-save">
            {messages.stepNoteDocumentsCreate}
          </p>
        ) : (
          <>
            {/* 🔴 ドラッグ & ドロップの枠。`<input type="file">` を**消さない**（ドラッグできない
                環境・キーボード操作でも取り込めること）。 */}
            <div
              data-testid="engineer-document-dropzone"
              data-dragging={dragging ? 'true' : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDropDocument}
              className={cn(
                'rounded-md border border-dashed p-4',
                dragging ? 'border-brand bg-brand-bg' : 'border-border-strong bg-bg-subtle',
              )}
            >
              <p className="mb-2 text-body text-fg-muted" data-testid="engineer-document-drop-hint">
                {messages.documentsDropHint}
              </p>
              <Field className="mb-3" label={messages.uploadFileLabel}>
                <Input
                  ref={documentInputRef}
                  type="file"
                  name="document"
                  onChange={(event) => pickDocument(event.target.files?.item(0) ?? null)}
                  disabled={uploadPhase === 'submitting'}
                  data-testid="engineer-document-file"
                />
              </Field>
              <Button
                type="button"
                size="sm"
                onClick={() => void onUploadDocument()}
                disabled={uploadPhase === 'submitting' || documentFile === null}
                data-testid="engineer-document-submit"
              >
                {uploadPhase === 'submitting' ? messages.uploadSubmitting : messages.uploadSubmit}
              </Button>
            </div>

            {uploadPhase === 'done' ? (
              <p role="status" className="mt-2 text-body text-fg" data-testid="engineer-document-done">
                {messages.uploadDone}
              </p>
            ) : null}
            {uploadPhase === 'error' ? (
              <p role="alert" className="mt-2 text-body text-danger" data-testid="engineer-document-error">
                {uploadErrorOf[skillSheetUploadErrorKind(uploadErrorCode)]}
              </p>
            ) : null}

            {acceptedVersions.length === 0 ? null : (
              <div className="mt-3" data-testid="engineer-document-accepted">
                <h3 className="mb-1 text-body font-semibold text-fg">
                  {messages.documentsAcceptedTitle}
                </h3>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {acceptedVersions.map((version) => (
                    <li
                      key={version}
                      className="text-body text-fg"
                      data-testid={`engineer-document-accepted-${version}`}
                    >
                      {messages.documentsVersionPrefix}
                      {version}
                      {' ・ '}
                      {/* 🔴 確定した直後の状態は必ず `SCANNING` である（`#19`）。 */}
                      <span className="text-fg-muted">{messages.scanStatusScanning}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 🔴 版の一覧・検査の結果・閲覧・ダウンロードは `S-008` が正である
                （2 つ目の版一覧を作らない。`docs/04` §S-006 の ⚠️ と同じ理由）。 */}
            <p className="mt-3">
              <Link
                className={SECONDARY_LINK_STACKED_CLASSES}
                href={`/engineers/${engineerId ?? ''}/skill-sheets`}
                data-testid="engineer-document-manage-link"
              >
                {messages.documentsManageLink}
              </Link>
            </p>
          </>
        )}
      </section>

      {/* 🔴 BR-52: 集めない情報を先に明示する（自由記述欄の推奨用途にもしない）。 */}
      <p
        className="rounded-md border border-border bg-bg-subtle p-3 text-body text-fg"
        data-testid="engineer-collection-scope"
      >
        {messages.collectionScope}
      </p>

      {/* --- 1. 基本 ------------------------------------------------------- */}
      <section data-testid="engineer-section-basic">
        <h2 className="mb-3 text-lg font-semibold text-fg">{messages.sectionBasic}</h2>
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
        <p className="text-body text-fg-muted" data-testid="engineer-ownership-note">
          {messages.ownershipReadOnlyNote}
        </p>
      </section>

      {/* --- 2. スキル ----------------------------------------------------- */}
      <section data-testid="engineer-section-skills">
        <h2 className="mb-3 text-lg font-semibold text-fg">{messages.sectionSkills}</h2>
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
          <p role="alert" className="mb-2 text-body text-danger" data-testid="engineer-skill-duplicate">
            {messages.skillDuplicate}
          </p>
        ) : null}

        {values.skills.length === 0 ? (
          <p className="text-body text-fg-muted" data-testid="engineer-skill-empty">
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
          <p className="mb-2 text-body text-fg-muted" data-testid="engineer-new-alias-note">
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
            <p className="mt-2 text-body text-fg-muted" data-testid="engineer-new-alias-empty">
              {messages.newAliasEmpty}
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2" data-testid="engineer-new-alias-list">
              {values.newSkillLabels.map((label) => (
                <li key={label} className="flex items-center gap-1 text-body">
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
          <p className="mt-2 text-body">
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
        <h2 className="mb-3 text-lg font-semibold text-fg">{messages.sectionCareers}</h2>
        <p className="mb-3 text-body text-fg-muted" data-testid="engineer-career-order-note">
          {messages.careerOrderNote}
        </p>
        {values.careers.length === 0 ? (
          <p className="mb-3 text-body text-fg-muted" data-testid="engineer-career-empty">
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
                          <p role="alert" className="text-body text-danger" data-testid={`engineer-career-error-period-from-${career.key}`}>
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
                        <label className="flex items-center gap-2 text-body text-fg">
                          <Checkbox
                            checked={career.ongoing}
                            onChange={(event) => updateCareer(career.key, { ongoing: event.target.checked })}
                            disabled={locked}
                            data-testid={`engineer-career-ongoing-${career.key}`}
                          />
                          {messages.careerOngoingToggle}
                        </label>
                        {rowErrors.periodTo === undefined ? null : (
                          <p role="alert" className="text-body text-danger" data-testid={`engineer-career-error-period-to-${career.key}`}>
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
                        <p role="alert" className="mt-1 text-body text-danger" data-testid={`engineer-career-error-role-${career.key}`}>
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
                        <p role="alert" className="mt-1 text-body text-danger" data-testid={`engineer-career-error-description-${career.key}`}>
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
                          <span className="text-xs text-fg-muted">{messages.careerRemovedNote}</span>
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
        </div>

        {/* ============ 右カラム: 諸条件（営業情報）+ 登録内容の確認 + 操作 ============
            🔴 **項目は 1 つも増やしていない / 減らしていない。** セクション 4〜6
               （稼働 / 条件 / 連絡先）をそのまま右へ移しただけである（`name` も `data-testid` も不変）。
            🔴 幅は固定（`xl:w-80` = 320px）。可変にすると大画面で入力欄だけが伸び、ラベルと値の
               対応が目で追えなくなる（`docs/04` §7.1 のクラス C の根拠を、ここで守っている）。 */}
        <div className="flex w-full flex-col gap-8 xl:w-80 xl:shrink-0">

      {/* --- 4. 稼働 ------------------------------------------------------- */}
      <section data-testid="engineer-section-availability">
        <h2 className="mb-3 text-lg font-semibold text-fg">{messages.sectionAvailability}</h2>
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
        <h2 className="mb-3 text-lg font-semibold text-fg">{messages.sectionConditions}</h2>
        <fieldset className="mb-2">
          <legend className="text-body text-fg">
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
        <h2 className="mb-3 text-lg font-semibold text-fg">{messages.sectionContact}</h2>
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
        <p className="text-body text-fg-muted" data-testid="engineer-contact-note">
          {messages.contactMinimumNote}
        </p>
      </section>

      {/* --- 登録内容の確認（2026-10-05。ワイヤーフレーム右の ④）----------------------
          🔴 **入力欄ではない。** 入力した値から**数えただけ**のものを並べる（新しい項目を
             持たない / 保存する値を変えない）。
          🔴 **「未入力です」を警告色にしない** —— 必須は氏名だけであり、スキル 0 件・経歴 0 行は
             正常な状態である（`docs/04` §S-007 / `F-008 AC-5`）。 */}
      <Card data-testid="engineer-form-review-card">
        <CardHeader>
          <CardTitle>{messages.reviewTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="m-0 text-body" data-testid="engineer-form-review">
            <div className="flex gap-3 border-b border-border py-1">
              <dt className="w-24 shrink-0 text-fg-muted">{messages.reviewDisplayName}</dt>
              <dd className="m-0 break-words text-fg" data-testid="engineer-form-review-display-name">
                {values.displayName.trim() === '' ? messages.reviewNotEntered : values.displayName}
              </dd>
            </div>
            <div className="flex gap-3 border-b border-border py-1">
              <dt className="w-24 shrink-0 text-fg-muted">{messages.reviewSkills}</dt>
              <dd className="m-0 text-fg tabular-nums" data-testid="engineer-form-review-skills">
                {values.skills.length} {messages.reviewUnit}
              </dd>
            </div>
            <div className="flex gap-3 py-1">
              <dt className="w-24 shrink-0 text-fg-muted">{messages.reviewCareers}</dt>
              <dd className="m-0 text-fg tabular-nums" data-testid="engineer-form-review-careers">
                {activeCareerCount} {messages.reviewUnit}
              </dd>
            </div>
          </dl>

          {/* 🔴 primary は 1 画面に 1 つ（§7.6）。testid と挙動は移設前から変えていない。
              🔴 「下書き保存」は作らない —— 下書きの状態も保存先も API に無く、作れば
                 新しい API になる（ワイヤーフレームとの差分は完了報告で申し送る）。 */}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={phase === 'submitting'} data-testid="engineer-submit">
              {phase === 'submitting' ? messages.saving : messages.save}
            </Button>
            <a className={SECONDARY_LINK_CLASSES} href={cancelHref} data-testid="engineer-cancel">
              {messages.cancel}
            </a>
          </div>
        </CardContent>
      </Card>
        </div>
        </div>
      </div>
    </form>
  );
}
