// apps/web/lib/middleware/planes.ts
// 🔴 主平面 (`/`) と管理平面 (`/admin`) のミドルウェアを**呼び分ける**判定（docs/05 §5.1 /
//    `CLAUDE.md` §10.5「管理平面は別ルート (`/admin`) かつ別ミドルウェアで認可する」。T-03-08）。
//
// ============================================================================
// 🔴 ミドルウェアが担うのは「画面遷移（302）」だけである
// ============================================================================
// Edge ランタイムは DB を読めない。したがってここに**データ境界の強制を置かない**
// （docs/05 §6.2 / SP-03 T-03-02 の 🔴）。境界は次の 3 つが担う:
//   ① `resolveTenantCtx` / `resolvePlatformCtx`（2FA・無効化・ロールを DB で毎回確定する）
//   ② RLS + Prisma 拡張（`withTenant` / `withPlatformRead`）
//   ③ 別署名鍵 + fail-closed パーサ（`parseTenantSessionClaims` / `parsePlatformSessionClaims`）
// ここで見るのは **Cookie の有無だけ**であり、中身（JWT）を検証しない。検証できたとしても
// それを信じて境界を決めない ——「ミドルウェアを外したら守れなくなる」構造を作らないため。
//
// ============================================================================
// 🔴 docs/05 §5.1 の matcher に対する補正（`/api/admin/**`）
// ============================================================================
// §5.1 は matcher を `['/((?!admin).*)', '/admin/:path*']` と書き、「内部で `adminMiddleware` /
// `mainMiddleware` を呼び分ける」と定める。ところが**管理平面の API は §6.9 のとおり
// `/api/admin/**` にあり、`/admin` 配下ではない**。matcher の第 1 要素（先頭が `admin` で
// ない全パス）に該当するため、パスの接頭辞だけで機械的に振り分けると管理平面の API が
// 主平面のミドルウェアへ流れる。**呼び分けは `/admin` と `/api/admin` の 2 接頭辞で行う。**
// （T-03-07 が §5.1 の Cookie `path` を同じ理由で補正したのと同型の補正であり、
//  docs/05 §5.1 に注記を追記した。）

/** 🔴 管理平面に属するパスの接頭辞。画面（`/admin`）と API（`/api/admin`）の 2 つ。 */
export const ADMIN_PLANE_PATH_PREFIXES = ['/admin', '/api/admin'] as const;

/** 管理平面の未認証で到達してよい画面（`A-001`）。 */
const PUBLIC_ADMIN_PAGE_PATHS = ['/admin/signin'] as const;

/** 未認証の運営者を送る先（`A-001`）。 */
export const ADMIN_SIGNIN_PATH = '/admin/signin';

export type PlaneRequestView = {
  readonly pathname: string;
  /** 管理平面のセッション Cookie（`__Host-ses-admin.session`）が付いているか。 */
  readonly hasPlatformSessionCookie: boolean;
  /**
   * 主平面のセッション Cookie（`__Host-ses.session`）が付いているか。
   * 🔴 判定には使わない（下記 `adminMiddleware` の注記）。観測のためだけに型に持つ。
   */
  readonly hasTenantSessionCookie: boolean;
};

export type PlaneDecision =
  | { readonly kind: 'CONTINUE' }
  | { readonly kind: 'REDIRECT'; readonly location: string };

const CONTINUE: PlaneDecision = { kind: 'CONTINUE' };

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** 管理平面のパスか（`/admin` と `/api/admin`）。 */
export function isAdminPlanePath(pathname: string): boolean {
  return ADMIN_PLANE_PATH_PREFIXES.some((prefix) => isUnder(pathname, prefix));
}

/**
 * 管理平面のミドルウェア（`CLAUDE.md` §10.5「別ミドルウェア」）。
 *
 * 🔴 **主平面のセッションを一切受け付けない。** 判定は「管理平面の Cookie があるか」だけで行い、
 *    主平面の Cookie の有無で分岐しない。分岐を書くと「主平面の Cookie があるときだけ弾く」
 *    のような穴（＝ Cookie を捨てれば通る）が生まれる。**無ければ常に `A-001` へ 302**であり、
 *    結果として `F-055 AC-2`（主平面のセッションで `/admin/*` に到達すると 302）を満たす。
 *
 * 🔴 `/api/admin/**` は素通しする。API の拒否は Route Handler（`requirePlatformCtx` →
 *    401 / 403）が行う ——「API を直接呼んでも拒否される」を証明する経路を 1 本に保つため
 *    （docs/05 §6.1 / `F-004 AC-1`）。ミドルウェアで先に 302 を返すと、API の応答が
 *    リダイレクトに化けてテストが認可を検証できなくなる。
 */
export function adminMiddleware(view: PlaneRequestView): PlaneDecision {
  if (isUnder(view.pathname, '/api/admin')) return CONTINUE;
  if (PUBLIC_ADMIN_PAGE_PATHS.some((path) => isUnder(view.pathname, path))) return CONTINUE;
  if (!view.hasPlatformSessionCookie) return { kind: 'REDIRECT', location: ADMIN_SIGNIN_PATH };
  return CONTINUE;
}

/**
 * 主平面のミドルウェア。
 *
 * 🔴 **現時点では何もしない（素通し）。** 主平面の未認証遷移は各ページの
 *    `resolveTenantCtxOutcome()` → `redirect('/signin')` が行っており、
 *    そこは Cookie の有無ではなく **DB で確定した事実**（無効化・2FA・ロール）で判断する。
 *    同じ判断を Cookie の有無で二重に書くと、片方だけが古くなる。
 *
 * 🔴 「管理平面のセッションで主平面に到達しても入れない」（`F-055 AC-2` の逆方向）は、
 *    主平面のページが読むのが `__Host-ses.session` だけであることによって既に成立している
 *    （管理平面の Cookie は別名・別鍵であり、`parseTenantSessionClaims` が `null` を返す）。
 *
 * 🔴 ここは T-03-02 の `/settings/security` 誘導（2FA 未設定の `OWNER` / `ADMIN`）が
 *    将来入る場所である。**その時も「画面遷移だけ」を守る。**
 */
export function mainMiddleware(view: PlaneRequestView): PlaneDecision {
  // 🔴 `view` を読まないのは「今は何も判断しない」ことの表明である。引数を落とさないのは、
  //    T-03-02 / T-20-05 がここに条件を足すときに `adminMiddleware` と同じ形で書けるようにするため。
  void view;
  return CONTINUE;
}

/** 平面を見分けて対応するミドルウェアへ委譲する（この 1 本だけが両者を知る）。 */
export function decidePlane(view: PlaneRequestView): PlaneDecision {
  return isAdminPlanePath(view.pathname) ? adminMiddleware(view) : mainMiddleware(view);
}
