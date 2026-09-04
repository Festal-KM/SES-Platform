// apps/web/lib/auth/cookie-names.ts
// 🔴 2 系統のセッション Cookie 名の**唯一の定義**（docs/05 §5.1 / docs/03 §4.9 / `BR-36`）。
//
// 🔴 なぜ 1 ファイルに切り出すか（T-03-08）: 管理平面のミドルウェア（Edge ランタイム）が
//    Cookie 名で平面を見分ける。`lib/auth/main.ts` / `lib/auth/platform.ts` は Auth.js と
//    `packages/db`（Prisma）を読み込むため Edge から import できない。名前を 2 箇所に
//    書き分けると、片方を変えたときに**ミドルウェアだけが古い名前を見続ける**
//    （= 認証済みでも常に 302、または未認証を通す）という静かな壊れ方をする。
//
// 🔴 `__Host-` 接頭辞は「`Secure` かつ `Domain` 属性なし かつ `Path=/`」をブラウザ側で強制する。
//    サブドメインから上書き設定できないため、セッション固定攻撃の経路を塞ぐ。
//
// 🔴 両平面の Cookie は `path=/` で**同居する**。したがって「path が異なるため送られない」は
//    交差禁止（`F-055 AC-2`）の根拠にならない。交差を塞ぐのは
//    ①Cookie 名 ②別の署名鍵（`AUTH_SECRET` / `AUTH_PLATFORM_SECRET`）
//    ③fail-closed パーサ（`parseTenantSessionClaims` / `parsePlatformSessionClaims`）の 3 点である
//    （docs/05 §5.1）。ミドルウェアは Cookie 名で**画面遷移を振り分けるだけ**であり、
//    境界の強制はしない。

/** 主平面（テナント利用者）。 */
export const MAIN_SESSION_COOKIE_NAME = '__Host-ses.session';

/** 管理平面（運営者）。🔴 `/api/admin/**` にも届くよう `path=/` である（docs/05 §5.1）。 */
export const PLATFORM_SESSION_COOKIE_NAME = '__Host-ses-admin.session';
