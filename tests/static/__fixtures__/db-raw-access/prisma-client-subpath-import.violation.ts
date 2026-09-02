// 違反: @prisma/client のサブパスの直接 import も禁止対象である（CLAUDE.md §3.1 / docs/05 §4.3）
import type { Sql } from '@prisma/client/runtime/library';

export const use = (sql: Sql) => sql;
