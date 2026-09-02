// 違反: packages/db が packages/ai に依存している（CLAUDE.md §2.1 ③）
import { runRole } from '@ses/ai';

export const use = () => runRole;
