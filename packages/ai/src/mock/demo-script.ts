// packages/ai/src/mock/demo-script.ts
// 🔴 `demo` 環境で `MockAnthropicClient` が返す既定応答（docs/05 §13.2）。T-07-11。
//
// ============================================================================
// 🔴 これは Issue #44（`Q-07-2`）で人間が決めた事項である（2026-09-10。回答 ①）
// ============================================================================
//   - **`demo` は常時 PASS**（営業が実演する環境で、ゲートに到達したジョブが必ず失敗するのを避ける）
//   - 🔴 **`development` には既定応答を置かない**（`MockAnthropicNotConfiguredError` のまま）。
//     「ゲートが実質的に無効な環境」を最小限に留めるのがこの選択の趣旨であり、
//     `development` でゲートを試す人は `createAiClient('mock', { script: [...] })` に
//     応答を明示する運用にする。**ここに `development` の枝を足さないこと。**
//
// 🔴 `demo` は**合成データしか入らない**環境である（`CLAUDE.md` §11）。実在の取引先の情報が
//    無いので「常時 PASS」で漏洩は起きない。逆に `sandbox` 以上は `ai: 'real'` であり、
//    この既定応答が使われる経路そのものが無い（`resolveConnectorSelection`）。

import type { MockAnthropicStep } from './anthropic.js';

/**
 * 🔴 `gate-inspector` の「全層 PASS」応答（`packages/ai/src/roles/gate-inspector.ts` の出力スキーマ）。
 *
 * 🔴 **`consistencyWarnings` も空にする。** 警告は合否を変えないが、実演のたびに根拠の無い
 *    警告が承認画面に出ると「ゲートの指摘は読まなくてよい」という誤った印象を与える。
 * ⚠️ Phase 1 で `demo` から実行されうる AI ロールは `gate-inspector` だけである
 *    （`sheet-parser` 以降は Phase 2）。ロールが増えたら、そのロールの応答をここに足す前に
 *    **どの環境で何を返すのが正しいか**を Issue #44 と同じ枠組みで決めること
 *    （`MockAnthropicClient` はスクリプトを呼び出し順に消費し、尽きたら最後の 1 つを繰り返す）。
 */
export const DEMO_GATE_INSPECTOR_PASS_STEP: MockAnthropicStep = {
  kind: 'output',
  output: {
    pii: { verdict: 'PASS', findings: [] },
    commerce: { verdict: 'PASS', findings: [] },
    consistencyWarnings: [],
  },
};

/** `demo` の既定スクリプト（1 手。尽きたら最後の 1 つが繰り返される）。 */
export const DEMO_MOCK_ANTHROPIC_SCRIPT: readonly MockAnthropicStep[] = [
  DEMO_GATE_INSPECTOR_PASS_STEP,
];
