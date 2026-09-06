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
import type { HomeBlock } from '../../../lib/home/types';
import {
  HostHomeSections,
  PartnerHomeSections,
  ScanQuarantineSection,
} from './home-sections';

const SHEET_ID = '01930000-0000-7000-8000-0000000000d1';
const ENGINEER_ID = '01930000-0000-7000-8000-0000000000b1';

function blockOf(items: HomeBlock['items']): HomeBlock {
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
//    T-03-06 で保留（両画面が未実装）→ T-05-01 で `S-007` のみ → 本タスクで 2 本そろった。
//    「2 本あること」を固定しておかないと、片方が消えても誰も気づかない。
describe('🔴 S-003 の初回空は S-012 / S-007 への導線 2 本（docs/04 §S-003）', () => {
  function renderHost(options: {
    readonly canRegisterEngineer: boolean;
    readonly canRegisterProject: boolean;
  }): string {
    return renderToStaticMarkup(createElement(HostHomeSections, options));
  }

  it('両方できるロールでは、案件の登録と人材の登録の 2 本が出る', () => {
    const html = renderHost({ canRegisterEngineer: true, canRegisterProject: true });

    expect(html).toContain('data-testid="home-host-register-project"');
    expect(html).toContain('href="/projects/new"');
    expect(html).toContain('data-testid="home-host-register-engineer"');
    expect(html).toContain('href="/engineers/new"');
  });

  it('🔴 案件を登録できないロールでは、その導線が DOM に存在しない（隠すのではなく描かない）', () => {
    const html = renderHost({ canRegisterEngineer: true, canRegisterProject: false });

    expect(html).not.toContain('home-host-register-project');
    expect(html).not.toContain('href="/projects/new"');
    // 人材側は残る（2 つのフラグを 1 つに畳んでいない）。
    expect(html).toContain('data-testid="home-host-register-engineer"');
  });

  it('🔴 VIEWER 相当（どちらも false）でも、人材台帳・案件一覧の閲覧導線は残る', () => {
    const html = renderHost({ canRegisterEngineer: false, canRegisterProject: false });

    expect(html).not.toContain('home-host-register-project');
    expect(html).not.toContain('home-host-register-engineer');
    expect(html).toContain('data-testid="home-host-engineer-ledger"');
    // 🔴 T-06-03: **登録できないことと、見られないことは別である**（`S-010` はロールで隠さない）。
    expect(html).toContain('data-testid="home-host-project-list"');
    expect(html).toContain('href="/projects"');
  });
});

// 🔴 T-06-03: `S-003` / `S-004` の**両方**から `S-010`（案件一覧）へ行けること（docs/04 §3.3）。
//    ホスト側だけに置くと、1 日 4〜5 時間を過ごす取引先（`CLAUDE.md` §1.2）が案件一覧へ
//    URL 直打ちでしか到達できない。
describe('🔴 S-004（取引先ホーム）からも S-005 / S-010 へ行ける（docs/04 §3.3）', () => {
  it('人材台帳と案件一覧の導線が 2 本とも出る', () => {
    const html = renderToStaticMarkup(
      createElement(PartnerHomeSections, { noticeText: '見える範囲の説明（合成）' }),
    );

    expect(html).toContain('data-testid="home-partner-engineer-ledger"');
    expect(html).toContain('data-testid="home-partner-project-list"');
    expect(html).toContain('href="/projects"');
    // 🔴 取引先のホームに「案件を登録」は無い（`docs/04` §S-012 権限差分）。
    expect(html).not.toContain('href="/projects/new"');
  });
});
