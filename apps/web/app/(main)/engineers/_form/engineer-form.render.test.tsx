// apps/web/app/(main)/engineers/_form/engineer-form.render.test.tsx
// `EngineerForm`（`S-007`）の描画テスト。T-05-01。
//
// 🔴 なぜこの粒度で要るか: `F-008 AC-1`（`BR-52` の範囲外の入力欄が**存在しない**）と
//    `F-008 AC-2`（所属区分に**入力欄が無い**）は、「無いこと」の検証である。
//    API の結合テストでは「送っても無視される」ことしか示せず、**画面に欄が無い**ことは
//    DOM を見るしかない。`docs/04` §S-007 は「入力欄としても持たない」と書いており、
//    無視される欄が画面にあるだけでも要件違反である。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` で
//    静的 HTML を得る（新規依存を増やさない。`sending-domain-screen.render.test.tsx` と同じ方針）。
//    `useEffect`（離脱確認の `beforeunload`）は静的レンダーでは走らないため、ここでは
//    「イベントを登録するコード（`dirty` の初期値は false）」の存在は検証しない。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EngineerForm,
  type EngineerFormMessages,
  type EngineerFormProps,
  type EngineerFormValues,
  type SkillDictionaryOption,
} from './engineer-form';

const SKILL_JAVA = '01930000-0000-7000-8000-0000000000e1';
const SKILL_AWS = '01930000-0000-7000-8000-0000000000e2';

const DICTIONARY: readonly SkillDictionaryOption[] = [
  { id: SKILL_JAVA, name: 'Java', category: 'LANGUAGE' },
  { id: SKILL_AWS, name: 'AWS', category: 'CLOUD' },
];

