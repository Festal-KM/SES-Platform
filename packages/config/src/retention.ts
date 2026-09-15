// packages/config/src/retention.ts
// 🔴 保持期間削除（`F-046`。`retention.delete`）と `PURGED`（`F-064`。`tenant.purge`）の
//    **削除対象と残す対象の唯一の出所**（docs/05 §9.7 / `F-064 AC-3`）。
//
// 🔴 暗黙の全件削除・全件保持にしない。業務テーブルの全部が `delete` か `retain` のどちらかに現れる
//    ことを docs/05 §17.2 のカタログ走査テストが検証する（削除ジョブ本体と走査テストは **SP-16**）。
//    T-09-12 の時点で置くのは設定値だけであり、ここを読むジョブはまだ無い。
//
// 🔴 `rows: 'ALL'` を持てるのは「保持期間の対象そのものが行である」表だけ。既定は列の NULL 化であり、
//    行削除にすると FK の連鎖で他の業務データが消えうるため、新しい表に安易に付けない。
//
// 🔴 ここに置くのは環境によって変わらない方針値である（`limits.ts` / `anonymize.ts` と同じ規律）。

/** 列の NULL 化（既定）。 */
export type PurgeColumnsSpec = {
  readonly table: string;
  readonly columns: readonly string[];
  /** S3 のオブジェクトも消す表（`skill_sheets.object_key` 等）。 */
  readonly objects?: 's3';
};

/**
 * 🔴 行の物理削除。`role` / `description` / `technologies` が NOT NULL で、空文字の行を残しても
 *    意味が無い表（`engineer_careers`）だけに使う。
 */
export type PurgeRowsSpec = {
  readonly table: string;
  readonly rows: 'ALL';
  /**
   * ⚠️ 暫定であることの明示。人間の回答で `retain` へ移す可能性がある要素に、確認中の Issue を付ける。
   *    回答が来たら **この 1 要素だけ**を直す（ハンドラは `PURGE_SPEC` を読むだけなのでコードは変わらない）。
   */
  readonly provisional?: `ISSUE-${number}`;
};

export type PurgeDeleteSpec = PurgeColumnsSpec | PurgeRowsSpec;

export type PurgeRetainSpec = {
  readonly table: string;
  readonly reason: string;
  readonly policy: 'RETAIN_ALL';
};

export const PURGE_SPEC = {
  delete: [
    { table: 'engineers', columns: ['contact_email', 'contact_phone', 'birth_date', 'preference_note'] },
    { table: 'skill_sheets', objects: 's3', columns: ['object_key'] },
    { table: 'skill_sheet_extractions', columns: ['payload'] },
    { table: 'messages', columns: ['body', 'attachment_key'] },
    // 🔴 T-09-12（暫定。[Issue #48](https://github.com/Festal-KM/SES-Platform/issues/48) で確認中。docs/05 §9.7 / TBD-20）。
    //    `docs/02` 章 6.8 / A-24 の既定（保持期間は `SkillSheet` 原本に準じる）に従い「含める」で置くが、
    //    `CLAUDE.md` §3.5 / `BR-29` の削除対象の列挙（連絡先・スキルシート原本）には経歴が入っておらず、
    //    列挙への追加は上流の改訂 = 人間の承認事項である。B（含めない）なら `retain` へ移すだけ。
    //    列の NULL 化ではなく「行の削除」であることを `rows` で示す。
    { table: 'engineer_careers', rows: 'ALL', provisional: 'ISSUE-48' },
  ],
  retain: [
    { table: 'audit_logs', reason: '法令上の保持義務がある範囲', policy: 'RETAIN_ALL' },
    { table: 'ai_usage', reason: '請求根拠', policy: 'RETAIN_ALL' },
    { table: 'usage_counters', reason: '請求根拠', policy: 'RETAIN_ALL' },
  ],
} as const satisfies {
  readonly delete: readonly PurgeDeleteSpec[];
  readonly retain: readonly PurgeRetainSpec[];
};

export type PurgeSpec = typeof PURGE_SPEC;
