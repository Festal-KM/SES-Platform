// 違反: @prisma/client を packages/db 内部以外で直接 import している（CLAUDE.md §3.1 / docs/05 §4.3）
import { PrismaClient } from '@prisma/client';

export const use = () => new PrismaClient();