const messages: EngineerFormMessages = {
  sectionBasic: '基本',
  sectionSkills: 'スキル',
  sectionCareers: '経験内容と従事期間',
  sectionAvailability: '稼働',
  sectionConditions: '条件',
  sectionContact: '連絡先',

  displayNameLabel: '氏名（社内表示用）',
  ownershipLabel: '所属区分',
  ownershipValue: '自社',
  ownershipReadOnlyNote: '所属はサインイン中のアカウントから決まります。',
  collectionScope: '本籍・家族構成・健康状態・信条にあたる内容は記入しないでください。',

  skillSearchLabel: 'スキル辞書から検索',
  skillAdd: '追加',
  skillColumnSkill: 'スキル',
  skillColumnYears: '経験年数',
  skillColumnLevel: 'レベル',
  skillColumnActions: '操作',
  skillRemove: '削除',
  skillEmpty: 'スキルが登録されていません。',
  skillDuplicate: 'このスキルはすでに追加されています。',
  skillLevelUnset: '未設定',
  newAliasLabel: '辞書に無いスキル表記',
  newAliasAdd: '新語候補として起票',
  newAliasNote: '辞書には追加されず、採用されるまで検索には使われません。',
  newAliasEmpty: '起票する表記はありません。',
  newAliasDictionaryLink: 'スキル辞書・新語候補の採否を開く',

  careerOrderNote: '編集中の行は追加した順のまま表示します。保存すると期間の新しい順に並び替えて保存されます。',
  careerColumnPeriod: '期間',
  careerColumnRole: '役割',
  careerColumnDescription: '業務内容',
  careerColumnTechnologies: '使用技術',
  careerColumnActions: '操作',
  careerPeriodFromLabel: '開始年月',
  careerPeriodToLabel: '終了年月',
  careerOngoingToggle: '継続中（終了年月なし）',
  careerAdd: '行を追加',
  careerRemove: '削除',
  careerRestore: '元に戻す',
  careerRemovedNote: '保存すると削除されます。',
  careerEmpty: '経験内容が登録されていません。',
  careerErrorPeriodFrom: '開始年月を入力してください（YYYY-MM）。',
  careerErrorPeriodTo: '終了年月は YYYY-MM で入力するか、「継続中」を選んでください。',
  careerErrorPeriodOrder: '開始年月は終了年月より前（または同じ月）にしてください。',
  careerErrorRole: '役割を入力してください。',
  careerErrorDescription: '業務内容を入力してください。',

  availabilityLabel: '稼働状況',
  availableFromLabel: '稼働可能時期',

  unitPriceLabel: '単価レンジ（月額）',
  unitPriceMin: '下限',
  unitPriceMax: '上限',
  unitPriceUnit: '円',
  prefectureLabel: '勤務地（都道府県）',
  remoteModeLabel: 'リモート可否',
  preferenceNoteLabel: '希望条件',
  valueUnset: '指定しない',

  contactEmailLabel: 'メールアドレス',
  contactPhoneLabel: '電話番号',
  contactMinimumNote: '連絡先は必要最小限のみを保持します。',

  save: '保存',
  saving: '保存しています…',
  saved: '保存しました。',
  saveError: '保存できませんでした。',
  cancel: 'キャンセル',
  leaveConfirm: '入力内容が保存されていません。',

  // --- 2026-10-05: 枠（縦ステッパー / 登録のポイント / 書類 / 確認）-------------------
  stepsTitle: '登録の流れ',
  stepLabelDocuments: '書類の取り込み',
  // 🔴 **「AI による情報抽出」ではない**（`CLAUDE.md` §3.2 のマスキング / `BR-52`。
  //    下の describe がワイヤーフレームの語が出ないことを固定する）。
  stepLabelProfile: '基本情報・スキル・経歴',
  stepLabelConditions: '諸条件の入力',
  stepLabelReview: '登録内容の確認',
  stepNoteDocumentsCreate: '人材を登録した後に取り込めます。',
  stepNoteDocumentsEdit: '任意。ウイルス検査が終わるまで外部には渡りません。',
  stepNoteProfile: '氏名だけが必須です。',
  stepNoteConditions: '任意。分かっている範囲で入れてください。',
  stepNoteReview: '内容を確かめてから登録します。',
  stepStateDone: '入力済み',
  stepStateCurrent: 'いま',
  stepStateTodo: 'このあと',
  stepStateOptional: '任意',
  pointsTitle: '登録のポイント',
  points: [
    '氏名以外は後から足せます。',
    'スキルは辞書から選ぶと検索に効きます。',
    '経歴は 1 行 = 1 つの現場です。0 行のままでも登録できます。',
    '書類はウイルス検査が終わるまで外部に渡せません。',
  ],

  documentsTitle: '書類の取り込み',
  documentsDropHint: 'ここにファイルをドラッグするか、下のボタンから選んでください。',
  documentsAcceptedTitle: 'このページで取り込んだ書類',
  documentsVersionPrefix: '版 ',
  documentsManageLink: '版の一覧と検査の状態を見る',
  uploadFormats: '対応形式: xlsx / docx / pdf',
  uploadImageNotice: '画像は自動読み取りに対応していません。',
  uploadScanNotice: 'ウイルス検査が終わるまで共有できません。',
  uploadFileLabel: 'ファイルを選択',
  uploadSubmit: 'アップロード',
  uploadSubmitting: 'アップロードしています…',
  uploadDone: 'アップロードしました。',
  uploadError: 'アップロードできませんでした。',
  uploadErrorTooLarge: 'ファイルのサイズが上限を超えています。',
  uploadErrorQuota: 'ストレージの上限に達しています。',
  uploadErrorTransfer: 'ストレージへの転送に失敗しました。',
  scanStatusScanning: '検査中（通常 2 分以内）',

  reviewTitle: '登録内容の確認',
  reviewDisplayName: '氏名',
  reviewSkills: 'スキル',
  reviewCareers: '経歴',
  reviewUnit: '件',
  reviewNotEntered: '未入力',
};

const EMPTY_VALUES: EngineerFormValues = {
  displayName: '',
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
  careers: [],
};

function render(overrides: Partial<EngineerFormProps> = {}): string {
  const props: EngineerFormProps = {
    mode: 'CREATE',
    engineerId: null,
    initial: EMPTY_VALUES,
    skillDictionary: DICTIONARY,
    availabilityOptions: [
      { value: 'WORKING', label: '稼働中' },
      { value: 'STANDBY', label: '待機中' },
    ],
    remoteModeOptions: [
      { value: 'FULL_REMOTE', label: 'フルリモート可' },
      { value: 'ONSITE_ONLY', label: '常駐のみ' },
    ],
    prefectureOptions: [
      { value: '13', label: '東京都' },
      { value: '27', label: '大阪府' },
    ],
    levelOptions: [
      { value: '1', label: '入門' },
      { value: '5', label: 'エキスパート' },
    ],
    cancelHref: '/',
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(EngineerForm, props));
}

