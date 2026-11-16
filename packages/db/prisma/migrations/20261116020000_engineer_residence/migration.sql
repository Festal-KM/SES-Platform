-- 在住地は希望勤務地と別に保存する。既存の行は変更しない。
ALTER TABLE "engineers" ADD COLUMN "residence_prefecture" TEXT;
