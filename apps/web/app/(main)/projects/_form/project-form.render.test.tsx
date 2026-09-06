// apps/web/app/(main)/projects/_form/project-form.render.test.tsx
// `ProjectForm`（`S-012`）の描画テスト。T-06-01。
//
// 🔴 なぜこの粒度で要るか:
//    ①`F-013 AC-1`（必須 / 尚可が**別ブロック**として描かれ、区分が行に残る）は
//      「画面の構造」そのものが要件である（`docs/04` §S-012「視覚的に分ける」）。
//    ②`F-013 AC-2`（商流情報ブロックに「公開範囲の相手には表示されません」を**常時**添える）は
//      「文言が常に見えていること」が要件であり、API の結合テストでは示せない。
//    ③`docs/04` §S-012「保存だけでは公開されない」も同じく画面上の説明が実体である
//      （`F-014 AC-2` を利用者に伝える唯一の場所）。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` で
//    静的 HTML を得る（新規依存を増やさない。`engineer-form.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProjectForm,
  toRequestBody,
  type ProjectFormMessages,
  type ProjectFormProps,
  type ProjectFormValues,
  type SkillDictionaryOption,
} from './project-form';

const SKILL_JAVA = '01930000-0000-7000-8000-0000000000e1';
const SKILL_AWS = '01930000-0000-7000-8000-0000000000e2';

const DICTIONARY: readonly SkillDictionaryOption[] = [
  { id: SKILL_JAVA, name: 'Java', category: 'LANGUAGE' },
  { id: SKILL_AWS, name: 'AWS', category: 'CLOUD' },
];

const COMMERCE_NOTICE =
  'この情報は公開範囲の相手には表示されません。エンド企業名と自社単価は取引先の画面に出ません。';
const VISIBILITY_NOTE = '保存しただけでは、この案件はどの取引先にも公開されません。';
const MUST_EMPTY = '必須要件がありません。このままでも保存できますが、候補の足切りが効きません。';
const NICE_EMPTY = '尚可要件は登録されていません。';

const messages: ProjectFormMessages = {
  sectionBasic: '基本',
  sectionConditions: '条件',
  sectionCommerce: '商流情報（内部用）',
  sectionPublicSummary: '外部公開用の記載',

  nameLabel: '案件名',
  headcountLabel: '募集人数',
  headcountUnit: '名',
  startDateLabel: '稼働開始日',
  statusLabel: '案件の状態',
  statusNote: '「後任募集」は自動で設定されることがあります。',

  requirementHeadings: { MUST: '必須要件', NICE: '尚可要件' },
  requirementNotes: { MUST: '必須要件は候補の足切りに使われます。', NICE: '尚可要件は足切りには使われません。' },
  requirementEmpties: { MUST: MUST_EMPTY, NICE: NICE_EMPTY },
  requirementSkillLabel: 'スキル（辞書から選ぶ）',
  requirementSkillSearch: 'スキル辞書から検索',
  requirementYearsLabel: '必要な経験年数',
  requirementFreeTextLabel: 'その他の条件（自由記述）',
  requirementAdd: 'この要件を追加',
  requirementRemove: '削除',
  requirementColumnRequirement: '要件',
  requirementColumnYears: '必要年数',
  requirementColumnActions: '操作',
  requirementYearsUnit: '年',
  requirementErrorEmpty: 'スキルか自由記述のどちらかを入力してください。',
  requirementErrorDuplicate: 'このスキルはすでに要件に含まれています。',

  unitPriceLabel: '単価レンジ（月額・外部公開用）',
  unitPriceMin: '下限',
  unitPriceMax: '上限',
  unitPriceUnit: '円',
  prefectureLabel: '勤務地（都道府県）',
  remoteModeLabel: 'リモート可否',
  valueUnset: '指定しない',

  commerceNotice: COMMERCE_NOTICE,
  endClientNameLabel: 'エンド企業名',
  internalUnitPriceLabel: '自社単価（月額）',

  publicSummaryLabel: '外部公開用の記載',
  publicSummaryNote: 'エンド企業名・自社単価・他社名を書かないでください。',

  visibilityComingSoon: VISIBILITY_NOTE,
  save: '保存',
  saving: '保存しています…',
  saved: '保存しました。',
  saveError: '保存できませんでした。',
  cancel: 'キャンセル',
  leaveConfirm: '入力内容が保存されていません。',
};

const EMPTY_VALUES: ProjectFormValues = {
  name: '',
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

function render(overrides: Partial<ProjectFormProps> = {}): string {
  const props: ProjectFormProps = {
    mode: 'CREATE',
    projectId: null,
    initial: EMPTY_VALUES,
    skillDictionary: DICTIONARY,
    statusOptions: [
      { value: 'OPEN', label: '募集中' },
      { value: 'FILLED', label: '充足' },
      { value: 'SUCCESSOR_WANTED', label: '後任募集' },
    ],
    remoteModeOptions: [{ value: 'FULL_REMOTE', label: 'フルリモート可' }],
    prefectureOptions: [{ value: '13', label: '東京都' }],
    requirementKinds: ['MUST', 'NICE'],
    cancelHref: '/',
    createdHrefPattern: '/projects/{id}/edit',
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProjectForm, props));
}

