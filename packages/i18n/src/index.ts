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

  // --- S-002 招待の受諾とアカウント初期設定（docs/04 §S-002 / F-002。T-03-03）---
  'invite.title': '招待の受諾',
  'invite.section.invitation': '招待の内容',
  'invite.section.account': 'アカウントの設定',
  'invite.tenantName.label': '招待元の組織',
  'invite.partnerCompany.label': '所属',
  'invite.role.label': '付与されるロール',
  'invite.email.label': '招待されたメールアドレス',
  'invite.expiresAt.label': '有効期限',
  'invite.displayName.label': '氏名',
  'invite.password.label': 'パスワード',
  'invite.password.hint': '12 文字以上で設定してください。',
  // 🔴 「受諾すると失効する（1 回限り）」ことを、押す前に伝える（docs/04 §S-002 / F-007 AC-4）。
  'invite.onceOnly.notice': 'この招待リンクは受諾すると失効します。',
  // 🔴 VIEWER として招待された場合は、できないことを**受諾前に**示す（BR-31 / docs/04 §S-002）。
  'invite.viewer.notice':
    '閲覧のみのアカウントです。承認・送信・ダウンロードはできません。',
  'invite.submit': '受諾してはじめる',
  'invite.submitting': '受諾しています…',
  // 🔴 期限切れ・使用済みは専用文言（docs/04 §S-002）。担当者名は出さない。
  'invite.error.expired':
    'この招待は有効期限が切れています。招待元の管理者に再発行を依頼してください。',
  'invite.error.accepted': 'この招待はすでに受諾されています。',
  'invite.error.notFound': '招待を確認できません。リンクをもう一度お確かめください。',
  'invite.error.failed': '受諾できませんでした。もう一度お試しください。',
  'invite.error.network': '接続できませんでした。時間をおいて再度お試しください。',
  'invite.signin.link': 'サインインへ',

  // --- ロール名（docs/04 §S-002「付与されるロールを受諾前に明示する」）---
  'role.OWNER': 'オーナー（組織の全権）',
  'role.ADMIN': '管理者（メンバー・取引先・設定の管理）',
  'role.SALES': '営業（案件・人材・提案の作成と編集）',
  'role.PARTNER_ADMIN': '取引先の管理者（自社の担当者と人材の管理）',
  'role.PARTNER_SALES': '取引先の営業（自社の人材・公開案件・提案）',
  'role.VIEWER': '閲覧のみ',

  // --- 共通エラー（docs/05 §15.1 の userMessageKey）---
  'error.validation': '入力内容をご確認ください。',
  'error.unauthenticated': 'サインインが必要です。',
  'error.forbidden': 'この操作を行う権限がありません。',
  'error.notFound': '対象が見つかりません。',
  // 🔴 docs/05 §15.1 `TwoFactorRequiredError`（403）。
  'error.2fa.required': '2 要素認証の設定と確認が必要です。',
  'error.2fa.invalidCode': 'コードが正しくありません。',
  'error.2fa.throttled': '試行回数の上限に達しました。しばらく時間をおいてからお試しください。',
  // 🔴 docs/05 §15.1 の 409 / 422 段（T-03-03 で必要な分。T-03-04 が同じ段にキーを足す）。
  'error.conflict': '現在の状態では実行できません。画面を更新してご確認ください。',
  'error.unprocessable': 'この内容では処理できません。入力内容をご確認ください。',
  'error.invitation.notAcceptable':
    'この招待は受諾できません。期限切れか、すでに受諾されている可能性があります。',
  // 🔴 受け取るのは招待を発行できる OWNER / ADMIN だけ（自テナントのメンバーを見られる立場）。
  //    次の行動（ロール変更）へ導ける文言にする。
  'error.invitation.emailAlreadyMember':
    'このメールアドレスの利用者はすでにこの組織に登録されています。招待ではなく、権限の変更をご確認ください。',
  'error.invitation.partnerNotAvailable':
    '取引先の担当者への招待は、まだご利用いただけません。自社メンバーの招待のみ発行できます。',
  'error.passwordReset.invalidToken':
    'このパスワード再設定のリンクは無効です。もう一度、再設定をお申し込みください。',
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
