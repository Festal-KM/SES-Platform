// packages/connectors/src/mock/index.ts
// 🔴 モック実装の唯一の入口。**`packages/connectors/src/index.ts` 以外から import しない**
//    （docs/05 §13.1 / §2.2 の表）。モックを直接 import できると、業務コードの中に
//    「この環境ならモック」というリクエストごとの分岐が書けてしまい、
//    差し替えの判断が起動時 1 箇所（`resolveConnectorSelection`）に閉じているという前提が壊れる。

export { MockEmailSender, redactEmailAddress, type MockEmailCall, type MockEmailSink, type MockEmailSenderOptions } from './email.js';
export { MockObjectStore, type MockObjectStoreOptions } from './object-store.js';
export { MockMalwareScanner, type MockMalwareScannerOptions } from './scanner.js';
export {
  MockEsignProvider,
  mockWebhookSignature,
  MOCK_AUTHORIZE_BASE_URL,
  MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX,
  type MockEsignProviderOptions,
} from './esign.js';
export { MockBillingProvider, type MockMeterEventRecord } from './billing.js';
