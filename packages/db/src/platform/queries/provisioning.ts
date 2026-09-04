// packages/db/src/platform/queries/provisioning.ts
// `A-014`（テナントの開設）の専用クエリ関数（docs/05 §5.2 / §6.9 API-A4 / API-A5 / §10.7 /
// `F-001`）。T-03-10。
//
// ============================================================================
// 🔴 この経路が `CLAUDE.md` §10.5 の read-only 原則に反しない理由（docs/05 §5.2 / `P-A-13`）
// ============================================================================
// 触れるのは `tenants` / `invitations` / `tenant_sending_domains` の 3 表の **`INSERT` だけ**で
// ある。いずれもテナントの「器」と開設手続きであり、越境 5 経路（§3.1）の対象表
// （エンジニア・案件・提案・チャット・契約）には 1 行も触れない。DB 側も
// `app_platform_write` にその 3 表以外の書き込みを GRANT していない（fail-closed）。
//
// ============================================================================
// 🔴 API-A4 と API-A5 を分ける（docs/05 §10.7 / `docs/04` program-design 申し送り 14）
// ============================================================================
// 招待メールの失敗で開設をやり直させない。やり直すと**重複テナント**が生まれ、分離が正しく
// 効いたまま業務が 2 つに割れる（分離が効いているぶん、後から気づけない）。
// テナント作成の冪等化は `Tenant.provisioningRequestId` の `UNIQUE`（`A-014` が採番する）。
//
// ============================================================================
// 🔴 なぜテナント ID をアプリ側で採番するのか
// ============================================================================
// `withPlatformWrite` はトランザクションの先頭で `SET LOCAL app.target_tenant_id` を発行し、
// `invitations` / `tenant_sending_domains` の `WITH CHECK` はその値と `tenant_id` の一致を
// 要求する（migration 20260904010000 §5）。したがってテナント ID は**書く前に**確定して
// いなければならない。ID は時系列に単調な UUID v7 で採る（`uuid.ts`）。
import { Prisma } from '@prisma/client';
import type { TenantCreationState, TenantEnvironment } from '@ses/domain';
import { isValidTenantCreation } from '@ses/domain';
import { withPlatformRead, withPlatformWrite } from '../../platform.js';
import type { AuthenticatedPlatformCtx, PlatformOwnerCtx } from '../../platform-context.js';
import { requirePlatformOwner } from '../../platform-context.js';
import {
  toPlatformProvisioningItem,
  type PlatformProvisioningItemView,
} from '../../serializers/platform/provisioning.js';
import { uuidV7 } from '../../uuid.js';

/** Prisma の一意制約違反。 */
const UNIQUE_VIOLATION = 'P2002';

export type PlatformProvisioningMeta = {
  readonly ipAddress?: string | null;
  /** 🔴 現在時刻は引数で受ける（結合テストが決定的な値を使えるようにするため）。 */
  readonly now: Date;
};

/**
 * 🔴 開設の入力が `docs/02` 章 5.4 の規則に反する（422）。
 *
 * 「見込み客の試用として開設すれば初期状態は `SANDBOX`、本契約として開設すれば `ACTIVE`。
 *  `demo` 環境のテナントは `ACTIVE` として扱う」。
 */
export class TenantProvisioningInputError extends Error {
  constructor(message: string) {
    super(`${message}（docs/02 章 5.4 / F-001）`);
    this.name = 'TenantProvisioningInputError';
  }
}

/**
 * 🔴 同じ `provisioningRequestId` での開設要求がすでに処理済みである（409）。
 *
 * `Tenant.provisioningRequestId` の `UNIQUE` が冪等の担保である（docs/05 §10.7）。
 * 🔴 **既存テナントを読み返して同じ応答を返すことはできない**: `app_platform_write` は
 *    `tenants` の `(id, lifecycle_state)` しか `SELECT` できず、`provisioning_request_id` を
 *    条件に引くことすらできない（Issue #24 の決定 = 既定値 A。列レベル GRANT）。
 *    したがって「重複を作らない」ことだけを保証し、結果は `A-002` / `A-014` の一覧で確認させる。
 *    **握り潰して 2 つ目のテナントを作るより、409 で止める方が安全である。**
 */
