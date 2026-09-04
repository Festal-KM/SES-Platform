// packages/db/src/platform.ts
// 🔴 管理平面（`/admin`）がテナント分離を越えて DB に触れる**唯一の経路**（docs/05 §5.2 / §5.3 /
//    `CLAUDE.md` §10.5 / `BR-37` / `BR-41`。T-03-08）。
//
// ============================================================================
// 🔴 別モジュールである理由と、主平面から到達できないことの担保
// ============================================================================
// 本ファイルは `@ses/db` の index からは export しない。公開経路は **`@ses/db/platform`
// サブパスだけ**であり、その import は ESLint（`eslint.config.mjs` の ADMIN_PLANE_ZONE）が
// `apps/web/app/admin/**` / `apps/web/app/api/admin/**` と `tests/isolation/**` に限定する
// （docs/03 `program-design` 申し送り 2「主平面のコードから `withPlatform` を import できないことを
//  ESLint で担保する」）。主平面のコードに 1 行でも書いた時点で CI が落ちる。
//
// ============================================================================
// 🔴 4 枚の担保（どれか 1 枚が破れても越境が起きない）
// ============================================================================
// ① **DB ロールと列レベル GRANT**（主たる担保。migration 20260904010000 / docs/05 §5.5 第 1 層）
//    `app_platform` は業務テーブルの `SELECT` しか持たず、しかも「運営者に見せない列」は
//    GRANT されていない。`as any` で型を破っても SQL が `permission denied` になる。
// ② **型**（`PlatformReadDb` に書き込みメソッドが無い / `PlatformWriteDbFor<D>` はドメインの表だけ）
// ③ **実行時のドメイン照合**（`withPlatformWrite` が `domain` 以外のモデルへの到達を throw する。
//    `tenants` は `TENANT_LIFECYCLE` と `TENANT_PROVISIONING` の両方に現れるため、
//    DB 権限だけではドメインを分離できない。§5.2 末尾の 🔴「3 枚目」）
// ④ **監査の先行**（§5.3。下記）
//
// ============================================================================
// 🔴 記録されない管理平面アクセスを「型として書けない」構造（§5.3 / `BR-41` / `F-055 AC-4`）
// ============================================================================
// `withPlatformRead` / `withPlatformWrite` は `fn` を実行する**前に**、**同一トランザクション**で
// `audit_logs` へ 1 行 `INSERT` する。書けなければ例外になり、`fn` は 1 度も呼ばれない。
// `action` と `targetTenantId` は**必須プロパティ**であり省略できないため、
// 「記録されない管理平面アクセス」は型として書けない。
//
// 🔴 操作者（`platformUserId` / `platformRole`）は `AuthenticatedPlatformCtx` からのみ来る
//    （`resolvePlatformCtx` が唯一の生成器。docs/05 §5.1 / `CLAUDE.md` §3.1「分離キーは認証
//     コンテキストから取り、リクエスト入力から受け取らない」）。docs/05 §5.2 の `PlatformOp` は
//    `platformUserId` / `platformRole` を素のフィールドとして書いているが、それだと呼び出し側が
//    任意の値を詰められる。ブランド型の ctx を要求する形に**狭めて**いる（緩めていない）。
import type { PrismaClient } from '@prisma/client';
import { AuditLogWriteError, auditLogRowValues, type AuditSummary } from './audit.js';
import { getPlatformReadClient, getPlatformWriteClient } from './platform-client.js';
import type { AuthenticatedPlatformCtx } from './platform-context.js';
import {
  clearPlatformTargetTenantSql,
  platformScopeSql,
  restorePlatformTargetTenantSql,
} from './scope-settings.js';

type PlatformTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// action（docs/05 §5.2「列挙。AuditLog の action と同一」/ §16.1）
// ---------------------------------------------------------------------------

