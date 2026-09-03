// packages/db/src/audit.ts
// `AuditLog` への書き込み（docs/05 §3.8 / §16.1 / F-005 / BR-27 / CLAUDE.md §3.5）。
//
// 🔴 なぜ `packages/db` に置くか: 監査ログは「対象操作と**同一トランザクション**で書き、
//    書けなければ操作を成立させない」（F-005 / F-012 AC-2 / T-03-05）。トランザクションを
//    開けるのは `packages/db` だけであり、行の組み立てを外に置くと必ず二重実装になる。
//
// 🔴 `AuditLog` はアプリケーションログではない（docs/03 §4.10）。DB のテーブルであり、
//    pino / Sentry と同じ経路に流さない。編集・削除は DB 権限で禁止済み（§3.8 の REVOKE）。
//
// 🔴 `create()` ではなく **`createMany()`** を使う（docs/05 §4.4 の 🔴）。
//    `audit_logs` の `INSERT` は C1（テナント全体）だが `SELECT` は C2（ホストのみ）であり、
//    `create()` が伴う `RETURNING` には `SELECT` ポリシーが適用される。パートナー所属利用者の
//    操作を `create()` で書こうとすると必ず失敗する（ポリシーを緩めて解決しない）。
//
// 🔴 `tenantId` を引数に持たない。Prisma 拡張（第 2 防御）が文脈の値で確定させる
//    （CLAUDE.md §3.1「分離キーは認証コンテキストから取る」）。
import type { TenantIdentity } from './auth-context.js';
import type { AuthenticatedTenantCtx, DeviceKind } from './context.js';
import type { AuditActorKind } from './schema-value-sets.js';
import { runInTenantTransaction, type withTenant } from './with-tenant.js';

/**
 * `AuditLog.summary` に入れてよい値。
 * 🔴 **PII を入れない**（氏名・メールアドレス・電話番号・スキルシート本文・チャット本文・
 *    トークン平文。docs/05 §16.2 / CLAUDE.md §3.4 / §3.5）。
 *    入れてよいのは種別・件数・状態・ID である。
 */
export type AuditSummary = Readonly<Record<string, string | number | boolean | null>>;

export type AuditLogEntry = {
  /** docs/05 §16.1 の一覧（オープンな名前空間。DB 側に CHECK は無い）。 */
  readonly action: string;
  readonly actorKind: AuditActorKind;
  readonly actorId?: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly summary: AuditSummary;
  readonly ipAddress?: string | null;
  readonly deviceKind?: DeviceKind | null;
};

/**
 * 🔴 監査ログの書き込みに失敗した（docs/05 §15.1 `AuditWriteFailedError` / §15.5）。
 *    **捕捉して操作を続行してはならない。** 呼び出し側はトランザクションをロールバックし、
 *    対象操作を成立させない（F-005 / F-012 AC-2）。API 境界が 500 に写像する。
 */
export class AuditLogWriteError extends Error {
  constructor(readonly action: string) {
    super(
      `監査ログの書き込みに失敗しました（action=${action}）。対象操作は成立させません（docs/05 §15.5）。`,
    );
    this.name = 'AuditLogWriteError';
  }
}

/**
 * `withTenant` が `fn` に渡すクライアントの型（`TenantDb`）をシグネチャから取り出す。
 * 🔴 `TenantDb` は export しない（docs/05 §4.3 規約 4）ため型を再定義せずここで引き出す。
 */
type TenantDbArg = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** `AuditLog` を書ける最小の能力。T-03-05 が業務操作と同じトランザクションから呼ぶ。 */
export type AuditLogWriter = Pick<TenantDbArg, 'auditLog'>;

/**
 * `audit_logs` の 1 行分の値（`tenantId` を**含まない**）。
 *
 * 🔴 `tenantId` を持たないのは、通常経路では Prisma 拡張（第 2 防御）が文脈の値で確定させるためである
 *    （CLAUDE.md §3.1「分離キーは認証コンテキストから取る」）。
 * @internal packages/db の内部からのみ使う（index.ts から export しない）。
 */
