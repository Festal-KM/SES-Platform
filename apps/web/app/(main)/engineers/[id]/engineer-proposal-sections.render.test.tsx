// apps/web/app/(main)/engineers/[id]/engineer-proposal-sections.render.test.tsx
// `EngineerProposalSections`（`S-006` セクション 4・5）の描画テスト。T-12-16。
//
// 🔴 ここで固定するもの:
//   ① セクション 4 の空文言（「この人材はまだ提案されていません」）。0 件ではセクション 5 を描かない
//   ② セクション 4 の行 = 提案先 / 案件 / 状態バッジ / 作成日 / `S-023` への導線 + 差分の選択。選択中の行は導線ではなく「表示中」
//   ③ 🔴 セクション 5 は凍結側と現在値が**左右に並置**され、**1 つのリストに混在しない**（凍結側の表と現在値の表が別、項目の表は
//      `frozen` / `current` が別の列）。「提案後に変更」の注記は `changed` の行にだけ出る
//   ④ 404 の文言に理由（他社所有）が無い。未選択のときは案内文だけ
//   ⑤ `engineer-detail-proposals-coming-soon` が DOM に無い（プレースホルダの実装置換）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EngineerProposalHistoryRow, SnapshotDiffRows } from '../../../../lib/engineers/proposal-sections-rows';
import { EngineerProposalSections, type EngineerProposalSectionsMessages, type EngineerProposalSectionsProps } from './engineer-proposal-sections';

const P1 = '01930000-0000-7000-8000-000000000a01';
const P2 = '01930000-0000-7000-8000-000000000a02';

const MESSAGES: EngineerProposalSectionsMessages = {
  sectionProposals: '提案履歴',
  sectionDiff: '凍結情報との差分',
  proposalsEmpty: 'この人材はまだ提案されていません。',
  columnRecipient: '提案先',
  columnProject: '案件',
  columnState: '状態',
  columnCreatedAt: '作成日',
  columnActions: '操作',
  detailLink: '提案の詳細',
  diffLink: '差分を見る',
  diffSelected: '表示中',
  diffLead: '提案履歴の行で「差分を見る」を選ぶと並べて表示します。',
  diffUnavailable: 'この提案の現在値は参照できません。',
  columnField: '項目',
  columnFrozen: '提案時点（凍結）',
  columnCurrent: '現在の台帳',
  careerColumnPeriod: '期間',
  careerColumnRole: '役割',
  careerColumnDescription: '業務内容',
  careerColumnTechnologies: '使用技術',
  careerColumnSource: '入力元',
  careersFrozenTitle: '提案時点の経験内容（凍結）',
  careersCurrentTitle: '現在の経験内容',
  careersNote: '凍結側と現在の台帳は別々のリストです。',
};

function historyRow(overrides: Partial<EngineerProposalHistoryRow> = {}): EngineerProposalHistoryRow {
  return {
    id: P1,
    href: `/proposals/${P1}`,
    diffHref: `/engineers/e1?diff=${P1}#engineer-detail-snapshot-diff`,
    recipient: '架空エンド株式会社',
    project: '基幹刷新',
    state: 'APPROVAL_PENDING',
    stateLabel: '承認待ち',
    tone: 'warning',
    createdOn: '2026-09-15',
    selected: false,
    ...overrides,
  };
}

function diffRows(overrides: Partial<SnapshotDiffRows> = {}): SnapshotDiffRows {
  return {
    proposalId: P1,
    title: '提案（2026-09-15 10:00 JST 凍結）↔ 現在',
    frozenAt: '2026-09-15 10:00 JST',
    fields: [
      { key: 'displayName', label: '氏名', frozen: ['架空 太郎'], current: ['架空 太郎'], changed: false, note: '変更なし' },
      { key: 'skills', label: 'スキル', frozen: ['Java 6 年（上級）'], current: ['Java 7 年（上級）', 'AWS 2 年（未設定）'], changed: true, note: '提案後に変更' },
      { key: 'unitPriceMin', label: '単価レンジ（下限）', frozen: ['650,000 円'], current: ['650,000 円'], changed: false, note: '変更なし' },
      { key: 'unitPriceMax', label: '単価レンジ（上限）', frozen: ['750,000 円'], current: ['—'], changed: true, note: '提案後に変更' },
      { key: 'availableFrom', label: '稼働可能時期', frozen: ['2026-10-01'], current: ['2026-10-01'], changed: false, note: '変更なし' },
      { key: 'prefecture', label: '勤務地（都道府県）', frozen: ['東京都'], current: ['東京都'], changed: false, note: '変更なし' },
      { key: 'remoteMode', label: 'リモート可否', frozen: ['一部リモート可'], current: ['一部リモート可'], changed: false, note: '変更なし' },
    ],
    careers: {
      frozen: [
        { key: 'frozen-0', period: '2024-04〜継続中', role: 'PL', description: '凍結された基幹刷新', technologies: 'Java' },
        { key: 'frozen-1', period: '2021-01〜2024-03', role: 'SE', description: '凍結された受託', technologies: '—' },
      ],
      current: [
        { id: 'c1', period: '2024-04〜継続中', role: 'PL', description: '現在の基幹刷新（改）', technologies: 'Java', source: '手入力' },
        { id: 'c3', period: '2019-01〜2020-12', role: 'PG', description: '現在の保守', technologies: 'PHP', source: '手入力' },
      ],
      frozenEmpty: null,
      currentEmpty: null,
      changed: true,
      note: '提案後に変更',
    },
    ...overrides,
  };
}

