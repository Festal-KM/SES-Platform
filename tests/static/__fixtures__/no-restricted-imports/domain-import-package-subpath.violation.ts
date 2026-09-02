// 違反: packages/domain が他の @ses/* パッケージのサブパスに依存している（CLAUDE.md §2.1 ②）
// docs/05 §2.1 は packages/db/src/platform.ts を別 export として設計しており、
// サブパス import は完全一致の禁止だけでは素通りする。
import { platformQuery } from '@ses/db/platform';

export const run = () => platformQuery;
