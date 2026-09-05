// packages/connectors/src/email/delivery-mode.ts
// 🔴 「その 1 通は実際に外部へ出たのか、モックで終わったのか」を判定する（docs/05 §13.2 / §9.7）。
//
// なぜ必要か: `EmailDispatch.status` は `SENT`（実送信）と `MOCKED`（疑似送信）を区別する。
// `tenant.purge-scan` は「削除予告が**配送済み**か」をこの状態で判定しており（docs/05 §9.7 /
// `F-064 AC-10`）、🔴 **`MOCKED` を配送済みとみなしてよいのは全モック環境だけ**である。
// 記録を取り違えると、予告が届いていないテナントのデータを削除しうる。
//
// 🔴 これは「リクエストごとの `APP_ENV` 分岐」ではない。引数の `kind` は
//    `resolveConnectorSelection` が**起動時に 1 回**決めた実装種別であり、
//    ここは `APP_ENV` も `process.env` も読まない（`CLAUDE.md` §11.1 / NFR-ENV-2）。
//
// 🔴 判定式は `SandboxRecipientScopedEmailSender.senderFor` と**同じ根拠**（宛先分類）に依る。
//    ずれると「モックへ流したのに SENT と記録する」（またはその逆）が起きる。
//    一致は `packages/connectors/src/email/delivery-mode.test.ts` が固定する。

import { isHostOrPlatformRecipientClass } from '@ses/domain';
import type { ConnectorImplementationKind, RecipientClass } from '../types.js';

/**
 * その宛先分類への送信がモックで終わるか。
 *
 * - `mock`（`development` / `demo`）: 全分類がモック
 * - `real`（`staging` / `production`）: 全分類が実送信
 * - `sandboxRecipientScoped`（`sandbox`）: 分類 1 / 分類外だけ実送信、分類 2 / 3 / 4 はモック
 */
export function isMockedDelivery(
  kind: ConnectorImplementationKind,
  recipientClass: RecipientClass,
): boolean {
  switch (kind) {
    case 'mock':
      return true;
    case 'real':
      return false;
    case 'sandboxRecipientScoped':
      return !isHostOrPlatformRecipientClass(recipientClass);
  }
}
