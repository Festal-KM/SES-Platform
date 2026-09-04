// 正常系: 管理平面（apps/web/app/admin/** / apps/web/app/api/admin/**）からの
// @ses/db/platform の import は許可される（T-03-08）。
import { withPlatformRead } from '@ses/db/platform';

export const use = withPlatformRead;
