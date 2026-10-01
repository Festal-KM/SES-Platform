// apps/web/lib/home/capabilities.ts
// `GET /api/me` の `capabilities`（docs/05 §6.3 #8）。T-03-06。
//
// 🔴 判定材料は `role` のみ（`BR-31` / `F-004 AC-6` / `F-006 AC-3`）。VIEWER は承認・送信・
//    ダウンロード・エクスポートのいずれも実行できない。API 側の拒否（`requireNotViewer`）は
//    `apps/web/lib/api/guards.ts` が担うため、ここは UI 判定用の反映にとどまる
//    （UI で隠しても API 直叩きは別途拒否される。`docs/05` §6.2）。
import type { TenantRole } from '@ses/db';
import type { MainCapabilities } from './types';

// ⚠️ 申し送り（F9）: `role !== 'VIEWER'` の 1 行なので、`T-16-12` が `PARTNER_VIEWER` を `TENANT_ROLES` に入れた時点で
//    `RESPOND` が `PARTNER_VIEWER` に有効と判定される（§10.1 は提案の作成・チャット投稿も不可と定める）。
//    `lib/shell/page-trail.ts` は既に `endsWith('VIEWER')` で判定しており 2 つの UI ロール表が食い違う。
//    🔴 `T-16-12` 着手時に本関数を単一出所として直すこと（要対応キューの `操作` 列がこれを引いている）。
export function deriveMainCapabilities(role: TenantRole): MainCapabilities {
  const allowed = role !== 'VIEWER';
  return {
    execute: { approve: allowed, submit: allowed, download: allowed, export: allowed },
  };
}
