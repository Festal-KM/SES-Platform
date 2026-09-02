// 違反: packages/domain が他の @ses/* パッケージに依存している（CLAUDE.md §2.1 ②）
import { withTenant } from '@ses/db';

export const run = () => withTenant();
