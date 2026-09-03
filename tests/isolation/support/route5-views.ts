// tests/isolation/support/route5-views.ts
// docs/05 §4.9「許可列の一覧」（`BR-66` と 1 対 1）と、射影ビュー 4 本が依存してよい表の一覧。
//
// 🔴 単一出所（T-02-09 申し送り 2）: route5-counterparty.test.ts（T-02-07 の最小実証）と
//    rls-enforced.test.ts（T-02-09 #13 のカタログ走査）の両方がこの期待値を参照するため、
//    定義をここへ集約する。列・依存表の追加は人間の承認事項（`CLAUDE.md` §8.6）であり、
//    この一覧を書き換えることが即ちその承認を意味する。
export const ALLOWED_VIEW_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  partner_assignments_v: [
    'id',
    'tenant_id',
    'counterparty_partner_company_id',
    'engineer_id',
    'state',
    'start_date',
    'end_date',
    'project_name',
    'extension_review_open',
  ],
  partner_contracts_v: [
    'id',
    'tenant_id',
    'counterparty_partner_company_id',
    'kind',
    'state',
    'period_start',
    'period_end',
    'unit_price',
  ],
  partner_contract_documents_v: [
    'id',
    'tenant_id',
    'counterparty_partner_company_id',
    'contract_id',
    'version',
    'signed_at',
    'signers',
    'scan_status',
  ],
  partner_orders_v: [
    'id',
    'tenant_id',
    'counterparty_partner_company_id',
    'contract_id',
    'assignment_id',
    'payment_state',
    'period_start',
    'period_end',
    'amount',
  ],
};

export const VIEW_NAMES = Object.keys(ALLOWED_VIEW_COLUMNS);

/** docs/05 §4.9: ビュー 4 本が依存してよい表（基底 4 表 + `projects` + `project_visibilities`）。 */
export const ALLOWED_VIEW_DEPENDENCY_TABLES = [
  'assignments',
  'contracts',
  'contract_documents',
  'orders',
  'projects',
  'project_visibilities',
] as const;
