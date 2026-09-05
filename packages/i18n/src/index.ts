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

  // --- A-001 運営者サインイン（docs/04 §A-001 / F-055。T-03-07）---
  // 🔴 平面帯（セクション 1）。運営者コンソールであることを画面上部に常時示す。
  'admin.plane.band': '運営者コンソール',
  // 🔴 認証アプリに表示する発行者名。テナント利用者の登録と取り違えられないようにする。
  'admin.console.issuer': 'SES Platform 運営者コンソール',
  'admin.signin.title': '運営者サインイン',
  'admin.signin.lead': '運営者アカウントでサインインしてください。',
  // 🔴 2 要素認証は全運営者に必須（F-055 AC-3 / BR-30）。設定を促す文言を出す。
  'admin.twoFactor.required.notice':
    '運営者アカウントは 2 要素認証の設定が必須です。設定を完了するまで管理平面のどの画面も利用できません。',
  'admin.home.title': '運営者コンソール',
  // 🔴 T-03-09 でテナント一覧（A-002）が使えるようになったため、文言を「利用量・監視」に絞った。
  'admin.home.placeholder': '利用量・監視は、後続のリリースでこの画面から利用できるようになります。',
  // 🔴 T-03-08: 運営者に見せてよいのは件数・状態・エラーだけである（CLAUDE.md §10.5）。
  //    テナント名・エンジニア名などの「内容」をこの画面に出さない。
  'admin.home.tenantCount.label': '契約テナント数',
  'admin.signout.submit': 'サインアウト',
  // 🔴 A-002 / A-003 共通（BR-37「運営者コンソールは既定 read-only」）。書き込み操作が
  //    無いことを画面タイトル右に常時明示する（docs/04 §A-002 / §A-003）。
  'admin.readOnly.badge': '閲覧のみ',

  // --- A-002 テナント一覧（docs/04 §A-002 / F-056。T-03-09）---
  'admin.tenants.title': 'テナント一覧',
  // 🔴 異常度順の並び替えは Phase 1（SP-11）。Phase 0 は「テナントがまだありません」のみ
  //    （A-014 テナント開設の導線は T-03-10 で追加する）。
  'admin.tenants.empty': 'テナントがまだありません。',
  'admin.tenants.column.name': 'テナント名',
  'admin.tenants.column.lifecycleState': 'ライフサイクル状態',
  'admin.tenants.column.environment': '環境',
  'admin.tenants.column.seats': '席数',
  'admin.tenants.column.partners': 'パートナー数',
  'admin.tenants.column.engineers': 'エンジニア数',
  'admin.tenants.column.projects': '案件数',
  'admin.tenants.column.lastActivity': '最終アクティビティ',
  'admin.tenants.loadMore': 'さらに読み込む',
  'admin.tenants.lastActivity.none': '記録なし',
  // 🔴 CLAUDE.md §4.2 の Tenant ステートマシン 5 状態（欠落禁止。テンプレートリテラルで
  //    動的にキーを組み立てず、apps/web/app/admin/tenants/_lib/labels.ts が固定の対応表を持つ）。
  'admin.tenants.lifecycleState.SANDBOX': 'サンドボックス',
  'admin.tenants.lifecycleState.ACTIVE': '契約中',
  'admin.tenants.lifecycleState.SUSPENDED': '停止中',
  'admin.tenants.lifecycleState.CLOSING': '解約手続き中',
  'admin.tenants.lifecycleState.PURGED': '削除済み',
  // 🔴 Tenant.environment（docs/05 §3.3。APP_ENV とは別物。テナントの契約種別）。
  'admin.tenants.environment.production': '本番契約',
  'admin.tenants.environment.sandbox': 'サンドボックス（契約前）',
  'admin.tenants.environment.demo': 'デモ',

  // --- A-003 テナント詳細（docs/04 §A-003 / F-056。T-03-09）---
  'admin.tenantDetail.eyebrow': 'テナント詳細',
  'admin.tenantDetail.section.contract': '契約',
  'admin.tenantDetail.section.scale': '規模',
  'admin.tenantDetail.section.activity': 'アクティビティ',
  'admin.tenantDetail.field.lifecycleState': 'ライフサイクル状態',
  'admin.tenantDetail.field.environment': '環境',
  'admin.tenantDetail.field.createdAt': '契約開始日時',
  'admin.tenantDetail.field.lifecycleChangedAt': '状態変更日時',
  'admin.tenantDetail.field.sandboxExpiresAt': 'サンドボックス期限',
  'admin.tenantDetail.field.closingEnteredAt': '解約手続き開始日時',
  'admin.tenantDetail.field.seats': '席数',
  'admin.tenantDetail.field.partners': 'パートナー数',
  'admin.tenantDetail.field.engineers': 'エンジニア数',
  'admin.tenantDetail.field.projects': '案件数',
  'admin.tenantDetail.field.proposals': '提案数',
  'admin.tenantDetail.field.lastActivity': '最終ログイン',
  'admin.tenantDetail.field.recentActivity': '直近 30 日の操作件数',
  // 🔴 F-062 AC-7 / docs/04 program-design 申し送り 15: 削除件数を出さない。
  //    削除完了の確認は A-010（Phase 3）の 1 本のみ。
  'admin.tenantDetail.purged.notice': 'このテナントのデータは削除済みです。',

  // --- A-014 テナントの開設（docs/04 §A-014 / F-001。T-03-10）---
  // 🔴 PLATFORM_OWNER のみが到達する画面（PLATFORM_SUPPORT にはナビにも現れない）。
  'admin.provisioning.title': 'テナントの開設',
  'admin.provisioning.link': 'テナントを開設する',
  // セクション 1: 開設先の環境（読み取り専用。選ばせない）
  'admin.provisioning.section.environment': '開設先の環境',
  'admin.provisioning.environment.readOnlyNote':
    '接続先で決まります。この画面では切り替えられません。',
  // セクション 2: 企業の情報
  'admin.provisioning.section.company': '企業の情報',
  'admin.provisioning.name.label': '企業名・商号',
  'admin.provisioning.timezone.label': 'タイムゾーン',
  'admin.provisioning.currency.label': '通貨',
  'admin.provisioning.currency.value': '日本円（固定）',
  // 🔴 同名テナントの警告（開設は止めない。docs/04 §A-014）
  'admin.provisioning.duplicateName.warning':
    '同じ名前のテナントがすでにあります。取り違えて 2 つ目を開設すると、以後の業務が 2 つに割れます。',
  // セクション 3: 契約の初期状態
  'admin.provisioning.section.lifecycle': '契約の初期状態',
  'admin.provisioning.lifecycle.SANDBOX': 'サンドボックス（試用）',
  'admin.provisioning.lifecycle.ACTIVE': '本契約',
  'admin.provisioning.lifecycle.sandboxNote':
    '30 日の期限つきです。期限が到来すると解約手続き中に進み、サンドボックスの管理画面の対象になります。',
  // セクション 4: プラン
  'admin.provisioning.section.plan': 'プラン',
  'admin.provisioning.plan.label': 'プランの識別子',
  'admin.provisioning.plan.hint':
    'プランの内容（席数上限・AI 利用量クォータ・メール上限）の設定と変更は、契約管理の画面で行います。',
  // セクション 5: 初期 OWNER の招待
  'admin.provisioning.section.owner': '初期オーナーの招待',
  'admin.provisioning.owner.email.label': '招待先メールアドレス',
  // 🔴 「複数名を一度に招待する」欄を置かない理由を運営者に示す（docs/04 §A-014）
  'admin.provisioning.owner.singleNote':
    '招待できるのは 1 名だけです。以降のメンバー追加は、テナントの組織設定から行われます。',
  // セクション 5b: 送信ドメインの登録
  'admin.provisioning.section.sendingDomain': '送信ドメインの登録',
  'admin.provisioning.sendingDomain.label': '独自ドメイン（任意）',
  'admin.provisioning.sendingDomain.note':
    '登録するだけです。DNS レコードの設定と検証は、オーナーが受諾後に自分で行います。開設直後は未検証（取引先へ 1 通も送れない状態）です。',
  // セクション 6: 開設後に自動で入る既定値の明示
  'admin.provisioning.section.defaults': '開設後に自動で入る既定値',
  'admin.provisioning.defaults.autoApprove': '提案の自動承認 — 無効',
  'admin.provisioning.defaults.approvalMode': 'AI 運用ロールの承認モード — すべて都度承認',
  'admin.provisioning.defaults.visibility': '案件の公開範囲 — 誰にも公開されない',
  'admin.provisioning.defaults.sendingDomain': '送信ドメインの検証状態 — 未検証',
  // セクション 7: 確認
  'admin.provisioning.section.confirm': '開設の確認',
  'admin.provisioning.confirm.lead': '次の内容で開設します。',
  'admin.provisioning.confirm.review': '確認へ進む',
  'admin.provisioning.confirm.back': '入力に戻る',
  'admin.provisioning.submit': 'テナントを開設する',
  'admin.provisioning.submitting': '開設しています…',
  // 🔴 「テナントは作成されていません」と「作成されたが招待に失敗した」を分けて示す
  'admin.provisioning.error.notCreated':
    'テナントは作成されていません。入力内容を確認して、もう一度お試しください。',
  'admin.provisioning.error.invitationFailed':
    'テナントは作成されました。招待の送信に失敗しています。開設をやり直さず、招待の再送を行ってください。',
  'admin.provisioning.error.duplicateRequest':
    'この開設要求はすでに処理済みです。テナント一覧で結果を確認してください。',
  'admin.provisioning.success': 'テナントを開設し、初期オーナーの招待を作成しました。',
  'admin.provisioning.retryInvitation': '招待を再送する',
  // 直近の開設
  'admin.provisioning.recent.title': '直近の開設',
  'admin.provisioning.recent.empty': 'まだテナントを開設していません。',
  'admin.provisioning.recent.column.createdAt': '開設日時',
  'admin.provisioning.recent.column.name': '企業名',
  'admin.provisioning.recent.column.environment': '環境',
  'admin.provisioning.recent.column.lifecycleState': '契約の状態',
  'admin.provisioning.recent.column.invitation': '招待の状態',
  'admin.provisioning.recent.column.sendingDomain': '送信ドメイン',
  'admin.provisioning.invitation.NOT_ISSUED': '未発行',
  'admin.provisioning.invitation.PENDING': '受諾待ち',
  'admin.provisioning.invitation.ACCEPTED': '受諾済み',
  'admin.provisioning.invitation.EXPIRED': '期限切れ',
  'admin.provisioning.invitation.REVOKED': '取消済み',
  'admin.provisioning.sendingDomain.none': '未登録',
  'admin.provisioning.sendingDomain.REGISTERED': '未検証',
  'admin.provisioning.sendingDomain.PENDING': '検証中',
  'admin.provisioning.sendingDomain.VERIFIED': '検証済み',
  'admin.provisioning.sendingDomain.FAILED': '検証に失敗',

  // --- S-035 組織設定（docs/04 §S-035 / F-001 / F-021。T-03-10）---
  'orgSettings.title': '組織設定',
  'orgSettings.section.organization': '組織情報',
  'orgSettings.name.label': '商号',
  'orgSettings.timezone.label': 'タイムゾーン',
  'orgSettings.currency.label': '通貨',
  'orgSettings.currency.value': '日本円（固定）',
  'orgSettings.environment.label': '環境',
  // 🔴 lifecycleState は読み取り専用（テナント側のどのロールからも変更できない）
  'orgSettings.lifecycleState.label': '契約の状態',
  'orgSettings.lifecycleState.readOnlyNote':
    '契約の状態はご自身では変更できません。変更が必要な場合はお問い合わせください。',
  'orgSettings.piiRetentionYears.label': '個人情報の保持期間（年）',
  'orgSettings.section.approvalPolicy': '承認ポリシー',
  'orgSettings.autoApprove.label': '提案の承認を自動で付与する（品質ゲートの全層 PASS のときのみ）',
  // 🔴 危険な操作としての確認（docs/04 §S-035）。1 層でも不合格なら人間に差し戻されることを明記する。
  'orgSettings.autoApprove.warning':
    '有効にすると、品質ゲートの全層 PASS の提案が人手の承認なしに送信されます。1 層でも不合格の提案は、この設定にかかわらず人間に差し戻されます。',
  'orgSettings.autoApprove.confirm': '上記を理解したうえで有効にします',
  // 🔴 S-039（AI ロール別の承認モード）との違いを明示し、同じブロックに置かない
  'orgSettings.autoApprove.scopeNote':
    'この設定は「提案の承認」に対するもので、AI 運用ロールごとの承認モードとは別の設定です。',
  'orgSettings.save': '保存する',
  'orgSettings.saving': '保存しています…',
  'orgSettings.saved': '保存しました。',
  'orgSettings.error.saveFailed': '保存できませんでした。もう一度お試しください。',
  // 🔴 Phase 0 の範囲を利用者に説明する（メンバー一覧・招待は後続）
  'orgSettings.members.comingSoon':
    'メンバーの一覧と招待は、後続のリリースでこの画面から利用できるようになります。',

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

  // --- S-046 パスワード再設定（docs/04 §S-046 / F-003。T-03-13）---
  // 🔴 未認証・全ロール共通の導線。運営者の再設定は別ルート（A-001）が持つ（`BR-36`）。
  'passwordReset.title': 'パスワード再設定',
  'passwordReset.request.eyebrow': '① メールアドレスを入力',
  'passwordReset.request.email.label': 'メールアドレス',
  'passwordReset.request.submit': 'パスワード再設定メールを送信',
  'passwordReset.request.submitting': '送信しています…',
  'passwordReset.request.backToSignIn': 'サインイン画面に戻る',
  'passwordReset.request.complete.eyebrow': '② 送信完了',
  // 🔴 固定文言。登録の有無によらず常に同一（docs/04 §S-046 / `CLAUDE.md` §7）。
  'passwordReset.request.complete.message':
    'ご登録のメールアドレス宛に、パスワード再設定のご案内をお送りしました',
  'passwordReset.request.complete.note': '登録の有無にかかわらず、常にこの表示になります。',
  'passwordReset.confirm.eyebrow': '③ 新しいパスワードの設定',
  'passwordReset.confirm.newPassword.label': '新しいパスワード',
  'passwordReset.confirm.newPasswordConfirm.label': '新しいパスワード（確認）',
  // 🔴 しきい値は #5b の既存実装（`PASSWORD_MIN_LENGTH`）に合わせる。画面側で別の値を発明しない。
  'passwordReset.confirm.passwordHint': '12 文字以上でご入力ください。',
  'passwordReset.confirm.submit': 'パスワードを更新する',
  'passwordReset.confirm.submitting': '更新しています…',
  'passwordReset.confirm.mismatch': '新しいパスワードと確認用の入力が一致しません。',
  'passwordReset.confirm.success':
    'パスワードを更新しました。新しいパスワードでサインインしてください。',
  'passwordReset.confirm.signInLink': 'サインインへ',
  // 🔴 無効・期限切れの専用文言は `error.passwordReset.invalidToken` を共用する
  //    （#5b の応答が同じ文言を返すため、画面のベタ書きと二重管理にしない）。
  'passwordReset.confirm.invalidLink.retry': '再設定をやり直す',
  'passwordReset.error.network': '接続できませんでした。時間をおいて再度お試しください。',

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
  // 🔴 docs/05 §15.1 `ViewerNotAllowedError`（403 / `BR-31` / `F-004 AC-6`）。
  //    できないことを言い切る（「権限がありません」だけだと、設定で解決できるように読める）。
  'error.viewer.notAllowed':
    '閲覧のみのアカウントのため、承認・送信・ダウンロードは実行できません。',
  // 🔴 docs/05 §15.1 `TenantNotExecutableError`（409 / `F-004 AC-7`〜`AC-9`）。
  //    🔴 拒否の理由（停止中 / 解約手続き中）を利用者に示す（`F-004 AC-9`）。ここを 1 つの
  //    文言に畳むと「なぜ実行できないのか」が伝わらず、AC-9 を満たさない。
  'error.tenant.suspended':
    'ご利用が停止されています。閲覧はできますが、この操作は実行できません。組織の管理者にお問い合わせください。',
  'error.tenant.closing':
    '解約のお手続き中のため、この操作は実行できません。閲覧とデータの返却のみご利用いただけます。',
  // 🔴 `PURGED` は終端（データ削除済み）。docs/05 §15.1 は 2 キーしか挙げていないが、
  //    §6.2 のゲート対象は `SUSPENDED` / `CLOSING` / `PURGED` の 3 状態であり、
  //    `CLOSING` の文言（「返却のみ利用できます」）を流用すると事実と食い違う。
  'error.tenant.purged': 'この組織のご利用は終了しています。',
  // 🔴 docs/05 §15.1 / §15.3 `InvalidStateTransitionError`（422 / `BR-33`）。
  'error.state.invalidTransition':
    '現在の状態では、この操作を実行できません。画面を更新して最新の状態をご確認ください。',
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
  // 🔴 T-04-07: docs/05 §15.1 の 409 段 `PartnerCompanySuspendedError`（`F-007 AC-2`）。
  //    🔴 テナントの停止（`error.tenant.suspended`）と**別の文言**にする。止まっている単位も、
  //    解除を依頼する相手も違う（取引先の停止を解けるのは取引先を招いたホストの管理者である）。
  //    🔴 「閲覧はできる」ことを書く —— データが消えていないことが伝わらないと、
  //    利用者は「アカウントを失った」と受け取る（`F-007 AC-2`「既存データは削除されない」）。
  'error.partnerCompany.suspended':
    'この取引先は現在停止されています。閲覧はできますが、提案の作成・送信やチャットの投稿は実行できません。お取引先の担当者にお問い合わせください。',
  // 🔴 T-04-09: 同時実行との競合（409）。**障害ではない**ため「失敗しました」と書かず、
  //    最新の状態を見てからやり直す、という次の行動を示す。
  'error.concurrentUpdate':
    'ほかの操作と同時に実行されたため、この操作は反映されませんでした。画面を更新して最新の状態をご確認のうえ、もう一度お試しください。',
  // 🔴 T-04-09: アカウント管理（`F-002 AC-3` / `AC-4`。docs/05 §6.7 #84 / #85）。
  //    いずれも「拒否されたこと」だけでなく**次に取れる行動**を書く（行き止まりにしない）。
  'error.member.outOfScope':
    'このアカウントは取引先自身が管理します。ロールの変更・無効化は、その取引先の管理者にご依頼ください。',
  'error.member.selfManagement':
    'ご自身のロール変更・無効化はできません。ほかの管理者にご依頼ください。',
  'error.member.roleNotAssignable':
    'このアカウントには付与できないロールです。所属（自社 / 取引先）に応じたロールをお選びください。',
  'error.member.lastOwner':
    '最後の OWNER を変更・無効化することはできません。先にほかのメンバーへ OWNER を付与してください。',
  'error.member.revoked':
    'このアカウントはすでに無効化されています。再開する場合は、あらためて招待を発行してください。',
  // 🔴 docs/05 §15.1 `SendingDomainNotVerifiedError`（422 / `BR-51` / `BR-71` / `F-022 AC-7`）。
  //    🔴 **「壊れている」ではなく「設定が済んでいない」として書く**（`docs/04` 申し送り 8）。
  //    次にやること（`S-036` で DNS レコードを設定する）が読み取れる文言にする。設定すべき
  //    レコードそのものは応答の `params` に構造化データとして載る（文言に埋め込まない）。
  'error.sendingDomain.unverified':
    '送信元ドメインの検証が完了していないため、取引先へ届く送信は実行できません。設定画面で DNS レコードを設定し、検証を完了してください。自社メンバーの招待は、この設定がなくても実行できます。',
  // 🔴 docs/04 §S-046 の固定文言（Err 列）。トークンの不一致・使用済み・期限切れ・形式不正を
  //    区別しない（区別するとトークンの実在が漏れる。docs/05 §6.3 #5b）。
  'error.passwordReset.invalidToken': 'このリンクは無効か、有効期限が切れています。',
  // 🔴 T-03-10: 管理平面（CLAUDE.md §10.1 / BR-44）。PLATFORM_SUPPORT には
  //    「権限が足りない」ことを伝え、PLATFORM_OWNER への依頼という次の行動へ導く。
  'error.admin.ownerRequired':
    'この操作は PLATFORM_OWNER のみが実行できます。権限を持つ運営者にご依頼ください。',
  'error.admin.provisioning.duplicateRequest':
    'この開設要求はすでに処理済みです。テナント一覧で結果をご確認ください。',
  'error.admin.provisioning.invalidCombination':
    '環境と契約の初期状態の組み合わせが正しくありません。試用はサンドボックス、本契約は契約中で開設してください。',
  'error.internal': '処理に失敗しました。時間をおいて再度お試しください。',

  // --- S-041 監査ログ（自テナント。docs/04 §S-041 / F-005 / F-012。T-03-05）---
  'auditLogs.title': '監査ログ',
  'auditLogs.filter.from.label': '期間（開始）',
  'auditLogs.filter.to.label': '期間（終了）',
  'auditLogs.filter.category.label': '操作種別',
  'auditLogs.filter.category.all': 'すべて',
  'auditLogs.filter.actorId.label': '主体 ID（任意）',
  'auditLogs.search': '検索',
  'auditLogs.searching': '検索しています…',
  'auditLogs.loadMore': 'さらに読み込む',
  'auditLogs.loadingMore': '読み込んでいます…',
  // 🔴 期間未指定では検索を実行させない（docs/04 §S-041）。
  'auditLogs.error.periodRequired': '期間を指定してください。',
  'auditLogs.error.searchFailed': '検索を実行できませんでした。',
  'auditLogs.empty.beforeSearch': '期間を指定して検索してください。',
  'auditLogs.empty.noMatch': '条件に一致する記録はありません。',
  'auditLogs.column.date': '日時',
  'auditLogs.column.actor': '主体',
  'auditLogs.column.action': '操作',
  'auditLogs.column.target': '対象',
  'auditLogs.column.meta': 'IP・デバイス',
  'auditLogs.actor.system': 'システム',
  'auditLogs.actor.platform': '運営者',
  // 🔴 BR-27 の記録対象を過不足なく網羅する（docs/04 §S-041。選択肢に無い種別は
  //    「記録されていない」と読まれるため、Phase 0 でまだ発生しない種別も選択肢に含める）。
  'auditLogs.category.LOGIN_LOGOUT': 'ログイン・ログアウト',
  'auditLogs.category.ENGINEER_SKILL_SHEET_ACCESS':
    'エンジニア詳細・スキルシートの閲覧／ダウンロード',
  'auditLogs.category.PROJECT_VIEW': '案件詳細の閲覧',
  'auditLogs.category.CREATE_UPDATE_DELETE': '作成・更新・削除',
  'auditLogs.category.PROPOSAL_SUBMIT': '提案の送信',
  'auditLogs.category.APPROVAL': '承認・却下',
  'auditLogs.category.PERMISSION_CHANGE': '権限変更',
  'auditLogs.category.VISIBILITY_CHANGE': '公開範囲の変更',
  'auditLogs.category.IMPERSONATION': '代理閲覧',

  // --- S-003 / S-004 役割別ホーム（docs/04 §S-003 / §S-004 / F-006。T-03-06）---
  // 🔴 Phase 0 は空のダッシュボード（CLAUDE.md §5）。要対応キュー等は Phase 1、満了間近は
  //    Phase 2 が文言を追加する。ここに置くのは Phase 0 から出る文言だけ。
  'home.title': 'ホーム',
  // docs/04 §S-003「空 / ローディング / エラー」の初回空の文言をそのまま使う。
  'home.host.empty.title': 'まだ案件と人材が登録されていません',
  // docs/04 §S-004「空 / ローディング / エラー」の初回空の文言をそのまま使う。
  'home.partner.empty.title':
    'まだ御社に公開された案件はありません。案件が公開されると、この画面に表示されます。',
  // 🔴 F-006 AC-2: 常時表示。件数・存在の示唆を含めない（docs/04 §S-004 セクション 6 の文言）。
  'home.partner.visibilityNotice':
    'この画面には、御社が登録した人材と、御社に公開された案件・御社が作成した提案のみが表示されます。',

  // --- S-036 送信ドメインの設定と検証（docs/04 §S-036 / F-001 AC-4 / docs/03 §3.2.7。T-04-04）---
  // 🔴 **状態であってエラーではない**（docs/04 `program-design` 申し送り 8）。
  //    「壊れている」ではなく「取引先へ送信できない状態」として、理由と手順とともに示す。
  //    画面（`S-036`）そのものは T-04-06 が作る。ここに置くのは API が返すキーの実体である。
  'settings.sendingDomain.state.REGISTERED': '登録済み（DNS レコードの準備中）',
  'settings.sendingDomain.state.PENDING': 'DNS の反映待ち',
  'settings.sendingDomain.state.VERIFIED': '検証済み',
  'settings.sendingDomain.state.FAILED': 'DNS レコードが確認できません',
  // 🔴 `sandbox` は共通ドメインで動くため検証を求めない（docs/03 §3.2.7-4）。
  //    「できない」ではなく「不要」であることを示す。
  'settings.sendingDomain.state.NOT_REQUIRED': 'この環境では設定は不要です',
  // 提示する DNS レコードの説明（docs/03 §3.2.7 / §3.2.9）。
  'settings.sendingDomain.record.DKIM': 'DKIM（送信元の署名）',
  'settings.sendingDomain.record.MAIL_FROM_MX': 'MAIL FROM（バウンスの受け取り）',
  'settings.sendingDomain.record.MAIL_FROM_SPF': 'SPF（送信元の許可）',
  // 🔴 検証が成立しない理由。**次に何をすればよいか**が分かる文言にする（障害の説明にしない）。
  'settings.sendingDomain.failure.DKIM_NOT_VERIFIED':
    'DKIM の CNAME レコード（3 件）が確認できません。DNS に登録済みの場合は、反映までしばらくお待ちください。',
  'settings.sendingDomain.failure.MAIL_FROM_NOT_VERIFIED':
    'MAIL FROM の MX・TXT レコードが確認できません。DNS に登録済みの場合は、反映までしばらくお待ちください。',
  'settings.sendingDomain.failure.MAIL_FROM_NOT_CONFIGURED':
    '送信元の準備が完了していません。「検証状態を再確認する」をもう一度お試しください。',
  'settings.sendingDomain.failure.IDENTITY_NOT_VERIFIED':
    'DNS レコードの確認が完了していません。反映までしばらくお待ちください。',

  // --- S-036 画面本体（docs/04 §S-036 / F-001 AC-4。T-04-06）---
  // 🔴 設定画面ではなくオンボーディングの最終工程として書く（docs/02 `ui-design` 申し送り 13）。
  'settings.sendingDomain.title': '送信ドメインの設定と検証',
  'settings.sendingDomain.breadcrumb.home': 'ホーム',
  'settings.sendingDomain.breadcrumb.settings': '設定',

  // セクション 0: オンボーディングの位置づけ（§2.3 の鎖。A-014 → S-002 → S-035 → 本画面）
  'settings.sendingDomain.onboarding.heading': 'オンボーディングの位置づけ',
  'settings.sendingDomain.onboarding.step.provisioning': 'テナントの開設',
  'settings.sendingDomain.onboarding.step.invitation': '招待の受諾',
  'settings.sendingDomain.onboarding.step.organization': '組織設定',
  'settings.sendingDomain.onboarding.step.current': '本画面（送信ドメインの検証）',
  'settings.sendingDomain.onboarding.goal':
    '到達点は「取引先へ送信できる状態」です。検証が終わるまで、組織設定とホームの最上部に「取引先へまだ 1 通も送れません」の帯が表示されます。',

  // セクション 1: 現在の状態
  'settings.sendingDomain.section.status': '現在の状態',
  'settings.sendingDomain.status.domainLabel': '送信元ドメイン',
  'settings.sendingDomain.status.none': '未設定',
  'settings.sendingDomain.notRequired.notice':
    'サンドボックス環境では共通ドメインで動作するため、ドメインの検証は不要です。本契約への移行時に検証が必要になります。',

  // `S-035` / `S-003` 最上部の帯（docs/04 §S-036 1298 行。検証が未完了である間だけ表示）
  'settings.sendingDomain.guardBanner.text': '取引先へまだ 1 通も送れません。',
  'settings.sendingDomain.guardBanner.linkLabel': '送信ドメインを設定する',

  // 空状態のバナー（docs/04 §S-036「空 / ローディング / エラー」）
  'settings.sendingDomain.banner.unset':
    '取引先へメールを送るには、御社のドメインの検証が必要です。検証が完了するまで、提案の送信・面談調整の連絡・取引先の招待・契約書のメール添付での送付は実行できません（自社メンバーの招待と、電子署名での契約書の送付は実行できます）。',
  // 🔴 「検証が外れた」（失効）と「初回の検証失敗」は行のうえで区別できない（どちらも
  //    state='FAILED' + verified_at=NULL。docs/05 §8.3）ため、共通の文言にする。
  'settings.sendingDomain.banner.failed': 'DNS レコードが確認できなくなりました。送信は停止しています。',

  // セクション 2: ドメインの登録（未登録のときのみ表示）
  'settings.sendingDomain.section.register': 'ドメインの登録',
  'settings.sendingDomain.register.domainLabel': '送信元ドメイン',
  'settings.sendingDomain.register.placeholder': 'example.co.jp',
  'settings.sendingDomain.register.submit': '登録する',
  'settings.sendingDomain.register.submitting': '登録しています…',
  'settings.sendingDomain.register.error':
    '登録できませんでした。ドメインの形式をご確認のうえ、もう一度お試しください。',
  // 🔴 登録は OWNER のみ（#71）。ADMIN には理由を示し、入力欄を出さない。
  'settings.sendingDomain.register.ownerOnlyNote': 'ドメインの登録はオーナーのみ行えます。',

  // セクション 3: DNS レコードの提示
  'settings.sendingDomain.section.records': 'DNS レコードの提示',
  'settings.sendingDomain.records.column.type': '種別',
  'settings.sendingDomain.records.column.name': '名前',
  'settings.sendingDomain.records.column.value': '値',
  'settings.sendingDomain.records.column.copy': 'コピー',
  'settings.sendingDomain.records.column.result': '確認結果',
  'settings.sendingDomain.records.result.confirmed': '確認済み',
  'settings.sendingDomain.records.result.unconfirmed': '未確認',
  'settings.sendingDomain.records.copy': 'コピー',
  'settings.sendingDomain.records.copied': 'コピーしました',
  'settings.sendingDomain.records.copyFailed': 'コピーできませんでした',
  'settings.sendingDomain.records.dkimPending':
    'DKIM のレコードは準備中です。しばらくしてから再度ご確認ください。',

  // 検証の実行（回数制限なし。docs/04 §S-036「非同期処理の表現」）
  'settings.sendingDomain.verify.submit': '検証を実行',
  'settings.sendingDomain.verify.submitting': '確認しています…',
  'settings.sendingDomain.verify.requested':
    '検証を実行しました。結果は次の確認、または通知でお知らせします。',
  'settings.sendingDomain.verify.pending':
    '検証しています（DNS の反映に数分〜数時間かかることがあります）。',
  'settings.sendingDomain.verify.pendingNote':
    '完了は通知でお知らせします。この画面を離れても検証は続きます。',
  'settings.sendingDomain.verify.error': '確認できませんでした。もう一度お試しください。',

  // セクション 4: この設定が影響する機能（docs/04 §S-036「影響範囲」）
  'settings.sendingDomain.section.affects': 'この設定が影響する機能',
  'settings.sendingDomain.affects.blocked': 'これらは検証が完了するまで実行できません。',
  'settings.sendingDomain.affects.screen.S-021': '提案の送信',
  'settings.sendingDomain.affects.screen.S-024': '面談調整の連絡',
  'settings.sendingDomain.affects.screen.S-026': '契約書のメール添付での送付',
  'settings.sendingDomain.affects.screen.S-014': '取引先の招待',
  // 🔴 F-002（自社メンバー招待）は対象外（F-001 AC-5）。取引先の招待とは扱いが違うことを書き分ける。
  'settings.sendingDomain.exclusion.memberInvite':
    '自社メンバーの招待（組織設定）は対象外です。共通ドメインで送信されるため、検証の完了を待たずに実行できます。',
  'settings.sendingDomain.exclusion.memberInvite.note': '※ 取引先の招待とは扱いが違います。',
  // 🔴 F-049（電子署名での契約書送付）も対象外（F-001 AC-4 の 🔴 / F-049 AC-8）。
  'settings.sendingDomain.exclusion.esign':
    '電子署名での契約書送付（接続時）も対象外です。メールを送るのは電子署名サービス側であり、前提条件は本画面の検証ではなく電子署名サービスの接続です。',

  // --- S-014 取引先企業の一覧・詳細と招待（docs/04 §S-014 / `F-007` `F-002`。T-04-07）---
  'partnerCompanies.title': '取引先企業',
  'partnerCompanies.breadcrumb.home': 'ホーム',
  'partnerCompanies.breadcrumb.settings': '設定',
  // 🔴 `F-007 AC-1`: パートナーには自社 1 社しか出ない。母集団を絞っているのは RLS だが、
  //    「他社が出ていないのではなく、そもそも見えない」ことを画面でも明示する（`S-004` と同じ趣旨）。
  'partnerCompanies.partnerScopeNotice': 'この画面には御社の情報のみが表示されます。',
  'partnerCompanies.readOnlyNote': '閲覧のみの権限のため、登録・招待・停止は行えません。',

  // セクション 1: 取引先一覧
  'partnerCompanies.section.list': '取引先一覧',
  'partnerCompanies.column.name': '企業名',
  'partnerCompanies.column.status': '状態',
  'partnerCompanies.column.accountCount': 'アカウント数',
  'partnerCompanies.column.openProjectCount': '公開中の案件数',
  'partnerCompanies.column.proposalCount': '提案数',
  'partnerCompanies.column.lastActivity': '最終アクティビティ',
  'partnerCompanies.status.ACTIVE': '有効',
  'partnerCompanies.status.SUSPENDED': '停止',
  'partnerCompanies.value.none': '—',
  'partnerCompanies.select': '選択',
  // 🔴 docs/04 §S-014「空 / ローディング / エラー」の初回空の文言（業務価値を 1 行添える）。
  'partnerCompanies.empty':
    '取引先が登録されていません。取引先を招待すると、案件を公開して提案を受け取れるようになります。',

  // セクション 2: 取引先の登録（#12）
  'partnerCompanies.section.register': '取引先の登録',
  'partnerCompanies.register.name.label': '企業名',
  'partnerCompanies.register.contactName.label': '担当者名（任意）',
  'partnerCompanies.register.contactEmail.label': '担当者メールアドレス（任意）',
  'partnerCompanies.register.submit': '登録する',
  'partnerCompanies.register.submitting': '登録しています…',
  'partnerCompanies.register.done': '取引先を登録しました。',
  'partnerCompanies.register.error':
    '登録できませんでした。入力内容をご確認のうえ、もう一度お試しください。',

  // セクション 3: 詳細
  'partnerCompanies.section.detail': '取引先の詳細',
  'partnerCompanies.detail.selectPrompt':
    '一覧から取引先を選ぶと、招待の発行と停止の操作が行えます。',
  'partnerCompanies.detail.contactName': '担当者',
  'partnerCompanies.detail.contactEmail': '担当者メールアドレス',
  'partnerCompanies.detail.invitedAt': '登録日',
  'partnerCompanies.detail.pendingInvitations': '未受諾の招待',
  'partnerCompanies.detail.suspendedAt': '停止日時',

  // セクション 4: 招待の発行（#14 のパートナーロール分）
  'partnerCompanies.section.invite': '招待の発行',
  'partnerCompanies.invite.email.label': 'メールアドレス',
  'partnerCompanies.invite.role.label': 'ロール',
  // 🔴 ホストがこの画面から招くのは取引先の管理者だけである。配下の営業アカウントは
  //    取引先自身（`PARTNER_ADMIN`）が招く（`F-002 AC-4`）。
  'partnerCompanies.invite.role.value': 'PARTNER_ADMIN（取引先の管理者）',
  'partnerCompanies.invite.submit': '招待を作成',
  'partnerCompanies.invite.submitting': '作成しています…',
  // 🔴 docs/04 §S-014「非同期処理の表現」: 「送信しました」ではなく「送信を受け付けました」。
  'partnerCompanies.invite.queued':
    '送信を受け付けました。送達の状況は、招待の状態でご確認ください。',
  // 🔴 `F-007 AC-5`: 未検証でも招待そのものは作られる。**失敗と書かない**（設定未了である）。
  'partnerCompanies.invite.held':
    '招待を作成しました。送信元ドメインの検証が完了してから送達されます。',
  'partnerCompanies.invite.error':
    '招待を作成できませんでした。入力内容をご確認のうえ、もう一度お試しください。',
  // 🔴 docs/04 §S-014: 未検証のときは招待ボタンを描画せず、その位置に理由と `S-036` への導線を置く。
  'partnerCompanies.invite.blocked': '送信元ドメインの検証が完了するまで、取引先を招待できません。',
  'partnerCompanies.invite.blocked.link': '送信ドメインを設定する',
  // 🔴 `F-001 AC-5`: 自社メンバーの招待とは扱いが違うことを、この画面の文言でも書き分ける。
  'partnerCompanies.invite.blocked.memberInviteNote':
    '※ 自社メンバーの招待（組織設定）は共通ドメインで送信されるため、検証の完了を待たずに実行できます。',

  // 🔴 T-04-08: `sandbox` の招待リンク（docs/04 §S-014 セクション 4 / `U-07` / `F-007 AC-4`）。
  //    `production` では `#14` の応答に `inviteUrl` が存在しないため、これらは 1 つも表示されない。
  //    🔴 「メールは一切送信されません」と書かない（docs/04 `U-07`）—— 自社メンバー宛は実際に届く。
  'partnerCompanies.invite.link.preNotice':
    'サンドボックス環境では、取引先の担当者宛のメール（招待を含む）は送信されません。招待を作成すると、この場に受諾リンクが表示されるので、取引先の担当者にお渡しください。',
  'partnerCompanies.invite.link.heading': '招待リンク',
  'partnerCompanies.invite.link.notice':
    'サンドボックス環境では招待メールが送信されません。このリンクを取引先の担当者にお渡しください。',
  'partnerCompanies.invite.link.label': '受諾リンク',
  'partnerCompanies.invite.link.copy': 'リンクをコピー',
  'partnerCompanies.invite.link.copied': 'コピーしました。',
  'partnerCompanies.invite.link.copyFailed':
    'コピーできませんでした。上のリンクを選択してコピーしてください。',
  // 🔴 有効期限・1 回限りの受諾・受諾後の失効は本番の招待と同一の規律である（`F-007 AC-4`）。
  //    再表示できないことも併せて明示する（この応答が平文リンクの唯一の出口である）。
  'partnerCompanies.invite.link.onceOnly':
    '※ このリンクは本番環境の招待と同じ扱いです。有効期限があり、受諾は 1 回限りで、受諾後は無効になります。この画面を離れると再表示できません。',

  // セクション 5: 停止 / 再開（#13）
  'partnerCompanies.section.suspension': '取引先の停止',
  'partnerCompanies.suspension.reason.label': '理由（任意）',
  'partnerCompanies.suspend.submit': 'この取引先を停止する',
  'partnerCompanies.suspend.confirmTitle': '停止の確認',
  // 🔴 docs/04 §S-014「操作と結果」の確認ステップの文言をそのまま使う（`F-007 AC-2`）。
  'partnerCompanies.suspend.confirmText':
    '配下アカウントは提案の作成・送信・チャット投稿ができなくなります。データは削除されません。',
  'partnerCompanies.suspend.confirm': '停止する',
  'partnerCompanies.suspend.cancel': 'キャンセル',
  'partnerCompanies.suspend.submitting': '停止しています…',
  'partnerCompanies.resume.submit': 'この取引先の停止を解除する',
  'partnerCompanies.resume.submitting': '解除しています…',
  'partnerCompanies.suspension.error': '実行できませんでした。もう一度お試しください。',

  // --- S-014 セクション 2「配下アカウント」/ アカウント管理（docs/04 §S-014 / §S-035 / F-002）。T-04-09 ---
  'members.section': '配下アカウント',
  // 🔴 ホスト（`OWNER` / `ADMIN`）向け。書き換えられないのは権限不足ではなく**役割分担**である。
  'members.readOnlyNote':
    'このお取引先のアカウントは、お取引先の管理者が管理します。ここでは状況の確認のみ行えます。',
  'members.empty': 'このお取引先のアカウントはまだありません。',
  'members.value.none': '—',

  'members.column.name': '氏名',
  'members.column.email': 'メールアドレス',
  'members.column.role': 'ロール',
  'members.column.status': '状態',
  'members.column.lastLogin': '最終ログイン',
  'members.column.actions': '操作',

  'members.status.ACTIVE': '有効',
  'members.status.REVOKED': '無効',
  'members.self': 'ご自身',

  // ロールの表示名（`CLAUDE.md` §10.1 の呼称に合わせる）。
  'members.role.OWNER': 'オーナー',
  'members.role.ADMIN': '管理者',
  'members.role.SALES': '営業',
  'members.role.PARTNER_ADMIN': '取引先管理者',
  'members.role.PARTNER_SALES': '取引先営業',
  'members.role.VIEWER': '閲覧のみ',

  // 🔴 ロール変更の確認ステップに出す「できること」（`docs/04` §S-035）。
  //    内容は `CLAUDE.md` §10.1 のロール階層そのもの。
  'members.roleCapability.OWNER': '組織の全権（契約・支払い・すべての設定の変更）',
  'members.roleCapability.ADMIN': 'メンバー管理・取引先の招待・公開範囲と設定の変更',
  'members.roleCapability.SALES': '案件・エンジニア・提案の作成と編集、承認、チャット',
  'members.roleCapability.PARTNER_ADMIN': '自社の営業アカウントと登録エンジニアの管理',
  'members.roleCapability.PARTNER_SALES':
    '自社エンジニアの更新、公開された案件の閲覧、提案、チャット',
  'members.roleCapability.VIEWER': '閲覧のみ（承認・送信・ダウンロードは行えません）',

  'members.roleChange.label': 'ロールを変更',
  'members.roleChange.submit': 'ロールを変更する',
  'members.roleChange.confirmTitle': 'ロール変更の確認',
  'members.roleChange.confirmBefore': '変更前',
  'members.roleChange.confirmAfter': '変更後',
  'members.roleChange.confirm': 'この内容で変更する',
  'members.roleChange.cancel': 'キャンセル',
  'members.roleChange.submitting': '変更しています…',
  'members.roleChange.done': 'ロールを変更しました。',
  'members.roleChange.error': '変更できませんでした。画面を更新してご確認ください。',

  'members.revoke.submit': '無効化',
  'members.revoke.confirmTitle': '無効化の確認',
  // 🔴 「何が起きて、何が起きないか」を両方書く（`docs/04` §S-035「データは削除されない」）。
  'members.revoke.confirmText':
    'このアカウントはサインインできなくなり、進行中の操作も行えなくなります。登録済みのエンジニア・提案・チャットは削除されません。',
  'members.revoke.confirm': '無効化する',
  'members.revoke.cancel': 'キャンセル',
  'members.revoke.submitting': '無効化しています…',
  'members.revoke.done': 'アカウントを無効化しました。',
  'members.revoke.error': '無効化できませんでした。画面を更新してご確認ください。',

  'members.invite.section': '自社アカウントの招待',
  'members.invite.email.label': 'メールアドレス',
  'members.invite.role.label': 'ロール',
  'members.invite.submit': '招待を送る',
  'members.invite.submitting': '送信しています…',
  // 🔴 「送信しました」と書かない（`docs/04` §S-014「非同期処理の表現」）。
  'members.invite.queued': '招待の送信を受け付けました。',
  // 🔴 保留は障害ではない（`BR-51` / `F-007 AC-5`）。招待そのものは作成されている。
  'members.invite.held':
    '招待を作成しました。送信元ドメインの検証が完了していないため、送信は保留しています（検証の完了後に自動で送信されます）。',
  'members.invite.error': '招待できませんでした。入力内容をご確認ください。',
  'members.invite.preNotice':
    'サンドボックス環境では招待メールが送信されません。発行後に表示されるリンクをお渡しください。',
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
