// packages/db/src/client.ts
// 🔴 生 PrismaClient を生成してよい唯一の場所（CLAUDE.md §3.1 / docs/05 §2.2）。
//    ここから外へ PrismaClient を export しない。アプリコードが触れるのは withTenant が
//    fn に渡すトランザクションクライアントだけである。
//
// 接続文字列は packages/config の DATABASE_URL を起動時の 1 箇所で渡す（docs/03 §4.3.3
// 「主平面と管理平面で別の接続プール・別の Prisma インスタンス」）。
// 🔴 ここで process.env を読まない（環境変数の検証は packages/config の責務。CLAUDE.md §3.5）。
import { PrismaClient } from '@prisma/client';

export type TenantDbOptions = {
  /** app_tenant ロールの接続文字列（docs/05 §4.2）。 */
  readonly datasourceUrl: string;
};

let baseClient: PrismaClient | undefined;

/** 起動時に 1 度だけ呼ぶ。2 度目以降は前のクライアントを切断してから差し替える。 */
export function configureTenantDb(options: TenantDbOptions): void {
  const previous = baseClient;
  baseClient = new PrismaClient({ datasourceUrl: options.datasourceUrl });
  if (previous) void previous.$disconnect();
}

/** @internal packages/db の内部からのみ使う。 */
export function getBaseClient(): PrismaClient {
  if (!baseClient) {
    throw new Error(
      'configureTenantDb() が呼ばれていません。起動時に packages/config の DATABASE_URL で 1 度だけ初期化してください。',
    );
  }
  return baseClient;
}

export async function disconnectTenantDb(): Promise<void> {
  const client = baseClient;
  baseClient = undefined;
  if (client) await client.$disconnect();
}
