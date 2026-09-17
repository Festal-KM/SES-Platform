-- ============================================================================
-- T-11-07 運営者マスキングの二層と非開示の検証（docs/05 §5.5 第 1 層 = 列 GRANT / `CLAUDE.md` §10.5 /
-- `BR-40` / `BR-42`）—— `app_platform` の SELECT を**狭める**（REVOKE のみ。GRANT を 1 列も足さない）
-- ============================================================================
-- migration 20260904010000 は `CLAUDE.md` §10.5「運営者にも見せないもの」を §5.5 の表のとおり列 GRANT に落としたが、
-- 表に名指しされていない列のうち「運営者に必要なのは件数・状態・エラーであって内容ではない」の基準に照らして
-- **読める必要が無いもの**が 7 表に残っていた。T-11-01〜T-11-08 の実装と申し送りで、管理平面のどの DTO も
-- これらを select していないことが確定した（第 2 層は既に出していない）ので、第 1 層でも塞ぐ（片方だけにしない）。
-- 🔴 いずれも `packages/db/src/platform/**` の読み取り関数が参照していない列である（参照していれば `permission denied`
--    で `tests/isolation/admin-*.test.ts` が落ちる。ここは fail-closed の向きでしか間違えられない）。
--
-- ============================================================================
-- 🔴 判断事項 1: 利用者・取引先担当者・招待先の身元（PII）と、内部トークンのハッシュ
-- ============================================================================
-- `A-002` / `A-003` は席数と最終ログインを `memberships × users` の `groupBy` / `_max` で数えるだけで、
-- 利用者の氏名・メールアドレスを解決して出す経路を管理平面に置かない（docs/sprints/SP-11 §4-3 / T-11-01 決着）。
-- `partner_companies.contact_*` は取引先の担当者個人の氏名・連絡先、`invitations.email` は招待先本人の連絡先で、
-- どちらも運営者の業務に要らない（A-014 は招待の状態と期限だけを見る）。`password_reset_token_hash` / `token_hash`
-- はハッシュであっても運営者が読む理由が無い。
REVOKE SELECT (email, display_name, password_reset_token_hash) ON users FROM app_platform;
REVOKE SELECT (contact_name, contact_email) ON partner_companies FROM app_platform;
REVOKE SELECT (email, token_hash) ON invitations FROM app_platform;

-- ============================================================================
-- 🔴 判断事項 2: 送信ドメインの識別情報・失敗理由（`A-005` 項目 11 は状態・日時・本数だけ。T-11-06 決着 ③）
-- ============================================================================
-- `mail_from_domain` は `domain` から導ける値、`ses_identity_arn` は運営者自身の AWS リソースだが、いずれも項目 11 の
-- 表示に要らない。`last_failure_reason` は SES / DNS 検証の失敗の自由文で、宛先・ドメイン設定の内容が混じりうる。
-- 🔴 `dkim_tokens` は **GRANT を残す**: `listUnverifiedSendingDomains` が「利用者に提示している DNS レコードの本数」
--    （`expectedRecords`）を数えるためだけに読み、値は応答に出さない（第 2 層 + E2E #15 の禁止値で担保）。
--    DKIM トークンは公開 DNS に CNAME として載る値であり秘匿値ではない（schema.prisma の注記）。
REVOKE SELECT (ses_identity_arn, mail_from_domain, last_failure_reason) ON tenant_sending_domains FROM app_platform;

-- ============================================================================
-- 🔴 判断事項 3: `ai_usage` の生成由来（対象・モデル・プロンプト版・用途）
-- ============================================================================
-- 原価の分解は `role` で行う（docs/05 §5.9「`role` で `GROUP BY`」/ §10.2）。`A-004` / `A-005` 項目 17 / `A-011` が読むのは
-- `tenant_id` / `role` / `estimated_cost_usd` / `started_at`（+ 件数）だけである。`target_id` は提案・スキルシートの ID で、
-- 管理平面に ID から内容を引く API は無いが、行ごとの対象・モデル・プロンプト版を運営者に並べる理由も無い
-- （T-11-02 / T-11-04 / T-11-08 の申し送り ②⑨⑥）。
REVOKE SELECT (model_id, purpose, prompt_version, target_type, target_id) ON ai_usage FROM app_platform;

-- ============================================================================
-- 🔴 判断事項 4: 自由記述（理由・失敗理由）
-- ============================================================================
-- `tenant_quota_overrides.reason` は運営者自身の記述だが、`A-004` の DTO には載せず監査ログにも長さしか残さない
-- （T-11-02 決着）。顧客との交渉内容が書かれうるため、読み取り経路も残さない。
-- `tenant_purge_runs.failure_reason` は削除ジョブの失敗の自由文（DB エラー本文等）。`A-005` 項目 7 は件数・原因・時刻だけ
-- （T-11-04 決着）。🔴 `counts` は **GRANT を残す**: API-A12（`A-010` の削除完了の確認。docs/05 §6.9）の応答が
--    `{ cause, status, completedAt, counts }` であり、削除件数は返却データの内容ではない。
REVOKE SELECT (reason) ON tenant_quota_overrides FROM app_platform;
REVOKE SELECT (failure_reason) ON tenant_purge_runs FROM app_platform;

-- ----------------------------------------------------------------------------
-- 🔴 期待値の写し: `tests/isolation/support/platform-grants.ts`（`PLATFORM_READ_COLUMN_ALLOWLIST` から上記を外し、
--    `PLATFORM_READ_COLUMN_DENYLIST` に足した）。`roles.test.ts` / `rls-enforced.test.ts` が実測し、
--    `tests/static/platform-grants-consistency.test.ts` が両リストの交差が空であることを固定する。
-- ----------------------------------------------------------------------------
