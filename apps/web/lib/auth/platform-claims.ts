// apps/web/lib/auth/platform-claims.ts
// 管理平面のセッション（JWT）が運ぶ主張の型（T-03-07 / `F-055`）。
//
// 🔴 主平面の `claims.ts` とは**別の型・別の JWT フィールド名・別の署名鍵**である。
//    片方の JWT をもう片方のインスタンスへ持ち込んでも、
//    ①署名鍵（`AUTH_SECRET` / `AUTH_PLATFORM_SECRET`）が違うため検証に失敗し、
//    ②仮に検証を通っても本ファイル / `claims.ts` のパーサがフィールド名の不一致で `null` を返す。
//    （`F-055 AC-2`「テナント利用者の認証情報で `/admin` に到達できず、逆も成立しない」）
//
// 🔴 セッションが運ぶのは**識別子だけ**である。ロール（`PLATFORM_OWNER` / `PLATFORM_SUPPORT`）は
//    載せない —— `loadPlatformUserFacts`（packages/db）がリクエストごとに DB から確定する。
//    載せると、ロール変更・無効化がセッションの有効期間ぶん遅れる。

/**
 * 管理平面のセッションが運ぶ主張。
 *
 * 🔴 `twoFactorVerified` だけは JWT に載せる（主平面と同じ理由）:
 *    「設定済みか」は DB の事実なので毎回引き直せるが、「**このセッションで**コードを入力したか」は
 *    セッションにしか存在しない事実であり DB から復元できない。
 * 🔴 未設定（`undefined`）は **false 扱い**（fail-closed）。
 */
export type PlatformSessionClaims = {
  readonly platformUserId: string;
  readonly twoFactorVerified?: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * 🔴 セッション更新（Auth.js の `trigger === 'update'`）で**受け付けてよい唯一の宣言**:
 *    「このセッションで 2 要素認証を検証した」。
 *
 * 🔴 主体（`platformUserId`）は更新経路では一切見ない。見てしまうと、セッション更新が
 *    **主体の乗り換え**になる。
 */
export function isPlatformTwoFactorVerifiedUpdate(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const claims = (payload as { platformClaims?: unknown }).platformClaims;
  if (typeof claims !== 'object' || claims === null) return false;
  return (claims as { twoFactorVerified?: unknown }).twoFactorVerified === true;
}

/**
 * JWT のペイロード（`unknown`）から主張を取り出す。
 * 🔴 fail-closed: 形が違えば `null`（部分的に読めた値で続行しない）。
 * 🔴 主平面の JWT（`userId` / `tenantId` を持つ）は `platformUserId` を持たないため `null` になる。
 */
export function parsePlatformSessionClaims(payload: unknown): PlatformSessionClaims | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const platformUserId = record['platformUserId'];
  if (!isUuid(platformUserId)) return null;
  return {
    platformUserId,
    // 🔴 `=== true` 以外はすべて未検証（fail-closed）。
    twoFactorVerified: record['platformTwoFactorVerified'] === true,
  };
}
