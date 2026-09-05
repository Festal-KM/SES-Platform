// 違反 fixture: モック実装をパッケージのサブパス経由で import する（docs/05 §13.1）。
import { MockEmailSender } from '@ses/connectors/mock';

export const use = MockEmailSender;
