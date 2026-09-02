// 違反: packages/connectors が packages/db に依存している（CLAUDE.md §2.1 ③）
import { withTenant } from '@ses/db';

export const use = () => withTenant;
