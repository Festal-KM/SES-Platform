// apps/web/app/(main)/projects/[id]/visibility/visibility-screen.render.test.tsx
// `ProjectVisibilityScreen`（`S-013`）の描画テスト。T-06-06。
//
// 🔴 ここで固定するのは「**描かれていないこと**」が中心である（`F-014 AC-2` / `BR-18`）:
//    ①「すべて選択」に相当する操作が無い ②初期状態でチェックが入るのは**現在公開中の相手だけ**
//    ③ゲートを迂回して公開する導線が無い ④保留を「公開しました」と書いていない。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`project-detail-screen.render.test.tsx` と同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectVisibilityChoice } from '../../../../../lib/projects/visibility';
import {
  ProjectVisibilityScreen,
  sameSelection,
  type ProjectVisibilityScreenMessages,
  type ProjectVisibilityScreenProps,
  type PublishPreview,
} from './visibility-screen';

const PARTNER_A: ProjectVisibilityChoice = {
  partnerCompanyId: 'p-a',
  name: '架空パートナー A',
  suspended: false,
  publishedOn: '2026-08-01',
};
const PARTNER_B: ProjectVisibilityChoice = {
  partnerCompanyId: 'p-b',
  name: '架空パートナー B',
  suspended: false,
  publishedOn: null,
};
const PARTNER_C: ProjectVisibilityChoice = {
  partnerCompanyId: 'p-c',
  name: '架空パートナー C（停止中）',
  suspended: true,
  publishedOn: null,
};

const PREVIEW: PublishPreview = {
  name: '合成案件（公開範囲）',
  headline: [{ key: 'status', label: '案件の状態', value: '募集中' }],
  conditions: [{ key: 'prefecture', label: '勤務地', value: '東京都' }],
  requirements: [
    {
      kind: 'MUST',
      heading: '必須要件',
      empty: '必須要件はありません。',
      rows: [{ key: 'MUST-0', requirement: 'Java', years: '3 年' }],
    },
    { kind: 'NICE', heading: '尚可要件', empty: '尚可要件は登録されていません。', rows: [] },
  ],
  publicSummary: '公開用の概要（合成データ）',
  requirementColumnRequirement: '要件',
  requirementColumnYears: '必要年数',
  warnings: [],
};

const messages: ProjectVisibilityScreenMessages = {
  lead: 'この案件をどの取引先に見せるかを指定します。',
  sectionCurrent: '現在の公開状態',
  sectionSelect: '公開先の選択',
  sectionPreview: '公開されたときの見え方',
  sectionGate: '品質ゲート',
  sectionExecute: '公開の実行',
  currentEmpty: 'この案件はまだどの取引先にも公開されていません。',
  currentColumnPartner: '取引先',
  currentColumnPublishedOn: '公開日',
  selectLegend: '公開する取引先',
  selectNote: '公開先は 1 社ずつ選びます。',
  selectPublishedBadge: '公開中',
  selectSuspendedBadge: '停止中',
  selectSuspendedNote: '停止中の取引先にも公開範囲は設定できます。',
  selectEmptyTitle: '取引先が登録されていません。',
  selectEmptyLead: '先に取引先を招待してください。',
  selectEmptyLink: '取引先を招待する',
  previewNote: 'ここに出ているものが、公開先の取引先に見えるすべてです。',
  previewWarningTitle: '外部に出る欄に、商流情報が含まれている可能性があります。',
  previewWarningLead: 'これは文字列の照合による注意喚起です。',
  gatePendingTitle: '公開の前に品質ゲートを実行します。',
  gatePendingLead: 'ゲートの実行は後続のリリースで有効になります。',
  submit: '保存する',
  submitting: '送信しています…',
  revokeConfirmTitle: '公開を解除しますか？',
  revokeConfirmLead: '作成済みの提案は残ります。',
  revokeConfirmSubmit: '解除して保存',
  revokeConfirmCancel: 'やめる',
  resultPendingGate: '公開の要求を受け付けました。',
  resultNoPublish: '公開範囲を更新しました。',
  errorSave: '公開範囲を保存できませんでした。',
  deniedTitle: '公開の操作を行えません。',
  backToDetail: '案件詳細へ戻る',
  editProject: '案件を編集',
  leaveConfirm: '公開先の選択が保存されていません。このページを離れますか？',
};

function render(overrides: Partial<ProjectVisibilityScreenProps> = {}): string {
  const props: ProjectVisibilityScreenProps = {
    projectId: '01930000-0000-7000-8000-0000000000a1',
    projectName: '合成案件（公開範囲）',
    choices: [PARTNER_A, PARTNER_B, PARTNER_C],
    preview: PREVIEW,
    detailHref: '/projects/01930000-0000-7000-8000-0000000000a1',
    editHref: '/projects/01930000-0000-7000-8000-0000000000a1/edit',
    partnerCompaniesHref: '/settings/partner-companies',
    denialMessage: null,
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProjectVisibilityScreen, props));
}

