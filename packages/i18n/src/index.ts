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

  // --- S-001 の 2 要素認証（docs/04 §S-001 セクション 3 / F-003 AC-2 / BR-30。T-03-02）---
  'auth.twoFactor.title': '2 要素認証',
  // 🔴 「OWNER / ADMIN は必須、それ以外は任意」という制度をそのまま伝える（docs/04 §S-001）。
  'auth.twoFactor.setup.lead':
    '認証アプリで次のセットアップ用アドレスを登録し、表示された 6 桁のコードを入力してください。',
  'auth.twoFactor.setup.uriLabel': 'セットアップ用アドレス（認証アプリに登録）',
  'auth.twoFactor.setup.recoveryHeading': 'リカバリコード',
  // 🔴 「この画面を離れると二度と表示されない」ことを、控える前に伝える。
  'auth.twoFactor.setup.recoveryNote':
    '認証アプリを使えないときに 1 回だけ使えるコードです。この画面を離れると再表示できません。安全な場所に控えてください。',
  'auth.twoFactor.verify.lead': '認証アプリに表示されている 6 桁のコードを入力してください。',
  'auth.twoFactor.code.label': '認証コード',
  'auth.twoFactor.submit': '確認',
  'auth.twoFactor.submitting': '確認しています…',
  'auth.twoFactor.error.invalidCode':
    'コードが正しくありません。時間をおいて、新しいコードでお試しください。',
  // 🔴 docs/04 §S-001「ロックアウトは残り時間を明示する」。⚠️ 残り時間の埋め込み表示は
  //    文言パラメータの仕組み（docs/05 §15.2 の `params`）が入る Issue の追従で行う。
  //    現状はサーバが `Retry-After` ヘッダで秒数を返す。
  'auth.twoFactor.error.throttled':
    '認証コードの入力回数が上限に達しました。しばらく時間をおいてから、もう一度お試しください。',

  // --- 共通エラー（docs/05 §15.1 の userMessageKey）---
  'error.validation': '入力内容をご確認ください。',
  'error.unauthenticated': 'サインインが必要です。',
  'error.forbidden': 'この操作を行う権限がありません。',
  'error.notFound': '対象が見つかりません。',
  // 🔴 docs/05 §15.1 `TwoFactorRequiredError`（403）。
  'error.2fa.required': '2 要素認証の設定と確認が必要です。',
  'error.2fa.invalidCode': 'コードが正しくありません。',
  'error.2fa.throttled': '試行回数の上限に達しました。しばらく時間をおいてからお試しください。',
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
