-- ============================================================================
-- T-09-13 ゲート実行文脈からパートナー台帳を読む限定経路 `app_gate_probe`
-- （docs/05 §11.14。Issue #41 = 選択肢 1〔2026-09-10 に人間が回答〕。§4.7 #16 / 二重防御 #12〜#14）
-- ============================================================================
-- 本 migration が置くのは 1 つだけである:
--   専用ロール `app_gate_probe` + SECURITY DEFINER 関数 2 本
--   —— `GATE_RUNNING` の提案 1 件について、その対象エンジニアの
--      「PII 層の既知値 5 列」と「整合層の裏付け 3 列」だけを、ホスト文脈のジョブから読む限定経路。
--
-- ============================================================================
-- 🔴 判断事項 1: なぜ要るのか（docs/05 §11.9 ⑦ / §11.14 ①）
-- ============================================================================
-- `gate.run` はジョブの**ホスト文脈**（`systemTenantCtx`。docs/05 §9.2 は partner_company_id を
-- 常に null と定める）で走る。`engineers` / `engineer_skills` は **C3 OWNER_SCOPED** であり、
-- ホスト文脈からは `owner_partner_company_id IS NULL` の行しか見えない。したがって
-- **パートナーが作成した提案は `ReviewGate` を 1 行も書かずに落ちていた**（fail-closed）。
-- 「パートナーが提案 → ホストが承認 → 送信」は `CLAUDE.md` §5 の Phase 1 成功条件 1 そのものである。
--
-- ============================================================================
-- 🔴 判断事項 2: 読む列は「整合層の 3 列」だけでは足りない（docs/05 §11.14 ②）
-- ============================================================================
-- `mask()` は既知値（主）+ パターン検出（補助）で伏せ、`gate-inspector` は伏せ字を指摘しない。
-- 機械的 PII 検出は既知値しか見ない（署名のメールで毎回 FAIL にしないため）。
-- したがって **`knownPii.emails` が空なら、エンジニア本人のメールが本文に残ったまま PII 層 PASS**
-- になる（電話・生年月日も同じ）。ホスト所属では台帳が読めるので起きない ——
-- **所属で PII 層の強さが変わる非対称を作らない**ために、PII 層の既知値 5 列も読む。
-- これは `loadProposalGateInput` がホスト所属について従来 `tx.engineer.findUnique` /
-- `tx.engineerSkill.findMany` で読んでいた列と**ちょうど同じ集合**である（それ以上を足していない）。
--
-- ============================================================================
-- 🔴 判断事項 3: 「汎用のエスケープハッチではない」ことの担保（docs/05 §11.14 ⑤）
-- ============================================================================
--   1. 鍵は **`proposal_id`** であり `engineer_id` ではない。返るのは常に「その提案の対象 1 人分」。
--      `engineers.owner_partner_company_id` に GRANT が無いので、所有者で絞る述語は**書けない**。
--   2. **`proposals.state = 'GATE_RUNNING'` の間しか 1 行も返らない**（#39 の認可を通った事実。
--      自己申告の GUC ではなくデータ由来の条件なので GUC は置かない）。
--   3. **ID を 1 つも返さない**（`engineer_id` / `owner_partner_company_id` / `proposal_id` / 行 ID）。
--      リレーションを辿って再び開く形が存在しない（T-08-03 の `SharedCandidateDb` の事故の再発を形で断つ）。
--   4. **ホスト文脈からしか呼べない**（`app_is_host()`）。`TenantDb` に `$queryRaw` が無いため
--      `apps/**` から直接呼ぶ経路も無い。
--   5. TS の呼び出し元は `packages/db/src/gate-engineer-facts.ts` の 1 ファイル、その消費者は
--      `packages/db/src/gate-target.ts` の 1 関数（`tests/static/gate-engineer-facts-single-path.test.ts`）。
--   6. **書けない**（`GRANT SELECT` のみ）。
--
-- ============================================================================
-- 🔴 射程の外（docs/05 §11.14 ⑨）
-- ============================================================================
-- `SkillSheetExtraction` の生成（SP-14）と Phase 2 の `SKILL_SHEET_SHARE` には本ロール・本関数を
-- 流用しない。**`app_gate_probe` に列や表を足して他の用途を通そうとしないこと。**

-- ============================================================================
-- 1. app_gate_probe への最小 GRANT（合計 16 列。テーブル単位の GRANT は 0）
-- ============================================================================
GRANT USAGE ON SCHEMA public TO app_gate_probe;

