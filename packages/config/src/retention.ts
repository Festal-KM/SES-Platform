// packages/config/src/retention.ts
// 🔴 保持期間削除（`F-046`。`retention.delete`）と `PURGED`（`F-064`。`tenant.purge`）の
//    **削除対象と残す対象の唯一の出所**（docs/05 §9.7 / `F-064 AC-3`）。
//
// 🔴 暗黙の全件削除・全件保持にしない。業務テーブルの全部が `delete` か `retain` のどちらかに現れる
//    ことを `tests/static/purge-spec-coverage.test.ts`（docs/05 §17.2 #12。T-10-09）がカタログ走査で検証する。
//    読むジョブは `tenant.purge`（`packages/db/src/tenant-purge.ts`。T-10-09）。`retention.delete`（Phase 2）も
//    同じ表を読む（2 箇所に別々の判断を書かない）。
//
// 🔴 `rows: 'ALL'` を持てるのは「保持期間の対象そのものが行である」表だけ。既定は列の消去であり、
//    行削除にすると FK の連鎖で他の業務データが消えうるため、新しい表に安易に付けない。
//
// 🔴 列の消去値（T-10-09）: 既定は NULL。NOT NULL の列は `{ name, erase }` で**消去後の値**を明示する
//    （`EMPTY_TEXT` = 空文字 / `EMPTY_JSON_ARRAY` = `[]` / `EMPTY_JSON_OBJECT` = `{}` /
//    `ROW_ID_TOKEN` = `purged:{id}`〔UNIQUE を保つ必要がある `users.email` だけ〕）。NULL 化できる列は
//    文字列で書く。**消去値の選択はこの表にだけ現れ、ジョブは値を判断しない。**
//
// 🔴 ここに置くのは環境によって変わらない方針値である（`limits.ts` / `anonymize.ts` と同じ規律）。
//    「試用環境だから削除しない / 期限を延ばす」に相当する値をここにも `schema.ts` にも置かない（`F-064 AC-9`）。

/** NOT NULL の列に書く消去後の値の種類。NULL 化できる列はこれを持たない（文字列だけで書く）。 */
export type PurgeErasure = 'EMPTY_TEXT' | 'EMPTY_JSON_ARRAY' | 'EMPTY_JSON_OBJECT' | 'ROW_ID_TOKEN';

/** 消去する列。文字列 = NULL 化。`{ name, erase }` = NOT NULL 列の消去値を明示。 */
export type PurgeColumn = string | { readonly name: string; readonly erase: PurgeErasure };

/**
 * ⚠️ 暫定であることの明示。人間の回答で `retain` へ移す可能性がある要素に、確認中の Issue を付ける。
 *    回答が来たら **この 1 要素だけ**を直す（ハンドラは `PURGE_SPEC` を読むだけなのでコードは変わらない）。
 *    `PENDING_ISSUE` = Issue 起票待ちの一時値（T-10-09 の 5 件は 2026-09-17 に [Issue #67] へ置き換え済み）。
 */
export type PurgeProvisional = `ISSUE-${number}` | 'PENDING_ISSUE';

/** 列の消去（既定）。 */
export type PurgeColumnsSpec = {
  readonly table: string;
  readonly columns: readonly PurgeColumn[];
  /**
   * 🔴 S3 のオブジェクトキーを持つ列（`skill_sheets.object_key` 等）。**①S3 の `DeleteObject` → ②列の消去**の順で
   *    処理する（docs/05 §9.7 / `docs/03` §4.12）。ここに載る列は `columns` にも載っていなければならない
   *    （実体を消して列を残さない）。
   * 🔴 載せてよいのは**値が `t/{tenantId}/…` の S3 キーである列だけ**。UUID 等の参照 ID を持つ列（`proposal_events.attachment_key`）
   *    を載せると `DeleteObject` がテナントプレフィックス検査で落ち続け、`PURGED` に到達しない。`listPurgeObjectKeys` は
   *    自テナントのプレフィックスでない値を `skipped` に分けて削除しに行かない（fail-closed）が、それは二重防御であり免罪符ではない。
   */
  readonly objectKeyColumns?: readonly string[];
  /** 消去済みの印を立てる列（`skill_sheets.purged_at` / `messages.purged_at` / `engineers.pii_purged_at`）。 */
  readonly purgedAtColumn?: string;
  readonly provisional?: PurgeProvisional;
};