describe('🔴 F-008 AC-2: 所属区分は入力欄を持たない', () => {
  it('所属区分は `output`（読み取り専用）として出る', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-ownership"');
    expect(html).toContain('<output data-testid="engineer-ownership">自社</output>');
    expect(html).toContain('data-testid="engineer-ownership-note"');
  });

  it('🔴 所属を選ばせる入力要素が DOM に 1 つも無い', () => {
    const html = render();
    for (const forbidden of [
      'ownerPartnerCompanyId',
      'owner_partner_company_id',
      'partnerCompanyId',
      'tenantId',
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('パートナー所属では表示が変わるだけである（欄は増えない）', () => {
    const html = render({ messages: { ...messages, ownershipValue: '取引先（自社）' } });
    expect(html).toContain('<output data-testid="engineer-ownership">取引先（自社）</output>');
    expect(html).not.toContain('ownerPartnerCompanyId');
  });
});

describe('🔴 F-008 AC-1 / BR-52: 収集範囲外の入力欄が存在しない', () => {
  const html = render();

  it.each([
    ['name="birthDate"'],
    ['name="domicile"'],
    ['name="familyStructure"'],
    ['name="healthCondition"'],
    ['name="creed"'],
    ['name="religion"'],
    ['name="nationality"'],
    ['name="gender"'],
  ])('%s の入力欄が無い', (marker) => {
    expect(html).not.toContain(marker);
  });

  it.each(['本籍', '家族', '健康', '信条', '国籍', '性別', '生年月日'])(
    'ラベルにも「%s」が現れない（自由記述欄の推奨用途にもしない）',
    (word) => {
      // 🔴 唯一の例外は「集めない」ことを説明する 1 文である（`collectionScope`）。
      const withoutScopeNote = html.split(messages.collectionScope).join('');
      expect(withoutScopeNote).not.toContain(word);
    },
  );

  it('🔴 「集めない」ことの明示が画面に出る', () => {
    expect(html).toContain('data-testid="engineer-collection-scope"');
    expect(html).toContain(messages.collectionScope);
  });
});

describe('docs/04 §S-007 の 6 セクションが揃っている', () => {
  it.each([
    'engineer-section-basic',
    'engineer-section-skills',
    'engineer-section-careers',
    'engineer-section-availability',
    'engineer-section-conditions',
    'engineer-section-contact',
  ])('%s がある', (testId) => {
    expect(render()).toContain(`data-testid="${testId}"`);
  });

});

// 🔴 T-09-12: セクション 3 は実際に登録できる行エディタである（docs/04 §S-007 セクション 3 / `F-008 AC-5`）。
describe('🔴 F-008 AC-5: 経験内容と従事期間の行エディタ', () => {
  it('✅ T-05-01 の暫定表示（comingSoon）は出ない。「行を追加」の導線と並びの説明が出る', () => {
    const html = render();
    expect(html).not.toContain('engineer-careers-coming-soon');
    expect(html).not.toContain('後続のリリース');
    expect(html).toContain('data-testid="engineer-career-add"');
    expect(html).toContain('data-testid="engineer-career-order-note"');
    expect(html).toContain(messages.careerOrderNote);
  });

  it('🔴 新規は 0 行で開き、空行を初期表示しない。0 行の文言に警告色・必須マークが無い', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-career-empty"');
    expect(html).not.toContain('data-testid="engineer-career-table"');
    const section = html.slice(html.indexOf('engineer-section-careers'), html.indexOf('engineer-section-availability'));
    expect(section).not.toMatch(/text-(red|amber)-\d+/);
    expect(section).not.toMatch(/role="alert"/);
    expect(section).not.toContain('必須');
    expect(section).not.toContain('required');
  });

  it('編集は台帳の行を応答の配列順のまま出し、継続中の行は終了年月が空で「継続中」が選ばれている', () => {
    const html = render({
      mode: 'EDIT',
      engineerId: '01930000-0000-7000-8000-0000000000f1',
      initial: {
        ...EMPTY_VALUES,
        displayName: '架空 太郎',
        careers: [
          {
            key: 'c1',
            id: 'c1',
            periodFrom: '2024-04',
            periodTo: '',
            ongoing: true,
            role: 'PL',
            description: '架空の基幹刷新',
            technologies: 'TypeScript',
            removed: false,
          },
          {
            key: 'c2',
            id: 'c2',
            periodFrom: '2021-01',
            periodTo: '2024-03',
            ongoing: false,
            role: 'SE',
            description: '架空の受発注',
            technologies: 'Java',
            removed: false,
          },
        ],
      },
    });
    expect(html).toContain('data-testid="engineer-career-table"');
    const first = html.indexOf('data-testid="engineer-career-row-c1"');
    const second = html.indexOf('data-testid="engineer-career-row-c2"');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first); // 配列順のまま（ソートし直さない）
    expect(html).toContain('data-testid="engineer-career-ongoing-c1"');
    const ongoingInput = /<input[^>]*data-testid="engineer-career-ongoing-c1"[^>]*>/.exec(html)?.[0] ?? '';
    expect(ongoingInput).toContain('checked=""');
    const periodToInput = /<input[^>]*data-testid="engineer-career-period-to-c1"[^>]*>/.exec(html)?.[0] ?? '';
    expect(periodToInput).toContain('disabled=""');
    expect(periodToInput).toContain('value=""');
    expect(html).toContain('data-testid="engineer-career-remove-c1"');
    expect(html).toContain('data-testid="engineer-career-remove-c2"');
  });

  it('🔴 役割は自由入力（select ではない）で、使用技術も自由入力である', () => {
    const html = render({
      mode: 'EDIT',
      engineerId: '01930000-0000-7000-8000-0000000000f1',
      initial: {
        ...EMPTY_VALUES,
        careers: [
          {
            key: 'c1',
            id: 'c1',
            periodFrom: '2024-04',
            periodTo: '',
            ongoing: true,
            role: 'PL',
            description: 'x',
            technologies: 'TypeScript',
            removed: false,
          },
        ],
      },
    });
    expect(html).toMatch(/<input[^>]*data-testid="engineer-career-role-c1"/);
    expect(html).not.toMatch(/<select[^>]*data-testid="engineer-career-role-c1"/);
    expect(html).toMatch(/<input[^>]*data-testid="engineer-career-technologies-c1"/);
  });

  it('削除印の行は「元に戻す」と「保存すると削除されます」を出す（保存前に限り取り消せる）', () => {
    const html = render({
      mode: 'EDIT',
      engineerId: '01930000-0000-7000-8000-0000000000f1',
      initial: {
        ...EMPTY_VALUES,
        careers: [
          {
            key: 'c1',
            id: 'c1',
            periodFrom: '2024-04',
            periodTo: '',
            ongoing: true,
            role: 'PL',
            description: 'x',
            technologies: '',
            removed: true,
          },
        ],
      },
    });
    expect(html).toContain('data-testid="engineer-career-restore-c1"');
    expect(html).toContain(messages.careerRemovedNote);
    expect(html).not.toContain('data-testid="engineer-career-remove-c1"');
  });
});

describe('🔴 F-010 AC-1: 辞書に無い表記は起票のみで、その場では検索に使われない', () => {
  it('起票欄と「採用されるまで検索に使われない」注記が常に出る', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-new-alias-input"');
    expect(html).toContain('data-testid="engineer-new-alias-note"');
    expect(html).toContain(messages.newAliasNote);
  });

  it('スキルの選択肢は辞書の項目だけである（自由入力でスキルを作れない）', () => {
    const html = render();
    expect(html).toContain(`value="${SKILL_JAVA}"`);
    expect(html).toContain(`value="${SKILL_AWS}"`);
    expect(html).toContain('data-testid="engineer-skill-select"');
  });
});