export class TenantProvisioningRequestConflictError extends Error {
  constructor() {
    super(
      'この開設要求はすでに処理済みです（provisioningRequestId の重複。docs/05 §10.7）。' +
        'テナント一覧で結果を確認してください。',
    );
    this.name = 'TenantProvisioningRequestConflictError';
  }
}

export type ProvisionTenantInput = {
  readonly name: string;
  readonly environment: TenantEnvironment;
  readonly lifecycleState: TenantCreationState;
  /**
   * 契約プラン。🔴 Phase 0 では `Subscription` を作らない（`app_platform_write` に
   * `plans` / `subscriptions` の GRANT が無い。docs/05 §5.2「`A-004` / `A-010` で
   * 許可リストと同時に追加する」）。**監査ログに記録する**ことで `F-001 AC-3`
   * （テナント名・プラン・環境種別・開設者）を満たす。契約の実体は `A-010`（Phase 3）。
   */
  readonly planId: string;
  /** 🔴 `A-014` が採番する冪等キー（docs/05 §10.7）。再送時も同じ値を送る。 */
  readonly provisioningRequestId: string;
  /**
   * 取引先へ届く送信に使う独自ドメイン（`A-014` 5b / `F-001 AC-4`）。
   * 🔴 **`state='REGISTERED'` で `INSERT` するだけ**である。DNS の提示と検証は
   *    `OWNER` が `S-036` で行う（SP-04）。未入力でも開設できる。
   */
  readonly sendingDomain?: string | null;
  /** `SANDBOX` で開設したときの試用期限（日数。`packages/config` の `SANDBOX_TRIAL_DAYS`）。 */
  readonly sandboxTrialDays: number;
};