/**
 * 🔴 管理平面の `AuditLog.action`。**列挙であり、任意の文字列を渡せない。**
 *
 * docs/05 §16.1 は運営者の記録を「運営者の全操作（閲覧を含む）→ `withPlatformRead` /
 * `withPlatformWrite`」の 1 行にまとめており、個々の action 名までは列挙していない。
 * ここが唯一の一覧である（`admin.*` 名前空間 + §16.1 が明示する `impersonation.*` の 2 つ）。
 * **新しい管理平面の操作を足すときは、ここに追記しないとコンパイルが通らない。**
 */
export const PLATFORM_ACTIONS = [
  // 閲覧（Phase 0〜1）。🔴 `/admin` ホームの GET も記録する（§5.3 の注記 / `F-055 AC-4`）。
  'admin.home.view',
  'admin.tenant.list',
  'admin.tenant.view',
  'admin.usage.view',
  'admin.monitoring.view',
  'admin.audit_log.search',
  'admin.deletion_status.view',
  // 書き込み（`CLAUDE.md` §10.5 が運営者に認めた 6 領域。§5.2 の `domain` と対応する）。
  'admin.tenant.create',
  'admin.tenant.owner_invitation',
  'admin.tenant.lifecycle_change',
  'admin.quota.change',
  'admin.subscription.change',
  'admin.feature_flag.change',
  'admin.announcement.create',
  // §16.1 が名前を明示している 2 つ（Phase 2。§5.6）。
  'impersonation.start',
  'impersonation.end',
] as const;

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

// ---------------------------------------------------------------------------
// 読み取り可能なモデル（docs/05 §5.5 第 1 層の GRANT と 1 対 1）
// ---------------------------------------------------------------------------

/**
 * 🔴 `app_platform` に列レベル `GRANT SELECT` がある 52 表（migration 20260904010000 §2）と
 *    1 対 1 の一覧。ここに無いモデルは `PlatformReadDb` の型に現れない。
 *
 * 射程外の 4 表（`skills` / `platform_users` / `plans` / `subscriptions`。`CLAUDE.md` §3.1）は
 * 含まない。`plans` / `subscriptions` は `A-004` / `A-010`（Phase 1 / 3）で GRANT と同時に足す。
 */
export const PLATFORM_READABLE_MODELS = [
  'tenant',
  'user',
  'membership',
  'partnerCompany',
  'invitation',
  'twoFactorCredential',
  'tenantSendingDomain',
  'engineer',
  'skillAlias',
  'engineerSkill',
  'skillSheet',
  'fileScanResult',
  'skillSheetExtraction',
  'project',
  'projectRequirement',
  'projectVisibility',
  'engineerShare',
  'matchCandidate',
  'proposalRequest',
  'proposal',
  'engineerSnapshot',
  'proposalEvent',
  'reviewGate',
  'chatThread',
  'threadParticipant',
  'message',
  'contract',
  'contractDocument',
  'contractTemplate',
  'order',
  'assignment',
  'extensionReview',
  'task',
  'notification',
  'aiUsage',
  'auditLog',
  'usageCounter',
  'tenantEsignConnection',
  'sendAttempt',
  'emailDispatch',
  'emailEvent',
  'webhookDelivery',
  'dataExportRequest',
  'tenantPurgeRun',
  'schedulerRun',
  'impersonationSession',
  'announcement',
  'tenantRoleApprovalMode',
  'tenantRoleModel',
  'tenantMatchWeight',
  'tenantMonthlyCost',
  'billingMeterSubmission',
] as const satisfies readonly (keyof PlatformTransactionClient)[];

export type PlatformReadableModel = (typeof PLATFORM_READABLE_MODELS)[number];

/**
 * 🔴 read-only を型で強制する（docs/05 §5.2）。Prisma のデリゲートから
 *    `find*` / `count` / `aggregate` / `groupBy` 以外を落とす。
 */
type ReadOnlyDelegate<D> = Pick<
  D,
  Extract<keyof D, `find${string}` | 'count' | 'aggregate' | 'groupBy'>
>;

