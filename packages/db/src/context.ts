// packages/db/src/context.ts
// 🔴 AuthenticatedTenantCtx の生成器はここだけ（docs/05 §4.3 / §4.1 第 3 防御）。
//
// T-01-04 で「ブランド型であること」「分離キーが認証情報からしか来ないこと」を実装した。
// T-01-06 で HostTenantCtx（docs/05 §4.3 実装の規約 6）を追加する。
// deviceKind の判定（apps/web/lib/auth/device.ts）・lifecycleState の DB 参照・
// Auth.js のセッション型への差し替えは T-03-01（SP-03）で実装済み。
//
// 🔴 T-02-01（T-01-07 からの申し送り①）: TenantLifecycleState は本ファイルと
//    packages/domain/src/state/tenant.ts の 2 箇所に重複定義されていた。
//    単一の出所を packages/domain に一本化する（packages/db → @ses/domain の依存は
//    docs/05 §2.2 で禁止されておらず、eslint.config.mjs の packages/db ゾーンも許可している。
//    逆向き〔domain → db〕は禁止のまま）。schema.prisma の `tenants.lifecycle_state` 列は
//    Prisma の `enum` ではなく `String`（TEXT + CHECK）である（schema.prisma 冒頭コメント参照。
//    Prisma の `enum` はネイティブ Postgres ENUM 型を要求し、実行時にキャストエラーを起こすため
//    使えなかった）。値の一致は tests/static/schema-enum-drift.test.ts が migration.sql の
//    CHECK 制約と自動で突合する（code-reviewer 指摘。「自動検証は現状無い。TBD」は解消済み）。
//    TenantRole は本ファイルの TENANT_ROLES（下記）が単一の出所。
import type { TenantLifecycleState } from '@ses/domain';

export type { TenantLifecycleState } from '@ses/domain';

declare const TenantCtxBrand: unique symbol;
declare const HostBrand: unique symbol;

/**
 * docs/05 §3.3 TenantRole の値の単一の出所。
 * 🔴 tests/static/schema-enum-drift.test.ts が migration.sql の `memberships_role_check` /
 *    `invitations_role_check` と突合する（code-reviewer 指摘。TENANT_LIFECYCLE_STATES と同じ扱い）。
 */
export const TENANT_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
  'PARTNER_ADMIN',
  'PARTNER_SALES',
  'VIEWER',
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'api';

/**
 * 🔴 2 要素認証が必須のテナントロール（`CLAUDE.md` §3.5 / `BR-30` / `F-003 AC-2`）。
 *    運営者（`PlatformUser`）は全員必須だが、それは管理平面（T-03-07）の別経路が扱う。
 *    **ここを減らすことは 2FA の要求範囲を変えることであり、人間の承認事項**（`CLAUDE.md` §8.6）。
 */
export const TWO_FACTOR_REQUIRED_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly TenantRole[];

export type TwoFactorRequiredRole = (typeof TWO_FACTOR_REQUIRED_ROLES)[number];

/**
 * このリクエストにおける 2 要素認証の状態。
 *
 * - `NOT_ENROLLED`: `TwoFactorCredential.confirmedAt IS NULL`（未設定 / 設定途中）
 * - `ENROLLED_UNVERIFIED`: 設定済みだが、**このセッションでは第 2 要素を提示していない**
 * - `VERIFIED`: 設定済みかつ、このセッションで提示済み（`POST /api/auth/2fa/verify`）
 */
export const TWO_FACTOR_SESSION_STATES = [
  'NOT_ENROLLED',
  'ENROLLED_UNVERIFIED',
  'VERIFIED',
] as const;

export type TwoFactorSessionState = (typeof TWO_FACTOR_SESSION_STATES)[number];

/**
 * 🔴 「DB の事実（設定済みか）」と「セッションの事実（このセッションで提示したか）」を
 *    1 つの状態に畳む**唯一の関数**。呼び出し側（`apps/web`）が 2 つの真偽値を自前で
 *    組み合わせると、片方を見落とした実装が書けてしまう。
 */
