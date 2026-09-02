// tests/isolation/support/fixtures.ts
// 二重防御テスト（docs/05 §4.7）とポリシークラス C0〜C8 の成立検証（T-02-06）の固定データ。
// 🔴 CLAUDE.md §5 Phase 0 の成功条件に合わせ、必ず 2 テナント以上を投入する（docs/05 §17.6）。
//    テナント A にはホストと **2 社のパートナー**を置く。パートナーが 1 社だけだと
//    「パートナー同士が相互に参照できない」（CLAUDE.md §3.1 の 🔴。最大の事故）を検証できない。
//
// 🔴 これは T-02-06 が各ポリシークラスの成立を最小限で確かめるための固定 SQL であり、
//    `seed:isolation`（packages/db/seed/presets/isolation.ts。packages/domain の transition() を
//    通して状態を進める本格版）は T-02-10 の範囲である。ここでは状態機械を経由しない
//    「静的な行」しか作らない（proposals は DRAFT、contracts は DRAFT のみ）。
//
// 🔴 superuser（postgres）で投入する。superuser は RLS を素通りするため、C0〜C8 の
//    ポリシー適用後もそのまま投入できる（tests/isolation/support/postgres.ts の ③）。

export const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
export const TENANT_B = '01930000-0000-7000-8000-0000000000b1';

/** テナント A に招待されている取引先企業（2 社）。 */
export const PARTNER_A1 = '01930000-0000-7000-8000-0000000000c1';
export const PARTNER_A2 = '01930000-0000-7000-8000-0000000000c2';

export const USER_A_HOST = '01930000-0000-7000-8000-0000000000d1';
export const USER_A_PARTNER = '01930000-0000-7000-8000-0000000000d2';
export const USER_B_HOST = '01930000-0000-7000-8000-0000000000d3';
export const USER_A_PARTNER2 = '01930000-0000-7000-8000-0000000000d4';

export const ENGINEER_A_HOST = '01930000-0000-7000-8000-0000000000e1';
export const ENGINEER_A_PARTNER = '01930000-0000-7000-8000-0000000000e2';
export const ENGINEER_B_HOST = '01930000-0000-7000-8000-0000000000e3';
export const ENGINEER_A_PARTNER2 = '01930000-0000-7000-8000-0000000000e4';

/** PARTNER_A1 にだけ公開した案件と、どこにも公開していない案件（C4 の正負）。 */
export const PROJECT_A_PUBLISHED = '01930000-0000-7000-8000-0000000000f1';
export const PROJECT_A_PRIVATE = '01930000-0000-7000-8000-0000000000f2';
export const REQUIREMENT_A_PUBLISHED = '01930000-0000-7000-8000-0000000000f3';
export const REQUIREMENT_A_PRIVATE = '01930000-0000-7000-8000-0000000000f4';
export const REVIEW_GATE_A_PUBLISH = '01930000-0000-7000-8000-0000000000f5';
export const VISIBILITY_A_P1 = '01930000-0000-7000-8000-0000000000f6';

export const SHARE_A_P1 = '01930000-0000-7000-8000-000000000101';
export const MATCH_A_P1 = '01930000-0000-7000-8000-000000000102';

export const PROPOSAL_A_HOST = '01930000-0000-7000-8000-000000000111';
export const PROPOSAL_A_P1 = '01930000-0000-7000-8000-000000000112';
export const PROPOSAL_A_P2 = '01930000-0000-7000-8000-000000000113';

export const THREAD_A_P1 = '01930000-0000-7000-8000-000000000121';
export const THREAD_A_P2 = '01930000-0000-7000-8000-000000000122';
export const MESSAGE_A_P1 = '01930000-0000-7000-8000-000000000123';
export const MESSAGE_A_P2 = '01930000-0000-7000-8000-000000000124';

