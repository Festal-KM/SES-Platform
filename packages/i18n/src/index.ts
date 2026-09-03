// packages/i18n/src/index.ts
// 🔴 ユーザー向け文言の唯一の置き場所（CLAUDE.md §3.5 / BR-32 / docs/05 §15.2）。
//    コンポーネント・API ハンドラ・エラークラスに文言をベタ書きしない。
//    サーバは `messageKey` だけを返し、文言の組み立ては表示側が本カタログで行う。
//
// 🔴 プロダクト名は `product.name` の 1 トークンだけを出所にする（docs/04 U-01）。
//    改称は本ファイルの 1 行の差し替えで済む。
//
// T-03-01（SP-03）で S-001（サインイン）と §15.1 のうち本タスクで到達しうるエラーの
// キーを置いた。**後続タスクはキーを追加するだけで、この構造を変えない。**

/** 対応ロケール。当面は日本語のみ（追加時はカタログを 1 つ増やす）。 */
export const LOCALES = ['ja'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ja';

const ja = {
  // --- プロダクト（docs/04 U-01。表示箇所はヘッダとサインイン系の画面に限る）---
  'product.name': 'SES Platform',

  // --- S-001 サインイン（docs/04 §S-001 / F-003）---
  'auth.signin.title': 'サインイン',
  'auth.signin.email.label': 'メールアドレス',
  'auth.signin.password.label': 'パスワード',
  'auth.signin.submit': 'サインイン',
  'auth.signin.submitting': 'サインインしています…',
  'auth.signin.passwordReset.link': 'パスワードをお忘れですか',
  // 🔴 「メールアドレスが存在しない」と「パスワードが違う」を区別しない（docs/04 §S-001）。
  'auth.signin.error.invalidCredentials':
    'メールアドレスまたはパスワードが正しくありません。ご確認のうえ、もう一度お試しください。',
  'auth.signin.error.network': '接続できませんでした。時間をおいて再度お試しください。',
  'auth.signout.submit': 'サインアウト',

  // --- 共通エラー（docs/05 §15.1 の userMessageKey）---
  'error.validation': '入力内容をご確認ください。',
  'error.unauthenticated': 'サインインが必要です。',
  'error.forbidden': 'この操作を行う権限がありません。',
  'error.notFound': '対象が見つかりません。',
  'error.internal': '処理に失敗しました。時間をおいて再度お試しください。',
} as const;

/** 🔴 文言キーの単一の出所。存在しないキーはコンパイルエラーになる。 */
export type MessageKey = keyof typeof ja;

const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { ja };

/**
 * 文言を引く。🔴 キーは `MessageKey` に限られるため、未定義キーの参照はコンパイルで落ちる。
 */
export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  return CATALOGS[locale][key];
}

/** 表示側（クライアントコンポーネント）へ丸ごと渡すためのカタログ。 */
export function catalog(locale: Locale = DEFAULT_LOCALE): Readonly<Record<MessageKey, string>> {
  return CATALOGS[locale];
}
