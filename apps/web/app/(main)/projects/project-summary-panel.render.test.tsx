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

// ✅✅ **2026-10-16（人間の明示指示）**: 帯の語は `案件サマリ`、ボタンは `詳細を開く` だけ、
//    タイル内に `基本情報` / `コピペ用サマリ` のタブ。
const messages: ProjectSummaryPanelMessages = {
  title: '案件サマリ',
  empty: '行をクリックすると、ここに案件サマリが出ます。',
  detail: '詳細を開く',
  tabBasic: '基本情報',
  tabCopy: 'コピペ用サマリ',
  copyHint: 'LINE やメールにそのまま貼り付けられる形式です。',
  copyGeneratedNote:
    'いまは案件の情報から自動で組んでいます。書き換えて保存できるようにする作業は後続です。',
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
    createElement(ProjectSummaryPanel, {
      row: row(),
      // ✅✅ 2026-10-16: 既定は `基本情報`（`PROJECT_PANEL_TAB_DEFAULT`）。
      // 🔴 **タブの URL は呼び出し側（`page.tsx` の `projectPanelTabHref`）が組む** ——
      //    組み立ては `lib/projects/list-rows.test.ts` が固定する。ここでは
      //    「画面が受け取った形をどう描くか」だけを見る。
      tab: 'BASIC' as const,
      tabHrefOf: (tab: 'BASIC' | 'COPY') => `/projects?panelTab=${tab}`,
      messages,
      ...overrides,
    }),
  );
}

