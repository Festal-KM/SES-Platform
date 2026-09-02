// 違反: packages/domain は何にも依存しない（CLAUDE.md §2.1）。@ses/* の import は禁止。
import { withTenant } from '@ses/db';

export function useIt() {
  return withTenant;
}
