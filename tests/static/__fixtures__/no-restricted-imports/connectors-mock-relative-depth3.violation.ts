// 違反 fixture: 3 階層下（例: packages/connectors/src/esign/docusign/oauth.ts）からの相対 import。
import { MockEsignProvider } from '../../mock/esign.js';

export const use = MockEsignProvider;