export type ProvisionTenantResult = {
  readonly id: string;
  readonly lifecycleState: string;
  /** 送信ドメインを登録したか（🔴 常に未検証で始まる。`F-001 AC-1`）。 */
  readonly sendingDomainRegistered: boolean;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * API-A4（`POST /api/admin/tenants`）。docs/05 §6.9。
 *
 * 🔴 **`PLATFORM_OWNER` のみ**（`PlatformOwnerCtx` を要求する = 型でも縛る）。
 * 🔴 `F-001 AC-1` の既定値はここで確定する: 自動承認 = 無効 / AI ロール承認モード = すべて
 *    都度承認（**行を作らない**ことがその表現。docs/05 §3.10 の `TenantRoleApprovalMode`）/
 *    案件の公開範囲 = 誰にも公開されない（`ProjectVisibility` の行を作らない）/
 *    送信ドメイン = 未検証（`verified_at IS NULL`）。
 * 🔴 `F-001 AC-3` の監査は `withPlatformWrite` が**ハンドラの前に**書く（§5.3）。
 *    対象テナントはこの時点でまだ実在しないため `audit_logs.tenant_id` は `NULL` になり、
 *    `target_id` に採番済みのテナント ID が残る（§5.2 / T-03-09 の補正）。
 */
export async function provisionTenant(
  ctx: PlatformOwnerCtx,
  input: ProvisionTenantInput,
  meta: PlatformProvisioningMeta,
): Promise<ProvisionTenantResult> {
  // 🔴 型に加えて実行時にも確かめる（`as` で型を破っても通さない）。
  requirePlatformOwner(ctx);

  if (!isValidTenantCreation({ environment: input.environment, lifecycleState: input.lifecycleState })) {
    throw new TenantProvisioningInputError(
      `環境（${input.environment}）と初期状態（${input.lifecycleState}）の組み合わせが不正です`,
    );
  }

  const tenantId = uuidV7(meta.now);
  const sendingDomain = input.sendingDomain ?? null;
  const sandboxExpiresAt =
    input.lifecycleState === 'SANDBOX'
      ? new Date(meta.now.getTime() + input.sandboxTrialDays * MILLISECONDS_PER_DAY)
      : null;

  try {
    return await withPlatformWrite(
      {
        ctx,
        action: 'admin.tenant.create',
        domain: 'TENANT_PROVISIONING',
        targetTenantId: tenantId,
        targetType: 'Tenant',
        targetId: tenantId,
        ipAddress: meta.ipAddress ?? null,
        before: null,
        // 🔴 `F-001 AC-3`: テナント名・プラン・環境種別・開設者。開設者は `actorId`
        //    （`withPlatformWrite` が `ctx.platformUserId` を入れる）が持つ。
        after: {
          name: input.name,
          environment: input.environment,
          lifecycleState: input.lifecycleState,
          planId: input.planId,
          provisioningRequestId: input.provisioningRequestId,
          sendingDomainRegistered: sendingDomain !== null,
          autoApproveEnabled: false,
        },
      },
      async (db) => {
        // 🔴 `select` を 2 列に絞る（`app_platform_write` の `tenants` への `SELECT` は
        //    `(id, lifecycle_state)` だけ。Issue #24 の決定 = 既定値 A）。
        //    既定の `RETURNING *` にすると `permission denied` になる。
        const created = await db.tenant.create({
          data: {
            id: tenantId,
            name: input.name,
            environment: input.environment,
            lifecycleState: input.lifecycleState,
            lifecycleChangedAt: meta.now,
            sandboxExpiresAt,
            // 🔴 `F-001 AC-1`: 危険側に倒れた既定で開設されないことを、DB の既定値任せに
            //    せず**明示**する（既定値が変わっても開設時の値は変わらない）。
            autoApproveEnabled: false,
            createdByPlatformUserId: ctx.platformUserId,
            provisioningRequestId: input.provisioningRequestId,
            createdAt: meta.now,
          },
          select: { id: true, lifecycleState: true },
        });

        if (sendingDomain !== null) {
          // 🔴 `createMany`（`RETURNING` 無し）で書く。`app_platform_write` は
          //    `tenant_sending_domains` に `SELECT` を持たない（読み返す経路を作らない）。
          await db.tenantSendingDomain.createMany({
            data: [
              {
                id: uuidV7(meta.now),
                tenantId,
                domain: sendingDomain,
                // 🔴 `state='REGISTERED'` / `verified_at IS NULL` は RLS の `WITH CHECK` でも
                //    固定されている（運営者は検証を代行できない。docs/05 §5.2）。
                state: 'REGISTERED',
                registeredByPlatformUserId: ctx.platformUserId,
                createdAt: meta.now,
              },
            ],
          });
        }

        return {
          id: created.id,
          lifecycleState: created.lifecycleState,
          sendingDomainRegistered: sendingDomain !== null,
        };
      },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      throw new TenantProvisioningRequestConflictError();
    }
    throw error;
  }
}

export type OwnerInvitationInput = {
  readonly email: string;
  /** 🔴 平文トークンは受け取らない（SHA-256 ハッシュのみ）。生成は呼び出し側の責務（docs/05 §6.3 #5）。 */
  readonly tokenHash: string;
  readonly expiresAt: Date;
};

export type OwnerInvitationResult = {
  readonly invitationId: string;
};

/**
 * API-A5（`POST /api/admin/tenants/{id}/owner-invitation`）。docs/05 §6.9。
 *
 * 🔴 運営者が発行できるのは**初期 `OWNER` 招待だけ**である（docs/05 §5.2 の `WITH CHECK`）。
 *    `SALES` / パートナーの招待、既存招待の変更・取消はできない（`UPDATE` / `DELETE` を
 *    GRANT していない）。以降のメンバー追加はテナント側（`S-035` / `F-002`）の責務。
 * 🔴 **再送で旧トークンを失効させられない**（`invitations` の `UPDATE` を持たないため）。
 *    複数の有効なリンクが並ぶことは起こりうるが、受諾は `users(tenant_id, email)` の
 *    `UNIQUE` と `accepted_at` の CAS で 1 回に閉じる（2 通目の受諾は 409）。
 *    「運営者が招待を取り消せない」ことは §5.2 が意図した制約である。
 *
 * 対象テナントが存在しなければ `null` を返す（404 への写像は呼び出し側。docs/05 §4.8）。
 */
export async function issueTenantOwnerInvitation(
  ctx: PlatformOwnerCtx,
  tenantId: string,
  input: OwnerInvitationInput,
  meta: PlatformProvisioningMeta,
): Promise<OwnerInvitationResult | null> {
  requirePlatformOwner(ctx);
  const invitationId = uuidV7(meta.now);

  return withPlatformWrite(
    {
      ctx,
      action: 'admin.tenant.owner_invitation',
      domain: 'TENANT_PROVISIONING',
      targetTenantId: tenantId,
      targetType: 'Invitation',
      targetId: invitationId,
      ipAddress: meta.ipAddress ?? null,
      before: null,
      // 🔴 メールアドレス（PII）とトークンを載せない（docs/05 §16.2 / `CLAUDE.md` §3.4）。
      after: { role: 'OWNER', tenantId, expiresAt: input.expiresAt.toISOString() },
    },
    async (db) => {
      // 🔴 実在確認（`app_platform_write` が読める 2 列だけを select する）。
      //    存在しないテナント ID に対する `INSERT` は FK 違反で 500 になるため、先に 404 へ畳む。
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (tenant === null) return null;

      await db.invitation.createMany({
        data: [
          {
            id: invitationId,
            tenantId,
            email: input.email,
            role: 'OWNER',
            partnerCompanyId: null,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            // 🔴 `invited_by IS NULL` かつ `invited_by_platform_user_id = 自分` は
            //    RLS の `WITH CHECK` でも固定されている（docs/05 §5.2）。
            invitedBy: null,
            invitedByPlatformUserId: ctx.platformUserId,
            createdAt: meta.now,
          },
        ],
      });

      return { invitationId };
    },
  );
}

export type RecentProvisioningQuery = {
  readonly limit: number;
};

/**
 * `A-014`「直近の開設」（docs/04 §A-014 の主要コンポーネント）。
 *
 * 🔴 **開設して終わりにしない。** 「取引先へ送信できる状態」に到達したか（招待が受諾されたか /
 *    送信ドメインが検証されたか）までを追えるようにする（`F-001 AC-4`）。
 * 🔴 招待先のメールアドレスを**返さない**（運営者に必要なのは状態であって内容ではない。
 *    `CLAUDE.md` §10.5 / `BR-40`）。
 * 🔴 閲覧そのものが `AuditLog` に記録される（`withPlatformRead`。`F-055 AC-4` / `BR-41`）。
 */
export async function listRecentProvisionings(
  ctx: AuthenticatedPlatformCtx,
  query: RecentProvisioningQuery,
  meta: PlatformProvisioningMeta,
): Promise<readonly PlatformProvisioningItemView[]> {
  return withPlatformRead(
    {
      ctx,
      action: 'admin.tenant.list',
      targetTenantId: null,
      ipAddress: meta.ipAddress ?? null,
      summary: { screen: 'A-014' },
    },
    async (db) => {
      const tenants = await db.tenant.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        select: {
          id: true,
          name: true,
          environment: true,
          lifecycleState: true,
          createdAt: true,
        },
      });
      if (tenants.length === 0) return [];

      const tenantIds = tenants.map((tenant) => tenant.id);
      const [invitations, domains] = await Promise.all([
        // 🔴 運営者が発行した初期 `OWNER` 招待だけを見る。`email` / `token_hash` を select しない。
        db.invitation.findMany({
          where: {
            tenantId: { in: tenantIds },
            role: 'OWNER',
            invitedByPlatformUserId: { not: null },
          },
          orderBy: [{ createdAt: 'desc' }],
          select: {
            tenantId: true,
            acceptedAt: true,
            revokedAt: true,
            expiresAt: true,
            createdAt: true,
          },
        }),
        db.tenantSendingDomain.findMany({
          where: { tenantId: { in: tenantIds } },
          orderBy: [{ createdAt: 'desc' }],
          select: { tenantId: true, state: true, verifiedAt: true },
        }),
      ]);

      // 🔴 同じテナントに複数行がある場合は**最新の 1 行**を使う（招待の再送・ドメインの再登録）。
      const latestInvitation = new Map<string, (typeof invitations)[number]>();
      for (const row of invitations) {
        if (!latestInvitation.has(row.tenantId)) latestInvitation.set(row.tenantId, row);
      }
      const latestDomain = new Map<string, (typeof domains)[number]>();
      for (const row of domains) {
        if (!latestDomain.has(row.tenantId)) latestDomain.set(row.tenantId, row);
      }

      return tenants.map((tenant) =>
        toPlatformProvisioningItem({
          id: tenant.id,
          name: tenant.name,
          environment: tenant.environment,
          lifecycleState: tenant.lifecycleState,
          createdAt: tenant.createdAt,
          invitation: latestInvitation.get(tenant.id) ?? null,
          sendingDomain: latestDomain.get(tenant.id) ?? null,
          now: meta.now,
        }),
      );
    },
  );
}
