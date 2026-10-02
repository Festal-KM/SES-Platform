// apps/web/app/(main)/projects/project-summary-panel.render.test.tsx
// `ProjectSummaryPanel`（`S-010` の副カラム）の状態別描画テスト。SP-22 段④。
//
// 🔴 なぜこの粒度で要るか（`project-list-screen.render.test.tsx` と同じ理由）:
//    ①🔴 **取引先の行では「公開先の設定状況」がパネルにも出ないこと**（`F-014 AC-4` / `BR-07`）
//    ②🔴 **商流情報（エンド企業名・内部単価）・担当者・他社の提案がパネルに 1 つも無いこと**
//      （`F-013 AC-2`）—— 「描かれていないこと」が要件であり、API のテストでは示せない
//    ③**`VIEWER` / 取引先に編集導線が無いこと**（`docs/04` §S-011 権限差分と同じ規律）
//    ④**行が無いページでパネルが空状態になること**（`docs/04` §10.4）
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';
import {
  ProjectSummaryPanel,
  type ProjectSummaryPanelMessages,
} from './project-summary-panel';

const PROJECT_A = '01930000-0000-7000-8000-0000000000c1';

function row(overrides: Partial<ProjectListRowView> = {}): ProjectListRowView {
  return {
    id: PROJECT_A,
    name: '金融系 Web API 改修',
    status: '募集中',
    mustRequirements: 'Java 5 年以上、Spring',
    moreMustRequirements: null,
    unitPrice: '650,000〜750,000 円',
    startDate: '2026-10-01',
    location: '東京都・一部リモート可',
    headcount: '2 名',
    updatedOn: '2026-09-05',
    visibility: '3 社に公開中',
    ...overrides,
  };
}

const messages: ProjectSummaryPanelMessages = {
  title: '案件の要点',
  empty: '行の「内容を見る」を押すと、ここに案件の要点が出ます。',
  detail: '案件詳細を開く',
  edit: '編集する',
  candidates: 'この案件に合う人材を探す',
  fieldStatus: '状態',
  fieldMustRequirements: '必須要件の要約',
  fieldUnitPrice: '単価レンジ',
  fieldStartDate: '開始日',
  fieldLocation: '勤務地・リモート',
  fieldHeadcount: '募集人数',
  fieldUpdatedOn: '更新日',
  fieldVisibility: '公開先の設定状況',
};

function render(overrides: Partial<Parameters<typeof ProjectSummaryPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ProjectSummaryPanel, { row: row(), canEdit: true, messages, ...overrides }),
  );
}

describe('案件の要点パネル（`docs/04` §7.1 の幅クラス B の副カラム）', () => {
  it('案件名・状態・キーバリューを描く', () => {
    const html = render();

    expect(html).toContain('data-testid="project-list-panel"');
    expect(html).toContain(`data-project-id="${PROJECT_A}"`);
    expect(html).toContain('data-testid="project-list-panel-name"');
    expect(html).toContain('金融系 Web API 改修');
    expect(html).toContain('data-testid="project-list-panel-status"');
    expect(html).toContain('募集中');
    for (const key of [
      'status',
      'mustRequirements',
      'unitPrice',
      'startDate',
      'location',
      'headcount',
      'updatedOn',
      'visibility',
    ]) {
      expect(html, `${key} が描かれていない`).toContain(
        `data-testid="project-list-panel-field-${key}"`,
      );
    }
  });

  it('🔴 `h1` を描かない（画面の `h1` は帯が持つ。1 画面 1 つ）', () => {
    expect(render()).not.toContain('<h1');
  });

  it('超過件数は `+N` で添え、0 件のときは添えない', () => {
    expect(render()).not.toContain('+0');
    expect(render({ row: row({ moreMustRequirements: '+2' }) })).toContain('+2');
  });

  it('導線は `S-011` / `S-016` / `S-012`（いずれも既存の画面）だけである', () => {
    const html = render();

    expect(html).toContain(`href="/projects/${PROJECT_A}"`);
    expect(html).toContain(`href="/projects/${PROJECT_A}/candidates"`);
    expect(html).toContain(`href="/projects/${PROJECT_A}/edit"`);
  });

  it('🔴 `VIEWER` / 取引先には編集導線が無い（`disabled` で残さない）', () => {
    const html = render({ canEdit: false });

    expect(html).not.toContain(`href="/projects/${PROJECT_A}/edit"`);
    expect(html).not.toContain('編集する');
    // 読み取りの導線は残る（閲覧は止めない）。
    expect(html).toContain(`href="/projects/${PROJECT_A}"`);
  });

  it('🔴 取引先の行では「公開先の設定状況」がパネルに 1 つも出ない（`F-014 AC-4` / `BR-07`）', () => {
    const html = render({ row: row({ visibility: null }) });

    expect(html).not.toContain('data-testid="project-list-panel-field-visibility"');
    expect(html).not.toContain('公開先の設定状況');
    expect(html).not.toContain('社に公開中');
  });

  it('🔴 商流情報・担当者・他社の提案を描く欄が無い（`F-013 AC-2` / `BR-07`）', () => {
    const html = render();

    for (const word of ['エンド', '商流', '自社単価', '内部単価', '担当者', '他社', '提案数']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
  });

  it('🔴 スコア・順位・重みの語が 1 つも出ない（Phase 1）', () => {
    const html = render();

    for (const word of ['スコア', '順位', '重み', '適合度']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
  });

  it('行が 1 件も無いページでは空状態になる（導線を描かない）', () => {
    const html = render({ row: null });

    expect(html).toContain('data-testid="project-list-panel-empty"');
    expect(html).toContain('案件の要点');
    expect(html).not.toContain('data-testid="project-list-panel-detail"');
    expect(html).not.toContain('data-testid="project-list-panel-edit"');
    expect(html).not.toContain('data-testid="project-list-panel-candidates"');
  });
});