export function auditLogRowValues(entry: AuditLogEntry) {
  return {
    actorKind: entry.actorKind,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    summary: entry.summary,
    ipAddress: entry.ipAddress ?? null,
    deviceKind: entry.deviceKind ?? null,
  };
}

/**
 * すでに開いているテナントトランザクションの中で 1 行書く。
 * 🔴 1 行書けなかったら例外にする（0 件を成功として扱わない）。
 */
export async function writeAuditLog(db: AuditLogWriter, entry: AuditLogEntry): Promise<void> {
  const result = await db.auditLog.createMany({ data: [auditLogRowValues(entry)] });
  if (result.count !== 1) throw new AuditLogWriteError(entry.action);
}

/**
 * 🔴 **認証の成否だけ**を記録する経路（docs/05 §16.1 の `auth.login` / `auth.logout` /
 *    `auth.login_failed`。F-003 AC-3）。
 *
 * なぜ `ctx` を取らないか:
 *   - サインインの記録は、**認証コンテキストがまだ生成できない局面**で必要になる。
 *     `#1 signin` は一次認証にすぎず（応答は `{ next: '2fa' | 'home' }`）、
 *     `resolveTenantCtx` は `OWNER` / `ADMIN` の 2FA 未設定を 403 で弾く（docs/05 §6.2 / T-03-02）。
 *     ctx を要求すると「2FA 未設定の管理者のログイン失敗が記録できない」ことになり、
 *     F-003 AC-3 を満たせなくなる。
 *   - 認証に失敗した利用者に対して `AuthenticatedTenantCtx`（＝認証済みの意味を持つ型）を
 *     組み立てるのは、型の意味を壊す。
 *
 * 🔴 汎用の抜け道ではない: 書ける表は `audit_logs` 1 表・列は `AuditLogEntry` の固定列だけで、
 *    引数に表名・列名は無い。分離キー（`identity`）は `withAuthLookup` が返した `users` 行 /
 *    セッション Cookie が出所であり、リクエスト入力から来ない（CLAUDE.md §3.1 / BR-03）。
 *    RLS は通常どおり効く（`app.tenant_id` を設定して書くため、C1 の `WITH CHECK` が判定する）。
 *    呼び出し元は `tests/static/auth-db-callers.test.ts` が `apps/web/lib/auth/**` に限定する。
 */
export async function recordAuthAuditLog(
  identity: TenantIdentity,
  entry: AuditLogEntry,
): Promise<void> {
  await runInTenantTransaction(
    {
      tenantId: identity.tenantId,
      partnerCompanyId: identity.partnerCompanyId,
      actorUserId: identity.userId,
    },
    (tx) => writeAuditLog(tx, entry),
  );
}

/**
 * 🔴 `withApiRoute` の `audit` オプション（docs/05 §6.1 / §16.1 / T-03-05）が使う唯一の経路。
 *    認証済みコンテキスト（`ctx`）だけで、ハンドラ本体の**前**に 1 行書く。
 *
 * 🔴 これは業務トランザクションとは**別のトランザクション**を開く。ハンドラが別途
 *    `withTenant` を開いて業務データを書く場合、2 つの書き込みは連動しない。
 *    「記録できなければハンドラを呼ばない」（本関数が例外を投げれば `withApiRoute` は
 *    `handler` を呼ばない）を優先する設計であり、「記録はできたがハンドラが失敗した」の
 *    逆方向のズレは許容する（ガード通過後の失敗はまれで、大半は 500 として運用側に見える）。
 *    行に紐づく詳細（作成した ID 等）を要する記録は、この経路ではなく業務トランザクション内の
 *    `writeAuditLog`（本ファイル上部。T-03-01 の意図的 seam）を引き続き使う。
 */
export async function recordAuditLog(
  ctx: AuthenticatedTenantCtx,
  entry: AuditLogEntry,
): Promise<void> {
  await runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    (tx) => writeAuditLog(tx, entry),
  );
}