/**
 * `withPlatformRead` / （Phase 2）`withImpersonation` が `fn` に渡すクライアント。
 * 🔴 `create` / `update` / `delete` / `$queryRaw` が型に無い。
 * 🔴 型だけでは足りない（`as any` で破れる）ため、**主たる担保は DB 権限**である
 *    （`app_platform` は業務テーブルに `INSERT` / `UPDATE` / `DELETE` を 1 つも持たない。
 *     `tests/isolation/roles.test.ts` ② / `rls-enforced.test.ts` #6 がカタログ走査で毎回確認する）。
 */
export type PlatformReadDb = {
  readonly [K in PlatformReadableModel]: ReadOnlyDelegate<PlatformTransactionClient[K]>;
};

// ---------------------------------------------------------------------------
// 書き込みドメイン（docs/05 §5.2）
// ---------------------------------------------------------------------------

/**
 * 🔴 これ以外の値を取れない。前 4 つが `CLAUDE.md` §10.5 の「契約・クォータ・機能フラグ・お知らせ」、
 *    後 3 つは §10.5 / §10.6 が運営者に明示的に認めた操作（停止・解約 / 代理閲覧 /
 *    テナント開設と初期 `OWNER` 招待）。**いずれも業務データではない。**
 */
export const PLATFORM_WRITE_DOMAINS = [
  'SUBSCRIPTION',
  'QUOTA',
  'FEATURE_FLAG',
  'ANNOUNCEMENT',
  'TENANT_LIFECYCLE',
  'IMPERSONATION',
  'TENANT_PROVISIONING',
] as const;

export type PlatformWriteDomain = (typeof PLATFORM_WRITE_DOMAINS)[number];

/**
 * 🔴 ドメインと、そのドメインで触れてよいモデルの対応（docs/05 §5.2 末尾の 🔴）。
 *
 * `tenants` は `TENANT_LIFECYCLE`（状態遷移）と `TENANT_PROVISIONING`（開設）の**両方**に現れる。
 * DB の GRANT は表単位なので、この 2 つを DB 権限だけでは分離できない。だから実行時の照合が要る。
 *
 * 🔴 **DB 側の GRANT は各ドメインの画面を実装するスプリントで足す**（Phase 0 で配線されるのは
 *    `TENANT_PROVISIONING` だけ。migration 20260904010000 の冒頭「先回りして GRANT を広げない」）。
 *    GRANT の無いドメインを使うと DB が `permission denied` を返す（fail-closed）。
 */
export const PLATFORM_WRITE_DOMAIN_MODELS = {
  SUBSCRIPTION: ['plan', 'subscription'],
  QUOTA: ['subscription', 'usageCounter'],
  FEATURE_FLAG: ['announcement'],
  ANNOUNCEMENT: ['announcement'],
  TENANT_LIFECYCLE: ['tenant'],
  IMPERSONATION: ['impersonationSession'],
  TENANT_PROVISIONING: ['tenant', 'invitation', 'tenantSendingDomain'],
} as const satisfies Record<PlatformWriteDomain, readonly (keyof PlatformTransactionClient)[]>;

/**
 * 🔴 `DELETE` を型に持たない。`app_platform_write` はどの表にも `DELETE` を GRANT されていない
 *    （`tests/isolation/roles.test.ts` ③ が許可リスト単位で毎回確認する）。
 */
type WriteDelegate<D> = Pick<
  D,
  Extract<
    keyof D,
    'create' | 'createMany' | 'update' | 'updateMany' | 'upsert' | 'count' | `find${string}`
  >
>;

/** ドメインごとに、触れてよいモデルだけを持つクライアント。 */
export type PlatformWriteDbFor<D extends PlatformWriteDomain> = {
  readonly [K in (typeof PLATFORM_WRITE_DOMAIN_MODELS)[D][number]]: WriteDelegate<
    PlatformTransactionClient[K]
  >;
};

