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

-- C2: 契約（ホストのみが読み書きする。パートナーの SELECT = C9 は T-02-07）。
INSERT INTO contracts (id, tenant_id, kind, state, counterparty_name, counterparty_partner_company_id) VALUES
  ('${CONTRACT_A_P1}', '${TENANT_A}', 'INDIVIDUAL', 'DRAFT', 'Partner A1', '${PARTNER_A1}');
`;