export const TASK_A_HOST = '01930000-0000-7000-8000-000000000131';
export const TASK_A_P1 = '01930000-0000-7000-8000-000000000132';
export const NOTIFICATION_A_HOST = '01930000-0000-7000-8000-000000000133';
export const NOTIFICATION_A_PARTNER = '01930000-0000-7000-8000-000000000134';
export const TWO_FACTOR_A_HOST = '01930000-0000-7000-8000-000000000135';

export const SKILL_ALIAS_GLOBAL = '01930000-0000-7000-8000-000000000141';
export const SKILL_ALIAS_A = '01930000-0000-7000-8000-000000000142';
export const SKILL_ALIAS_B = '01930000-0000-7000-8000-000000000143';

export const ANNOUNCEMENT_ALL = '01930000-0000-7000-8000-000000000151';
export const ANNOUNCEMENT_A = '01930000-0000-7000-8000-000000000152';
export const ANNOUNCEMENT_B = '01930000-0000-7000-8000-000000000153';

export const SCHEDULER_RUN_SEED = '01930000-0000-7000-8000-000000000161';
export const CONTRACT_A_P1 = '01930000-0000-7000-8000-000000000171';

export const MEMBERSHIP_A_HOST = '01930000-0000-7000-8000-000000000181';
export const MEMBERSHIP_A_P1 = '01930000-0000-7000-8000-000000000182';
export const MEMBERSHIP_A_P2 = '01930000-0000-7000-8000-000000000183';
export const MEMBERSHIP_B_HOST = '01930000-0000-7000-8000-000000000184';

export const INVITATION_A_HOST = '01930000-0000-7000-8000-000000000191';
export const INVITATION_A_P1 = '01930000-0000-7000-8000-000000000192';

/** 招待トークン（平文）とそのハッシュ。行由来コンテキスト（docs/05 §4.4.2）の検証に使う。 */
export const INVITATION_A_HOST_TOKEN_HASH = 'seed-invitation-hash-host';
export const INVITATION_A_P1_TOKEN_HASH = 'seed-invitation-hash-partner1';

/** パスワード再設定トークンのハッシュ（USER_B_HOST に設定済み）。 */
export const PASSWORD_RESET_TOKEN_HASH_B = 'seed-password-reset-hash-b';

// ---------------------------------------------------------------------------
// T-02-07: 越境経路 5（当事者レコードの参照）の母集団（docs/05 §4.7 #8〜#10 / §4.9）
// ---------------------------------------------------------------------------
// 🔴 各パートナーが当事者の Assignment / Contract / ContractDocument / Order を 1 件ずつ持ち、
//    **同一案件（PROJECT_A_PUBLISHED）に両社の稼働を置く**。他社が当事者の行が同じ表・同じ案件に
//    あっても、一覧・COUNT・ID 直指定のいずれでも 0 件になることを確かめるための母集団である。
// 🔴 `packages/domain` の transition() を通した本格版のシード（seed:isolation）は T-02-10 の範囲。
//    ここは T-02-06 と同じく「静的な行」を置くだけである。

/** 未公開案件（PROJECT_A_PRIVATE）に紐づく提案。稼働の FK を張るためだけの行。 */
export const PROPOSAL_A_P1_PRIVATE = '01930000-0000-7000-8000-000000000114';

/** PARTNER_A1 が当事者。案件は PARTNER_A1 に公開済み → project_name が見える（F-065 AC-1）。 */
export const ASSIGNMENT_A_P1_PUBLISHED = '01930000-0000-7000-8000-0000000001a1';
/** PARTNER_A1 が当事者。案件は未公開 → 稼働行は見えるが project_name は NULL（F-065 AC-1）。 */
export const ASSIGNMENT_A_P1_PRIVATE = '01930000-0000-7000-8000-0000000001a2';
/** 🔴 PARTNER_A2 が当事者。PARTNER_A1 からは 1 件も見えてはならない。 */
export const ASSIGNMENT_A_P2 = '01930000-0000-7000-8000-0000000001a3';
/** 自社エンジニアの稼働（当事者列 NULL）。どのパートナーからも見えてはならない。 */
export const ASSIGNMENT_A_HOST = '01930000-0000-7000-8000-0000000001a4';

