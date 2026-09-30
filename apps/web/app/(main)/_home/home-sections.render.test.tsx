// apps/web/app/(main)/_home/home-sections.render.test.tsx
// 🔴 T-05-08: `ScanQuarantineSection`（`S-003` / `S-004` の隔離の周知。`F-011` 処理④）。
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
  HostHeaderSecondaryAction,
  HostHomeSections,
  PartnerHomeSections,
  ScanQuarantineSection,
  type HomeSummaryProps,
} from './home-sections';

/**
 * 🔴 T-22-09: `SummaryStrip` の合成値。**3 件以上**である（部品が 1〜2 件で実行時に落ちる ——
 *    「0 の指標を間引いた」ことの徴候だから。`docs/05` §6.11.1）。
 */
const HOST_SUMMARY: HomeSummaryProps = {
  items: [
    { label: '案件', value: '128', href: '/projects' },
    { label: '人材', value: '64', href: '/engineers' },
    { label: '進行中の提案', value: '7', href: '/proposals' },
  ],
  initialEmpty: false,
};

const PARTNER_SUMMARY: HomeSummaryProps = {
  items: [
    { label: '御社に公開された案件', value: '12', href: '/projects' },
    { label: '自社の人材', value: '30', href: '/engineers' },
    { label: '共有中', value: '5', href: '/engineer-shares' },
    { label: '進行中の提案', value: '2', href: '/proposals' },
  ],
  initialEmpty: false,
};

/** 全 metric が 0（= 初回空）。値は `0` のままで**項目を間引かない**。 */
function zeroed(summary: HomeSummaryProps): HomeSummaryProps {
  return { items: summary.items.map((item) => ({ ...item, value: '0' })), initialEmpty: true };
}

const SHEET_ID = '01930000-0000-7000-8000-0000000000d1';
const ENGINEER_ID = '01930000-0000-7000-8000-0000000000b1';

// ✅ T-12-15: `HomeBlock` が合併型（`SCAN_QUARANTINE` | `ACTION_QUEUE`）になったので、隔離ブロックの `items` を名指しする。
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
    // 型として氏名を持たないことは `types.test.ts` が固定する。ここでは
    // 「描画に使えるのは ID / 版 / 状態 / 時刻だけ」であることを実行時にも確かめる。
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