export function twoFactorSessionState(params: {
  /** `TwoFactorCredential.confirmedAt IS NOT NULL`（DB の事実）。 */
  readonly enrolled: boolean;
  /** このセッションで第 2 要素を検証済みか（JWT の主張）。 */
  readonly verifiedInSession: boolean;
}): TwoFactorSessionState {
  if (!params.enrolled) return 'NOT_ENROLLED';
  return params.verifiedInSession ? 'VERIFIED' : 'ENROLLED_UNVERIFIED';
}

/** 🔴 なぜ 2FA が要求されたか。UI の遷移先（設定 / コード入力）を決めるためだけに使う。 */
export const TWO_FACTOR_REQUIREMENT_REASONS = ['SETUP_REQUIRED', 'VERIFICATION_REQUIRED'] as const;

export type TwoFactorRequirementReason = (typeof TWO_FACTOR_REQUIREMENT_REASONS)[number];

/**
 * 🔴 2 要素認証が未充足のため**認証コンテキストを生成しなかった**（docs/05 §6.2 / §15.1 /
 *    `BR-30` / `F-003 AC-2`）。API 境界では 403 に写像する。
 *
 * 🔴 これは「業務データを 0 件にする」ではなく「`withTenant` に到達させない」ための例外である。
 *    `AuthenticatedTenantCtx` が存在しない ＝ DB アクセスの入口そのものが開かない。
 */
export class TwoFactorRequiredError extends Error {
  constructor(readonly reason: TwoFactorRequirementReason) {
    super(
      reason === 'SETUP_REQUIRED'
        ? '2 要素認証の設定が必要です（OWNER / ADMIN は必須。CLAUDE.md §3.5 / BR-30）。'
        : '2 要素認証コードの入力が必要です（このセッションでは未検証）。',
    );
    this.name = 'TwoFactorRequiredError';
  }
}

/** ロールが 2 要素認証を必須とするか（`BR-30`）。 */
export function requiresTwoFactor(role: TenantRole): boolean {
  return (TWO_FACTOR_REQUIRED_ROLES as readonly TenantRole[]).includes(role);
}

/**
 * 🔴 2 要素認証のゲート（docs/05 §6.2）。`resolveTenantCtx` の中でだけ呼ぶ。
 *
 * 判定は 2 つある。**どちらか一方だけでは 2FA として成立しない**:
 *   ① `OWNER` / `ADMIN` が未設定（`confirmedAt IS NULL`）→ `SETUP_REQUIRED`
 *   ② 設定済みなのにこのセッションで未提示 → `VERIFICATION_REQUIRED`
 *      （②が無いと「一度設定すれば以後はパスワードだけで入れる」ことになり、
 *        2 要素目が実質存在しなくなる。ロールを問わず適用する）
 */
function assertTwoFactorSatisfied(role: TenantRole, state: TwoFactorSessionState): void {
  if (state === 'NOT_ENROLLED') {
    if (requiresTwoFactor(role)) throw new TwoFactorRequiredError('SETUP_REQUIRED');
    return;
  }
  if (state === 'ENROLLED_UNVERIFIED') throw new TwoFactorRequiredError('VERIFICATION_REQUIRED');
}

/**
 * 認証済みのテナント文脈。🔴 ブランドプロパティは外部から書けないため、
 * `resolveTenantCtx` 以外がこの型の値を構築できない（docs/05 §4.3 の違反時の挙動 = コンパイルエラー）。
 */
