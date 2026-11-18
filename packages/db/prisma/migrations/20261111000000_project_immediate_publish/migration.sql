-- 即時公開では検査結果を要求しない。過去の検査結果は保持する。
ALTER TABLE project_visibilities ALTER COLUMN review_gate_id DROP NOT NULL;

-- 古いワーカーによる公開・解除を防ぐ。保留要求のみ取り下げ、公開済みの行は変更しない。
LOCK TABLE project_publish_requests IN ACCESS EXCLUSIVE MODE;
ALTER TABLE project_publish_requests NO FORCE ROW LEVEL SECURITY;
DELETE FROM project_publish_requests;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM project_publish_requests) THEN
    RAISE EXCEPTION 'project publish requests remain';
  END IF;
END $$;
ALTER TABLE project_publish_requests FORCE ROW LEVEL SECURITY;
-- 移行中の旧バージョンが新たな要求を作らないよう DB でも禁止する。
ALTER TABLE project_publish_requests ADD CONSTRAINT project_publish_requests_retired CHECK (false);