/** 🔴 PARTNER_A2 が当事者の契約。PARTNER_A1 からは 1 件も見えてはならない。 */
export const CONTRACT_A_P2 = '01930000-0000-7000-8000-000000000172';
/** 当事者列が NULL の契約（ホストとエンド企業の契約に相当）。 */
export const CONTRACT_A_HOST = '01930000-0000-7000-8000-000000000173';

/** 署名済みの最終版（PARTNER_A1 が当事者）。 */
export const CONTRACT_DOC_A_P1_SIGNED = '01930000-0000-7000-8000-0000000001b1';
/** 🔴 未署名のドラフト版。C9 の `signed_at IS NOT NULL` により行として存在しない（F-066 AC-2）。 */
export const CONTRACT_DOC_A_P1_DRAFT = '01930000-0000-7000-8000-0000000001b2';
/** 🔴 PARTNER_A2 が当事者の署名済み版。PARTNER_A1 からは見えてはならない。 */
export const CONTRACT_DOC_A_P2_SIGNED = '01930000-0000-7000-8000-0000000001b3';

export const ORDER_A_P1 = '01930000-0000-7000-8000-0000000001c1';
/** 🔴 PARTNER_A2 が当事者の発注。PARTNER_A1 からは見えてはならない。 */
export const ORDER_A_P2 = '01930000-0000-7000-8000-0000000001c2';

/** 🔴 ホスト内部の延長検討（BR-67）。パートナーはどの経路でも到達できてはならない。 */
export const EXTENSION_REVIEW_A_P1 = '01930000-0000-7000-8000-0000000001d1';

/** 経路 5 の射影に**現れてはならない**値。応答の JSON を走査して不在を確かめるために使う。 */
export const FORBIDDEN_MARKERS = {
  /** extension_reviews.facts / summary（ホスト内部の検討内容。BR-67）。 */
  extensionReviewFacts: 'host-internal-renewal-facts',
  extensionReviewSummary: 'host-internal-renewal-summary',
  /** contracts.payment_terms（BR-66 の開示項目に無い）。 */
  contractPaymentTerms: 'host-internal-payment-terms',
  /** contract_documents.object_key（ダウンロードは issueDownloadUrl 経由。§14.2）。 */
  contractDocumentObjectKey: 'host-internal-contract-object-key',
} as const;

