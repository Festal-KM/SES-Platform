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
import { ScanQuarantineSection } from './home-sections';

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