/** 🔴 宣言されたドメイン以外のモデルへ到達しようとした（§5.2 の 3 枚目の担保）。 */
export class PlatformWriteDomainViolationError extends Error {
  constructor(
    readonly domain: PlatformWriteDomain,
    readonly model: string,
  ) {
    super(
      `管理平面の書き込みドメイン ${domain} では ${model} に触れません（docs/05 §5.2）。` +
        'ドメインを増やすのは CLAUDE.md §10.5 の改訂（人間の承認事項）です。',
    );
    this.name = 'PlatformWriteDomainViolationError';
  }
}

// ---------------------------------------------------------------------------
// 操作の記述（docs/05 §5.2 の PlatformOp / PlatformWriteOp）
// ---------------------------------------------------------------------------

/**
 * 🔴 変更前後のスナップショット（`PlatformWriteOp.before` / `after`）。
 *
 * docs/05 §5.2 は `unknown` と書いているが、この値は `AuditLog.summary` に載る。
 * §16.2 は「`AuditLog.summary` に PII を入れない。記録するのは ID・件数・状態・変更前後の
 * **列挙値**のみ」と定めるため、**平坦なプリミティブの記録**に型で狭めている（緩めていない）。
 */
export type PlatformChangeSnapshot = Readonly<
  Record<string, string | number | boolean | null>
>;

export type PlatformOp = {
  /** 🔴 操作者。`resolvePlatformCtx` 以外が作れないブランド型（リクエスト入力から来ない）。 */
  readonly ctx: AuthenticatedPlatformCtx;
  /** 🔴 必須。省略できない（§5.3）。 */
  readonly action: PlatformAction;
  /** 🔴 必須。`null` = テナント横断（`F-058` の監査ログ横断検索 / `F-059` の集計）。 */
  readonly targetTenantId: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  /** 🔴 PII を入れない（§16.2）。種別・件数・状態・ID だけ。 */
  readonly summary?: AuditSummary;
  /** 代理閲覧（§5.6。Phase 2）でのみ必須になる。指定すると `summary.reason` に載る。 */
  readonly reason?: string;
  readonly ipAddress?: string | null;
};

export type PlatformWriteOp<D extends PlatformWriteDomain = PlatformWriteDomain> = PlatformOp & {
  readonly domain: D;
  /** 🔴 必須。新規作成なら `null` を明示的に渡す。 */
  readonly before: PlatformChangeSnapshot | null;
  /** 🔴 必須。 */
  readonly after: PlatformChangeSnapshot | null;
};

// ---------------------------------------------------------------------------
// 実装
// ---------------------------------------------------------------------------

/**
 * 監査ログ 1 行の内容を組み立てる。
 * @internal packages/db の内部とそのユニットテストからのみ使う（`platform/index.ts` から export しない）。
 */
export function auditEntryOf(op: PlatformOp): Parameters<typeof auditLogRowValues>[0] {
  const summary: AuditSummary = {
    ...(op.summary ?? {}),
    // 🔴 「誰の権限で行われたか」は後から遡れなければならない（§10.5「運営者の全操作を記録する」）。
    platformRole: op.ctx.platformRole,
    ...(op.reason === undefined ? {} : { reason: op.reason }),
  };
  return {
    action: op.action,
    actorKind: 'PLATFORM_USER',
    actorId: op.ctx.platformUserId,
    targetType: op.targetType ?? null,
    targetId: op.targetId ?? null,
    summary,
    ipAddress: op.ipAddress ?? null,
    deviceKind: op.ctx.deviceKind,
  };
}

