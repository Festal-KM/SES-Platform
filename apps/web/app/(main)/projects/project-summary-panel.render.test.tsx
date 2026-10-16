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
    // 🔴 ✅ 2026-10-14: 状態の**値**（語ではない）。色は `@ses/ui` が状態名から決める。
    statusState: 'OPEN',
    mustRequirements: 'Java 5 年以上、Spring',
    moreMustRequirements: null,
    unitPrice: '65〜75 万円',
    startDate: '2026-10-01',
    location: '東京都',
    remoteMode: '一部リモート可',
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
  fieldMustRequirements: '必須要件の要約',
  fieldUnitPrice: '単価レンジ',
  fieldStartDate: '開始日',
  fieldLocation: '勤務地',
  fieldRemoteMode: '稼働形態',
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
  it('帯・案件名・状態 Badge・キーバリューを描く', () => {
    const html = render();

    expect(html).toContain('data-testid="project-list-panel"');
    expect(html).toContain(`data-project-id="${PROJECT_A}"`);
    // ✅ 2026-10-14: 帯（器の名前）。🔴 語は `案件詳細` ではない（§7.8。`詳細` は画面を指す語）。
    expect(html).toContain('案件の要点');
    expect(html).toContain('data-testid="project-list-panel-name"');
    expect(html).toContain('金融系 Web API 改修');
    expect(html).toContain('data-testid="project-list-panel-status"');
    expect(html).toContain('募集中');
    for (const key of [
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

  // ============================================================================
  // 🔴 ✅ 2026-10-14: 受領した定義書 §1.8（案件詳細 Panel）に形を合わせた
  // ============================================================================
  it('🔴 状態は `StatusBadge` で 1 回だけ描く（Key-Value に 2 本目を置かない）', () => {
    const html = render();

    expect(html).toContain('data-entity="project"');
    expect(html).toContain('data-state="OPEN"');
    // 🔴 同じ値をパネルの中で 2 回描かない（定義書はタイトル行と Key-Value の両方に置いている）。
    expect(html).not.toContain('data-testid="project-list-panel-field-status"');
    expect(html.match(/募集中/g)).toHaveLength(1);
  });

  it('🔴 状態名で描き分ける（語ではなく値を使っている）', () => {
    const html = render({ row: row({ status: '終了', statusState: 'CLOSED' }) });

    expect(html).toContain('data-state="CLOSED"');
  });

  it('下端の操作行は 3 本すべてが同じ輪郭ボタンで、幅を等分する', () => {
    const html = render();
    // 🔴 面と枠は `packages/ui`（`SECONDARY_BUTTON_LINK_CLASSES`）が持つので、**ここでは
    //    その語を書かない**（書くと `tests/static/ui-shadow-and-size.test.ts` の
    //    「画面が面のクラス定数を再実装していない」に当たる）。**幅の配り方**で掴む。
    const detail = /<a class="([^"]*)"[^>]*data-testid="project-list-panel-detail"/.exec(html);
    const edit = /<a class="([^"]*)"[^>]*data-testid="project-list-panel-edit"/.exec(html);
    const candidates = /<a class="([^"]*)"[^>]*data-testid="project-list-panel-candidates"/.exec(html);

    expect(detail?.[1]?.split(' ')).toContain('flex-1');
    expect(edit?.[1]?.split(' ')).toContain('flex-1');
    expect(candidates?.[1]?.split(' ')).toContain('w-full');
    // 🔴 3 本は同じ見た目である（1 本だけ違う形にしない）。
    // ⚠️ **幅の語は比較から外す** —— `flex-1` は `tailwind-merge` が `shrink-0` と競合すると
    //    判断して落とすため（`flex: 1 1 0%` は `flex-shrink` を含む）、幅を配る語と
    //    `shrink-0` は「文脈が決める層」として同じ扱いにする。
    const LAYOUT_TOKENS = ['flex-1', 'w-full', 'shrink-0'];
    const shapeOf = (classes: string | undefined): string =>
      (classes ?? '')
        .split(' ')
        .filter((token) => !LAYOUT_TOKENS.includes(token))
        .join(' ');
    expect(shapeOf(edit?.[1])).toBe(shapeOf(detail?.[1]));
    expect(shapeOf(candidates?.[1])).toBe(shapeOf(detail?.[1]));
  });

  it('🔴 定義書から落としたものを描いていない（閉じる ✕ / 5 タブ / 複製 / チャット）', () => {
    const html = render();

    for (const word of ['案件を複製', 'チャット', '関連ファイル', 'メモ', '提案状況', '基本情報']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
    // 🔴 閉じる操作は URL に状態が無いので置かない（押しても何も起きないボタンを作らない）。
    expect(html).not.toContain('aria-label="閉じる"');
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

  it('行が 1 件も無いページでは空状態になる（帯は残し、導線を描かない）', () => {
    const html = render({ row: null });

    expect(html).toContain('data-testid="project-list-panel-empty"');
    // 🔴 帯は両方の状態で出す（行の有無でパネルの器の位置が動かない）。
    expect(html).toContain('案件の要点');
    expect(html).not.toContain('data-entity="project"');
    expect(html).not.toContain('data-testid="project-list-panel-detail"');
    expect(html).not.toContain('data-testid="project-list-panel-edit"');
    expect(html).not.toContain('data-testid="project-list-panel-candidates"');
  });
});
