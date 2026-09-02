-- T-02-07（docs/sprints/SP-02-schema-isolation.md）: 越境経路 5（当事者レコードの参照）の
-- ポリシークラス C9 COUNTERPARTY_READ と、射影ビュー 4 本。
-- 一次資料: docs/05 §4.4 C9 / §4.9 / CLAUDE.md §3.1-5 / BR-65〜BR-69（Issue #8 で人間が承認した越境経路）。
--
-- 🔴 この経路の設計の要は「行と列を別々の機構で絞る」ことである:
--      行 = C9 の RLS ポリシー（当事者列の等値比較）
--      列 = 射影ビューの列集合（BR-66 の開示項目と 1 対 1）
--    アプリの `select` の書き分け・取得後のフィルタには一切頼らない
--    （docs/03 §4.3.2-1 / docs/02 申し送り 13-④「取得後のフィルタではなく取得時の射影」）。
--
-- 🔴 パートナー向けの書込ポリシーを 1 つも作らない（BR-68）。C2 の書込ポリシー（20260903050000）は
--    `app_is_host()` を含むためパートナー文脈では偽になり、INSERT/UPDATE/DELETE は 0 件更新になる。
-- 🔴 extension_reviews にはパートナー読み取りのポリシーを一切書かない（BR-67）。
--    ホスト内部の検討内容（renewal-advisor の出力を含む）は経路 5 の対象外である。
--    本ファイルに `extension_reviews` が現れるのは、このコメントと GRANT の非追加の記述だけである。

-- ============================================================================
-- 1. C9 COUNTERPARTY_READ（docs/05 §4.4。SELECT のみ）
-- ============================================================================
-- USING = `<T> = app_tenant_id() AND NOT app_is_host() AND <C> = app_partner_id()`。
-- 🔴 `NOT app_is_host()` を明示的に置く: これが無いとホスト文脈で C2 の SELECT と OR 結合され、
--    当事者列が NULL の行に対する意味が変わりうる。ホストの読みは C2 が担当し、C9 はパートナー専用である。
-- 🔴 `EXISTS` を使わず列の等値比較だけで判定する（docs/05 §4.4 C9。経路 1〜4 より速い）。
-- 🔴 `COUNT` もこのポリシー越しの自社分だけになる（件数からの推測を封じる。F-065 AC-3 / F-066 AC-4）。
DO $do$
DECLARE
  r record;
  expr text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('assignments',        ''),
      ('contracts',          ''),
      -- 🔴 署名済み最終版のみ（ドラフト版は行として存在しない。F-066 AC-2 / F-047 AC-8）
      ('contract_documents', ' AND signed_at IS NOT NULL'),
      ('orders',             '')
    ) AS v(tbl, extra)
  LOOP
    expr := format(
      '(tenant_id = app_tenant_id() AND NOT app_is_host() AND counterparty_partner_company_id = app_partner_id()%s)',
      r.extra
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c9_select', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO app_tenant USING %s', r.tbl || '_c9_select', r.tbl, expr);
  END LOOP;
END
$do$;

-- ============================================================================
-- 2. 射影ビュー 4 本（docs/05 §4.9）
-- ============================================================================
-- 🔴 `security_invoker = true` であること。ビューの所有者は app_migrator だが、基底表の RLS は
--    **呼び出し元（app_tenant）** の文脈で評価される。これが無いと所有者権限で素通りし、
--    C9 が効かないまま全パートナーの行が見える（経路 5 の前提が丸ごと崩れる）。
-- 🔴 許可列は docs/05 §4.9 の一覧と 1 対 1。`updated_at` / `created_at` は 4 本のいずれにも置かない。
--    列の追加は BR-66 の開示項目を増やすことであり、人間の承認事項（CLAUDE.md §8.6）。
-- 🔴 結合・副問い合わせを持つのは partner_assignments_v だけである（projects / project_visibilities。
--    いずれもパートナーが C4 / C5 で読める表）。C2 の表（extension_reviews / match_candidates 等）を
--    参照するビューは 1 本も無い。

DROP VIEW IF EXISTS partner_assignments_v;
CREATE VIEW partner_assignments_v WITH (security_invoker = true) AS
  SELECT a.id,
         a.tenant_id,
         a.counterparty_partner_company_id,
         a.engineer_id,
         a.state,
         a.start_date,
         a.end_date,
         p.name AS project_name,
         (a.state = 'EXTENSION_REVIEW') AS extension_review_open
  FROM assignments a
  LEFT JOIN projects p
    ON p.id = a.project_id
   AND p.tenant_id = a.tenant_id
   AND EXISTS (
         SELECT 1 FROM project_visibilities v
         WHERE v.tenant_id = a.tenant_id
           AND v.project_id = a.project_id
           AND v.partner_company_id = a.counterparty_partner_company_id
           AND v.revoked_at IS NULL
       );
