// packages/domain/src/recipient/scope.ts
// 宛先分類の**部分集合**（docs/05 §8.2 の分類別の扱い / §8.3 / §9.4）。T-04-02。
//
// 🔴 なぜ部分集合を型として持つか:
//    「この送信経路に載せてよい分類」を型で表しておかないと、`RecipientClass` を受け取る
//    すべての経路が全 5 分類を受け入れてしまう。docs/05 §9.4 が `email.dispatch` の payload を
//    `HostOrPlatformDispatch` に限定せよと書いているのは、**分類 2 / 3 / 4 の宛先を
//    運用メールのキューに載せられないようにする**ためである（型で禁止する）。
//
// 🔴 ここにあるのは「集合の定義」だけで、環境（`APP_ENV`）による分岐は 1 つも無い。
//    差し替えの判断は `packages/config` の `resolveConnectorSelection` 1 箇所に閉じる
//    （CLAUDE.md §11.1 / docs/05 §13.1）。

import type { RecipientClass } from './classify.js';

/**
 * 🔴 業務上の外部送信（取引先・第三者へ届く）にあたる宛先分類。
 *
 * この分類では独自ドメインの検証済み送信元が必須であり、共通ドメインへ**フォールバックしない**
 * （`BR-51` / docs/05 §8.3）。`sandbox` ではモックに倒れる（docs/02 章 7.6 の判定表）。
 */
export const EXTERNAL_RECIPIENT_CLASSES = [
  'PARTNER_MEMBER',
  'CLIENT',
  'ENGINEER',
] as const satisfies readonly RecipientClass[];

export type ExternalRecipientClass = (typeof EXTERNAL_RECIPIENT_CLASSES)[number];

/**
 * 🔴 `email.dispatch`（運用メール。docs/05 §9.4）に載せてよい宛先分類 = **分類 1 と分類外だけ**。
 *
 * このキューだけ `attempts: 3` が許されるのは、宛先が自テナントの利用者または運営者に限られ
 * `BR-21`（取引先への二重送信）の射程外だからである。したがって**分類 2 / 3 / 4 を
 * 載せられないことが `attempts: 3` の前提条件**であり、型で保証する必要がある。
 */
export const HOST_OR_PLATFORM_RECIPIENT_CLASSES = [
  'HOST_MEMBER',
  'PLATFORM',
] as const satisfies readonly RecipientClass[];

export type HostOrPlatformRecipientClass = (typeof HOST_OR_PLATFORM_RECIPIENT_CLASSES)[number];

/**
 * 🔴 `email.dispatch`（運用メール。docs/05 §9.4）の **payload に載せてよい**宛先分類。T-05-08。
 *
 * ============================================================================
 * 🔴 `HOST_OR_PLATFORM_RECIPIENT_CLASSES` と**役割が違う**（同じに見えるが混ぜてはならない）
 * ============================================================================
 * - `HOST_OR_PLATFORM_*` … 🔴 **`sandbox` で実送信してよいか**の判定
 *   （`isMockedDelivery` / `SandboxRecipientScopedEmailSender`）。**ここに `PARTNER_MEMBER` を
 *   足すと、取引先の担当者へ `sandbox` から実メールが飛ぶ**（`CLAUDE.md` §11.1 の最悪の事故）。
 * - `OPERATIONAL_MAIL_*` … **どのキューに載せてよいか**の判定。載せた先の実送信 / モックの
 *   振り分けは上の別判定が行う。
 *
 * ============================================================================
 * 🔴 なぜ分類 2 を運用メールに載せられるようにしたか（T-05-08。`CLAUDE.md` §8.7 で docs 追従済み）
 * ============================================================================
 * `F-011` 処理④（スキャン失敗・隔離の周知）の宛先は**そのファイルの所有側の担当者**であり、
 * パートナー所属（分類 2）でありうる。分類 2 を運べる運用メールの経路が無いと、
 * **周知がホスト側にしか届かない**（`F-011` の 🔴「パートナーの担当者が隔離に気づけない状態に
 * ならない」に反する）。
 *
 * `attempts: 3` の前提は次の 2 つであり、分類 2 を足しても崩れない:
 *   ① 🔴 **業務上の外部送信（分類 3 / 4 = 提案先・エンジニア本人）を載せられない**
 *      —— 下の `AssertOperationalMailExcludesOutsiders` が型で固定する
 *   ② `EmailDispatch.dedupeKey` の `UNIQUE` と `QUEUED` からの CAS で、何回再試行しても 1 通
 * ①②は `account.mail`（分類 1 / 2 を `attempts: 3` で運ぶ既存経路）とまったく同じ根拠である。
 */
export const OPERATIONAL_MAIL_RECIPIENT_CLASSES = [
  'HOST_MEMBER',
  'PARTNER_MEMBER',
  'PLATFORM',
] as const satisfies readonly RecipientClass[];

export type OperationalMailRecipientClass = (typeof OPERATIONAL_MAIL_RECIPIENT_CLASSES)[number];

/**
 * 🔴 `account.mail`（招待・パスワード再設定。docs/05 §9.4）の宛先分類 = **分類 1 と分類 2 だけ**。
 *
 * 宛先は「招待中の本人 / 本人」に限られる。業務上の外部送信（分類 3 / 4）を載せる型を持たない。
 * `sandbox` では分類 2 がモックになり、代わりに招待リンクを画面に表示する（`F-007 AC-4`。T-04-08）。
 */