export type AuthenticatedTenantCtx = {
  readonly tenantId: string;
  readonly partnerCompanyId: string | null; // null = ホスト所属
  readonly userId: string;
  readonly role: TenantRole;
  readonly lifecycleState: TenantLifecycleState;
  /**
   * 🔴 T-04-07（`F-007 AC-2`）: 所属する取引先企業が停止されている場合の停止時刻。
   *    `null` = 停止されていない。**ホスト所属では常に `null`**（停止の単位は取引先企業）。
   *
   * 🔴 `lifecycleState` と同じく**毎リクエスト DB から確定する**（`loadTenantMembership`）。
   *    セッションに焼き込むと、停止しても既存セッションが実行系を通り続ける。
   * 🔴 「実行系を拒否する」判定は本フィールドを見る `requireExecutable`（`apps/web/lib/api/guards.ts`）
   *    が 1 箇所で行う。参照（一覧・詳細）は止めない —— `F-007 AC-2` は
   *    「提案作成・送信・チャット投稿ができなくなる。既存データは削除されない」であり、
   *    見えなくすることではない。
   */
  readonly partnerSuspendedAt: Date | null;
  readonly deviceKind: DeviceKind;
  readonly [TenantCtxBrand]: true;
};

/**
 * 主平面の認証済みセッション。
 * 🔴 分離キー（tenantId / partnerCompanyId）はこの型からのみ来る。
 *    `resolveTenantCtx` はリクエスト body / query / path を引数に取らない（CLAUDE.md §3.1 / BR-03）。
 */
export type MainSession = {
  readonly tenantId: string;
  readonly partnerCompanyId: string | null;
  readonly userId: string;
  readonly role: TenantRole;
  readonly lifecycleState: TenantLifecycleState;
  /**
   * 🔴 T-04-07（`F-007 AC-2`）: 所属する取引先企業の停止時刻（`null` = 停止されていない）。
   *    **必須フィールドである**（`twoFactor` と同じ理由）—— 省略できると、渡し忘れた
   *    経路だけが停止中の取引先の実行系を通してしまう。値の出所は
   *    `loadTenantMembership`（DB の `partner_companies.suspended_at`）だけである。
   */
  readonly partnerSuspendedAt: Date | null;
  /**
   * 🔴 2 要素認証の状態（docs/05 §6.2 / `F-003 AC-2`）。**必須フィールドである。**
   *    省略できると「渡し忘れた経路だけ 2FA を素通りする」ことが起こりうるため、
   *    型で必ず決めさせる（値の組み立ては `twoFactorSessionState()` が唯一の経路）。
   */
  readonly twoFactor: TwoFactorSessionState;
};

/** ctx に載せてよいリクエスト由来の情報。🔴 分離キーを含めてはならない。 */
export type RequestMeta = {
  readonly deviceKind: DeviceKind;
};

/**
 * 🔴 AuthenticatedTenantCtx の唯一の生成経路。
 *
 * 🔴 2 要素認証のゲートはここに置く（docs/05 §6.2。middleware ではない）。
 *    未充足なら `TwoFactorRequiredError` を投げ、**ctx を生成しない**。
 *    `withTenant` は ctx を要求するため、業務データへの入口そのものが開かない
 *    （＝ API を直叩きしても 1 件も取得できない。`F-003 AC-2`）。
 *    Edge の middleware は DB を読めないので、そこに境界の強制を置かない。
 */
export async function resolveTenantCtx(
  session: MainSession,
  req: RequestMeta,
): Promise<AuthenticatedTenantCtx> {
  assertTwoFactorSatisfied(session.role, session.twoFactor);
  // 🔴 T-04-07: 「ホスト所属なのに取引先の停止時刻がある」は不変条件の破れである。
  //    静かに `null` へ丸めない —— 丸めると、組み立て側のバグが「停止が効かない」形で
  //    本番まで生き延びる（0 件で隠すのと同じ壊れ方。docs/05 §4.7 #9）。
  if (session.partnerCompanyId === null && session.partnerSuspendedAt !== null) {
    throw new Error(
      'ホスト所属の文脈に partnerSuspendedAt が設定されています（停止の単位は取引先企業です。F-007 AC-2）。',
    );
  }
  return {
    tenantId: session.tenantId,
    partnerCompanyId: session.partnerCompanyId,
    userId: session.userId,
    role: session.role,
    lifecycleState: session.lifecycleState,
    partnerSuspendedAt: session.partnerSuspendedAt,
    deviceKind: req.deviceKind,
  } as AuthenticatedTenantCtx;
}