/**
 * 🔴 行の物理削除。`role` / `description` / `technologies` が NOT NULL で、空文字の行を残しても
 *    意味が無い表（`engineer_careers`）だけに使う。
 */
export type PurgeRowsSpec = {
  readonly table: string;
  readonly rows: 'ALL';
  readonly provisional?: PurgeProvisional;
};

export type PurgeDeleteSpec = PurgeColumnsSpec | PurgeRowsSpec;

export type PurgeRetainSpec = {
  readonly table: string;
  readonly reason: string;
  readonly policy: 'RETAIN_ALL';
};

export const PURGE_SPEC = {
  delete: [
    // --- ① 集める（エンジニア台帳） ------------------------------------------------------------
    {
      table: 'engineers',
      columns: [
        'contact_email',
        'contact_phone',
        'birth_date',
        'preference_note',
        // 現所属会社名（PII 扱い。`CLAUDE.md` §3.2 / §3.3 PII 層）。
        'affiliation_label',
        // ⚠️ 氏名。`CLAUDE.md` §3.5 / `BR-29` の列挙（連絡先・スキルシート原本）に無いが、個人情報そのもの。
        //    T-10-09 は既定〔削除〕で置き、Issue 起票を申し送る（`engineer_careers` = Issue #48 と同型）。
        { name: 'display_name', erase: 'EMPTY_TEXT' },
      ],
      purgedAtColumn: 'pii_purged_at',
      provisional: 'ISSUE-67',
    },
    { table: 'skill_sheets', columns: ['object_key', 'note'], objectKeyColumns: ['object_key'], purgedAtColumn: 'purged_at' },
    { table: 'skill_sheet_extractions', columns: [{ name: 'payload', erase: 'EMPTY_JSON_OBJECT' }] },
    // 🔴 T-09-12（暫定。[Issue #48](https://github.com/Festal-KM/SES-Platform/issues/48) で確認中。docs/05 §9.7 / TBD-20）。
    //    `docs/02` 章 6.8 / A-24 の既定（保持期間は `SkillSheet` 原本に準じる）に従い「含める」で置くが、
    //    `CLAUDE.md` §3.5 / `BR-29` の削除対象の列挙（連絡先・スキルシート原本）には経歴が入っておらず、
    //    列挙への追加は上流の改訂 = 人間の承認事項である。B（含めない）なら `retain` へ移すだけ。
    //    列の NULL 化ではなく「行の削除」であることを `rows` で示す。
    { table: 'engineer_careers', rows: 'ALL', provisional: 'ISSUE-48' },
    // --- 利用者・招待・取引先の担当者（連絡先） ----------------------------------------------
    {
      // テナント利用者本人。`PURGED` 後にログインは不要（資格情報も消す = 誰もサインインできない）。
      table: 'users',
      columns: [
        { name: 'email', erase: 'ROW_ID_TOKEN' },
        { name: 'display_name', erase: 'EMPTY_TEXT' },
        { name: 'password_hash', erase: 'EMPTY_TEXT' },
        'password_reset_token_hash',
      ],
    },
    { table: 'invitations', columns: [{ name: 'email', erase: 'EMPTY_TEXT' }] },
    { table: 'partner_companies', columns: ['contact_name', 'contact_email'] },
    // --- ③ 提案（凍結 PII・宛先・本文・添付） ---------------------------------------------
    {
      table: 'engineer_snapshots',
      columns: [
        { name: 'display_name', erase: 'EMPTY_TEXT' },
        'affiliation_label',
        // 経歴の凍結コピー（`engineer_careers` と同じ判断 = Issue #48）。
        { name: 'careers', erase: 'EMPTY_JSON_ARRAY' },
      ],
      provisional: 'ISSUE-48',
    },
    {
      table: 'proposals',
      columns: [
        { name: 'recipient_email', erase: 'EMPTY_TEXT' },
        'subject',
        'body',
        'draft_body',
        // 送信基盤の失敗本文（宛先アドレスを含みうる）。
        'last_failure_reason',
      ],
    },
    // 🔴 `attachment_key` に `objectKeyColumns` を付けない。Phase 1 の #37（T-09-09）は添付した版の `skill_sheets.id`（UUID）を
    //    入れており S3 のキーではない。S3 の実体は `skill_sheets.object_key` 側で消す（UUID を `DeleteObject` に渡すと
    //    `S3ObjectStore` の `ObjectKeyOutOfTenantScopeError` で削除が永久に失敗し、`PURGED` に到達しない）。
    { table: 'proposal_events', columns: ['note', 'attachment_key'] },
    { table: 'proposal_requests', columns: [{ name: 'message', erase: 'EMPTY_TEXT' }, 'decline_reason'] },
    {
      // `findings[].excerpt` は検出した PII の本文そのもの。
      table: 'review_gates',
      columns: [
        { name: 'findings', erase: 'EMPTY_JSON_ARRAY' },
        { name: 'ai_warnings', erase: 'EMPTY_JSON_ARRAY' },
      ],
    },
    // ⚠️ 根拠文は匿名化済みの入力から生成される（§3.2）。個人情報を含まない設計だが、候補について述べた自由文であり既定〔削除〕。
    { table: 'match_candidates', columns: ['rationale'], provisional: 'ISSUE-67' },
    // --- チャット ---------------------------------------------------------------------------
    { table: 'messages', columns: ['body', 'attachment_key'], objectKeyColumns: ['attachment_key'], purgedAtColumn: 'purged_at' },
    // --- ⑤ 契約 / ⑥ 稼働 ------------------------------------------------------------------
    { table: 'contract_documents', columns: ['object_key', 'merge_result', 'signers'], objectKeyColumns: ['object_key'] },
    { table: 'contract_templates', columns: ['object_key'], objectKeyColumns: ['object_key'] },
    // 送信基盤の失敗本文（宛先アドレスを含みうる）。
    { table: 'contracts', columns: ['send_failure_reason'] },
    // ⚠️ `facts` は機械収集の根拠（エンジニアの属性を含みうる）、`summary` は AI 出力。既定〔削除〕。
    {
      table: 'extension_reviews',
      columns: [{ name: 'facts', erase: 'EMPTY_JSON_OBJECT' }, 'summary'],
      provisional: 'ISSUE-67',
    },
    // --- 横断（通知・送信・返却） -------------------------------------------------------------
    // ⚠️ 通知の見出しと差し込み値（氏名を含みうる）。既定〔削除〕。
    {
      table: 'notifications',
      columns: [{ name: 'title', erase: 'EMPTY_TEXT' }, { name: 'body_params', erase: 'EMPTY_JSON_OBJECT' }],
      provisional: 'ISSUE-67',
    },
    { table: 'email_dispatches', columns: [{ name: 'recipient_email', erase: 'EMPTY_TEXT' }, 'failure_reason'] },
    { table: 'send_attempts', columns: ['failure_detail'] },
    // 🔴 返却データ（CSV 一式）は個人情報の塊である。`PURGED` で実体も消す。
    { table: 'data_export_requests', columns: ['object_key'], objectKeyColumns: ['object_key'] },
  ],
  retain: [
    // --- 法令・請求・運用の根拠 --------------------------------------------------------------
    { table: 'audit_logs', reason: '法令上の保持義務がある範囲', policy: 'RETAIN_ALL' },
    { table: 'ai_usage', reason: '請求根拠', policy: 'RETAIN_ALL' },
    { table: 'usage_counters', reason: '請求根拠', policy: 'RETAIN_ALL' },
    { table: 'tenant_monthly_costs', reason: '請求根拠（月次の売上・原価）', policy: 'RETAIN_ALL' },
    { table: 'billing_meter_submissions', reason: '請求根拠（従量の提出記録）', policy: 'RETAIN_ALL' },
    { table: 'usage_measurement_findings', reason: '計測の検算記録。個人情報を含まない', policy: 'RETAIN_ALL' },
    { table: 'usage_limit_states', reason: '上限判定の記録。個人情報を含まない', policy: 'RETAIN_ALL' },
    { table: 'tenant_quota_overrides', reason: '契約条件の変更履歴（運営者の操作）', policy: 'RETAIN_ALL' },
    { table: 'tenant_purge_runs', reason: '削除完了の確認の唯一の根拠（F-062 AC-7）', policy: 'RETAIN_ALL' },
    { table: 'tenants', reason: 'PURGED の状態を記録する行そのもの。企業名は個人情報ではない', policy: 'RETAIN_ALL' },
    // --- 構造（個人情報を含まない業務データ。PURGED でも構造は残す） ------------------------------
    { table: 'memberships', reason: '所属とロールの構造。個人情報は users 側で消す', policy: 'RETAIN_ALL' },
    { table: 'engineer_skills', reason: 'スキル辞書への関連（匿名 5 項目の範囲）', policy: 'RETAIN_ALL' },
    { table: 'skill_aliases', reason: 'スキル表記ゆれの辞書。個人情報を含まない', policy: 'RETAIN_ALL' },
    { table: 'file_scan_results', reason: 'スキャン結果の記録。実体は skill_sheets 側で削除済み', policy: 'RETAIN_ALL' },
    { table: 'projects', reason: '案件（商流情報は業務データであり個人情報ではない）', policy: 'RETAIN_ALL' },
    { table: 'project_requirements', reason: '案件の要件', policy: 'RETAIN_ALL' },
    { table: 'project_visibilities', reason: '公開範囲の記録（越境経路 1 の根拠）', policy: 'RETAIN_ALL' },
    { table: 'project_publish_requests', reason: '公開要求の記録', policy: 'RETAIN_ALL' },
    { table: 'engineer_shares', reason: '匿名共有の設定履歴（経路 4 の根拠）', policy: 'RETAIN_ALL' },
    { table: 'chat_threads', reason: 'スレッドの構造。本文は messages 側で消す', policy: 'RETAIN_ALL' },
    { table: 'thread_participants', reason: '参加会社の記録（越境経路 3 の根拠）', policy: 'RETAIN_ALL' },
    { table: 'orders', reason: '発注・請求の記録', policy: 'RETAIN_ALL' },
    { table: 'assignments', reason: '稼働の記録（期間・状態）', policy: 'RETAIN_ALL' },
    { table: 'tasks', reason: 'ToDo の種別と対象 ID だけ', policy: 'RETAIN_ALL' },
    // --- 設定・接続 ---------------------------------------------------------------------------
    { table: 'tenant_sending_domains', reason: '送信ドメインの検証記録。企業のドメインであり個人情報ではない', policy: 'RETAIN_ALL' },
    {
      table: 'tenant_esign_connections',
      reason: '資格情報は暗号化済み（§8.6）。接続の失効は解約フロー（F-062。Phase 3）で invalidated_at を立てる',
      policy: 'RETAIN_ALL',
    },
    {
      table: 'two_factor_credentials',
      reason: '暗号化済みの秘密値。ログイン経路は users の資格情報の消去で閉じる',
      policy: 'RETAIN_ALL',
    },
    { table: 'tenant_role_approval_modes', reason: 'AI ロールの承認モード設定', policy: 'RETAIN_ALL' },
    { table: 'tenant_role_models', reason: 'AI ロールのモデル設定', policy: 'RETAIN_ALL' },
    { table: 'tenant_match_weights', reason: 'マッチング重みの設定', policy: 'RETAIN_ALL' },
    // --- C0 SYSTEM_ONLY / 運営データ（テナント文脈から触れない。docs/05 §4.4） ----------------------
    { table: 'scheduler_runs', reason: 'C0 SYSTEM_ONLY。テナント列を持たない', policy: 'RETAIN_ALL' },
    { table: 'webhook_deliveries', reason: 'C0 SYSTEM_ONLY。テナント列を持たず、payload は redact 済み', policy: 'RETAIN_ALL' },
    { table: 'email_events', reason: 'C0 SYSTEM_ONLY。配信イベントの記録', policy: 'RETAIN_ALL' },
    { table: 'impersonation_sessions', reason: 'C0 SYSTEM_ONLY。運営者の代理閲覧の記録（監査）', policy: 'RETAIN_ALL' },
    { table: 'announcements', reason: '運営者のお知らせ・機能フラグ（テナントの業務データではない）', policy: 'RETAIN_ALL' },
  ],
} as const satisfies {
  readonly delete: readonly PurgeDeleteSpec[];
  readonly retain: readonly PurgeRetainSpec[];
};

export type PurgeSpec = typeof PURGE_SPEC;

/** `PurgeColumn` の列名（文字列 / オブジェクトの両形から取る）。 */
export function purgeColumnName(column: PurgeColumn): string {
  return typeof column === 'string' ? column : column.name;
}

/** `PurgeColumn` の消去値の種類（NULL 化なら `null`）。 */
export function purgeColumnErasure(column: PurgeColumn): PurgeErasure | null {
  return typeof column === 'string' ? null : column.erase;
}

export function isPurgeRowsSpec(spec: PurgeDeleteSpec): spec is PurgeRowsSpec {
  return 'rows' in spec;
}
