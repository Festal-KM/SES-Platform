-- 基本情報の追加。既存の値を推測して補完しない。
ALTER TABLE projects
  ADD COLUMN location_detail TEXT,
  ADD COLUMN public_memo TEXT,
  ADD COLUMN remarks TEXT;
