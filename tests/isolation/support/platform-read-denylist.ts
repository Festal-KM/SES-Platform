// tests/isolation/support/platform-read-denylist.ts
// docs/05 §5.5「運営者に対するマスキング（二層）」第 1 層 = 列単位の GRANT。
// `CLAUDE.md` §10.5「運営者にも見せないもの: エンジニアの氏名 …」の実装担保。
//
// 🔴 単一出所（T-02-09 申し送り 3）: roles.test.ts（T-01-05/§4）と rls-enforced.test.ts
//    （T-02-09 #7）の両方がこの denylist を実測するため、定義をここへ集約する。
//    §5.5 の表自体が唯一の真実であり、ここは実測用の固定リストである
//    （表・列の追加を忘れても他のテストが自動で検知するわけではない）。
export const PLATFORM_READ_COLUMN_DENYLIST: Record<string, readonly string[]> = {
  engineers: [
    'display_name',
    'birth_date',
    'contact_email',
    'contact_phone',
    'affiliation_label',
    'city',
    'preference_note',
  ],
  skill_sheets: ['object_key'],
  skill_sheet_extractions: ['payload'],
  projects: ['end_client_name', 'internal_unit_price'],
  engineer_snapshots: ['display_name', 'affiliation_label', 'skills', 'careers'],
  proposals: ['subject', 'body', 'draft_body', 'recipient_email'],
  proposal_events: ['note', 'attachment_key'],
  review_gates: ['findings', 'ai_warnings'],
  proposal_requests: ['message', 'decline_reason'],
  messages: ['body', 'attachment_key'],
  assignments: ['unit_price'],
  contracts: ['unit_price', 'counterparty_name', 'payment_terms'],
  contract_documents: ['signers', 'object_key', 'merge_result'],
  contract_templates: ['object_key', 'mapping'],
  orders: ['amount'],
  tenant_esign_connections: ['credential_encrypted', 'connect_hmac_keys_encrypted', 'webhook_path_secret_encrypted'],
  two_factor_credentials: ['secret_encrypted', 'recovery_code_hashes'],
  users: ['password_hash'],
};
