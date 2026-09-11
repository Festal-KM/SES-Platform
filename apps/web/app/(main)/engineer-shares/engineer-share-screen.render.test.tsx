// apps/web/app/(main)/engineer-shares/engineer-share-screen.render.test.tsx
// `EngineerShareScreen`（`S-015`）の描画テスト。T-08-02。
//
// 🔴 ここで固定するのは「**描かれていないこと**」が中心である（`F-016 AC-1` / `BR-53` /
//    `docs/04` §S-015）:
//    ① 🔴 **「一括で共有可にする」に相当する操作が 1 つも無い**（全選択のチェックボックスも無い）
//    ② 🔴 **空状態が煽っていない**（「共有すると…」に相当する誘導が無い）
//    ③ 🔴 **丸める前の値（`7 年` / `65 万円` / `渋谷区` / 具体的な稼働開始日）が現れない**
//    ④ 🔴 **「反映まで数分かかります」に相当する表示が無い**（即時反映が要件）
//    ⑤ 停止中（`denialMessage`）のとき、操作ボタンを描かない（`F-004 AC-7`）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`visibility-screen.render.test.tsx` と同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EngineerShareScreen,
  type EngineerShareRowView,
  type EngineerShareScreenMessages,
  type EngineerShareScreenProps,
} from './engineer-share-screen';

const SHARED_ROW: EngineerShareRowView = {
  engineerId: '01930000-0000-7000-8000-0000000000a1',
  displayName: '合成 太郎',
  shared: true,
  sharedOn: '2026-09-01',
  proposalRequestCount: '0 件',
  availability: '翌月',
  preview: {
    skills: ['Java', 'AWS'],
    yearsBand: '5〜10 年',
    priceBand: '60〜70 万円',
    availabilityBand: '翌月',
    location: '東京都・一部リモート可',
    updatedOn: '2026-09-08',
  },
};

const NOT_SHARED_ROW: EngineerShareRowView = {
  engineerId: '01930000-0000-7000-8000-0000000000a2',
  displayName: '合成 次郎',
  shared: false,
  sharedOn: '—',
  proposalRequestCount: '0 件',
  availability: '即日',
  preview: {
    skills: [],
    yearsBand: '—',
    priceBand: '—',
    availabilityBand: '即日',
    location: '—',
    updatedOn: '2026-09-07',
  },
};

const messages: EngineerShareScreenMessages = {
  lead: '共有可にすると、ホストの候補一覧に匿名で表示されます。',
  sectionShared: '共有中の人材',
  sectionNotShared: '共有していない自社の人材',
  sectionPreview: '開示プレビュー',
  columnName: '氏名（貴社内の表示）',
  columnSharedOn: '共有開始日',
  columnProposalRequestCount: '受け取った提案依頼',
  columnAvailability: '稼働可能時期',
  columnAction: '操作',
  sharedEmpty: '共有している人材はいません。',
  notSharedEmpty: '共有していない人材はいません。',
  ledgerEmpty: '人材がまだ登録されていません。',
  ledgerRegister: '人材を登録する',
  previewSelect: '人材を選ぶと、ホストに表示される内容をここで確認できます。',
  previewNote: 'ホストに表示されるのは次の 5 項目だけです。',
  previewCareersNote: '経歴は開示されません。',
  fieldSkills: 'スキル',
  fieldYears: '経験年数',
  fieldPrice: '単価レンジ',
  fieldAvailability: '稼働可能時期',
  fieldLocation: '勤務地・リモート可否',
  fieldUpdatedOn: '更新日',
  valueNone: '—',
  share: '共有可にする',
  shareConfirmTitle: 'この内容がホストに表示されます',
  shareConfirmSubmit: '共有可にする',
  shareConfirmCancel: 'やめる',
  shareSubmitting: '設定しています…',
  revoke: '共有を解除する',
  revokeConfirmTitle: '共有を解除しますか',
  revokeConfirmLead: '解除した時点で、ホストの候補一覧に表示されなくなります。',
  revokeConfirmSubmit: '解除する',
  revokeConfirmCancel: 'やめる',
  revokeSubmitting: '解除しています…',
  errorSave: '設定を変更できませんでした。',
  errorRetryNote: '設定は変わっていません。もう一度お試しください。',
  deniedTitle: '共有の設定を変更できません。',
};

function render(overrides: Partial<EngineerShareScreenProps> = {}): string {
  return renderToStaticMarkup(
    createElement(EngineerShareScreen, {
      rows: [SHARED_ROW, NOT_SHARED_ROW],
      registerHref: '/engineers/new',
      denialMessage: null,
      messages,
      ...overrides,
    }),
  );
}