/**
 * 🔴 `audit_logs.tenant_id` は `tenants` への FK である。`op.targetTenantId` は URL 直打ちなど
 *    **未検証の入力**（`admin.tenant.view` は「見ようとした ID」そのものが `targetTenantId` になる。
 *    T-03-09）に由来しうるため、実在しない ID をそのまま `INSERT` すると FK 違反で例外になり、
 *    「見えない ＝ 存在しない」（docs/05 §4.8）の 404 に畳めず 500 になってしまう。
 *
 * 🔴 この確認は `fn` の**前**（監査行を組み立てる過程）で行うため、「監査の記録が `fn` の学んだ
 *    事実に依存する」ことにはならない（§5.3 の不変条件を保ったまま）。実在しなければ
 *    `tenant_id` を `NULL`（横断相当）で記録する —— `targetId`（FK 制約なし）に元の ID が残るため、
 *    「何を見ようとしたか」の記録は失われない。
 *
 * 🔴 このとき `writePlatformAuditRow` は `app.target_tenant_id` を `INSERT` の**間だけ**空にし、
 *    `INSERT` が成功したら**元の（実在しない）ID へ戻してから `fn` を呼ぶ**
 *    （`clearPlatformTargetTenantSql` / `restorePlatformTargetTenantSql`。`scope-settings.ts`）。
 *    空にしたまま `fn` を実行すると RLS が「対象未指定＝全テナント可視」の文脈になり、`fn` が
 *    アプリの `where` 句だけに頼って絞り込む状態になる。元の ID へ戻せば、その ID に一致する行は
 *    元々存在しないため `fn` は RLS だけで自動的に 0 件へ閉じる（§5.2「`targetTenantId` を
 *    指定した操作は RLS により自動的にそのテナントへ閉じる」という不変条件を、この分岐でも保つ）。
 */
async function resolveAuditTenantId(
  tx: PlatformTransactionClient,
  targetTenantId: string | null,
): Promise<string | null> {
  if (targetTenantId === null) return null;
  const found = await tx.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true } });
  return found === null ? null : targetTenantId;
}

/**
 * 🔴 `fn` の**前に** `AuditLog` を 1 行書く（§5.3）。同一トランザクションなので、
 *    ここで例外になれば `fn` は 1 度も実行されず、書けた記録もロールバックされる。
 *
 * 🔴 `createMany()` を使う（`create()` の `RETURNING` には `SELECT` ポリシーが適用され、
 *    横断操作〔`tenant_id IS NULL`〕以外で読み返せないことがあるため。docs/05 §4.4 の 🔴 と同じ理由）。
 */
async function writePlatformAuditRow(
  tx: PlatformTransactionClient,
  op: PlatformOp,
  extra: Readonly<Record<string, string | number | boolean | null>> = {},
): Promise<void> {
  const entry = auditEntryOf(op);
  const values = auditLogRowValues(entry);
  const originalTargetTenantId = op.targetTenantId;
  const tenantId = await resolveAuditTenantId(tx, originalTargetTenantId);
  // 🔴 対象が実在しなかった場合だけ真になる（`resolveAuditTenantId` は `targetTenantId === null`
  //    のときも `null` を返すため、横断操作〔元々 null〕と取り違えないよう両方の条件を見る）。
  const targetMissing = tenantId === null && originalTargetTenantId !== null;

  if (targetMissing) {
    // 🔴 対象が実在しなかった。`audit_logs` の `WITH CHECK`（migration 20260904010000 §3）は
    //    「`app.target_tenant_id` が空のときだけ `tenant_id IS NULL` を許す」ため、`INSERT` の
    //    **間だけ** GUC 側も横断相当（空）に下ろす（`scope-settings.ts` の対応コメント参照）。
    await tx.$queryRaw(clearPlatformTargetTenantSql());
  }

  const result = await tx.auditLog.createMany({
    data: [
      {
        ...values,
        summary: { ...(values.summary as AuditSummary), ...extra },
        tenantId,
      },
    ],
  });
  if (result.count !== 1) throw new AuditLogWriteError(op.action);

  if (targetMissing && originalTargetTenantId !== null) {
    // 🔴 `fn` の**前**に、実在しない元の ID へ戻す。以降 `fn` は RLS だけで「対象 0 件」に閉じる
    //    ——「アプリの `where` に依存しない」という §5.2 の不変条件を、この分岐でも保つ。
    await tx.$queryRaw(restorePlatformTargetTenantSql(originalTargetTenantId));
  }
}