function render(props: Partial<EngineerProposalSectionsProps> = {}): string {
  return renderToStaticMarkup(
    createElement(EngineerProposalSections, {
      history: [historyRow()],
      diff: { kind: 'NONE' },
      messages: MESSAGES,
      ...props,
    }),
  );
}

/** `data-testid="…"` を持つ要素の外側 HTML（開始タグから対応する閉じタグまで）を切り出す（入れ子は同名タグの深さで数える）。 */
function outerOf(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const at = html.indexOf(marker);
  expect(at, `${testId} が無い`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(start))?.[1] ?? '';
  const open = new RegExp(`<${tag}(\\s|>)`, 'g');
  const close = new RegExp(`</${tag}>`, 'g');
  let depth = 0;
  let cursor = start;
  for (;;) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (nextClose === null) throw new Error(`${tag} の閉じタグが無い`);
    if (nextOpen !== null && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      cursor = nextClose.index + 1;
      if (depth === 0) return html.slice(start, nextClose.index + nextClose[0].length);
    }
  }
}

describe('① セクション 4 の空文言と、0 件ではセクション 5 が無いこと', () => {
  it('0 件: 「この人材はまだ提案されていません」。表も セクション 5 も無い。プレースホルダの testid も無い', () => {
    const html = render({ history: [] });
    expect(html).toContain('data-testid="engineer-detail-proposals"');
    expect(html).toContain('data-testid="engineer-detail-proposals-empty"');
    expect(html).toContain(MESSAGES.proposalsEmpty);
    expect(html).not.toContain('engineer-detail-proposals-table');
    expect(html).not.toContain('engineer-detail-snapshot-diff');
    expect(html).not.toContain('engineer-detail-proposals-coming-soon');
  });
});

describe('② セクション 4 の行', () => {
  it('提案先 / 案件 / 状態バッジ / 作成日 / S-023 への導線 / 差分の導線。選択中の行は「表示中」', () => {
    const html = render({ history: [historyRow(), historyRow({ id: P2, selected: true, stateLabel: '見送り', tone: 'neutral', state: 'LOST' })] });
    expect(html).not.toContain('engineer-detail-proposals-coming-soon');
    const row1 = outerOf(html, `engineer-proposal-row-${P1}`);
    expect(row1).toContain('架空エンド株式会社');
    expect(row1).toContain('基幹刷新');
    expect(row1).toContain('承認待ち');
    expect(row1).toContain('2026-09-15');
    expect(row1).toContain(`data-state="APPROVAL_PENDING"`);
    expect(row1).toContain(`data-selected="false"`);
    expect(row1).toContain(`href="/proposals/${P1}"`);
    expect(row1).toContain(`data-testid="engineer-proposal-diff-link-${P1}"`);
    expect(row1).toContain(`href="/engineers/e1?diff=${P1}#engineer-detail-snapshot-diff"`);
    const row2 = outerOf(html, `engineer-proposal-row-${P2}`);
    expect(row2).toContain(`data-selected="true"`);
    expect(row2).toContain(`data-testid="engineer-proposal-diff-selected-${P2}"`);
    expect(row2).not.toContain(`engineer-proposal-diff-link-${P2}`);
    // セクション 5 は提案があるので描かれる（未選択 → 案内文）。
    expect(html).toContain('data-testid="engineer-detail-snapshot-diff"');
    expect(html).toContain('data-testid="engineer-snapshot-diff-lead"');
    expect(html).toContain(MESSAGES.diffLead);
  });
});