describe('S-015 の骨格（docs/04 §S-015 のセクション 1〜4）', () => {
  it('説明ブロック・共有中・未共有・プレビューの 4 つが出る', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-share-lead"');
    expect(html).toContain('data-testid="engineer-share-shared"');
    expect(html).toContain('data-testid="engineer-share-not-shared"');
    expect(html).toContain('data-testid="engineer-share-preview"');
  });

  it('共有中の行には解除、未共有の行には共有可にする操作が 1 件ずつ付く', () => {
    const html = render();
    expect(html).toContain(`data-testid="engineer-share-revoke-${SHARED_ROW.engineerId}"`);
    expect(html).toContain(`data-testid="engineer-share-share-${NOT_SHARED_ROW.engineerId}"`);
    // 共有中の行に「共有可にする」は出ない（逆も同じ）。
    expect(html).not.toContain(`data-testid="engineer-share-share-${SHARED_ROW.engineerId}"`);
    expect(html).not.toContain(`data-testid="engineer-share-revoke-${NOT_SHARED_ROW.engineerId}"`);
  });

  it('プレビューは選択するまで出ない（`docs/04` §S-015 ローディング「一覧を先に」）', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-share-preview-placeholder"');
    expect(html).not.toContain(`data-testid="engineer-share-preview-${SHARED_ROW.engineerId}"`);
  });
});

describe('🔴 一括で全件をオンにする操作が存在しない（`F-016 AC-1` / `BR-53`）', () => {
  it('チェックボックス（複数選択の起点）を 1 つも描かない', () => {
    const html = render();
    expect(html).not.toContain('type="checkbox"');
  });

  it('操作ボタンの数は行数と一致する（まとめて動かす追加のボタンが無い）', () => {
    const html = render();
    const shareButtons = html.match(/data-testid="engineer-share-share-/g) ?? [];
    const revokeButtons = html.match(/data-testid="engineer-share-revoke-/g) ?? [];
    expect(shareButtons).toHaveLength(1);
    expect(revokeButtons).toHaveLength(1);
  });
});

describe('🔴 空状態が煽っていない（`docs/04` §S-015）', () => {
  it('共有 0 件のときは事実だけを述べる', () => {
    const html = render({ rows: [NOT_SHARED_ROW] });
    expect(html).toContain('data-testid="engineer-share-shared-empty"');
    expect(html).toContain('共有している人材はいません。');
  });

  it('台帳が空のときは `S-007` への導線を出す（行き止まりにしない）', () => {
    const html = render({ rows: [] });
    expect(html).toContain('data-testid="engineer-share-ledger-empty"');
    expect(html).toContain('href="/engineers/new"');
    // 一覧・プレビューのセクションごと出さない（空の箱を並べない）。
    expect(html).not.toContain('data-testid="engineer-share-shared-table"');
    expect(html).not.toContain('data-testid="engineer-share-preview"');
  });
});

describe('🔴 丸める前の値が画面に現れない（`F-017 AC-3` / `docs/04` §5-2）', () => {
  it.each([
    ['経験年数の実数', '7 年'],
    ['単価の実額', '65 万円'],
    ['単価の円表記', '650,000'],
    ['市区町村', '渋谷区'],
    ['稼働開始日（日付）', '2026-09-16'],
  ])('%s（%s）が出ない', (_label, forbidden) => {
    expect(render()).not.toContain(forbidden);
  });

  it('一覧の「稼働可能時期」列はプレビューと同じ丸めた区分である', () => {
    expect(SHARED_ROW.availability).toBe(SHARED_ROW.preview.availabilityBand);
  });
});

describe('🔴 即時反映（`F-016 AC-2`）を裏切る表示が無い', () => {
  it('「反映まで」「数分」に相当する語を持たない', () => {
    const html = render();
    expect(html).not.toContain('反映まで');
    expect(html).not.toContain('数分');
  });
});

describe('🔴 停止中・解約手続き中は操作を描かない（`F-004 AC-7`）', () => {
  it('理由を出し、共有・解除のボタンを 1 つも描かない', () => {
    const html = render({ denialMessage: '契約が停止中のため、実行系の操作はできません。' });
    expect(html).toContain('data-testid="engineer-share-denied"');
    expect(html).not.toContain('data-testid="engineer-share-share-');
    expect(html).not.toContain('data-testid="engineer-share-revoke-');
    // 🔴 閲覧は遮断しない（一覧は出る）。
    expect(html).toContain('data-testid="engineer-share-shared-table"');
  });
});

describe('🔴 モバイルで判断材料を隠さない（`CLAUDE.md` §13.3 / `docs/04` §S-015 デバイス別）', () => {
  it('氏名・稼働可能時期・解除ボタンに `hidden` クラスが付いていない', () => {
    const html = render();
    // 間引いてよいのは補助 2 列だけ（`hidden sm:table-cell` は 共有開始日 / 提案依頼のみ）。
    const hidden = html.match(/hidden sm:table-cell/g) ?? [];
    // ヘッダ 2 + 本文 2 = 4 箇所（共有中テーブルのみ。未共有テーブルは 3 列で間引かない）。
    expect(hidden).toHaveLength(4);
  });

  it('独自ブレークポイントを使っていない（Tailwind の既定 `sm` のみ）', () => {
    const html = render();
    expect(html).not.toMatch(/\[\d+px\]:/);
  });
});