-- 🔴 LEFT JOIN であること: 結合先 projects にも RLS（C4）が効き、パートナー文脈では未公開案件の行が
--    消える。INNER JOIN や CASE では**稼働行ごと**消えて F-065 AC-1 / S-044 を落とす
--    （「非公開の案件」として稼働の存在自体は見えなければならない）。
-- 🔴 EXISTS を ON 句に置くのは、ホストのプレビュー（全案件が見える文脈）でも取引先と同じ NULL を
--    得るためである（docs/05 §17.3 #21「プレビューが一致」）。
-- 🔴 extension_review_open は state からの導出であり extension_reviews を参照しない（BR-67）。
-- 🔴 unit_price / owner_user_id / review_opened_at / reminder30_sent_at / actual_leave_date は無い。
COMMENT ON VIEW partner_assignments_v IS
  'route5-projection: BR-66（案件名 / 稼働期間 / 契約満了日 / 延長確認の状態）。docs/05 §4.9';

DROP VIEW IF EXISTS partner_contracts_v;
CREATE VIEW partner_contracts_v WITH (security_invoker = true) AS
  SELECT id,
         tenant_id,
         counterparty_partner_company_id,
         kind,
         state,
         period_start,
         period_end,
         unit_price
  FROM contracts;
-- 🔴 unit_price は「自社（パートナー）とホストの間の契約単価」である（BR-66）。ホストの販売単価は
--    projects.internal_unit_price であり、経路 5 のどのビューにも現れない。
-- 🔴 counterparty_name / payment_terms / send_failure_reason / withdraw_reason / updated_at は無い。
COMMENT ON VIEW partner_contracts_v IS
  'route5-projection: BR-66（種別 / 状態 / 期間 / 自社との契約単価）。docs/05 §4.9';

DROP VIEW IF EXISTS partner_contract_documents_v;
CREATE VIEW partner_contract_documents_v WITH (security_invoker = true) AS
  SELECT id,
         tenant_id,
         counterparty_partner_company_id,
         contract_id,
         version,
         signed_at,
         signers,
         scan_status
  FROM contract_documents;
-- 🔴 object_key は無い（ダウンロードは docs/05 §14.2 の issueDownloadUrl 経由）。
-- 🔴 merge_result / normalized_status / external_document_id / review_gate_id / requested_at は無い。
-- 🔴 「署名済み最終版のみ」は C9 の `AND signed_at IS NOT NULL` が担う（ビュー側で WHERE を重ねない。
--    行の絞り込みは 1 箇所＝ RLS に集約する）。
COMMENT ON VIEW partner_contract_documents_v IS
  'route5-projection: BR-66（版 / 署名の状態 / 署名済みの最終版のみ）。docs/05 §4.9';

DROP VIEW IF EXISTS partner_orders_v;
CREATE VIEW partner_orders_v WITH (security_invoker = true) AS
  SELECT id,
         tenant_id,
         counterparty_partner_company_id,
         contract_id,
         assignment_id,
         payment_state,
         period_start,
         period_end,
         amount
  FROM orders;
-- 🔴 issued_on / created_at は無い（BR-66 は 状態 / 期間 / 金額 の 3 項目）。
COMMENT ON VIEW partner_orders_v IS
  'route5-projection: BR-66（状態 / 期間 / 金額）。docs/05 §4.9';

-- 🔴 T-02-09 への申し送り（カタログ走査 13 本を書く人へ）:
--    射影ビューは `pg_class.relkind = 'v'` であり、既存のヘルパ（readPublicTables /
--    readPublicBaseTables）の `relkind IN ('r','p')` からは既に除外されている。
--    ただし **ビューにも counterparty_partner_company_id 列がある**ため、テスト #11
--    （当事者列を持つ表が 4 表以外に増えていたら FAIL）を `pg_attribute` だけで書くと
--    ビュー 4 本を「5〜8 表目」として誤検知する。走査の母集団は必ず relkind で絞ること。
--    同様に #1〜#4（RLS 有効 / ポリシー 1 件以上 / ポリシー式 / 孤児表）も表だけを母集団にする
--    （ビューは RLS ポリシーを持てない）。ビュー自体の検査は #13 が担当する。

-- ============================================================================
-- 3. GRANT（docs/05 §4.9）
-- ============================================================================
-- 🔴 app_tenant にだけ SELECT を与える。app_platform / app_platform_write には GRANT しない
--    （運営者は経路 5 の射影に到達しない。BR-40 / CLAUDE.md §10.5）。
-- 🔴 SELECT のみ。ビューに INSERT / UPDATE / DELETE を GRANT しない（BR-68）。
--    加えて partner_assignments_v は結合と計算列を持つため PostgreSQL の自動更新可能ビューにならず、
--    仮に GRANT しても書き込みは失敗する（三重の担保: 型 / GRANT / ビューの構造）。
GRANT SELECT ON partner_assignments_v, partner_contracts_v, partner_contract_documents_v, partner_orders_v
  TO app_tenant;