export const SEED_SQL = `
-- 🔴 T-02-01: tenants に environment / lifecycle_changed_at / provisioning_request_id が
--    NOT NULL で追加された（docs/05 §3.3）。
INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, provisioning_request_id) VALUES
  ('${TENANT_A}', 'Tenant A', 'production', 'ACTIVE', now(), 'seed-provisioning-tenant-a'),
  ('${TENANT_B}', 'Tenant B', 'production', 'ACTIVE', now(), 'seed-provisioning-tenant-b');

-- 🔴 T-02-02: engineers.owner_partner_company_id が partner_companies への FK を持つようになった
--    （T-02-01 からの申し送り）ため、参照先の行を先に投入する。
INSERT INTO partner_companies (id, tenant_id, name, invited_at) VALUES
  ('${PARTNER_A1}', '${TENANT_A}', 'Partner A1', now()),
  ('${PARTNER_A2}', '${TENANT_A}', 'Partner A2', now());

INSERT INTO users (id, tenant_id, owner_partner_company_id, email, display_name, password_hash) VALUES
  ('${USER_A_HOST}',     '${TENANT_A}', NULL,            'host-a@example.test',     'Host A',     'seed-hash'),
  ('${USER_A_PARTNER}',  '${TENANT_A}', '${PARTNER_A1}', 'partner-a1@example.test', 'Partner A1', 'seed-hash'),
  ('${USER_A_PARTNER2}', '${TENANT_A}', '${PARTNER_A2}', 'partner-a2@example.test', 'Partner A2', 'seed-hash'),
  ('${USER_B_HOST}',     '${TENANT_B}', NULL,            'host-b@example.test',     'Host B',     'seed-hash');

-- 🔴 パスワード再設定の行由来コンテキスト（docs/05 §4.4.2）の検証用。テナント B の利用者に置く
--    ことで「メール／トークンからテナントが決まる」ことを確かめられる。
UPDATE users
   SET password_reset_token_hash = '${PASSWORD_RESET_TOKEN_HASH_B}',
       password_reset_expires_at = now() + interval '1 hour'
 WHERE id = '${USER_B_HOST}';

INSERT INTO memberships (id, tenant_id, user_id, role, partner_company_id, joined_at) VALUES
  ('${MEMBERSHIP_A_HOST}', '${TENANT_A}', '${USER_A_HOST}',     'SALES',         NULL,            now()),
  ('${MEMBERSHIP_A_P1}',   '${TENANT_A}', '${USER_A_PARTNER}',  'PARTNER_SALES', '${PARTNER_A1}', now()),
  ('${MEMBERSHIP_A_P2}',   '${TENANT_A}', '${USER_A_PARTNER2}', 'PARTNER_SALES', '${PARTNER_A2}', now()),
  ('${MEMBERSHIP_B_HOST}', '${TENANT_B}', '${USER_B_HOST}',     'SALES',         NULL,            now());

INSERT INTO invitations (id, tenant_id, email, role, partner_company_id, token_hash, expires_at, invited_by) VALUES
  ('${INVITATION_A_HOST}', '${TENANT_A}', 'invitee-host@example.test',    'SALES',         NULL,            '${INVITATION_A_HOST_TOKEN_HASH}', now() + interval '7 days', '${USER_A_HOST}'),
  ('${INVITATION_A_P1}',   '${TENANT_A}', 'invitee-partner@example.test', 'PARTNER_SALES', '${PARTNER_A1}', '${INVITATION_A_P1_TOKEN_HASH}',   now() + interval '7 days', '${USER_A_HOST}');

INSERT INTO engineers (id, tenant_id, owner_partner_company_id, display_name) VALUES
  ('${ENGINEER_A_HOST}',     '${TENANT_A}', NULL,             'Engineer A-Host'),
  ('${ENGINEER_A_PARTNER}',  '${TENANT_A}', '${PARTNER_A1}',  'Engineer A-Partner'),
  ('${ENGINEER_A_PARTNER2}', '${TENANT_A}', '${PARTNER_A2}',  'Engineer A-Partner2'),
  ('${ENGINEER_B_HOST}',     '${TENANT_B}', NULL,             'Engineer B-Host');

-- C1: グローバル行（tenant_id IS NULL）と各テナント固有の別名（F-010 AC-2）。
INSERT INTO skill_aliases (id, tenant_id, alias, status, origin) VALUES
  ('${SKILL_ALIAS_GLOBAL}', NULL,          'React.js',  'ACCEPTED', 'HUMAN'),
  ('${SKILL_ALIAS_A}',      '${TENANT_A}', 'ReactJS-A', 'ACCEPTED', 'HUMAN'),
  ('${SKILL_ALIAS_B}',      '${TENANT_B}', 'ReactJS-B', 'ACCEPTED', 'HUMAN');

-- C1（読み替え）: 全テナント宛と特定テナント宛のお知らせ。
INSERT INTO announcements (id, kind, target_tenant_ids, title_key, body_key, created_by) VALUES
  ('${ANNOUNCEMENT_ALL}', 'NOTICE', ARRAY[]::uuid[],             'announce.all.title', 'announce.all.body', '${USER_A_HOST}'),
  ('${ANNOUNCEMENT_A}',   'NOTICE', ARRAY['${TENANT_A}']::uuid[], 'announce.a.title',   'announce.a.body',   '${USER_A_HOST}'),
  ('${ANNOUNCEMENT_B}',   'NOTICE', ARRAY['${TENANT_B}']::uuid[], 'announce.b.title',   'announce.b.body',   '${USER_A_HOST}');

-- C0: テナントキーを持たない表（withSystemScope からのみ到達できる）。
INSERT INTO scheduler_runs (id, job_name, run_key, status) VALUES
  ('${SCHEDULER_RUN_SEED}', 'assignment.expiry-scan', 'assignment.expiry-scan:2026-09-03T09:00+09:00', 'OK');

-- C2 / C4: 公開済みの案件（PARTNER_A1 のみ）と未公開の案件。
INSERT INTO projects (id, tenant_id, name, end_client_name, internal_unit_price, public_summary, status) VALUES
  ('${PROJECT_A_PUBLISHED}', '${TENANT_A}', 'Project A Published', 'End Client A', 900000, '公開用の概要', 'OPEN'),
  ('${PROJECT_A_PRIVATE}',   '${TENANT_A}', 'Project A Private',   'End Client B', 800000, NULL,          'OPEN');

INSERT INTO project_requirements (id, tenant_id, project_id, kind, free_text) VALUES
  ('${REQUIREMENT_A_PUBLISHED}', '${TENANT_A}', '${PROJECT_A_PUBLISHED}', 'MUST', 'TypeScript 3 年'),
  ('${REQUIREMENT_A_PRIVATE}',   '${TENANT_A}', '${PROJECT_A_PRIVATE}',   'MUST', 'Go 3 年');

-- 公開時のゲート結果（project_visibilities.review_gate_id の FK 先）。
INSERT INTO review_gates (
  id, tenant_id, owner_partner_company_id, target_type, target_id, content_hash,
  execution, pii_verdict, commerce_verdict, consistency_verdict, findings, ai_warnings, executed_at
) VALUES (
  '${REVIEW_GATE_A_PUBLISH}', '${TENANT_A}', NULL, 'PROJECT_PUBLISH', '${PROJECT_A_PUBLISHED}', 'seed-content-hash',
  'DONE', 'PASS', 'PASS', 'PASS', '[]'::jsonb, '[]'::jsonb, now()
);

-- 🔴 越境経路 1 の唯一の根拠（PARTNER_A1 にだけ公開する）。
INSERT INTO project_visibilities (id, tenant_id, project_id, partner_company_id, published_at, published_by, review_gate_id) VALUES
  ('${VISIBILITY_A_P1}', '${TENANT_A}', '${PROJECT_A_PUBLISHED}', '${PARTNER_A1}', now(), '${USER_A_HOST}', '${REVIEW_GATE_A_PUBLISH}');

-- 🔴 越境経路 4 の唯一の根拠（PARTNER_A1 が自社エンジニアを匿名共有する）。
INSERT INTO engineer_shares (id, tenant_id, engineer_id, partner_company_id, shared_at, shared_by) VALUES
  ('${SHARE_A_P1}', '${TENANT_A}', '${ENGINEER_A_PARTNER}', '${PARTNER_A1}', now(), '${USER_A_PARTNER}');

-- C2: マッチング候補（ホストだけが読む）。
INSERT INTO match_candidates (id, tenant_id, project_id, engineer_id, is_anonymous, computed_at) VALUES
  ('${MATCH_A_P1}', '${TENANT_A}', '${PROJECT_A_PUBLISHED}', '${ENGINEER_A_PARTNER}', true, now());

-- C5: ホスト / PARTNER_A1 / PARTNER_A2 の提案を 1 件ずつ（他社の提案が見えないことの検証）。
INSERT INTO proposals (id, tenant_id, owner_partner_company_id, project_id, engineer_id, state, recipient_company_name, recipient_email, created_by) VALUES
  ('${PROPOSAL_A_HOST}', '${TENANT_A}', NULL,             '${PROJECT_A_PUBLISHED}', '${ENGINEER_A_HOST}',     'DRAFT', 'Client Co', 'client@example.test', '${USER_A_HOST}'),
  ('${PROPOSAL_A_P1}',   '${TENANT_A}', '${PARTNER_A1}',  '${PROJECT_A_PUBLISHED}', '${ENGINEER_A_PARTNER}',  'DRAFT', 'Client Co', 'client@example.test', '${USER_A_PARTNER}'),
  ('${PROPOSAL_A_P2}',   '${TENANT_A}', '${PARTNER_A2}',  '${PROJECT_A_PUBLISHED}', '${ENGINEER_A_PARTNER2}', 'DRAFT', 'Client Co', 'client@example.test', '${USER_A_PARTNER2}');

-- C6: 会社単位スレッド（ホスト × 各パートナー）。🔴 1 スレッドに複数パートナーは同席しない。
INSERT INTO chat_threads (id, tenant_id, kind, partner_company_id) VALUES
  ('${THREAD_A_P1}', '${TENANT_A}', 'COMPANY', '${PARTNER_A1}'),
  ('${THREAD_A_P2}', '${TENANT_A}', 'COMPANY', '${PARTNER_A2}');

-- 🔴 越境経路 3 の唯一の根拠。
INSERT INTO thread_participants (id, tenant_id, thread_id, partner_company_id, joined_at) VALUES
  ('01930000-0000-7000-8000-000000000125', '${TENANT_A}', '${THREAD_A_P1}', NULL,            now()),
  ('01930000-0000-7000-8000-000000000126', '${TENANT_A}', '${THREAD_A_P1}', '${PARTNER_A1}', now()),
  ('01930000-0000-7000-8000-000000000127', '${TENANT_A}', '${THREAD_A_P2}', NULL,            now()),
  ('01930000-0000-7000-8000-000000000128', '${TENANT_A}', '${THREAD_A_P2}', '${PARTNER_A2}', now());

INSERT INTO messages (id, tenant_id, owner_partner_company_id, thread_id, sender_user_id, sender_partner_company_id, body) VALUES
  ('${MESSAGE_A_P1}', '${TENANT_A}', '${PARTNER_A1}', '${THREAD_A_P1}', '${USER_A_PARTNER}',  '${PARTNER_A1}', 'partner1 からの本文'),
  ('${MESSAGE_A_P2}', '${TENANT_A}', '${PARTNER_A2}', '${THREAD_A_P2}', '${USER_A_PARTNER2}', '${PARTNER_A2}', 'partner2 からの本文');

-- C5: タスク（ホスト担当 / パートナー担当）。
INSERT INTO tasks (id, tenant_id, owner_partner_company_id, kind, target_type, target_id, due_on, assignee_user_id) VALUES
  ('${TASK_A_HOST}', '${TENANT_A}', NULL,            'INTERVIEW', 'Proposal', '${PROPOSAL_A_HOST}', current_date, '${USER_A_HOST}'),
  ('${TASK_A_P1}',   '${TENANT_A}', '${PARTNER_A1}', 'INTERVIEW', 'Proposal', '${PROPOSAL_A_P1}',   current_date, '${USER_A_PARTNER}');

-- C7: 通知（受信者本人だけが読む）。
INSERT INTO notifications (id, tenant_id, recipient_user_id, kind, title, body_key, body_params) VALUES
  ('${NOTIFICATION_A_HOST}',    '${TENANT_A}', '${USER_A_HOST}',    'PROPOSAL_SUBMITTED', 'ホスト宛',     'notify.host', '{}'::jsonb),
  ('${NOTIFICATION_A_PARTNER}', '${TENANT_A}', '${USER_A_PARTNER}', 'PROPOSAL_SUBMITTED', 'パートナー宛', 'notify.p1',   '{}'::jsonb);

-- C7: 2 要素認証（本人のみ）。
INSERT INTO two_factor_credentials (id, subject_type, subject_id, tenant_id, secret_encrypted, recovery_code_hashes) VALUES
  ('${TWO_FACTOR_A_HOST}', 'USER', '${USER_A_HOST}', '${TENANT_A}', 'enc:seed', ARRAY['hash1']::text[]);

-- ---------------------------------------------------------------------------
-- 越境経路 5（当事者レコードの参照。T-02-07。docs/05 §4.4 C9 / §4.9 / BR-65〜BR-69）
-- ---------------------------------------------------------------------------
-- 🔴 各社が当事者の Assignment / Contract / ContractDocument / Order を 1 件ずつ持ち、
--    同一案件（PROJECT_A_PUBLISHED）に PARTNER_A1 と PARTNER_A2 の稼働を置く。

-- 未公開案件に紐づく提案（稼働の FK を張るための行。公開後に取り消された案件に相当する）。
INSERT INTO proposals (id, tenant_id, owner_partner_company_id, project_id, engineer_id, state, recipient_company_name, recipient_email, created_by) VALUES
  ('${PROPOSAL_A_P1_PRIVATE}', '${TENANT_A}', '${PARTNER_A1}', '${PROJECT_A_PRIVATE}', '${ENGINEER_A_PARTNER}', 'WON', 'Client Co', 'client@example.test', '${USER_A_PARTNER}');

-- C2（ホストの読み書き）/ C9（パートナーの SELECT）。
-- 🔴 unit_price は「自社（パートナー）とホストの間の契約単価」。ホストの販売単価は
--    projects.internal_unit_price（900000 / 800000）であり、経路 5 のどのビューにも現れない。
-- 🔴 CHECK (state <> 'EXECUTED' OR executed_at IS NOT NULL) があるため executed_at は INSERT で入れる
--    （EXECUTED 行は BEFORE UPDATE トリガで書き換えられない。あとから UPDATE で補えない）。
INSERT INTO contracts (id, tenant_id, kind, state, counterparty_name, counterparty_partner_company_id, unit_price, period_start, period_end, payment_terms, executed_at) VALUES
  ('${CONTRACT_A_P1}',   '${TENANT_A}', 'INDIVIDUAL', 'DRAFT',    'Partner A1',   '${PARTNER_A1}', 650000, DATE '2026-10-01', DATE '2027-03-31', '${FORBIDDEN_MARKERS.contractPaymentTerms}', NULL),
  ('${CONTRACT_A_P2}',   '${TENANT_A}', 'INDIVIDUAL', 'DRAFT',    'Partner A2',   '${PARTNER_A2}', 700000, DATE '2026-10-01', DATE '2027-03-31', '${FORBIDDEN_MARKERS.contractPaymentTerms}', NULL),
  ('${CONTRACT_A_HOST}', '${TENANT_A}', 'MASTER',     'EXECUTED', 'End Client A', NULL,            900000, DATE '2026-04-01', DATE '2027-03-31', '${FORBIDDEN_MARKERS.contractPaymentTerms}', now());

-- 🔴 署名済み最終版（C9 で見える）とドラフト版（C9 の signed_at IS NOT NULL で消える）を対にして置く。
INSERT INTO contract_documents (id, tenant_id, counterparty_partner_company_id, contract_id, version, object_key, scan_status, signed_at, signers) VALUES
  ('${CONTRACT_DOC_A_P1_DRAFT}',  '${TENANT_A}', '${PARTNER_A1}', '${CONTRACT_A_P1}', 1, '${FORBIDDEN_MARKERS.contractDocumentObjectKey}', 'CLEAN', NULL,  '[{"role":"HOST","routingOrder":1,"status":"CREATED"}]'::jsonb),
  ('${CONTRACT_DOC_A_P1_SIGNED}', '${TENANT_A}', '${PARTNER_A1}', '${CONTRACT_A_P1}', 2, '${FORBIDDEN_MARKERS.contractDocumentObjectKey}', 'CLEAN', now(), '[{"role":"HOST","routingOrder":1,"status":"SIGNED"},{"role":"PARTNER","routingOrder":2,"status":"SIGNED"}]'::jsonb),
  ('${CONTRACT_DOC_A_P2_SIGNED}', '${TENANT_A}', '${PARTNER_A2}', '${CONTRACT_A_P2}', 1, '${FORBIDDEN_MARKERS.contractDocumentObjectKey}', 'CLEAN', now(), '[{"role":"HOST","routingOrder":1,"status":"SIGNED"}]'::jsonb);

-- 🔴 同一案件（PROJECT_A_PUBLISHED）に PARTNER_A1 / PARTNER_A2 / 自社の稼働を置く。
--    ASSIGNMENT_A_P1_PRIVATE だけが未公開案件（PROJECT_A_PRIVATE）に紐づく（F-065 AC-1 の NULL 経路）。
INSERT INTO assignments (id, tenant_id, engineer_id, project_id, proposal_id, counterparty_partner_company_id, state, start_date, end_date, unit_price, owner_user_id) VALUES
  ('${ASSIGNMENT_A_P1_PUBLISHED}', '${TENANT_A}', '${ENGINEER_A_PARTNER}',  '${PROJECT_A_PUBLISHED}', '${PROPOSAL_A_P1}',         '${PARTNER_A1}', 'ACTIVE',            DATE '2026-10-01', DATE '2027-03-31', 650000, '${USER_A_HOST}'),
  ('${ASSIGNMENT_A_P1_PRIVATE}',   '${TENANT_A}', '${ENGINEER_A_PARTNER}',  '${PROJECT_A_PRIVATE}',   '${PROPOSAL_A_P1_PRIVATE}', '${PARTNER_A1}', 'EXTENSION_REVIEW',  DATE '2026-04-01', DATE '2026-09-30', 600000, '${USER_A_HOST}'),
  ('${ASSIGNMENT_A_P2}',           '${TENANT_A}', '${ENGINEER_A_PARTNER2}', '${PROJECT_A_PUBLISHED}', '${PROPOSAL_A_P2}',         '${PARTNER_A2}', 'ACTIVE',            DATE '2026-10-01', DATE '2027-03-31', 700000, '${USER_A_HOST}'),
  ('${ASSIGNMENT_A_HOST}',         '${TENANT_A}', '${ENGINEER_A_HOST}',     '${PROJECT_A_PUBLISHED}', '${PROPOSAL_A_HOST}',       NULL,            'ACTIVE',            DATE '2026-10-01', DATE '2027-03-31', 800000, '${USER_A_HOST}');

INSERT INTO orders (id, tenant_id, counterparty_partner_company_id, contract_id, assignment_id, amount, period_start, period_end, payment_state) VALUES
  ('${ORDER_A_P1}', '${TENANT_A}', '${PARTNER_A1}', '${CONTRACT_A_P1}', '${ASSIGNMENT_A_P1_PUBLISHED}', 650000, DATE '2026-10-01', DATE '2026-10-31', 'UNPAID'),
  ('${ORDER_A_P2}', '${TENANT_A}', '${PARTNER_A2}', '${CONTRACT_A_P2}', '${ASSIGNMENT_A_P2}',           700000, DATE '2026-10-01', DATE '2026-10-31', 'UNPAID');

-- 🔴 ホスト内部の延長検討（BR-67）。当事者列を持たず、パートナー向けポリシーも射影も存在しない。
INSERT INTO extension_reviews (id, tenant_id, assignment_id, opened_at, owner_user_id, facts, summary) VALUES
  ('${EXTENSION_REVIEW_A_P1}', '${TENANT_A}', '${ASSIGNMENT_A_P1_PRIVATE}', now(), '${USER_A_HOST}',
   '{"note":"${FORBIDDEN_MARKERS.extensionReviewFacts}"}'::jsonb,
   '{"note":"${FORBIDDEN_MARKERS.extensionReviewSummary}"}'::jsonb);
`;
