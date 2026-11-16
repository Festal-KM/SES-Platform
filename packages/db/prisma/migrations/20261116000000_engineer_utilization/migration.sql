-- 既存データは未設定のまま保持する。
ALTER TABLE "engineers" ADD COLUMN "utilization_rate" INTEGER;
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_utilization_rate_check"
  CHECK ("utilization_rate" BETWEEN 0 AND 100);