export const ACCOUNT_MAIL_RECIPIENT_CLASSES = [
  'HOST_MEMBER',
  'PARTNER_MEMBER',
] as const satisfies readonly RecipientClass[];

export type AccountMailRecipientClass = (typeof ACCOUNT_MAIL_RECIPIENT_CLASSES)[number];

/**
 * 🔴 テナントに所属しない宛先（分類 3 / 4）。`resolveRecipientClass` の `fallback` の型である。
 *
 * **既定値をモック側に倒す**ための型（docs/02 章 7.6 のタイブレーカー / docs/05 §8.2）:
 * `fallback` に `'HOST_MEMBER'` / `'PLATFORM'` を渡せない = 分類を省略した送信が
 * 実送信側に落ちる経路が存在しない。
 */
export const OUTSIDER_RECIPIENT_CLASSES = [
  'CLIENT',
  'ENGINEER',
] as const satisfies readonly RecipientClass[];

export type OutsiderRecipientClass = (typeof OUTSIDER_RECIPIENT_CLASSES)[number];

// 🔴 「実送信してよい分類（分類 1 / 分類外）」と「独自ドメイン必須の外部送信（分類 2 / 3 / 4）」が
//    交差しないことを型で固定する（queues.ts の `AssertDisjointJobNames` と同じ仕掛け）。
//    交差した瞬間に「共通ドメインで取引先へ送れる」経路が生まれるため、コンパイルで落とす。
type AssertSendScopesAreDisjoint = [
  Extract<HostOrPlatformRecipientClass, ExternalRecipientClass>,
] extends [never]
  ? true
  : never;
const SEND_SCOPES_ARE_DISJOINT: AssertSendScopesAreDisjoint = true;
void SEND_SCOPES_ARE_DISJOINT;

// 🔴 既定値（`fallback`）が実送信側に入り込めないことも型で固定する。
type AssertFallbackIsAlwaysMocked = [
  Extract<OutsiderRecipientClass, HostOrPlatformRecipientClass>,
] extends [never]
  ? true
  : never;
const FALLBACK_IS_ALWAYS_MOCKED: AssertFallbackIsAlwaysMocked = true;
void FALLBACK_IS_ALWAYS_MOCKED;

// 🔴 T-05-08: 運用メールのキュー（`attempts: 3`）に**テナントに所属しない宛先**（分類 3 / 4 =
//    提案先・エンジニア本人）を載せられないことを型で固定する。これが崩れると
//    「取引先・第三者への送信が自動リトライされる」＝ `BR-21` / `CLAUDE.md` §3.4 の直接違反になる。
type AssertOperationalMailExcludesOutsiders = [
  Extract<OperationalMailRecipientClass, OutsiderRecipientClass>,
] extends [never]
  ? true
  : never;
const OPERATIONAL_MAIL_EXCLUDES_OUTSIDERS: AssertOperationalMailExcludesOutsiders = true;
void OPERATIONAL_MAIL_EXCLUDES_OUTSIDERS;

/** 広い型として見た集合（`includes` の引数型を `RecipientClass` に保つための内部ビュー）。 */
const EXTERNAL: readonly RecipientClass[] = EXTERNAL_RECIPIENT_CLASSES;
const HOST_OR_PLATFORM: readonly RecipientClass[] = HOST_OR_PLATFORM_RECIPIENT_CLASSES;
const ACCOUNT_MAIL: readonly RecipientClass[] = ACCOUNT_MAIL_RECIPIENT_CLASSES;
const OPERATIONAL_MAIL: readonly RecipientClass[] = OPERATIONAL_MAIL_RECIPIENT_CLASSES;

/** 🔴 独自ドメインの検証済み送信元が必須か（docs/05 §8.3 / `BR-51`）。 */
export function isExternalRecipientClass(value: RecipientClass): value is ExternalRecipientClass {
  return EXTERNAL.includes(value);
}

/**
 * 🔴 **`sandbox` で実送信してよいか**（docs/02 章 7.6 NFR-ENV-1 / `CLAUDE.md` §11.1）。
 *
 * ⚠️ **「`email.dispatch` に載せてよいか」ではない**（それは `isOperationalMailRecipientClass`）。
 *    この関数の偽が「モックへ倒す」を意味する（`isMockedDelivery` /
 *    `SandboxRecipientScopedEmailSender`）ため、ここに分類を足すことは
 *    **その分類の宛先へ `sandbox` から実メールを送る**ことと同義である。
 */
export function isHostOrPlatformRecipientClass(
  value: RecipientClass,
): value is HostOrPlatformRecipientClass {
  return HOST_OR_PLATFORM.includes(value);
}

/**
 * 🔴 `email.dispatch`（運用メール）に載せてよいか（docs/05 §9.4）。T-05-08。
 *
 * 分類 1 / 2 / 分類外が真。🔴 **分類 3 / 4（提案先・エンジニア本人）は偽**であり、
 * 業務上の外部送信が `attempts: 3` のキューに載ることはない。
 */
export function isOperationalMailRecipientClass(
  value: RecipientClass,
): value is OperationalMailRecipientClass {
  return OPERATIONAL_MAIL.includes(value);
}

/** 🔴 `account.mail` に載せてよいか（docs/05 §9.4）。 */
export function isAccountMailRecipientClass(
  value: RecipientClass,
): value is AccountMailRecipientClass {
  return ACCOUNT_MAIL.includes(value);
}