-- 🔴 鍵の解決に要る 4 列だけ。subject / body / 提案先 / 単価には届かない。
--    proposals は C5（ホストが全行を読める）なので、この 4 列で開示は 1 つも増えない。
GRANT SELECT (id, tenant_id, engineer_id, state) ON proposals TO app_gate_probe;

-- 🔴 PII 層の既知値 5 列 + 結合キー 2 列。owner_partner_company_id は**与えない**（判断事項 3-1）。
--    unit_price_min / unit_price_max / city / prefecture / remote_mode / availability /
--    available_from / preference_note / retention_expires_at / pii_purged_at にも与えない。
GRANT SELECT (tenant_id, id, display_name, birth_date, contact_email, contact_phone, affiliation_label)
  ON engineers TO app_gate_probe;

-- 🔴 整合層の照合 3 列 + 結合キー 2 列。original_label / normalized_* / source は与えない
--    （整合層は skill_id と数値しか照合しない。docs/05 §11.8 ③）。
GRANT SELECT (tenant_id, engineer_id, skill_id, years_of_experience, level)
  ON engineer_skills TO app_gate_probe;

-- 🔴 ポリシー。パートナー境界は課さないが**テナント境界は課す**（app_scan_probe と同形。§4.7 #3 を通る）。
DROP POLICY IF EXISTS proposals_gate_probe_select ON proposals;
CREATE POLICY proposals_gate_probe_select ON proposals FOR SELECT TO app_gate_probe
  USING (tenant_id = app_tenant_id());
DROP POLICY IF EXISTS engineers_gate_probe_select ON engineers;
CREATE POLICY engineers_gate_probe_select ON engineers FOR SELECT TO app_gate_probe
  USING (tenant_id = app_tenant_id());
DROP POLICY IF EXISTS engineer_skills_gate_probe_select ON engineer_skills;
CREATE POLICY engineer_skills_gate_probe_select ON engineer_skills FOR SELECT TO app_gate_probe
  USING (tenant_id = app_tenant_id());

-- 🔴 ALTER FUNCTION ... OWNER TO は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを
--    要求する（PostgreSQL の仕様）。**実行時にだけ**付与し、直後に剥がす
--    （境界バイパスロールにスキーマ作成権を常置しない。migration 20260908000000 と同じ）。
GRANT CREATE ON SCHEMA public TO app_gate_probe;

-- ============================================================================
-- 🔴 判断事項 4: `SET search_path = public, pg_temp`（T-09-13 レビューで是正。docs/05 §11.14 ⑩）
-- ============================================================================
-- `SET search_path = public` だけだと、PostgreSQL はリレーション名の解決で**一時スキーマを最初に**探す
-- （`pg_temp` を明示しない限り暗黙に先頭へ入る）。呼び出し側（`app_tenant`）が
--   CREATE TEMP TABLE proposals(id uuid, tenant_id uuid, engineer_id uuid, state text);
--   GRANT SELECT ON pg_temp.proposals TO app_gate_probe;
--   INSERT INTO proposals VALUES (任意 uuid, 自テナント, 他社の engineer_id, 'GATE_RUNNING');
-- と仕込むと、関数本体の `FROM proposals p` がその一時表を読み、**判断事項 3-1（鍵が proposal_id）と
-- 3-2（GATE_RUNNING の間だけ）の両方が迂回される**（code-reviewer が実 DB で再現。テナント境界だけは
-- `engineers` のポリシーが守った）。`pg_temp` を**末尾に明示**すると本体の `public.proposals` が先に解決され、
-- 一時表は届かない（公式「Writing SECURITY DEFINER Functions Safely」）。
-- 🔴 既存の SECURITY DEFINER 関数 6 本にも同じ穴があったため、migration 20260918010000 で横断適用した。
--    回帰は `tests/isolation/gate-engineer-facts.test.ts` #14 ④ と `rls-enforced.test.ts` の横断検査が固定する。

