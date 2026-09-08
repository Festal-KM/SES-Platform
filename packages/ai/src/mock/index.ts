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