describe('🔴 F-014 AC-2: 既定で広げない', () => {
  it('初期状態でチェックが入るのは、現在公開中の相手だけである', () => {
    const html = render();

    // 公開中（A）だけが checked。B / C は未チェック。
    expect(html).toContain('data-testid="project-visibility-choice-p-a" checked=""');
    expect(html).toContain('data-testid="project-visibility-choice-p-b"');
    expect(html).not.toContain('data-testid="project-visibility-choice-p-b" checked=""');
    expect(html).not.toContain('data-testid="project-visibility-choice-p-c" checked=""');
  });

  it('🔴 「すべて選択」に相当する操作が無い', () => {
    const html = render();

    expect(html).not.toContain('すべて選択');
    expect(html).toContain(messages.selectNote);
  });

  it('公開先が 0 件なら「まだ公開されていません」と出る', () => {
    const html = render({ choices: [PARTNER_B] });

    expect(html).toContain('data-testid="project-visibility-current-empty"');
    expect(html).toContain(messages.currentEmpty);
  });
});

describe('🔴 BR-18 / F-014 AC-3: ゲートを迂回する導線が無い', () => {
  it('「了解のうえ公開」に相当する操作が無く、ゲートの状態が常時出る', () => {
    const html = render();

    expect(html).toContain('data-testid="project-visibility-gate-title"');
    expect(html).toContain(messages.gatePendingLead);
    expect(html).not.toContain('了解');
    expect(html).not.toContain('無視');
  });

  it('🔴 保留を「公開しました」と書かない（初期表示に成功メッセージが無い）', () => {
    const html = render();

    expect(html).not.toContain('data-testid="project-visibility-result"');
    expect(html).not.toContain(messages.resultNoPublish);
  });
});

describe('docs/04 §10.1 S-013: 空状態と権限差分', () => {
  it('取引先が 1 社も無ければ `S-014` への導線が出る', () => {
    const html = render({ choices: [] });

    expect(html).toContain('data-testid="project-visibility-select-empty"');
    expect(html).toContain('href="/settings/partner-companies"');
    // 保存の対象が 1 件も無いので、保存ボタンは無効のまま出る（押せる導線を作らない）。
    expect(html).toContain('disabled="" data-testid="project-visibility-submit"');
  });

  it('🔴 変更が無いときは保存ボタンが押せない（同じ集合を送り直す操作を作らない）', () => {
    expect(render()).toContain('disabled="" data-testid="project-visibility-submit"');
  });

  it('🔴 F-004 AC-7: 実行できないテナントでは保存ボタンが無く、理由が出る', () => {
    const html = render({ denialMessage: 'このテナントは停止中です。' });

    expect(html).toContain('data-testid="project-visibility-denied"');
    expect(html).toContain('このテナントは停止中です。');
    expect(html).not.toContain('data-testid="project-visibility-submit"');
    // 🔴 導線が無いだけでなく、選択そのものも無効化される（拒否の本体は `#28` のガード）。
    expect(html).toContain('<fieldset disabled=""');
  });

  it('停止中の取引先も選択肢に残り、その理由が添えられる', () => {
    const html = render();

    expect(html).toContain(PARTNER_C.name);
    expect(html).toContain('data-testid="project-visibility-suspended-note"');
  });
});

describe('プレビュー（docs/04 §S-013 セクション 3）', () => {
  it('取引先に見える値だけを出す（要件・条件・外部公開用の記載）', () => {
    const html = render();

    expect(html).toContain(PREVIEW.publicSummary);
    expect(html).toContain('Java');
    expect(html).toContain('必須要件');
  });

  it('🔴 商流情報の混入は警告として出る（合否ではない）', () => {
    const html = render({
      preview: {
        ...PREVIEW,
        warnings: [{ key: 'publicSummary-END_CLIENT_NAME', field: '外部公開用の記載', kind: 'エンド企業名' }],
      },
    });

    expect(html).toContain('data-testid="project-visibility-preview-warning"');
    expect(html).toContain(messages.previewWarningTitle);
    expect(html).toContain(messages.previewWarningLead);
    // 修正の行き先は `S-012` である（この画面で内容を書き換えない）。
    expect(html).toContain('data-testid="project-visibility-edit-link"');
  });

  it('警告が無ければ警告ブロックごと出ない', () => {
    expect(render()).not.toContain('data-testid="project-visibility-preview-warning"');
  });
});

describe('🔴 docs/04 §10.1 S-013: 選択変更の途中で離脱 → 確認', () => {
  // 🔴 `beforeunload` の登録そのものは `renderToStaticMarkup`（effect が走らない）では
  //    観測できない。ここで固定するのは**判定の規則**であり、規則が壊れる 2 方向
  //    （「変更したのに確認が出ない」/「保存できているのに確認が出続ける」）を塞ぐ。
  it('同じ集合なら未保存ではない（並び順に依存しない）', () => {
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSelection([], [])).toBe(true);
  });

  it('追加・削除のどちらも未保存として検出される', () => {
    expect(sameSelection(['a'], ['a', 'b'])).toBe(false);
    expect(sameSelection(['a', 'b'], ['a'])).toBe(false);
    expect(sameSelection(['a'], ['b'])).toBe(false);
  });

  it('🔴 基準は「最後に送った選択」であり「公開中の集合」ではない（ゲート保留の分がずれる）', () => {
    // 保存直後の状態: 送った選択は A + B、公開が成立したのは A だけ（B はゲート待ち）。
    const sentSelection = ['p-a', 'p-b'];
    const publishedAfterSave = ['p-a'];

    // 送った選択を基準にすれば「未保存ではない」。
    expect(sameSelection(sentSelection, sentSelection)).toBe(true);
    // 公開中を基準にすると「未保存」のままになる（＝ 確認が鳴り止まない）。
    expect(sameSelection(sentSelection, publishedAfterSave)).toBe(false);
  });
});