describe('新規と編集で同じフォームを使う（片方だけ規律が緩まない）', () => {
  it('新規は空フォーム（既定値入り）で、スキル 0 件の表示が出る', () => {
    const html = render();
    expect(html).toContain('data-mode="CREATE"');
    expect(html).toContain('data-testid="engineer-skill-empty"');
    expect(html).not.toContain('data-testid="engineer-skill-table"');
  });

  it('編集は初期値が入り、スキル表が出る', () => {
    const html = render({
      mode: 'EDIT',
      engineerId: '01930000-0000-7000-8000-0000000000f1',
      initial: {
        ...EMPTY_VALUES,
        displayName: '架空 太郎',
        prefecture: '13',
        skills: [
          { skillId: SKILL_JAVA, name: 'Java', yearsOfExperience: '8', level: '5' },
        ],
      },
    });
    expect(html).toContain('data-mode="EDIT"');
    expect(html).toContain('架空 太郎');
    expect(html).toContain('data-testid="engineer-skill-table"');
    expect(html).toContain(`data-testid="engineer-skill-row-${SKILL_JAVA}"`);
  });
});

// ============================================================================
// 🔴 2026-10-05: 新しい枠（人間提示のワイヤーフレーム「SES Hub 新規人材登録ダッシュボード.png」）
// ============================================================================
// 🔴 ここで固定するのは**作らなかったもの**が中心である（[Issue #87]）:
//   ① 🔴 **AI の配線を置かない**（「AI で情報を読み取る」ボタン・抽出結果のタブ・読み取った書類の
//      プレビューが 1 つも無い）。`CLAUDE.md` §3.2 のマスキングがあるため AI は氏名・生年月日を
//      返せず、`BR-52` により DB に列も無い。**押して何も起きないボタンを置かない。**
//   ② 🔴 **既存のフォームの項目を 1 つも増やしていない / 減らしていない**（6 セクションと
//      入力欄の `name` が不変）。
//   ③ 🔴 **新規では書類の取り込み枠を出さない**（既存の API は版をエンジニアに紐づけて採番する）。
//   ④ 🔴 **ウイルス検査の状態を正しく出し、共有・ダウンロードの導線を置かない**（§3.4 / `F-011 AC-1`）。
const EDIT_ENGINEER_ID = '01930000-0000-7000-8000-0000000000f1';