/**
 * 🔴 管理平面の読み取り（閲覧を含む運営者の全操作）。`app_platform` ロールで接続する。
 *
 * ```
 * BEGIN;
 *   SET LOCAL app.platform_user_id = …;   -- platformScopeSql（§5.3）
 *   SET LOCAL app.target_tenant_id = …;   -- 横断は ''
 *   INSERT INTO audit_logs (…);           -- 🔴 先に書く
 *   <fn の中のクエリ>
 * COMMIT;
 * ```
 *
 * 🔴 `op.targetTenantId` を指定した操作は、RLS の `platform_read` ポリシーにより
 *    **自動的にそのテナントへ閉じる**（アプリの `where` に依存しない）。
 */
export async function withPlatformRead<T>(
  op: PlatformOp,
  fn: (db: PlatformReadDb) => Promise<T>,
): Promise<T> {
  return getPlatformReadClient().$transaction(async (tx) => {
    await tx.$queryRaw(
      platformScopeSql({
        platformUserId: op.ctx.platformUserId,
        targetTenantId: op.targetTenantId,
      }),
    );
    await writePlatformAuditRow(tx, op);
    return fn(tx as PlatformReadDb);
  });
}

/** `then` は Promise 解決時に必ず参照される。ここで throw すると `await` が壊れる。 */
const PROXY_PASSTHROUGH_KEYS = new Set<string>(['then', 'catch', 'finally', 'toJSON']);

/**
 * 🔴 §5.2 の「3 枚目」: `domain` と、実際に触れるモデルの対応を**実行時に**検証する。
 *    型（`PlatformWriteDbFor<D>`）を `as any` で破っても、ここで throw する。
 */
/** @internal packages/db の内部とそのユニットテストからのみ使う。 */
export function restrictToWriteDomain<D extends PlatformWriteDomain>(
  tx: PlatformTransactionClient,
  domain: D,
): PlatformWriteDbFor<D> {
  const allowed: readonly string[] = PLATFORM_WRITE_DOMAIN_MODELS[domain];
  const target: Record<string, unknown> = {};
  for (const model of allowed) {
    target[model] = (tx as unknown as Record<string, unknown>)[model];
  }
  return new Proxy(target, {
    get(proxyTarget, property) {
      if (typeof property !== 'string') return Reflect.get(proxyTarget, property);
      if (PROXY_PASSTHROUGH_KEYS.has(property)) return Reflect.get(proxyTarget, property);
      if (!allowed.includes(property)) throw new PlatformWriteDomainViolationError(domain, property);
      return Reflect.get(proxyTarget, property);
    },
  }) as PlatformWriteDbFor<D>;
}

/**
 * 🔴 管理平面の書き込み。**`CLAUDE.md` §10.5 が認めた 6 領域（= 7 ドメイン）だけ**が対象であり、
 *    テナントの業務データ（エンジニア・案件・提案・チャット・契約）には到達できない。
 *    `app_platform_write` ロールで接続する。
 *
 * 🔴 監査の先行は `withPlatformRead` と同じ（§5.3）。加えて `before` / `after` を必須で受け取り、
 *    `AuditLog.summary` に載せる（§5.2）。
 */
export async function withPlatformWrite<D extends PlatformWriteDomain, T>(
  op: PlatformWriteOp<D>,
  fn: (db: PlatformWriteDbFor<D>) => Promise<T>,
): Promise<T> {
  return getPlatformWriteClient().$transaction(async (tx) => {
    await tx.$queryRaw(
      platformScopeSql({
        platformUserId: op.ctx.platformUserId,
        targetTenantId: op.targetTenantId,
      }),
    );
    await writePlatformAuditRow(tx, op, {
      domain: op.domain,
      before: op.before === null ? null : JSON.stringify(op.before),
      after: op.after === null ? null : JSON.stringify(op.after),
    });
    return fn(restrictToWriteDomain(tx, op.domain));
  });
}
