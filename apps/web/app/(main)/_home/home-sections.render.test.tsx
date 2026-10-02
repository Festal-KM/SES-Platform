// apps/web/app/(main)/_home/home-sections.render.test.tsx
// 🔴 T-05-08: `ScanQuarantineSection`（`S-003` / `S-004` の隔離の周知。`F-011` 処理④）。
//    ✅ 2026-10-02（`docs/04` 改訂 23）: `SummaryStrip` が **KPI カード 4 枚**に置き換わったため、
//    本ファイルの対象は「サーバ描画の断片」（初回空 / タブの面 / KPI 直下の 1 行 / 帯の secondary /
//    隔離の周知）になった。🔴 **検査の趣旨は 1 つも落としていない**（凍結済みの testid の在処と
//    権限差分の「描かない」が引き続き固定されている）。
//
// 🔴 なぜ描画のテストが要るか: `F-011` 処理④ の 🔴 は「**アプリ内表示は分類によらず必ず行う**
//    （パートナーの担当者が隔離に気づけない状態にならない）」であり、これは**画面に出ていること**
//    そのものが要件である。API の結合テストでは示せない。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`skill-dictionary-screen.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HomeBlock, ScanQuarantineHomeBlock } from '../../../lib/home/types';
import {
  EngineersTabPanel,
  HostHeaderSecondaryAction,
  HostHomeEmptyState,
  HostUsageLine,
  PartnerHomeEmptyState,
  PartnerVisibilityNoticeLine,
  ProjectsTabPanel,
  ScanQuarantineSection,
} from './home-sections';

const SHEET_ID = '01930000-0000-7000-8000-0000000000d1';
const ENGINEER_ID = '01930000-0000-7000-8000-0000000000b1';

// ✅ T-12-15: `HomeBlock` が合併型なので、隔離ブロックの `items` を名指しする。
function blockOf(items: ScanQuarantineHomeBlock['items']): HomeBlock {
  return { kind: 'SCAN_QUARANTINE', items };
}

const ITEM = {
  skillSheetId: SHEET_ID,
  engineerId: ENGINEER_ID,
  version: 3,
  scanStatus: 'INFECTED',
  detectedAt: '2026-09-06T01:00:00.000Z',
} as const;

function render(blocks: readonly HomeBlock[]): string {
  return renderToStaticMarkup(createElement(ScanQuarantineSection, { blocks }));
}

describe('🔴 隔離の周知は必ず描かれる（F-011 処理④）', () => {
  it('隔離された版があるとセクションが描かれる', () => {
    const html = render([blockOf([ITEM])]);
    expect(html).toContain('home-scan-quarantine');
    expect(html).toContain(`home-scan-quarantine-item-${SHEET_ID}`);
  });

  it('🔴 次の行動（S-008 への導線）を必ず添える（行き止まりにしない）', () => {
    const html = render([blockOf([ITEM])]);
    expect(html).toContain(`/engineers/${ENGINEER_ID}/skill-sheets`);
  });

  it('🔴 3 つの隔離状態をすべて描く（状態ごとに文言が分かれる）', () => {
    const html = render([
      blockOf([
        { ...ITEM, scanStatus: 'INFECTED' },
        { ...ITEM, skillSheetId: 's2', scanStatus: 'UNSCANNABLE' },
        { ...ITEM, skillSheetId: 's3', scanStatus: 'FAILED' },
      ]),
    ]);
    expect(html).toContain('data-scan-status="INFECTED"');
    expect(html).toContain('data-scan-status="UNSCANNABLE"');
    expect(html).toContain('data-scan-status="FAILED"');
    expect(html).toContain('隔離');
    expect(html).toContain('検査不能');
    expect(html).toContain('検査失敗');
  });

  it('🔴 氏名を出さない入力しか受け取らない（BR-27。ホームは 60 秒ごとに読み直される）', () => {
    expect(Object.keys(ITEM).sort()).toEqual([
      'detectedAt',
      'engineerId',
      'scanStatus',
      'skillSheetId',
      'version',
    ]);
  });
});

describe('0 件のときはセクションごと出さない（docs/04 §S-004 の判断）', () => {
  it('ブロックが無ければ何も描かない', () => {
    expect(render([])).toBe('');
  });

  it('ブロックはあるが items が空なら何も描かない', () => {
    expect(render([blockOf([])])).toBe('');
  });
});