describe('🔴 枠: 縦ステッパー 4 段（現在地が 1 つだけ分かる）', () => {
  it('4 段が順序どおりに並び、通し番号と注記が付く', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-form-steps"');
    const order = ['documents', 'profile', 'conditions', 'review'].map((key) =>
      html.indexOf(`data-testid="engineer-form-step-${key}"`),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(messages.stepLabelProfile);
    expect(html).toContain(messages.stepNoteProfile);
  });

  it('🔴 `aria-current="step"` はちょうど 1 つである（2 つ出るとステッパーが飾りになる）', () => {
    for (const values of [EMPTY_VALUES, { ...EMPTY_VALUES, displayName: '架空 太郎' }]) {
      const html = render({ initial: values });
      expect(html.match(/aria-current="step"/g) ?? []).toHaveLength(1);
    }
  });

  it('氏名が空なら基本情報が現在地、入っていれば確認が現在地である', () => {
    const empty = render();
    expect(empty).toMatch(/engineer-form-step-profile"[^>]*data-state="CURRENT"/);
    expect(empty).toMatch(/engineer-form-step-review"[^>]*data-state="TODO"/);

    const named = render({ initial: { ...EMPTY_VALUES, displayName: '架空 太郎' } });
    expect(named).toMatch(/engineer-form-step-profile"[^>]*data-state="DONE"/);
    expect(named).toMatch(/engineer-form-step-review"[^>]*data-state="CURRENT"/);
  });

  it('🔴 任意の段（書類 / 諸条件）に「未入力」側の状態を出さない', () => {
    const html = render();
    expect(html).toMatch(/engineer-form-step-documents"[^>]*data-state="OPTIONAL"/);
    expect(html).toMatch(/engineer-form-step-conditions"[^>]*data-state="OPTIONAL"/);
  });

  it('🔴 ワイヤーフレームの「AI による情報抽出」の段を作らない（§3.2 のマスキング / `BR-52`）', () => {
    for (const mode of ['CREATE', 'EDIT'] as const) {
      const html = render({ mode, engineerId: mode === 'EDIT' ? EDIT_ENGINEER_ID : null });
      for (const word of ['AI による情報抽出', 'AI で情報を読み取る', '読み取った書類', 'フリガナ']) {
        expect(html, `${word} が描かれている`).not.toContain(word);
      }
      // 抽出結果のタブ（5 本）も無い（面が無いのでタブも無い）。
      expect(html).not.toContain('role="tablist"');
    }
  });

  it('「登録のポイント」が段落の配列として出る', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-form-points"');
    for (const [index, line] of messages.points.entries()) {
      expect(html).toContain(`data-testid="engineer-form-point-${String(index)}"`);
      expect(html).toContain(line);
    }
  });
});

describe('🔴 枠: 書類の取り込み（`S-008` と同じ経路。新しい API を作らない）', () => {
  it('🔴 新規では取り込み枠を出さず、「登録した後に取り込めます」と書く（`disabled` で表さない）', () => {
    const html = render({ mode: 'CREATE', engineerId: null });
    expect(html).toContain('data-testid="engineer-section-documents"');
    expect(html).toContain('data-testid="engineer-document-after-save"');
    expect(html).toContain(messages.stepNoteDocumentsCreate);
    // 🔴 枠・入力欄・ボタンが 1 つも無い（押せない枠を置かない）。
    expect(html).not.toContain('data-testid="engineer-document-dropzone"');
    expect(html).not.toContain('data-testid="engineer-document-file"');
    expect(html).not.toContain('data-testid="engineer-document-submit"');
    expect(html).not.toContain('type="file"');
  });

  it('編集ではドロップ枠とファイル選択の両方が出る（ドラッグできない環境を遮断しない）', () => {
    const html = render({ mode: 'EDIT', engineerId: EDIT_ENGINEER_ID });
    expect(html).toContain('data-testid="engineer-document-dropzone"');
    expect(html).toContain('data-testid="engineer-document-drop-hint"');
    expect(html).toContain('data-testid="engineer-document-file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('data-testid="engineer-document-submit"');
  });

  it('🔴 検査の注記を出し、共有・ダウンロード・閲覧の導線を 1 つも置かない（§3.4 / `F-011 AC-1`）', () => {
    const html = render({ mode: 'EDIT', engineerId: EDIT_ENGINEER_ID });
    expect(html).toContain(messages.uploadScanNotice);
    expect(html).toContain(messages.uploadFormats);
    expect(html).toContain(messages.uploadImageNotice);
    for (const forbidden of ['ダウンロード', '添付', 'この版を開く']) {
      expect(html, `${forbidden} の導線が置かれている`).not.toContain(forbidden);
    }
  });

  it('版の一覧と検査の結果は `S-008` へ送る（2 つ目の版一覧を作らない）', () => {
    const html = render({ mode: 'EDIT', engineerId: EDIT_ENGINEER_ID });
    expect(html).toContain('data-testid="engineer-document-manage-link"');
    expect(html).toContain(`href="/engineers/${EDIT_ENGINEER_ID}/skill-sheets"`);
    // 取り込む前は「このページで取り込んだ書類」の節を出さない（空の箱を出さない）。
    expect(html).not.toContain('data-testid="engineer-document-accepted"');
  });
});

describe('🔴 枠: 登録内容の確認と操作（既存の導線のまま）', () => {
  it('確認は数えた値だけを出す（入力欄ではない）', () => {
    const html = render({ initial: { ...EMPTY_VALUES, displayName: '架空 太郎' } });
    expect(html).toContain('data-testid="engineer-form-review"');
    expect(html).toContain('data-testid="engineer-form-review-display-name"');
    expect(html).toContain('data-testid="engineer-form-review-skills"');
    expect(html).toContain('data-testid="engineer-form-review-careers"');
    // 確認の節に `input` / `select` / `textarea` が 1 つも無い。
    const card = html.slice(html.indexOf('data-testid="engineer-form-review-card"'));
    const body = card.slice(0, card.indexOf('data-testid="engineer-submit"'));
    expect(body).not.toContain('<input');
    expect(body).not.toContain('<select');
    expect(body).not.toContain('<textarea');
  });

  it('氏名が空のときは「未入力」と出し、警告色を当てない', () => {
    const html = render();
    const cell = html.slice(html.indexOf('data-testid="engineer-form-review-display-name"'));
    const value = cell.slice(0, cell.indexOf('</dd>'));
    expect(value).toContain(messages.reviewNotEntered);
    expect(value).not.toContain('text-danger');
    expect(value).not.toContain('text-warning');
  });

  it('🔴 「下書き保存」を作らない（下書きの状態も保存先も API に無い）', () => {
    const html = render();
    expect(html).not.toContain('下書き');
    // 送信ボタンは 1 つだけ（primary は 1 画面に 1 つ。§7.6）。
    expect(html.match(/type="submit"/g) ?? []).toHaveLength(1);
  });

  it('保存・キャンセルの testid と挙動は移設前から変わっていない', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-submit"');
    expect(html).toContain('data-testid="engineer-cancel"');
    expect(html).toContain('href="/"');
  });
});

describe('🔴 枠を変えても項目は 1 つも増えていない / 減っていない', () => {
  it.each([
    'displayName',
    'availability',
    'availableFrom',
    'unitPriceMin',
    'unitPriceMax',
    'prefecture',
    'remoteMode',
    'preferenceNote',
    'contactEmail',
    'contactPhone',
  ])('`name="%s"` の入力欄が在る', (name) => {
    expect(render()).toContain(`name="${name}"`);
  });

  it('🔴 ワイヤーフレームの ステータス / 担当者 / 区分 / 並行状況 を作らない（DB に列が無い）', () => {
    for (const mode of ['CREATE', 'EDIT'] as const) {
      const html = render({ mode, engineerId: mode === 'EDIT' ? EDIT_ENGINEER_ID : null });
      for (const name of ['status', 'assignee', 'category', 'parallelStatus', 'engineerStatus']) {
        expect(html, `name="${name}" が在る`).not.toContain(`name="${name}"`);
      }
      for (const word of ['担当者', '並行状況']) {
        expect(html, `${word} が描かれている`).not.toContain(word);
      }
    }
  });

  it('🔴 独自ブレークポイントを使っていない（Tailwind 既定の `xl` / `2xl` のみ）', () => {
    const html = render({ mode: 'EDIT', engineerId: EDIT_ENGINEER_ID });
    expect(html).not.toMatch(/\[\d+px\]:/);
    expect(html).not.toMatch(/max-(?:sm|md|lg|xl):/);
  });
});

/**
 * 🔴 **中央カラムを狭くする変更を機械で止める。**
 *
 * `HANDOFF.md` §6-9 と `PageBody` の `'main-min'` の実測が残した教訓は
 * **「見える量を削ってまでパネルを横に置かない」**である。3 カラムを 1 本の `xl:flex-row` で
 * 並べると 1280px（Playwright の `Desktop Chrome` の幅）で中央が ≈ 416px になり、経歴の
 * 行エディタ（min-content ≈ 736px）がほとんど読めなくなる。そこで器を入れ子にして
 * **左レールは `2xl` でだけ横に並ぶ**ようにした。🔴 入れ子を素朴な 1 段に戻すとここが落ちる。
 */
describe('🔴 枠: 中央カラムの幅を守る段の組み方（入れ子を崩すと落ちる）', () => {
  it('左レールが横に並ぶのは `2xl` からで、`xl` では全幅に積む', () => {
    const html = render();
    // ⚠️ 部分文字列で見ない（`2xl:w-56` は `xl:w-56` を含む）。語の境界で見る。
    const hasClass = (name: string): boolean =>
      new RegExp(`(?:^|["\\s])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:["\\s]|$)`).test(html);

    // 外側の器は `2xl:flex-row` であり、`xl:flex-row` 単体は中央と右の器だけが持つ。
    expect(html).toContain('flex flex-col gap-6 2xl:flex-row');
    expect(hasClass('2xl:w-56')).toBe(true);
    // 🔴 左レールの固定幅は `2xl` からである（`xl:w-56` という語そのものが無い）。
    expect(hasClass('xl:w-56')).toBe(false);
  });

  it('中央と右は `xl` から並び、中央は `min-w-0 flex-1` / 右は 320px 固定である', () => {
    const html = render();
    expect(html).toContain('flex min-w-0 flex-1 flex-col gap-6 xl:flex-row');
    expect(html).toContain('flex min-w-0 flex-1 flex-col gap-8');
    expect(html).toContain('xl:w-80');
    expect(html).toContain('xl:shrink-0');
  });

  it('DOM の順序は 左レール → 中央 → 右 である（保存が最後に来る）', () => {
    const html = render();
    const steps = html.indexOf('data-testid="engineer-form-steps-card"');
    const basic = html.indexOf('data-testid="engineer-section-basic"');
    const conditions = html.indexOf('data-testid="engineer-section-conditions"');
    const submit = html.indexOf('data-testid="engineer-submit"');
    expect(steps).toBeGreaterThan(-1);
    expect(basic).toBeGreaterThan(steps);
    expect(conditions).toBeGreaterThan(basic);
    expect(submit).toBeGreaterThan(conditions);
  });
});