describe('③ 🔴 セクション 5: 凍結側と現在値が左右に並置され、1 つのリストに混在しない', () => {
  it('項目の表は frozen / current が別の列。「提案後に変更」は changed の行だけ', () => {
    const html = render({ diff: { kind: 'READY', rows: diffRows() } });
    const view = outerOf(html, 'engineer-snapshot-diff');
    expect(view).toContain(`data-proposal-id="${P1}"`);
    expect(view).toContain('提案（2026-09-15 10:00 JST 凍結）↔ 現在');
    expect(view).toContain(MESSAGES.columnFrozen);
    expect(view).toContain(MESSAGES.columnCurrent);

    const skills = outerOf(html, 'engineer-snapshot-diff-field-skills');
    expect(skills).toContain('data-changed="true"');
    expect(outerOf(skills, 'engineer-snapshot-diff-frozen-skills')).toContain('Java 6 年（上級）');
    expect(outerOf(skills, 'engineer-snapshot-diff-frozen-skills')).not.toContain('Java 7 年');
    expect(outerOf(skills, 'engineer-snapshot-diff-current-skills')).toContain('Java 7 年（上級）');
    expect(outerOf(skills, 'engineer-snapshot-diff-current-skills')).toContain('AWS 2 年（未設定）');
    expect(outerOf(skills, 'engineer-snapshot-diff-note-skills')).toContain('提案後に変更');

    const name = outerOf(html, 'engineer-snapshot-diff-field-displayName');
    expect(name).toContain('data-changed="false"');
    expect(outerOf(name, 'engineer-snapshot-diff-note-displayName')).toContain('変更なし');
    expect(outerOf(name, 'engineer-snapshot-diff-note-displayName')).not.toContain('提案後に変更');

    // 7 項目すべてが描かれる（落とさない）。
    for (const key of ['displayName', 'skills', 'unitPriceMin', 'unitPriceMax', 'availableFrom', 'prefecture', 'remoteMode']) {
      expect(view).toContain(`data-testid="engineer-snapshot-diff-field-${key}"`);
    }
    expect((view.match(/data-changed="true"/g) ?? []).length).toBe(3); // skills / unitPriceMax / careers の注記
  });

  it('経歴は凍結側の表と現在値の表が別。凍結側の行が現在値の表に無く、現在値の行が凍結側の表に無い', () => {
    const html = render({ diff: { kind: 'READY', rows: diffRows() } });
    const careers = outerOf(html, 'engineer-snapshot-diff-careers');
    const frozen = outerOf(careers, 'engineer-snapshot-diff-careers-frozen');
    const current = outerOf(careers, 'engineer-snapshot-diff-careers-current');
    expect(frozen).toContain('data-side="frozen"');
    expect(current).toContain('data-side="current"');
    // 凍結側 = S-023 セクション 3 と同じ 4 列（入力元の列は無い）。現在値 = セクション 8 と同じ（入力元あり）。
    expect(frozen).toContain(MESSAGES.careersFrozenTitle);
    expect(frozen).not.toContain(MESSAGES.careerColumnSource);
    expect(current).toContain(MESSAGES.careersCurrentTitle);
    expect(current).toContain(MESSAGES.careerColumnSource);
    // 🔴 混在しない。
    expect(frozen).toContain('凍結された基幹刷新');
    expect(frozen).toContain('凍結された受託');
    expect(frozen).not.toContain('現在の');
    expect(current).toContain('現在の基幹刷新（改）');
    expect(current).toContain('現在の保守');
    expect(current).not.toContain('凍結された');
    expect(frozen).toContain('data-testid="engineer-snapshot-diff-frozen-career-frozen-0"');
    expect(frozen).not.toContain('engineer-snapshot-diff-current-career-');
    expect(current).toContain('data-testid="engineer-snapshot-diff-current-career-c1"');
    expect(current).not.toContain('engineer-snapshot-diff-frozen-career-');
    // 表は 2 つ（凍結側 1 + 現在値 1）。
    expect((careers.match(/<table/g) ?? []).length).toBe(2);
    expect(outerOf(html, 'engineer-snapshot-diff-careers-note')).toContain('提案後に変更');
    expect(html).toContain(MESSAGES.careersNote);
  });

  it('凍結 0 行 / 現在 0 行はそれぞれの空文言。注記は「変更なし」', () => {
    const html = render({
      diff: {
        kind: 'READY',
        rows: diffRows({ careers: { frozen: [], current: [], frozenEmpty: '凍結 0 行', currentEmpty: '現在 0 行', changed: false, note: '変更なし' } }),
      },
    });
    expect(outerOf(html, 'engineer-snapshot-diff-careers-frozen')).toContain('凍結 0 行');
    expect(outerOf(html, 'engineer-snapshot-diff-careers-current')).toContain('現在 0 行');
    expect(html).not.toContain('engineer-snapshot-diff-careers-frozen-table');
    expect(html).not.toContain('engineer-snapshot-diff-careers-current-table');
    expect(outerOf(html, 'engineer-snapshot-diff-careers-note')).toContain('data-changed="false"');
  });
});

describe('④ 404（現在値を参照できない）', () => {
  it('理由を語らない文言だけ。差分の表は無い', () => {
    const html = render({ diff: { kind: 'UNAVAILABLE' } });
    expect(html).toContain('data-testid="engineer-snapshot-diff-unavailable"');
    expect(html).toContain(MESSAGES.diffUnavailable);
    expect(html).not.toContain('data-testid="engineer-snapshot-diff"');
    expect(html).not.toContain('engineer-snapshot-diff-fields');
    expect(html).not.toMatch(/他社|取引先|所有/);
  });
});
