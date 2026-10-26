-- ============================================================================
-- チャットに案件を貼る（`messages.attached_project_id`）。2026-10-23、チャットレーン（担当: 紺野）。
-- docs/05 §3.7.1 / §6.5 #51 / #51n。紺野が 2026-10-22〜23 に決定。宮田さんへの確認は PR 本文。
-- ============================================================================
-- 🔴 この migration は既存の行を 1 行も書き換えない（列を足すだけ。既存の行は NULL = 貼っていない）。
--    したがって HANDOFF §3.1 の「FORCE ROW LEVEL SECURITY を一時解除する」手順は要らない。
--
-- 🔴 判断事項 1: 列は 1 つだけ（案件 1 件）。要員（エンジニア）カードは作らない（取引先の部屋には貼らない決まり）。
-- 🔴 判断事項 2: 複合 FK `(tenant_id, attached_project_id) → projects(tenant_id, id)`（Issue #33 の向き。
--    別テナントの案件を指す行を DB が拒む）。参照先の UNIQUE(tenant_id, id) をここで足す
--    （`engineers_tenant_id_id_key` と同型。PK は id 単独のまま）。
-- 🔴 判断事項 3: ON DELETE SET NULL は **attached_project_id だけ**を NULL にする（PostgreSQL 15 以降の列指定。
--    tenant_id まで NULL にしない）。案件は業務データとして論理削除しない規約なので、実際に働くのはまず無い。
-- 🔴 判断事項 4: RLS は messages の既存のまま（C6 / C10。列を足すだけ）。**案件カードは読む人の RLS で
--    projects（C4）を読み直して描く**ので、貼った案件が見る人に見えなければ名前も ID も出ない（アプリ側）。
--    貼れる条件（送る人が読める・部屋に取引先がいればその取引先に公開中）はアプリ（`apps/web/lib/chat/service.ts`）が
--    投稿と同じトランザクションで確かめる。
-- 🔴 判断事項 5: 運営者（app_platform）には GRANT しない（messages は列単位の GRANT。足さなければ読めない = fail-closed）。

CREATE UNIQUE INDEX IF NOT EXISTS "projects_tenant_id_id_key" ON "projects"("tenant_id", "id");

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attached_project_id" UUID;

ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_tenant_id_attached_project_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_attached_project_id_fkey"
  FOREIGN KEY ("tenant_id", "attached_project_id") REFERENCES "projects"("tenant_id", "id")
  ON DELETE SET NULL ("attached_project_id");

COMMENT ON COLUMN "messages"."attached_project_id" IS
  '発言に貼った案件（案件カード。2026-10-23）。カードは読む人の RLS で projects を読み直して描く。運営者に GRANT しない';