describe('案件の要点パネル（`docs/04` §7.1 の幅クラス B の副カラム）', () => {
  it('帯・案件名・状態 Badge・キーバリューを描く', () => {
    const html = render();

    expect(html).toContain('data-testid="project-list-panel"');
    expect(html).toContain(`data-project-id="${PROJECT_A}"`);
    // ✅✅ **2026-10-16: 帯の語は `案件サマリ`**（人間の明示指示「右側の案件の要点は
    //    案件サマリに文言を変更して」）。⚠️ §7.8 の統一語より人間の明示指示が優先する。
    expect(html).toContain('案件サマリ');
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

  // ✅✅ **2026-10-16: 下端の操作は 1 本だけになった**（人間の明示指示「案件サマリの
  //    ボタンは、詳細を開くだけでよい」）。🔴 `編集する` / `この案件に合う人材を探す` は
  //    画面から外した（行き先は `S-011` からそのまま辿れる）。
  it('🔴 下端の操作は「詳細を開く」の 1 本だけである', () => {
    const html = render();
    // 🔴 面と枠は `packages/ui`（`SECONDARY_BUTTON_LINK_CLASSES`）が持つので、**ここでは
    //    その語を書かない**（書くと `tests/static/ui-shadow-and-size.test.ts` の
    //    「画面が面のクラス定数を再実装していない」に当たる）。**幅の配り方**で掴む。
    const detail = /<a class="([^"]*)"[^>]*data-testid="project-list-panel-detail"/.exec(html);

    expect(detail?.[1]?.split(' ')).toContain('w-full');
    expect(html).toContain('詳細を開く');
    // 🔴 **2 本目・3 本目が無い**（残っていると「1 つだけでよい」の指示が守られていない）。
    expect(html).not.toContain('data-testid="project-list-panel-edit"');
    expect(html).not.toContain('data-testid="project-list-panel-candidates"');
    expect(html).not.toContain('編集する');
    expect(html).not.toContain('この案件に合う人材を探す');
  });

  it('🔴 定義書から落としたものを描いていない（閉じる ✕ / 5 タブ / 複製 / チャット）', () => {
    const html = render();

    // ✅✅ **2026-10-16: `基本情報` をこの一覧から外した** —— 人間の明示指示
    //    「タイル内にタブを設置して、基本情報とコピペ用サマリ」で**実際にタブを置いた**。
    //    🔴 **定義書の均等 5 タブを落としたままである**ことは下の 4 語で担保している
    //       （`提案状況` / `関連ファイル` / `メモ` は中身が無いので置いていない）。
    for (const word of ['案件を複製', 'チャット', '関連ファイル', 'メモ', '提案状況']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
    // 🔴 閉じる操作は URL に状態が無いので置かない（押しても何も起きないボタンを作らない）。
    expect(html).not.toContain('aria-label="閉じる"');
  });

  // ============================================================================
  // ✅✅ 2026-10-16: タイル内のタブ（人間の明示指示「タイル内にタブを設置して、
  //     基本情報とコピペ用サマリ（添付を参考）」）
  // ============================================================================
  describe('🔴 タブ（`基本情報` / `コピペ用サマリ`）', () => {
    it('2 つのタブをリンクで描き、開いている側に `aria-current` を付ける', () => {
      const html = render();

      expect(html).toContain('data-testid="project-list-panel-tabs"');
      expect(html).toContain('data-testid="project-list-panel-tab-basic"');
      expect(html).toContain('data-testid="project-list-panel-tab-copy"');
      expect(html).toContain('基本情報');
      expect(html).toContain('コピペ用サマリ');
      // 🔴 **リンクである**（クライアントの島を使っていない。水和の前から押せる）。
      expect(html).toContain('href="/projects?panelTab=BASIC"');
      expect(html).toContain('href="/projects?panelTab=COPY"');
      // 🔴 `role="tablist"` を名乗らない（矢印キーで動く約束をしたことになる）。
      expect(html).not.toContain('role="tablist"');
      // 🔴 開いている側だけが現在地である。
      const basic = /<a class="[^"]*"[^>]*aria-current="page"[^>]*data-testid="project-list-panel-tab-basic"/;
      expect(html).toMatch(basic);
    });

    it('🔴 `基本情報` のときだけ Key-Value を描く', () => {
      const html = render();

      expect(html).toContain('data-testid="project-list-panel-basic"');
      expect(html).not.toContain('data-testid="project-list-panel-copy"');
    });

    it('🔴 `コピペ用サマリ` のときは貼れるテキストを描き、Key-Value を描かない', () => {
      const html = render({ tab: 'COPY' });

      expect(html).not.toContain('data-testid="project-list-panel-basic"');
      expect(html).toContain('data-testid="project-list-panel-copy"');
      expect(html).toContain('data-testid="project-list-panel-copy-text"');
      // 🔴 **`readOnly` である**（保存先の列がまだ無い。保存できない編集をさせない）。
      //    ⚠️ React の静的描画は `readOnly=""` の綴りで出す（HTML の属性名は大文字小文字を
      //       区別しないのでブラウザでは `readonly` として働く）。
      expect(html).toContain('readOnly=""');
      // 🔴 **できないことを書く**（登録時の生成と書き換え保存は後続）。
      expect(html).toContain('後続です');
      // 🔴 貼られる形（`【案件名】…`）。
      expect(html).toContain('【案件名】金融系 Web API 改修');
    });

    it('🔴🔴 コピペ用サマリにホスト内部の情報（公開先の設定状況）を入れない', () => {
      // 🔴 貼り先が取引先なら**他社の存在を漏らす**（`CLAUDE.md` §3.1 の 🔴）。
      //    行の型には在るが、`projectCopySummary` は意図して読まない。
      const html = render({ tab: 'COPY' });

      expect(html).not.toContain('【公開先の設定状況】');
      expect(html).not.toContain('3 社に公開中');
    });
  });

  it('🔴 `h1` を描かない（画面の `h1` は帯が持つ。1 画面 1 つ）', () => {
    expect(render()).not.toContain('<h1');
  });

  it('超過件数は `+N` で添え、0 件のときは添えない', () => {
    expect(render()).not.toContain('+0');
    expect(render({ row: row({ moreMustRequirements: '+2' }) })).toContain('+2');
  });

  // ✅✅ **2026-10-16: 導線は `S-011` の 1 本だけになった**（人間の明示指示）。
  it('導線は `S-011`（既存の画面）だけである', () => {
    const html = render();

    expect(html).toContain(`href="/projects/${PROJECT_A}"`);
    // 🔴 **新しい画面を足していない**のは変わらない。外した 2 本は `S-011` から辿れる。
    expect(html).not.toContain(`href="/projects/${PROJECT_A}/candidates"`);
    expect(html).not.toContain(`href="/projects/${PROJECT_A}/edit"`);
  });

  // ⚠️ 旧「🔴 `VIEWER` / 取引先には編集導線が無い」は**検査ごと外した** ——
  //    編集の導線がロールによらず 1 つも無くなったので、`canEdit` という prop 自体が消えた
  //    （拒否の本体は `#26` の `requireRole` / `S-012` の `redirect` / `projects` の RLS = C2
  //     であり、UI の配慮が 1 つ無くなっただけである）。上の検査が「編集の導線が無い」ことを
  //    ロールによらず固定している。

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
    expect(html).toContain('案件サマリ');
    // ✅✅ 2026-10-16: 🔴 **タブも描かない** —— 押しても何も出ないタブを置かない。
    expect(html).not.toContain('data-testid="project-list-panel-tabs"');
    expect(html).not.toContain('data-entity="project"');
    expect(html).not.toContain('data-testid="project-list-panel-detail"');
    expect(html).not.toContain('data-testid="project-list-panel-edit"');
    expect(html).not.toContain('data-testid="project-list-panel-candidates"');
  });
});