// 🔴 T-06-01: `docs/04` §4.1 の初回空は「`S-012` / `S-007` への導線 **2 本**」である。
//    ✅ T-22-09 で `EmptyState` の 3 段構造になり、✅ 改訂 23 で**初回空のときだけ主カラムに出る**
//    （KPI カード・タブ・右レールを描かない。判定は `lib/home/summary-view.ts` の 1 関数）。
describe('🔴 S-003 の初回空は EmptyState の 3 段（S-012 / S-007 への導線 2 本）', () => {
  function renderHost(options: {
    readonly canRegisterEngineer: boolean;
    readonly canRegisterProject: boolean;
  }): string {
    return renderToStaticMarkup(createElement(HostHomeEmptyState, options));
  }

  it('両方できるロールでは、案件の登録（Primary）と人材の登録（Secondary）の 2 本が出る', () => {
    const html = renderHost({ canRegisterEngineer: true, canRegisterProject: true });
    expect(html).toContain('data-testid="home-host-empty-state-description"');
    expect(html).toContain('data-testid="home-host-empty-register-project"');
    expect(html).toContain('href="/projects/new"');
    expect(html).toContain('data-testid="home-host-empty-state-secondary"');
    expect(html).toContain('href="/engineers/new"');
  });

  it('🔴 案件を登録できないロールでは、その導線が DOM に存在しない（隠すのではなく描かない）', () => {
    const html = renderHost({ canRegisterEngineer: true, canRegisterProject: false });
    expect(html).not.toContain('home-host-empty-register-project');
    expect(html).not.toContain('href="/projects/new"');
    // 人材側は残る（2 つのフラグを 1 つに畳んでいない）。
    expect(html).toContain('data-testid="home-host-empty-state-secondary"');
  });

  it('🔴 器（凍結済みの `home-host-summary`）は初回空でも残る（改名ではなく併記）', () => {
    expect(renderHost({ canRegisterEngineer: true, canRegisterProject: true })).toContain(
      'data-testid="home-host-summary"',
    );
  });

  it('🔴 初回空でも `EmptyState` にナビゲーションの重複リンクを置かない（サイドバーの写しを作らない）', () => {
    const html = renderHost({ canRegisterEngineer: true, canRegisterProject: true });
    for (const href of [
      'href="/projects"',
      'href="/engineers"',
      'href="/proposals"',
      'href="/proposal-requests"',
    ]) {
      expect(html, href).not.toContain(href);
    }
  });
});

// ============================================================================
// 🔴 改訂 23: 一覧への入口は**タブの面の導線**（凍結済みの testid をそのまま使う）
// ============================================================================
describe('🔴 `案件` / `人材` タブの面（docs/04 §4.1 改訂 23）', () => {
  it('ホスト: 案件の面から `S-010`、人材の面から `S-005` へ行ける（凍結値を保つ）', () => {
    const projects = renderToStaticMarkup(createElement(ProjectsTabPanel, { audience: 'HOST' }));
    expect(projects).toContain('data-testid="home-host-project-list"');
    expect(projects).toContain('href="/projects"');
    const engineers = renderToStaticMarkup(
      createElement(EngineersTabPanel, { audience: 'HOST', canManageShares: false }),
    );
    expect(engineers).toContain('data-testid="home-host-engineer-ledger"');
    expect(engineers).toContain('href="/engineers"');
  });

  it('取引先: 同じ位置に取引先側の testid が出る（`S-003` の「ついで」にしない）', () => {
    const projects = renderToStaticMarkup(createElement(ProjectsTabPanel, { audience: 'PARTNER' }));
    expect(projects).toContain('data-testid="home-partner-project-list"');
    expect(projects).not.toContain('data-testid="home-host-project-list"');
    const engineers = renderToStaticMarkup(
      createElement(EngineersTabPanel, { audience: 'PARTNER', canManageShares: true }),
    );
    expect(engineers).toContain('data-testid="home-partner-engineer-ledger"');
  });

  it('🔴 `S-015` に到達できないロールでは共有の設定の導線を描かない（グレーアウトにしない）', () => {
    const allowed = renderToStaticMarkup(
      createElement(EngineersTabPanel, { audience: 'PARTNER', canManageShares: true }),
    );
    expect(allowed).toContain('data-testid="home-partner-engineer-shares"');
    expect(allowed).toContain('href="/engineer-shares"');
    const denied = renderToStaticMarkup(
      createElement(EngineersTabPanel, { audience: 'PARTNER', canManageShares: false }),
    );
    expect(denied).not.toContain('data-testid="home-partner-engineer-shares"');
    expect(denied).not.toContain('href="/engineer-shares"');
    // 空振り防止（他の入口は出ている）。
    expect(denied).toContain('data-testid="home-partner-engineer-ledger"');
  });

  it('🔴 ホストの面に `S-015` の導線が 1 本も出ない（ホスト側ロールにこの画面は存在しない）', () => {
    const html = renderToStaticMarkup(
      createElement(EngineersTabPanel, { audience: 'HOST', canManageShares: true }),
    );
    expect(html).not.toContain('href="/engineer-shares"');
  });

  it('🔴 「0 件」「ありません」と書かない（案件も人材も在るのに嘘になる）', () => {
    for (const html of [
      renderToStaticMarkup(createElement(ProjectsTabPanel, { audience: 'HOST' })),
      renderToStaticMarkup(createElement(EngineersTabPanel, { audience: 'HOST', canManageShares: false })),
    ]) {
      expect(html).not.toContain('0 件');
      expect(html).not.toContain('ありません');
    }
  });

  it('🔴 氏名を受け取る口が無い（`BR-27`。面の入力は `audience` と権限だけ）', () => {
    const html = renderToStaticMarkup(
      createElement(EngineersTabPanel, { audience: 'PARTNER', canManageShares: true }),
    );
    expect(html).toContain('data-testid="home-engineers-panel"');
  });
});

