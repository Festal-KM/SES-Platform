-- 既存案件は未設定のまま保持する。検索用の項目だけを追加する。
ALTER TABLE projects ADD COLUMN development_phases TEXT[] NOT NULL DEFAULT '{}',
 ADD COLUMN development_method TEXT, ADD COLUMN utilization_rate INTEGER;
ALTER TABLE projects ADD CONSTRAINT projects_development_phases_check CHECK (development_phases <@ ARRAY['PLANNING','REQUIREMENTS','BASIC_DESIGN','DETAIL_DESIGN','INTEGRATION_TEST','SYSTEM_TEST','OPERATIONS']::TEXT[]),
 ADD CONSTRAINT projects_development_method_check CHECK (development_method IN ('WATERFALL','AGILE')),
 ADD CONSTRAINT projects_utilization_rate_check CHECK (utilization_rate BETWEEN 1 AND 100);
