// apps/web/lib/auth/claims.ts
// セッション（JWT）が運ぶ主張の型。
//
// 🔴 セッションが運ぶのは **識別子だけ**である（テナント / パートナー所属 / 利用者）。
//    ロールとテナントのライフサイクル状態を**焼き込まない**:
//      ① 権限変更・`Membership` の失効・ライフサイクル遷移が、セッションの有効期間ぶん遅れる
//      ② JWT の中身がそのまま権限になる設計は、署名が破られた場合の被害が権限昇格まで及ぶ
//    これらは `loadTenantMembership`（packages/db）がリクエストごとに DB から確定させる。
//
// 🔴 `tenantId` / `partnerCompanyId` の出所は `withAuthLookup` が返した `users` 行であり、
//    リクエスト入力ではない（CLAUDE.md §3.1 / BR-03 / F-003 AC-1）。
import type { TenantIdentity } from '@ses/db';

/** 主平面のセッションが運ぶ主張。`TenantIdentity`（packages/db）と同じ 3 キー。 */
export type TenantSessionClaims = TenantIdentity;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * JWT のペイロード（`unknown`）から主張を取り出す。
 * 🔴 fail-closed: 形が違えば `null`（部分的に読めた値で続行しない）。
 */
export function parseTenantSessionClaims(payload: unknown): TenantSessionClaims | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const tenantId = record['tenantId'];
  const userId = record['userId'];
  const partnerCompanyId = record['partnerCompanyId'] ?? null;
  if (!isUuid(tenantId) || !isUuid(userId)) return null;
  if (partnerCompanyId !== null && !isUuid(partnerCompanyId)) return null;
  return { tenantId, userId, partnerCompanyId };
}
