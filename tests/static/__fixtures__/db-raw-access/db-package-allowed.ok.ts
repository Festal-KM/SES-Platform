// 対照: packages/db 内部だけが @prisma/client の直接 import と $queryRaw / $executeRaw の
// 直接呼び出しを行える（CLAUDE.md §3.1 / docs/05 §4.3）。
import { PrismaClient, Prisma } from '@prisma/client';

export async function run(client: PrismaClient) {
  await client.$queryRaw(Prisma.sql`SELECT 1`);
  await client.$executeRaw`SELECT 1`;
  return client;
}
