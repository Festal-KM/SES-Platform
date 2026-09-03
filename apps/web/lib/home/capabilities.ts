// apps/web/lib/home/capabilities.ts
// `GET /api/me` の `capabilities`（docs/05 §6.3 #8）。T-03-06。
//
// 🔴 判定材料は `role` のみ（`BR-31` / `F-004 AC-6` / `F-006 AC-3`）。VIEWER は承認・送信・
//    ダウンロード・エクスポートのいずれも実行できない。API 側の拒否（`requireNotViewer`）は
//    `apps/web/lib/api/guards.ts` が担うため、ここは UI 判定用の反映にとどまる
//    （UI で隠しても API 直叩きは別途拒否される。`docs/05` §6.2）。
import type { TenantRole } from '@ses/db';
import type { MainCapabilities } from './types';

export function deriveMainCapabilities(role: TenantRole): MainCapabilities {
  const allowed = role !== 'VIEWER';
  return {
    execute: { approve: allowed, submit: allowed, download: allowed, export: allowed },
  };
}
