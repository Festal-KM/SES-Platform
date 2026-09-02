// 違反: packages/db が packages/ai のサブパスに依存している（CLAUDE.md §2.1 ③）
// docs/05 は packages/ai/src/run.ts を実行系の唯一の export としており、
// サブパス import は完全一致の禁止だけでは素通りする。
import { runRole } from '@ses/ai/run';

export const use = () => runRole;
