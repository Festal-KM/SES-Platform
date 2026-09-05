// 違反 fixture: 2 階層下（例: packages/connectors/src/email/ses.ts）からモック実装を相対 import する。
import { MockEmailSender } from '../mock/email.js';

export const use = MockEmailSender;