/**
 * ホスト文脈であることが型で保証された ctx（docs/05 §4.3 実装の規約 6）。
 * 🔴 `requireHost` 以外がこの型の値を構築できない（もう 1 つの生成経路は `apps/worker` 用の
 * `systemTenantCtx`（本ファイル下部。docs/05 §9.2。T-03-10 で実装済み））。
 * `partnerCompanyId` はブランドと同時に `null` へ絞り込まれる。
 *
 * 経路 5 の基底表（`assignments` / `contracts` / `contract_documents` / `orders` /
 * `extension_reviews`）と、`HostTenantDb` への 5 デリゲート追加（`Omit` / `Pick` と
 * `assertPartnerBaseTableNotAccessed` の実行時フック）は T-02-07 で完了済み。
 * 本型は ctx の契約（「ホスト文脈しか `withHostTenant` に入れない」）を担う
 * （`packages/db/src/with-tenant.ts:48` の `TenantDb`（`Omit`）/ `:59` の `HostTenantDb` を参照）。
 */
export type HostTenantCtx = AuthenticatedTenantCtx & {
  readonly partnerCompanyId: null;
  readonly [HostBrand]: true;
};

/**
 * 🔴 `requireHost` がパートナー文脈を弾いたことを示す。
 * API 境界（`apps/web`。§15 のエラー階層が実装され次第）では `NotFoundError`（404）に写像する
 * ——「見えない ＝ 存在しない」（docs/05 §4.8）を守るため、403 とは区別しない。
 */
export class HostOnlyContextError extends Error {
  constructor() {
    super(
      'この操作はホスト所属の利用者のみが実行できます（docs/05 §4.3 実装の規約 6）。' +
        'パートナー文脈からは 404 として扱ってください（§4.8「見えない ＝ 存在しない」）。',
    );
    this.name = 'HostOnlyContextError';
  }
}

/**
 * 🔴 `HostTenantCtx` の生成経路の 1 つ（もう 1 つは `apps/worker` が使う `systemTenantCtx`。
 * 本ファイル下部。T-03-10 で実装済み）。
 * パートナー文脈（`partnerCompanyId !== null`）なら `HostOnlyContextError` を投げ、
 * ホスト文脈だけを型で絞り込む（TypeScript のアサーション関数）。
 */
export function requireHost(ctx: AuthenticatedTenantCtx): asserts ctx is HostTenantCtx {
  if (ctx.partnerCompanyId !== null) {
    throw new HostOnlyContextError();
  }
}

/**
 * 🔴 ジョブの実行主体（docs/05 §9.2 の `JobIdentity`）。
 *    キュー名と `jobId` を必須で受け取り、`AuditLog.summary` にそのまま載せられる形にする。
 */
export type JobIdentity = {
  /** キュー名（`usage.seat-snapshot` 等。docs/05 §9）。 */
  readonly queue: string;
  /** BullMQ の `jobId`。冪等キーそのものであり、記録に残す価値がある。 */
  readonly jobId: string;
};

/**
 * 🔴 ジョブ文脈の「利用者 ID」。**空文字である**（docs/05 §9.2「`userId` は null 相当」）。
 *
 * `tenantScopeSettingsSql` はこの値を `set_config('app.actor_user_id', …)` に渡し、
 * `app_actor_user_id()` は `NULLIF(…, '')::uuid` なので **NULL** になる。
 * つまり C7 SELF（本人の行だけ）のポリシーはジョブ文脈で 1 つも真にならない。
 *
 * 🔴 ダミーの UUID にしない: 監査ログの `actorId` に誤って流し込まれたとき、
 *    UUID なら「実在しない誰か」の記録として**静かに**残ってしまう。空文字なら
 *    `uuid` へのキャストで即座に失敗する（`actorKind='SYSTEM'` + `actorId=null` で
 *    記録するのが正しい。docs/05 §16.1 / `F-005 AC-4`）。
 */
export const SYSTEM_ACTOR_ID = '';

