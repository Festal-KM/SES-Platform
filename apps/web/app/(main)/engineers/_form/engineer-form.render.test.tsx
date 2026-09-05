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

  careersComingSoon: '経験内容と従事期間は、後続のリリースで登録できるようになります。',

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

  it('実装していないセクション（経験内容と従事期間）は隠さず、その旨を出す', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-careers-coming-soon"');
    expect(html).toContain(messages.careersComingSoon);
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
