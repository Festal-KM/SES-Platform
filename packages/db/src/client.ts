// packages/db/src/client.ts
// 🔴 生 PrismaClient を生成してよい唯一の場所（CLAUDE.md §3.1 / docs/05 §2.2）。
//    ここから外へ PrismaClient を export しない。アプリコードが触れるのは withTenant が
//    fn に渡すトランザクションクライアントだけである。
//
// 接続文字列は packages/config の DATABASE_URL を起動時の 1 箇所で渡す（docs/03 §4.3.3
// 「主平面と管理平面で別の接続プール・別の Prisma インスタンス」）。
// 🔴 ここで process.env を読まない（環境変数の検証は packages/config の責務。CLAUDE.md §3.5）。
import { PrismaClient } from '@prisma/client';

/** 発行された SQL 1 文の観測（🔴 SQL 本文だけ。パラメータ値は渡さない —— PII が観測側に流れる経路を作らない）。 */
export type TenantDbQueryEvent = {
  readonly query: string;
};

export type TenantDbOptions = {
  /** app_tenant ロールの接続文字列（docs/05 §4.2）。 */
  readonly datasourceUrl: string;
  /**
   * 発行された SQL を 1 文ごとに観測するフック（任意）。
   * 🔴 結合テストが「1 ページの DB 往復が行数に比例しない」ことを数えるためのもの（docs/05 §6.4「#10 の改訂」
   *    テスト (h)）。未指定なら Prisma のクエリイベントを有効化しない（本番の起動経路は従来どおり）。
   */
  readonly onQuery?: (event: TenantDbQueryEvent) => void;
};

let baseClient: PrismaClient | undefined;

/** 起動時に 1 度だけ呼ぶ。2 度目以降は前のクライアントを切断してから差し替える。 */
export function configureTenantDb(options: TenantDbOptions): void {
  const previous = baseClient;
  if (options.onQuery === undefined) {
    baseClient = new PrismaClient({ datasourceUrl: options.datasourceUrl });
  } else {
    const onQuery = options.onQuery;
    const observed = new PrismaClient({
      datasourceUrl: options.datasourceUrl,
      log: [{ emit: 'event', level: 'query' }],
    });
    observed.$on('query', (event) => onQuery({ query: event.query }));
    baseClient = observed;
  }
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