describe('🔴 F-013 AC-1: 必須要件と尚可要件が別区分として描かれる', () => {
  it('必須 / 尚可のブロックが 2 つとも存在し、見出しと説明が別物である', () => {
    const html = render();

    expect(html).toContain('data-testid="project-section-requirements-MUST"');
    expect(html).toContain('data-testid="project-section-requirements-NICE"');
    expect(html).toContain(messages.requirementHeadings['MUST']);
    expect(html).toContain(messages.requirementHeadings['NICE']);
    expect(html).toContain(messages.requirementNotes['MUST']);
    expect(html).toContain(messages.requirementNotes['NICE']);
  });

  it('🔴 登録済みの要件は区分ごとの表に分かれ、行に kind が残る', () => {
    const html = render({
      initial: {
        ...EMPTY_VALUES,
        requirements: [
          {
            key: 'r0',
            kind: 'MUST',
            skillId: SKILL_JAVA,
            skillName: 'Java',
            freeText: '',
            requiredYears: '3',
          },
          {
            key: 'r1',
            kind: 'NICE',
            skillId: '',
            skillName: '',
            freeText: 'AWS の運用経験',
            requiredYears: '',
          },
        ],
      },
    });

    expect(html).toContain('data-testid="project-requirement-row-MUST-r0"');
    expect(html).toContain('data-testid="project-requirement-row-NICE-r1"');
    // 🔴 区分は行の属性にも残す（並び順に区分の意味を背負わせない）。
    expect(html).toContain('data-kind="MUST"');
    expect(html).toContain('data-kind="NICE"');
    expect(html).toContain('AWS の運用経験');
  });

  it('🔴 必須 0 件は「保存できるが足切りが効かない」警告になる（保存を止めない）', () => {
    const html = render();

    expect(html).toContain('data-testid="project-requirements-empty-MUST"');
    expect(html).toContain(MUST_EMPTY);
    // 保存ボタンは押せる（`disabled` 属性が付いていない）。
    // ⚠️ `disabled:` で始まる Tailwind のクラス名と区別するため、属性の形（`disabled=`）で見る。
    const submitIndex = html.indexOf('data-testid="project-submit"');
    const buttonStart = html.lastIndexOf('<button', submitIndex);
    expect(html.slice(buttonStart, submitIndex)).not.toContain('disabled=');
  });

  it('尚可 0 件は通常の空状態である（警告ではない）', () => {
    const html = render();

    expect(html).toContain('data-testid="project-requirements-empty-NICE"');
    expect(html).toContain(NICE_EMPTY);
  });
});

describe('🔴 F-013 AC-2: 商流情報は「公開範囲の相手には表示されない」と常時明示される', () => {
  it('商流情報ブロックに注意書きが常時描かれる（折りたたみに隠さない）', () => {
    const html = render();

    expect(html).toContain('data-testid="project-section-commerce"');
    expect(html).toContain('data-testid="project-commerce-notice"');
    expect(html).toContain(COMMERCE_NOTICE);
  });

  it('エンド企業名と自社単価の入力欄が商流情報ブロックの中にある', () => {
    const html = render();
    const sectionStart = html.indexOf('data-testid="project-section-commerce"');
    const sectionEnd = html.indexOf('data-testid="project-section-public-summary"');

    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
    const section = html.slice(sectionStart, sectionEnd);
    expect(section).toContain('data-testid="project-end-client-name"');
    expect(section).toContain('data-testid="project-internal-unit-price"');
  });

  it('外部公開用の記載には商流層の観点の注意書きが付く（合否はここで判定しない）', () => {
    const html = render();

    expect(html).toContain('data-testid="project-public-summary-note"');
    expect(html).toContain(messages.publicSummaryNote);
  });
});

describe('🔴 docs/04 §S-012: 保存だけでは公開されない（F-014 AC-2）', () => {
  it('公開されない旨が画面に常時出る', () => {
    const html = render();

    expect(html).toContain('data-testid="project-visibility-coming-soon"');
    expect(html).toContain(VISIBILITY_NOTE);
  });

  it('🔴 `S-013`（公開範囲の設定）への導線をまだ置かない（存在しない画面へ送らない）', () => {
    const html = render();

    expect(html).not.toContain('/visibility');
    expect(html).not.toContain('href="/projects/');
  });
});

describe('送信 body（docs/05 §6.4 #26 の ProjectInput）', () => {
  it('🔴 要件は kind を 1 件ずつ持ち、空文字は null になる', () => {
    const body = toRequestBody({
      ...EMPTY_VALUES,
      name: '  架空案件  ',
      requirements: [
        {
          key: 'r0',
          kind: 'MUST',
          skillId: SKILL_JAVA,
          skillName: 'Java',
          freeText: '',
          requiredYears: '3',
        },
        {
          key: 'r1',
          kind: 'NICE',
          skillId: '',
          skillName: '',
          freeText: 'AWS の運用経験',
          requiredYears: '',
        },
      ],
    });

    expect(body.name).toBe('架空案件');
    expect(body.requirements).toEqual([
      { kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 3 },
      { kind: 'NICE', skillId: null, freeText: 'AWS の運用経験', requiredYears: null },
    ]);
  });

  it('🔴 body に `originAssignmentId` を組み立てる余地が無い（画面が値を知らない）', () => {
    const body = toRequestBody({ ...EMPTY_VALUES, name: '架空案件' });
    expect(body).not.toHaveProperty('originAssignmentId');
    expect(body).not.toHaveProperty('tenantId');
  });

  it('商流情報は body に載る（保持はする。出さないのは取得時の射影の責務）', () => {
    const body = toRequestBody({
      ...EMPTY_VALUES,
      name: '架空案件',
      endClientName: '架空エンド株式会社',
      internalUnitPrice: '900000',
    });
    expect(body.endClientName).toBe('架空エンド株式会社');
    expect(body.internalUnitPrice).toBe(900_000);
  });
});