-- ============================================================================
-- 2-a. app_gate_proposal_engineer_pii: PII 層の既知値（🔴 ちょうど 0 行または 1 行。ID を返さない）
-- ============================================================================
-- 🔴 2 本に分ける理由（docs/05 §11.14 ④）: PII の 1 行とスキルの N 行を LEFT JOIN で 1 つの
--    RETURNS TABLE にすると、PII が行数ぶん複製されて返る / スキル 0 件のときに NULL 列付きで
--    1 行になる、という形の曖昧さが呼び出し側に写る。戻り値の形が固定であることが要。
CREATE FUNCTION app_gate_proposal_engineer_pii(p_proposal_id uuid)
  RETURNS TABLE (display_name text, birth_date date, contact_email text, contact_phone text, affiliation_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
BEGIN
  -- 🔴 fail-closed その 1: テナント文脈が無い接続（withSystemScope / migration）から呼ばれても
  --    「全テナントの行が対象」にならない（app_apply_scan_status と同じ）。
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_gate_proposal_engineer_pii: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;
  -- 🔴 fail-closed その 2: ホスト文脈（= ジョブの systemTenantCtx）以外からは呼べない。
  --    パートナー文脈のセッションが GATE_RUNNING の提案 ID を推測して他社の値を引く経路を DB で塞ぐ。
  IF NOT app_is_host() THEN
    RAISE EXCEPTION 'app_gate_proposal_engineer_pii: ホスト文脈以外からは呼べません（docs/05 §11.14 ⑤）';
  END IF;

  RETURN QUERY
    SELECT e.display_name, e.birth_date, e.contact_email, e.contact_phone, e.affiliation_label
      FROM proposals p
      JOIN engineers e ON e.tenant_id = p.tenant_id AND e.id = p.engineer_id
     WHERE p.tenant_id = app_tenant_id()
       AND p.id = p_proposal_id
       AND p.state = 'GATE_RUNNING';       -- 🔴 ゲート実行中の提案に限る（判断事項 3-2）
END;
$BODY$;
ALTER FUNCTION app_gate_proposal_engineer_pii(uuid) OWNER TO app_gate_probe;

-- ============================================================================
-- 2-b. app_gate_proposal_engineer_skills: 整合層の裏付け（🔴 0 行以上。skill_id は Skill 辞書〔グローバル〕の ID）
-- ============================================================================
CREATE FUNCTION app_gate_proposal_engineer_skills(p_proposal_id uuid)
  RETURNS TABLE (skill_id uuid, years_of_experience numeric, level integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
BEGIN
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_gate_proposal_engineer_skills: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;
  IF NOT app_is_host() THEN
    RAISE EXCEPTION 'app_gate_proposal_engineer_skills: ホスト文脈以外からは呼べません（docs/05 §11.14 ⑤）';
  END IF;

  RETURN QUERY
    SELECT s.skill_id, s.years_of_experience, s.level
      FROM proposals p
      JOIN engineer_skills s ON s.tenant_id = p.tenant_id AND s.engineer_id = p.engineer_id
     WHERE p.tenant_id = app_tenant_id()
       AND p.id = p_proposal_id
       AND p.state = 'GATE_RUNNING'
     ORDER BY s.skill_id ASC;               -- 決定的な順序（整合層は skill_id で束ねるので順序に依存しないが、実測の比較を安定させる）
END;
$BODY$;
ALTER FUNCTION app_gate_proposal_engineer_skills(uuid) OWNER TO app_gate_probe;

-- 🔴 CREATE は上の 2 つの ALTER FUNCTION のときにしか要らない。直ちに剥がす。
REVOKE CREATE ON SCHEMA public FROM app_gate_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える。
--    app_platform / app_platform_write には与えない —— 運営者コンソールはゲートを実行しない
--    （CLAUDE.md §10.5「スキルシートの原本と本文・氏名・連絡先は運営者にも見せない」）。
REVOKE ALL ON FUNCTION app_gate_proposal_engineer_pii(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION app_gate_proposal_engineer_skills(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_gate_proposal_engineer_pii(uuid)    TO app_tenant;
GRANT EXECUTE ON FUNCTION app_gate_proposal_engineer_skills(uuid) TO app_tenant;

COMMENT ON FUNCTION app_gate_proposal_engineer_pii(uuid) IS
  'T-09-13: 品質ゲート（PROPOSAL）の PII 既知値（docs/05 §11.14）。呼び出し元は packages/db/src/gate-engineer-facts.ts のみ。';
COMMENT ON FUNCTION app_gate_proposal_engineer_skills(uuid) IS
  'T-09-13: 品質ゲート（PROPOSAL）の整合層の裏付け（docs/05 §11.14）。呼び出し元は packages/db/src/gate-engineer-facts.ts のみ。';