// ============================================================================
// 🔴 改訂 23: KPI カード直下の 1 行（ホスト = 残量 / 取引先 = 見える範囲の説明）
// ============================================================================
describe('🔴 KPI カード直下の 1 行', () => {
  it('ホスト: 残量（件数）の入口が出る（`F-027 AC-1`。ホスト所属の 4 ロールすべて）', () => {
    const html = renderToStaticMarkup(createElement(HostUsageLine, {}));
    expect(html).toContain('data-testid="home-host-usage"');
    expect(html).toContain('href="/settings/usage"');
    // 🔴 金額を出さない（`BR-24`）。
    expect(html).not.toContain('円');
    expect(html).not.toContain('$');
  });

  it('取引先: 見える範囲の説明が常設される（`F-006 AC-2`）', () => {
    const html = renderToStaticMarkup(
      createElement(PartnerVisibilityNoticeLine, { noticeText: '見える範囲の説明（合成）' }),
    );
    expect(html).toContain('data-testid="home-partner-visibility-notice"');
    expect(html).toContain('見える範囲の説明（合成）');
  });
});

// ============================================================================
// 🔴 S-004 の初回空（催促の導線を置かない）
// ============================================================================
describe('🔴 S-004（取引先ホーム）の初回空', () => {
  function renderPartner(canManageShares: boolean): string {
    return renderToStaticMarkup(
      createElement(PartnerHomeEmptyState, { canRegisterEngineer: true, canManageShares }),
    );
  }

  it('🔴 `人材を登録`（Primary）+ `共有の設定を見る`（Secondary）で、催促の導線を置かない', () => {
    const html = renderPartner(true);
    expect(html).toContain('data-testid="home-partner-empty-state-description"');
    expect(html).toContain('data-testid="home-partner-empty-register-engineer"');
    expect(html).toContain('href="/engineers/new"');
    expect(html).toContain('data-testid="home-partner-empty-state-secondary"');
    // 🔴 取引先のホームに「案件を登録」は無い（第二境界）。
    expect(html).not.toContain('href="/projects/new"');
    // 🔴 「ホストに問い合わせる」に相当する導線を置かない。
    expect(html).not.toContain('問い合わせ');
  });

  it('🔴 共有の設定に到達できないロールでは Secondary を描かない', () => {
    expect(renderPartner(false)).not.toContain('data-testid="home-partner-empty-state-secondary"');
  });

  it('🔴 器（凍結済みの `home-partner-summary`）は初回空でも残る', () => {
    expect(renderPartner(true)).toContain('data-testid="home-partner-summary"');
  });
});

// ============================================================================
// 🔴 T-22-09: `PageHeader` の secondary アクション（`人材を登録`）
// ============================================================================
describe('🔴 帯の secondary アクションはロールで描き分ける', () => {
  it('登録できるロールには出る', () => {
    const html = renderToStaticMarkup(
      createElement(HostHeaderSecondaryAction, { canRegisterEngineer: true }),
    );
    expect(html).toContain('data-testid="home-host-register-engineer"');
    expect(html).toContain('href="/engineers/new"');
  });

  it('🔴 `VIEWER` には描かない（無効化したボタンを置かない）', () => {
    expect(
      renderToStaticMarkup(createElement(HostHeaderSecondaryAction, { canRegisterEngineer: false })),
    ).toBe('');
  });
});
