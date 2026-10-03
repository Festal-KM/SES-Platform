// apps/web/lib/proposals/gate-layer-badge.test.ts
// 🔴 ゲートの層バッジの見え方（`docs/04` §5-3 / **`docs/05` §6.5 の `S-021` の行** /
//    `docs/02` `ui-design` 申し送り 5 / `CLAUDE.md` §3.3 / `F-027 AC-5`）。
//    SP-22 段④。**着手時は 3 画面が別々の写像を持ち、`RUNNING` の色が画面によって違っていた。**
import { describe, expect, it } from 'vitest';
import type { GateLayerState } from '@ses/domain';
import { GATE_LAYER_BADGE_APPEARANCE, gateLayerBadgeAppearance } from './gate-layer-badge';

/** 🔴 `GateLayerState` の 4 値（`packages/domain/src/gate/view.ts`）。型と実体の一致を固定する。 */
const ALL_STATES: readonly GateLayerState[] = ['RUNNING', 'PASS', 'FAIL', 'HELD'];

describe('🔴 docs/04 §5-3: 層バッジの見え方は 1 箇所で決まる', () => {
  it('4 状態ちょうどを持つ（漏れがあると UI で状況が読めなくなる）', () => {
    expect(Object.keys(GATE_LAYER_BADGE_APPEARANCE).sort()).toEqual([...ALL_STATES].sort());
    for (const state of ALL_STATES) expect(gateLayerBadgeAppearance(state)).toBeDefined();
  });

  it('🔴 `HELD`（AI の上限で停止）は `RUNNING`（検査中）と同じ見え方 —— FAIL ではない（`F-027 AC-5`）', () => {
    // 色を変えると `GATE_FAILED`（直すべき元データがある）と読み違え、ゲート FAIL 率の監視も汚れる。
    expect(gateLayerBadgeAppearance('HELD')).toEqual(gateLayerBadgeAppearance('RUNNING'));
    expect(gateLayerBadgeAppearance('HELD')).not.toEqual(gateLayerBadgeAppearance('FAIL'));
  });

  it('🔴 `PASS` / `FAIL` / 進行中が互いに別の色である（同じ色・同じ形で並べない。§5-3）', () => {
    const pass = gateLayerBadgeAppearance('PASS');
    const fail = gateLayerBadgeAppearance('FAIL');
    const running = gateLayerBadgeAppearance('RUNNING');
    expect(new Set([pass.variant, fail.variant, running.variant]).size).toBe(3);
    expect(pass.variant).toBe('success');
    // 🔴 `docs/05` §6.5 の `S-021` の行: 「ゲートの指摘（**FAIL = 赤**）と整合層の警告（琥珀の別リスト）」。
    //    ⚠️ **`docs/04` §S-020 / §S-021 ③ ではない**（`docs/04` に色の条文は無い。2026-10-03 のレビュー指摘）。
    expect(fail.variant).toBe('danger');
  });

  it('🔴 進行中・保留は点線枠である（§5-1「点線枠 = 進行中・保留」）', () => {
    expect(gateLayerBadgeAppearance('RUNNING').shape).toBe('dashed');
    expect(gateLayerBadgeAppearance('HELD').shape).toBe('dashed');
    expect(gateLayerBadgeAppearance('PASS').shape).toBe('solid');
    expect(gateLayerBadgeAppearance('FAIL').shape).toBe('solid');
  });

  it('🔴 `WARN`（AI の警告）という層の状態を持たない —— 警告で層を落とさない（§3.3 第 3 層）', () => {
    expect(Object.keys(GATE_LAYER_BADGE_APPEARANCE)).not.toContain('WARN');
    expect(Object.keys(GATE_LAYER_BADGE_APPEARANCE)).not.toContain('WARNING');
  });
});
