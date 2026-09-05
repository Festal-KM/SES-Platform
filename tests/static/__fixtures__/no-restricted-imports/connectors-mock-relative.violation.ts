// 違反 fixture: packages/connectors 内部からモック実装を相対 import する
// （index.ts 以外は禁止。docs/05 §13.1）。
import { MockEmailSender } from './mock/email.js';

export const use = MockEmailSender;
