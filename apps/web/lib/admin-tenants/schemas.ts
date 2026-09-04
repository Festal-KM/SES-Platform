// apps/web/lib/admin-tenants/schemas.ts
// `GET /api/admin/tenants`（API-A2 / `A-002`）の境界検証と、`A-002` / `A-003` の画面が
// 共有するテナント ID 形状チェック。
//
// 🔴 `cursor` はテナント ID（uuid(7)）そのもの。`cursorPageQuerySchema`（複数エンティティで
//    共有する汎用スキーマ。`apps/web/lib/api/pagination.ts`）にテナント ID 前提の検証を
//    直接足さず、ここで個別に検証する（e2e-tester 指摘: 不正な形の `cursor` が Prisma の
//    `cursor: { id }` へそのまま渡ると `uuid` 型キャストの Postgres エラーで未捕捉のまま
//    500 になっていた）。
// 🔴 `apps/web/app/**` はルート定義とビューでありユニットテストを置かない
//    （`vitest.config.ts` の include コメント）。Route Handler と画面（`page.tsx`）の両方が
//    呼ぶ検証ロジックはここ（`apps/web/lib/**`）に置き、ユニットテストで固定する。
import { z } from 'zod';
import {
  EMAIL_MAX_LENGTH,
  SENDING_DOMAIN_MAX_LENGTH,
  TENANT_NAME_MAX_LENGTH,
} from '@ses/config';
import { TENANT_CREATION_STATES, TENANT_ENVIRONMENTS } from '@ses/domain';
import { cursorPageQuerySchema, type CursorPageQuery } from '../api/pagination';
import { assertNoIsolationKeys } from '../api/isolation-keys';

const uuidSchema = z.uuid();

/** テナント ID として妥当な形状（UUID）かどうか。実在は確認しない。 */
export function isTenantIdLike(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export type AdminTenantListQueryResult =
  | { readonly ok: true; readonly value: CursorPageQuery }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * `GET /api/admin/tenants` の query を検証する（`apps/web/app/api/admin/tenants/route.ts` が
 * 呼ぶ唯一の経路）。
 *
 * 🔴 `cursorPageQuerySchema` の一般形状検証（非空・長さ上限）の**後**に、`cursor` がテナント ID の
 *    形（UUID）かどうかを追加で確認する。ここを通らない `cursor` は 400 になり、
 *    `listPlatformTenants`（＝ Prisma のカーソル句）へは一度も渡らない。
 */
export function parseAdminTenantListQuery(raw: unknown): AdminTenantListQueryResult {
  const parsed = cursorPageQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) };
  }
  if (parsed.data.cursor !== undefined && !isTenantIdLike(parsed.data.cursor)) {
    return { ok: false, issues: ['cursor'] };
  }
  return { ok: true, value: parsed.data };
}

// ---------------------------------------------------------------------------
// API-A4 / API-A5（`A-014` テナントの開設。docs/05 §6.9）。T-03-10。
// ---------------------------------------------------------------------------

/**
 * ラベル部分（英数字とハイフン）を `.` で 2 つ以上つないだ形。
 * 🔴 DNS の完全な妥当性はここでは判定しない（判定は SES の検証 = `S-036` / SP-04）。
 *    ここが弾くのは「明らかにドメインでない入力」だけである。
 */
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * `POST /api/admin/tenants`（API-A4）の body（docs/05 §6.9）。
 *
 * 🔴 `lifecycleState` は **開設できる 2 状態**（`SANDBOX` / `ACTIVE`）に限る
 *    （`TENANT_CREATION_STATES`。docs/02 章 5.4「開設は遷移ではない」）。
 *    `TENANT_LIFECYCLE_STATES`（5 値）を使うと、`PURGED` で開設できる API になってしまう。
 * 🔴 `environment` と `lifecycleState` の**組み合わせ**の検証はここで行わない。
 *    判定の本体は `packages/domain` の `isValidTenantCreation` であり（単一の出所）、
 *    違反は 422（`TenantProvisioningInvalidError`）になる。400 と 422 を混ぜない。
 * 🔴 `sendingDomain` は小文字化して受ける（DNS は大文字小文字を区別しない。
 *    `tenant_sending_domains(tenant_id, domain)` の `UNIQUE` が表記ゆれで割れないようにする）。
 */
export const createTenantBodySchema = z.object({
  name: z.string().trim().min(1).max(TENANT_NAME_MAX_LENGTH),
  environment: z.enum(TENANT_ENVIRONMENTS),
  lifecycleState: z.enum(TENANT_CREATION_STATES),
  /** 🔴 Phase 0 は監査ログにのみ記録する（`Subscription` の作成は Phase 3。`A-010`）。 */
  planId: z.string().trim().min(1).max(100),
  /** 🔴 冪等キー（docs/05 §10.7）。`A-014` が採番し、再送時も同じ値を送る。 */
  provisioningRequestId: z.string().trim().min(1).max(200),
  sendingDomain: z
    .string()
    .trim()
    .toLowerCase()
    .max(SENDING_DOMAIN_MAX_LENGTH)
    .regex(DOMAIN_PATTERN)
    .optional(),
});

export type CreateTenantBody = z.infer<typeof createTenantBodySchema>;

/**
 * `POST /api/admin/tenants/{id}/owner-invitation`（API-A5）の body。
 *
 * 🔴 `role` を受け取らない。運営者が発行できるのは**初期 `OWNER` 招待だけ**であり
 *    （docs/05 §5.2 の `WITH CHECK`）、選ばせる余地を API の型に作らない。
 * 🔴 `partnerCompanyId` も受け取らない（`assertNoIsolationKeys` が構造としても禁じる）。
 */
export const ownerInvitationBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(EMAIL_MAX_LENGTH).email(),
});

export type OwnerInvitationBody = z.infer<typeof ownerInvitationBodySchema>;

// 🔴 管理平面のルートは `withApiRoute`（主平面の共通ガード）を通らないため、
//    分離キーの検査を**明示的に**呼ぶ（docs/05 §6.1 の規律を管理平面でも守る）。
assertNoIsolationKeys(Object.keys(createTenantBodySchema.shape), 'createTenantBodySchema');
assertNoIsolationKeys(Object.keys(ownerInvitationBodySchema.shape), 'ownerInvitationBodySchema');

export type ParsedBody<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParsedBody<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) };
  }
  return { ok: true, value: parsed.data };
}

export function parseCreateTenantBody(raw: unknown): ParsedBody<CreateTenantBody> {
  return parseWith(createTenantBodySchema, raw);
}

export function parseOwnerInvitationBody(raw: unknown): ParsedBody<OwnerInvitationBody> {
  return parseWith(ownerInvitationBodySchema, raw);
}