/**
 * ジョブ文脈の ctx。`HostTenantCtx` に**実行中のジョブの識別**を足したものである。
 * 🔴 `job` を型に持たせる理由: 状態を変えるジョブは `AuditLog`（`actorKind='SYSTEM'`）を
 *    書く（docs/05 §9.1）。そのとき「どのジョブが書いたか」を `summary` に載せられないと、
 *    後から遡っても `SYSTEM` としか分からない。
 */
export type SystemTenantCtx = HostTenantCtx & { readonly job: JobIdentity };

/**
 * 🔴 ジョブ（`apps/worker`）が `withTenant` / `withHostTenant` を使うための文脈（docs/05 §9.2）。
 *
 * 🔴 **`apps/web` から呼んではならない**（同 §9.2 の ⚠️）。HTTP 経路がこれを呼べると、
 *    リクエスト入力の `tenantId` で任意のテナントの文脈を作れてしまう（`CLAUDE.md` §3.1）。
 *    呼び出し元の限定は `tests/static/auth-db-callers.test.ts` の走査が行う
 *    （`withSystemScope` / 行由来コンテキスト 3 関数と同じ扱い）。
 *
 * 🔴 `partnerCompanyId` は常に `null`（ホスト相当）。ワーカーがパートナー文脈を持てないことが、
 *    `docs/05` §17.2 #20 の「`apps/worker/**` を `withHostTenant` の呼び出し元限定から外す」
 *    根拠になっている。
 * 🔴 `lifecycleState` を引数に取らない: ジョブは「実行系ガード（`requireExecutable`）を通す
 *    利用者操作」ではなく、状態に依らず走る計測・期限処理である。状態で分岐するジョブは
 *    自分で `tenants` を読んで判断する（ctx に嘘の状態を詰めさせない）。
 */
export function systemTenantCtx(tenantId: string, job: JobIdentity): SystemTenantCtx {
  if (tenantId === '') {
    throw new Error('systemTenantCtx: tenantId が空です（テナント文脈を作れません）。');
  }
  return {
    tenantId,
    partnerCompanyId: null,
    userId: SYSTEM_ACTOR_ID,
    // 🔴 RLS はロールを判定材料にしない（§4.4 のポリシーは tenant_id / partner_company_id /
    //    actor_user_id の 3 GUC しか見ない）。それでも `OWNER` / `ADMIN` を置かないのは、
    //    ロールを見るアプリ側のガード（`requireRole`）にジョブが「管理者として」通る値を
    //    与えないためである。ジョブは利用者を騙らない。
    role: 'SALES',
    // 🔴 ジョブは実行系ガードの対象ではないため、ここで停止状態を表現しない（下記コメント）。
    lifecycleState: 'ACTIVE',
    // 🔴 ジョブ文脈は常にホスト相当（`partnerCompanyId: null`）であり、取引先企業の停止
    //    （`F-007 AC-2`）の対象になりようがない。`resolveTenantCtx` の不変条件と同じ形にする。
    partnerSuspendedAt: null,
    deviceKind: 'api',
    job,
  } as SystemTenantCtx;
}

/**
 * 🔴 `withPartnerScope`（docs/05 §4.9）の当事者が確定できないことを示す。
 *
 * 経路 5 の当事者は次のどちらか一方からしか決まらない:
 *   ①パートナー文脈なら `ctx.partnerCompanyId`（認証コンテキスト。`CLAUDE.md` §3.1 / `BR-03`）
 *   ②ホストのプレビュー（`S-029` / `S-025`）なら `previewPartnerCompanyId`
 * 両方が来た場合（= パートナーがリクエスト入力で当事者を指定しようとした）と、
 * どちらも無い場合（= ホストが対象を指定していない）は、0 件を返さず例外にする。
 * **0 件は「そういうデータが無い」と区別できず、絞り忘れが本番まで生き延びるため。**
 */
export class PartnerScopeTargetError extends Error {
  constructor(message: string) {
    super(`${message}（docs/05 §4.9 / CLAUDE.md §3.1-5）`);
    this.name = 'PartnerScopeTargetError';
  }
}
