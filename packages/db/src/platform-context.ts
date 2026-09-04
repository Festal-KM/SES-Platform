// packages/db/src/platform-context.ts
// 🔴 `AuthenticatedPlatformCtx` の生成器はここだけ（`context.ts` の `resolveTenantCtx` と対）。
//    T-03-07（`F-055` / `A-001`）。
//
// 🔴 主平面の `AuthenticatedTenantCtx` とは**別の型**である。相互に代入できないため、
//    「テナントの ctx で管理平面のクエリを実行する」「運営者の ctx で `withTenant` を呼ぶ」の
//    いずれもコンパイルで落ちる（`F-055 AC-2` の型による担保）。
//
// 🔴 2 要素認証のゲートはここに置く（docs/05 §5.1 / §6.2 と同じ方針。middleware ではない）。
//    Edge の middleware は DB を読めないため、そこに境界の強制を置かない。middleware（T-03-08）が
//    担うのは画面遷移（302）だけである。
import type { DeviceKind, RequestMeta, TwoFactorSessionState } from './context.js';
import { TwoFactorRequiredError } from './context.js';
import type { PlatformRole } from './schema-value-sets.js';

declare const PlatformCtxBrand: unique symbol;
declare const PlatformOwnerBrand: unique symbol;

/**
 * 認証済みの運営者文脈。
 * 🔴 ブランドプロパティは外部から書けないため、`resolvePlatformCtx` 以外がこの型の値を
 *    構築できない。T-03-08 の `withPlatformRead` / `withPlatformWrite` はこの型を起点にする。
 */
export type AuthenticatedPlatformCtx = {
  readonly platformUserId: string;
  readonly platformRole: PlatformRole;
  readonly deviceKind: DeviceKind;
  readonly [PlatformCtxBrand]: true;
};

/**
 * 管理平面の認証済みセッション。
 * 🔴 `platformRole` は**セッションではなく DB から確定した値**を渡す
 *    （`loadPlatformUserFacts`）。JWT に書かれたロールを信じない。
 */
export type PlatformSession = {
  readonly platformUserId: string;
  readonly platformRole: PlatformRole;
  /**
   * 🔴 2 要素認証の状態（`F-055 AC-3`）。**必須フィールドである。**
   *    省略できると「渡し忘れた経路だけ 2FA を素通りする」ことが起こりうる。
   */
  readonly twoFactor: TwoFactorSessionState;
};

/**
 * 🔴 運営者の 2FA ゲート（`F-055 AC-3` / `CLAUDE.md` §3.5「運営者は必須」）。
 *
 * 主平面（`OWNER` / `ADMIN` のみ必須）と違い、**ロールによる例外が無い**。
 * したがってロール引数を取らない —— 取れるようにすると「このロールだけ免除」を書けてしまう。
 */
function assertPlatformTwoFactorSatisfied(state: TwoFactorSessionState): void {
  if (state === 'NOT_ENROLLED') throw new TwoFactorRequiredError('SETUP_REQUIRED');
  if (state === 'ENROLLED_UNVERIFIED') throw new TwoFactorRequiredError('VERIFICATION_REQUIRED');
}

/**
 * 🔴 `AuthenticatedPlatformCtx` の唯一の生成経路。
 *
 * 2FA が未充足なら `TwoFactorRequiredError` を投げ、**ctx を生成しない**。
 * 管理平面のクエリ経路（T-03-08）は ctx を要求するため、
 * **2FA を設定するまで管理平面のいずれの画面・API にも到達できない**（`F-055 AC-3`）。
 */
export async function resolvePlatformCtx(
  session: PlatformSession,
  req: RequestMeta,
): Promise<AuthenticatedPlatformCtx> {
  assertPlatformTwoFactorSatisfied(session.twoFactor);
  return {
    platformUserId: session.platformUserId,
    platformRole: session.platformRole,
    deviceKind: req.deviceKind,
  } as AuthenticatedPlatformCtx;
}

/**
 * 🔴 `PLATFORM_OWNER` であることが**型で**保証された ctx（`HostTenantCtx` と同じ仕掛け）。
 *
 * docs/02 章 4.4 / `BR-44` / `F-001` の `PP` = `−`: テナントの開設・停止・解約・プラン変更は
 * `PLATFORM_OWNER` だけが行える。**`PLATFORM_SUPPORT` は監視・調査・サポートのみ**である
 * （`CLAUDE.md` §10.1）。
 *
 * この型を引数に要求する関数（API-A4 / A5 の実装）は、`requirePlatformOwner` を通さない
 * `AuthenticatedPlatformCtx` を渡された時点でコンパイルが落ちる。
 */
export type PlatformOwnerCtx = AuthenticatedPlatformCtx & {
  readonly platformRole: 'PLATFORM_OWNER';
  readonly [PlatformOwnerBrand]: true;
};

/**
 * 🔴 `PLATFORM_SUPPORT` が `PLATFORM_OWNER` 専用の操作を要求した（`CLAUDE.md` §10.1 / `BR-44`）。
 *
 * API 境界では **403** に写像する（docs/02 章 5.4 の「`PLATFORM_SUPPORT` の要求は 403」）。
 * 🔴 404 に畳まない: 運営者は対象テナントの存在をすでに一覧（`A-002`）で見られる立場であり、
 *    隠すべき情報が無い。逆に 404 にすると「権限が足りない」ことが伝わらず、
 *    `PLATFORM_OWNER` への依頼という次の行動に繋がらない。
 */
export class PlatformRoleNotAllowedError extends Error {
  constructor(readonly required: PlatformRole) {
    super(
      `この操作は ${required} のみが実行できます（CLAUDE.md §10.1 / BR-44）。` +
        'PLATFORM_SUPPORT は監視・調査・サポートに限られます。',
    );
    this.name = 'PlatformRoleNotAllowedError';
  }
}

/**
 * 🔴 `PlatformOwnerCtx` の唯一の生成経路（アサーション関数）。
 *    `PLATFORM_SUPPORT` なら `PlatformRoleNotAllowedError` を投げる。
 */
export function requirePlatformOwner(
  ctx: AuthenticatedPlatformCtx,
): asserts ctx is PlatformOwnerCtx {
  if (ctx.platformRole !== 'PLATFORM_OWNER') {
    throw new PlatformRoleNotAllowedError('PLATFORM_OWNER');
  }
}
