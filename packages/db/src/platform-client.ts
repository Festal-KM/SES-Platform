// packages/db/src/platform-client.ts
// 🔴 管理平面の接続プール（docs/03 §4.3.3「主平面と管理平面で別の接続プール・別の Prisma
//    インスタンス」/ docs/05 §4.2）。**主平面の `configureTenantDb` とは別の PrismaClient** である。
//
// T-03-07（運営者認証）が必要とするのは `app_platform_write`（`PLATFORM_WRITE_DATABASE_URL`）の
// 1 本だけである。読み取り専用の `app_platform`（`PLATFORM_DATABASE_URL`）を使う
// `withPlatformRead` / `withImpersonation` は **T-03-08** の範囲であり、その client も本ファイルに
// 足す（接続プールの生成箇所を 1 ファイルに保つ）。
//
// 🔴 ここで `process.env` を読まない（環境変数の検証は packages/config の責務。CLAUDE.md §3.5）。
import { PrismaClient } from '@prisma/client';

export type PlatformWriteDbOptions = {
  /** `app_platform_write` ロールの接続文字列（docs/05 §4.2）。 */
  readonly datasourceUrl: string;
};

let platformWriteClient: PrismaClient | undefined;

/** 起動時に 1 度だけ呼ぶ。2 度目以降は前のクライアントを切断してから差し替える。 */
export function configurePlatformWriteDb(options: PlatformWriteDbOptions): void {
  const previous = platformWriteClient;
  platformWriteClient = new PrismaClient({ datasourceUrl: options.datasourceUrl });
  if (previous) void previous.$disconnect();
}

/** @internal packages/db の内部からのみ使う。 */
export function getPlatformWriteClient(): PrismaClient {
  if (!platformWriteClient) {
    throw new Error(
      'configurePlatformWriteDb() が呼ばれていません。起動時に packages/config の PLATFORM_WRITE_DATABASE_URL で 1 度だけ初期化してください。',
    );
  }
  return platformWriteClient;
}

export async function disconnectPlatformWriteDb(): Promise<void> {
  const client = platformWriteClient;
  platformWriteClient = undefined;
  if (client) await client.$disconnect();
}
