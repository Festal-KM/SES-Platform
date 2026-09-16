// packages/db/src/serializers/platform/audit-logs.ts
// `A-006`（監査ログ横断検索）/ API-A7 の運営者向けシリアライザ
// （docs/05 §5.5 第 2 層 `toPlatformAuditLog` / §5.7 / `F-058 AC-1` / `AC-3` / `BR-40` / `BR-42`。T-11-03）。
//
// 🔴 管理平面の Route Handler は DB の行をそのまま返さない。ここが「応答に出してよいフィールド」の
//    唯一の一覧である。`audit_logs` は全列が `app_platform` に GRANT されている（docs/05 §5.5 第 1 層は
//    「`summary` は §16.2 の規約により PII を含まない」前提で列を開けている）が、**過去の行に何が
//    入っているかを前提にせず**、`summary` は必ず `maskAuditSummary`（`@ses/domain`）を通す。
// 🔴 応答型に `summary` の生 JSON（`unknown` / `Prisma.JsonValue`）を通さない。`MaskedAuditSummary`
//    （`unknown` を含まない再帰型）だけを持つ。
// 🔴 `targetId` は載せる（運営者が `A-003` へ辿る / 同一対象の操作を束ねるために要る）が、
//    **管理平面に `targetId` から本文・氏名・経歴を引く API は存在しない**
//    （`tests/static/admin-no-content-reach.test.ts` が固定する。`F-058 AC-2`）。
// 🔴 `actorDisplayName` を持たない。主平面の `S-041` は `users.display_name` を解決して出すが、
//    運営者に利用者の氏名は要らない（`CLAUDE.md` §10.5「件数・状態・エラーであって内容ではない」。
//    `docs/sprints/SP-11` §4-3「`S-041` に出すことを理由に `A-006` にも出さない」）。
//    主体は `actorKind` + `actorId`（不透明な ID）で識別する。
import { maskAuditSummary, type MaskedAuditSummary } from '@ses/domain';
import type { AuditActorKind, AuditDeviceKind } from '../../schema-value-sets.js';

/**
 * クエリ関数（`packages/db/src/platform/queries/audit-logs.ts`）が組み立てる中間表現。
 * 🔴 Prisma の行をそのまま渡さない（列が増えても呼び出し側が明示的に足さない限りここには現れない）。
 */
export type PlatformAuditLogRow = {
  readonly id: string;
  readonly tenantId: string | null;
  /** 行の `tenant_id` から解決したテナント名。解決できなければ `null`（削除済み等）。 */
  readonly tenantName: string | null;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  /** 🔴 生の JSON。**この型の外へ出さない**（`toPlatformAuditLog` がマスクして畳む）。 */
  readonly summary: unknown;
  readonly impersonationSessionId: string | null;
  readonly ipAddress: string | null;
  readonly deviceKind: string | null;
  readonly createdAt: Date;
};

/** `GET /api/admin/audit-logs`（API-A7）の 1 行。 */
export type PlatformAuditLogView = {
  readonly id: string;
  readonly createdAt: string;
  /** `null` = 運営者の横断操作（テナントを持たない）。 */
  readonly tenantId: string | null;
  readonly tenantName: string | null;
  readonly actorKind: AuditActorKind;
  /** 🔴 不透明な ID。氏名・メールアドレスは持たない。 */
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  /** 🔴 マスク済み・固定形。`body` / `subject` / `note` 等の内容キーは**キーごと落ちている**。 */
  readonly summary: MaskedAuditSummary;
  readonly impersonationSessionId: string | null;
  readonly ipAddress: string | null;
  readonly deviceKind: AuditDeviceKind | null;
};

/** 🔴 応答に出してよいフィールドの明示列挙。Prisma の行を Object.assign で素通しさせない。 */
export function toPlatformAuditLog(row: PlatformAuditLogRow): PlatformAuditLogView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    actorKind: row.actorKind as AuditActorKind,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    summary: maskAuditSummary(row.summary),
    impersonationSessionId: row.impersonationSessionId,
    ipAddress: row.ipAddress,
    deviceKind: row.deviceKind as AuditDeviceKind | null,
  };
}
