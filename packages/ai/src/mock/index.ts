// packages/ai/src/mock/index.ts
// 🔴 モック実装への到達経路は `packages/ai/src/index.ts` の `createAiClient` だけである
//    （`packages/connectors` のモックと同じ規律。docs/05 §13.1）。バレルから
//    `MockAnthropicClient` を re-export しない —— 業務コードが「この環境ならモック」という
//    分岐を書けてしまうため。
export {
  MockAnthropicClient,
  MockAnthropicNotConfiguredError,
  type MockAnthropicClientOptions,
  type MockAnthropicStep,
} from './anthropic.js';
// 🔴 T-07-11: `demo` の既定応答（Issue #44 の回答 ①）。**データだけ**を出す ——
//    「どの環境でこれを使うか」の判断は起動時の配線（`apps/worker/src/runtime.ts` の
//    `resolveMockAiOptions`）1 箇所にあり、`packages/ai` は `APP_ENV` を知らない。
export { DEMO_GATE_INSPECTOR_PASS_STEP, DEMO_MOCK_ANTHROPIC_SCRIPT } from './demo-script.js';
