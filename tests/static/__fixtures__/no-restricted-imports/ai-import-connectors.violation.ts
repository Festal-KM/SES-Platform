// 違反: packages/ai が packages/connectors に依存している（CLAUDE.md §2.1 ③）
import { createConnectors } from '@ses/connectors';

export const use = () => createConnectors;
