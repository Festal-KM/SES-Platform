// packages/db/src/platform-client.ts
// 🔴 管理平面の接続プール（docs/03 §4.3.3「主平面と管理平面で別の接続プール・別の Prisma
//    インスタンス」/ docs/05 §4.2）。**主平面の `configureTenantDb` とは別の PrismaClient** である。
//
// 🔴 T-03-08: 管理平面は **2 本の接続プール**を持つ（docs/05 §4.2 の表）。
//   - `app_platform`（`PLATFORM_DATABASE_URL`）… 読み取り専用。`withPlatformRead` /（Phase 2）
//     `withImpersonation`。業務テーブルへの `INSERT/UPDATE/DELETE` を 1 つも持たない
//     （唯一の例外は `audit_logs` の `INSERT`。§5.3 の「監査を先に書く」を同一トランザクションで
//      成立させるために要る。migration 20260904010000 §3）
//   - `app_platform_write`（`PLATFORM_WRITE_DATABASE_URL`）… `withPlatformWrite` と運営者認証経路
//
// 🔴 主平面（`client.ts` の `configureTenantDb`）とは別インスタンス・別ロールである。
//    読み書きを 1 本のプールに混ぜない ——「読み取り専用は DB 権限で担保する」（§5.2）が、
//    同じ接続を使い回すと成立しない。
//
// 🔴 ここで `process.env` を読まない（環境変数の検証は packages/config の責務。CLAUDE.md §3.5）。
import { PrismaClient } from '@prisma/client';

export type PlatformReadDbOptions = {
  /** `app_platform` ロールの接続文字列（docs/05 §4.2）。 */
  readonly datasourceUrl: string;
};

let platformReadClient: PrismaClient | undefined;

/** 起動時に 1 度だけ呼ぶ。2 度目以降は前のクライアントを切断してから差し替える。 */
export function configurePlatformReadDb(options: PlatformReadDbOptions): void {
  const previous = platformReadClient;
  platformReadClient = new PrismaClient({ datasourceUrl: options.datasourceUrl });
  if (previous) void previous.$disconnect();
}

/** @internal packages/db の内部からのみ使う。 */
export function getPlatformReadClient(): PrismaClient {
  if (!platformReadClient) {
    throw new Error(
      'configurePlatformReadDb() が呼ばれていません。起動時に packages/config の PLATFORM_DATABASE_URL で 1 度だけ初期化してください。',
    );
  }
  return platformReadClient;
}

export async function disconnectPlatformReadDb(): Promise<void> {
  const client = platformReadClient;
  platformReadClient = undefined;
  if (client) await client.$disconnect();
}

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