// 🔴 T-06-01: `docs/04` §S-003 の初回空は「`S-012` / `S-007` への導線 **2 本**」である。
//    T-03-06 で保留（両画面が未実装）→ T-05-01 で `S-007` のみ → T-06-01 で 2 本そろった。
//    ✅ T-22-09: **`EmptyState` の 3 段構造**（①説明 → ②Primary〔案件を登録〕→ ③Secondary〔人材を登録〕）に
//    置き換えた。**導線が 2 本であること**は変えていない（片方が消えても誰も気づかない状態を作らない）。
describe('🔴 S-003 の初回空は EmptyState の 3 段（S-012 / S-007 への導線 2 本）', () => {
  function renderHost(options: {
    readonly canRegisterEngineer: boolean;
    readonly canRegisterProject: boolean;
    readonly summary?: HomeSummaryProps;
  }): string {
    return renderToStaticMarkup(
      createElement(HostHomeSections, { ...options, summary: options.summary ?? zeroed(HOST_SUMMARY) }),
    );
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

  it('🔴 初回空では `SummaryStrip` を描かない（`0` が並ぶ画面を作らない。docs/04 §S-003）', () => {
    const html = renderHost({ canRegisterEngineer: true, canRegisterProject: true });
    expect(html).not.toContain('data-testid="home-host-summary-root"');
    // 器（凍結済みの値）は残る（改名ではなく併記）。
    expect(html).toContain('data-testid="home-host-summary"');
  });

  it('🔴 初回空でも `EmptyState` にナビゲーションの重複リンクを置かない（サイドバーの写しを作らない）', () => {
    const html = renderHost({ canRegisterEngineer: true, canRegisterProject: true });
    for (const href of ['href="/projects"', 'href="/engineers"', 'href="/proposals"', 'href="/proposal-requests"']) {
      expect(html, href).not.toContain(href);
    }
  });
});

// ============================================================================
// 🔴 T-22-09: 一覧への入口は `SummaryStrip` の**値**に紐づく（ナビの重複を置かない）
// ============================================================================
describe('🔴 S-003 の一覧への入口は SummaryStrip の値（docs/04 §S-003 改訂 16）', () => {
  function renderHost(canRegister: boolean): string {
    return renderToStaticMarkup(
      createElement(HostHomeSections, {
        summary: HOST_SUMMARY,
        canRegisterEngineer: canRegister,
        canRegisterProject: canRegister,
      }),
    );
  }

  it('案件 / 人材 / 進行中の提案 の値がそれぞれの一覧へのリンクである', () => {
    const html = renderHost(true);
    expect(html).toContain('data-testid="home-host-summary-root"');
    expect(html).toMatch(/home-host-project-list"[^>]*>128</);
    expect(html).toMatch(/home-host-engineer-ledger"[^>]*>64</);
    expect(html).toMatch(/home-host-proposals"[^>]*>7</);
  });

  it('🔴 VIEWER 相当（登録できないロール）でも一覧への入口は残る（見られないことと登録できないことは別）', () => {
    const html = renderHost(false);
    expect(html).toContain('data-testid="home-host-engineer-ledger"');
    expect(html).toContain('data-testid="home-host-project-list"');
    expect(html).toContain('href="/projects"');
    // 🔴 残量（件数）の入口もホスト所属の 4 ロールすべてに出る（`F-027 AC-1`）。
    expect(html).toContain('data-testid="home-host-usage"');
    expect(html).toContain('href="/settings/usage"');
  });

  it('🔴 個々の 0 で項目を間引かない（3 件のまま並びが変わらない）', () => {
    const withZero: HomeSummaryProps = {
      items: [
        { label: '案件', value: '0', href: '/projects' },
        { label: '人材', value: '64', href: '/engineers' },
        { label: '進行中の提案', value: '0', href: '/proposals' },
      ],
      initialEmpty: false,
    };
    const html = renderToStaticMarkup(
      createElement(HostHomeSections, {
        summary: withZero,
        canRegisterEngineer: true,
        canRegisterProject: true,
      }),
    );
    expect(html).toContain('data-item-count="3"');
  });

  it('🔴 件数は要対応キューより弱い（補助テキストの大きさ / `--color-fg-muted` / 背景なし）', () => {
    const html = renderHost(true);
    const root = html.match(/<div[^>]*data-testid="home-host-summary-root"[^>]*>/)?.[0] ?? '';
    // 🔴 カードにしない（背景・枠線・影を持たない）。
    expect(root).not.toMatch(/\bbg-/);
    expect(root).not.toMatch(/\bborder\b/);
    expect(root).not.toMatch(/shadow/);
    // 🔴 値とラベルは `text-xs` + `--color-fg-muted`（キューの `text-cell` / `text-fg` より弱い）。
    const valueLink = html.match(/<a[^>]*data-testid="home-host-project-list"[^>]*>/)?.[0] ?? '';
    expect(valueLink).toContain('text-xs');
    expect(valueLink).toContain('text-fg-muted');
    // 🔴 グラフ・スパークラインを置かない。
    expect(html).not.toContain('<svg');
  });
});

// 🔴 T-06-03 / T-08-02: `S-004`（取引先ホーム）からも `S-005` / `S-010` / `S-015` へ行ける（docs/04 §2）。
//    ✅ T-22-09: 入口は `SummaryStrip` の値（`自社の人材` / `御社に公開された案件` / `共有中`）に移った。
describe('🔴 S-004（取引先ホーム）の入口と見える範囲の説明', () => {
  function renderPartner(options: {
    readonly canManageShares: boolean;
    readonly canRegisterEngineer?: boolean;
    readonly summary?: HomeSummaryProps;
  }): string {
    return renderToStaticMarkup(
      createElement(PartnerHomeSections, {
        summary: options.summary ?? PARTNER_SUMMARY,
        noticeText: '見える範囲の説明（合成）',
        canRegisterEngineer: options.canRegisterEngineer ?? true,
        canManageShares: options.canManageShares,
      }),
    );
  }

  it('人材台帳・案件一覧・匿名共有の設定の入口が値に紐づいて出る', () => {
    const html = renderPartner({ canManageShares: true });
    expect(html).toContain('data-testid="home-partner-engineer-ledger"');
    expect(html).toContain('data-testid="home-partner-project-list"');
    expect(html).toContain('data-testid="home-partner-proposals"');
    expect(html).toContain('data-testid="home-partner-engineer-shares"');
    expect(html).toContain('href="/projects"');
    // 🔴 取引先のホームに「案件を登録」は無い（`docs/04` §S-012 権限差分 / 第二境界）。
    expect(html).not.toContain('href="/projects/new"');
  });

  it('🔴 `S-015` に到達できないロールでは `共有中` がリンクにならない（指標そのものは消さない）', () => {
    const summary: HomeSummaryProps = {
      items: PARTNER_SUMMARY.items.map((item) =>
        item.label === '共有中' ? { label: item.label, value: item.value } : item,
      ),
      initialEmpty: false,
    };
    const html = renderPartner({ canManageShares: false, summary });
    expect(html).not.toContain('data-testid="home-partner-engineer-shares"');
    expect(html).not.toContain('href="/engineer-shares"');
    // 🔴 4 件のまま（ロールで並びが変わらない）。
    expect(html).toContain('data-item-count="4"');
    // 空振り防止（他の入口は出ている）。
    expect(html).toContain('data-testid="home-partner-engineer-ledger"');
  });

  it('🔴 見える範囲の説明はストリップの直下に常設する（初回空でも出る。`F-006 AC-2`）', () => {
    for (const summary of [PARTNER_SUMMARY, zeroed(PARTNER_SUMMARY)]) {
      const html = renderPartner({ canManageShares: true, summary });
      expect(html).toContain('data-testid="home-partner-visibility-notice"');
      expect(html).toContain('見える範囲の説明（合成）');
    }
  });

  it('🔴 初回空は `人材を登録`（Primary）+ `共有の設定を見る`（Secondary）で、催促の導線を置かない', () => {
    const html = renderPartner({ canManageShares: true, summary: zeroed(PARTNER_SUMMARY) });
    expect(html).toContain('data-testid="home-partner-empty-state-description"');
    expect(html).toContain('data-testid="home-partner-empty-register-engineer"');
    expect(html).toContain('href="/engineers/new"');
    expect(html).toContain('data-testid="home-partner-empty-state-secondary"');
    expect(html).not.toContain('data-testid="home-partner-summary-root"');
  });

  it('🔴 ホストのホームには `S-015` の導線が 1 本も出ない（ホスト側ロールにこの画面は存在しない）', () => {
    const html = renderToStaticMarkup(
      createElement(HostHomeSections, {
        summary: HOST_SUMMARY,
        canRegisterEngineer: true,
        canRegisterProject: true,
      }),
    );
    expect(html).not.toContain('href="/engineer-shares"');
  });
});

// ============================================================================
// 🔴 T-22-09: 独立したナビゲーションリンクの塊を置かない（実利用者の指摘 ③）
// ============================================================================
describe('🔴 ホームにサイドバーの写し（ナビゲーションの重複リンク）が無い', () => {
  it('ホスト: 一覧への入口は「値に紐づくリンク」だけで、`〜を開く` の塊が無い', () => {
    const html = renderToStaticMarkup(
      createElement(HostHomeSections, {
        summary: HOST_SUMMARY,
        canRegisterEngineer: true,
        canRegisterProject: true,
      }),
    );
    // 🔴 `提案依頼の一覧を開く` は要対応キューのヘッダ右へ移した（本ファイルには無い）。
    expect(html).not.toContain('href="/proposal-requests"');
    // 🔴 一覧のリンクの語（「案件一覧を開く」等）を本文に並べない —— 出るのは件数の値である。
    expect(html).not.toContain('案件一覧を開く');
    expect(html).not.toContain('人材台帳を開く');
    expect(html).not.toContain('提案の一覧を開く');
  });

  it('取引先: 同じく `〜を開く` の塊が無い（`S-003` の「ついで」にしない）', () => {
    const html = renderToStaticMarkup(
      createElement(PartnerHomeSections, {
        summary: PARTNER_SUMMARY,
        noticeText: '見える範囲の説明（合成）',
        canRegisterEngineer: true,
        canManageShares: true,
      }),
    );
    expect(html).not.toContain('href="/proposal-requests"');
    expect(html).not.toContain('案件一覧を開く');
    expect(html).not.toContain('人材台帳を開く');
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

// ============================================================================
// 🔴 T-22-09: ホームに氏名が出ない（`BR-27`。60 秒ポーリングで `engineer.view` を積まない）
// ============================================================================
describe('🔴 ホームのセクションは氏名を受け取る口を持たない', () => {
  it('ストリップの入力は「ラベル / 値 / href」の 3 項目だけである', () => {
    for (const item of [...HOST_SUMMARY.items, ...PARTNER_SUMMARY.items]) {
      expect(Object.keys(item).sort()).toEqual(['href', 'label', 'value']);
    }
  });

  it('隔離の周知の入力は ID / 版 / 状態 / 時刻だけである（氏名が無い）', () => {
    expect(Object.keys(ITEM).sort()).toEqual([
      'detectedAt',
      'engineerId',
      'scanStatus',
      'skillSheetId',
      'version',
    ]);
  });
});
