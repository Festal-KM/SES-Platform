// 違反: 主平面のコードが @ses/db/platform（withPlatformRead / withPlatformWrite）を import している
// （CLAUDE.md §10.5 / docs/05 §5.2 / docs/03 program-design 申し送り 2。T-03-08）。
// 🔴 テナント分離を越える経路は管理平面（apps/web/app/admin/** と apps/web/app/api/admin/**）だけに置く。
import { withPlatformRead } from '@ses/db/platform';

export const use = withPlatformRead;
