// apps/web/lib/members/service.ts
// メンバー一覧（docs/05 §6.7 #83）・ロール変更（#84）・無効化（#85）。`F-002` / `S-014` / `S-035`。T-04-09。
//
// 🔴 **母集団はアプリが決めない。**一覧の境界は `memberships` の RLS（C5。
//    `tenant_id = app_tenant_id() AND (app_is_host() OR partner_company_id = app_partner_id())`）が
//    決める。したがって:
//      - ホスト … 自テナントの全所属（ホスト社員 + 各取引先の配下）が見える（`S-035` の「所属」列）
//      - パートナー … **自社配下だけ**が見える。ホストの所属も他社の所属も 1 行も見えない
//    これが `F-002 AC-4`（「他社および自社（ホスト）のアカウントは一覧にも現れない」）の実装である。
//    ここに `tenantId` / `partnerCompanyId` の `where` を書かない（`F-004 AC-1`）。
//
// 🔴 **`users` を母集団にしない。** `users` の SELECT は C8 DIRECTORY であり、
//    パートナーからも**ホスト所属の利用者は見える**（チャットの送信者名などに要るため）。
//    利用者から数え上げると `F-002 AC-4` をその場で破る。氏名・メールは
//    「`memberships` で確定した ID の分だけ」引く（下の `listMembers` を参照）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストが
//    サーバを立てずに同じ経路を実行できるようにするため（`partner-companies/service.ts` と同じ方針）。
import {
  TENANT_ROLES,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type TenantRole,
} from '@ses/db';
import type { AuthAttemptMeta } from '../auth/credentials';
import {
  ConcurrentUpdateError,
  ForbiddenError,
  InternalError,
  MemberLastOwnerError,
  MemberOutOfScopeError,
  MemberRevokedError,
  MemberRoleNotAssignableError,
  MemberSelfManagementError,
  NotFoundError,
} from '../api/errors';
import {
  decideMemberRevoke,
  decideMemberRoleChange,
  type MemberActor,
  type MemberDenialReason,
  type MemberTarget,
} from './policy';

/**
 * docs/05 §16.1 の `membership.role_change` / `membership.revoke`。
 *
 * 🔴 **`*.update` に畳まない**（`partner_company.update` とは扱いが逆である）。docs/05 §16.1 が
 *    この 2 つを固有の action として列挙しており、`S-041` の操作種別フィルタでも
 *    `PERMISSION_CHANGE`（`lib/audit-logs/categories.ts`）に割り当て済みだからである。
 *    ここを `membership.update` にすると、**権限変更が「作成・更新・削除」に紛れて
 *    `PERMISSION_CHANGE` で 0 件になる**（`BR-27` の「権限変更」が検索できなくなる）。
 */
export const MEMBER_AUDIT_ACTIONS = {
  roleChange: 'membership.role_change',
  revoke: 'membership.revoke',
} as const;

/** 一覧に出す状態（`S-035` の「状態」列）。`Membership.revokedAt` の有無を 1 語に畳んだ表示上の値。 */
export const MEMBER_STATUSES = ['ACTIVE', 'REVOKED'] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * `#83` の 1 件分（`docs/04` §S-035 のメンバー一覧列と `S-014` の「配下アカウント」）。
 *
 * ⚠️ **2FA の設定状況（`docs/04` §S-035）を含めない。** `two_factor_credentials` は
 *    RLS の C7 SELF（`subject_id = app_actor_user_id()`）であり、**他人の設定状況は
 *    1 行も読めない**（docs/05 §4.4）。`false` で埋めると「未設定に見えるが実は設定済み」という
 *    嘘の列になるため、**列ごと持たない**。`S-035`（ホストのメンバー管理画面）で必要になった時点で、
 *    経路 4 の `app_engineer_is_shared()` と同型の「存在の真偽だけを返す」関数を設計する
 *    （T-04-09 の申し送り）。
 */
export type MemberView = {
  /** 🔴 `Membership.id`（操作対象の識別子。#84 / #85 の `{id}`）。 */
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  /**
   * 🔴 パートナー文脈では**自社配下の利用者のメールしか含まれない**（母集団が C5 で閉じるため）。
   *    docs/05 §4.4 C8 の「パートナー向けシリアライザは `email` を返さない」は、
   *    ホスト所属利用者の行がパートナーに見えることへの規律であり、本一覧はその行に到達しない。
   */
  readonly email: string;
  readonly role: TenantRole;
  /** null = ホスト所属。 */
  readonly partnerCompanyId: string | null;
  /** ホスト所属では null（`S-035` の「所属」列は「自社」と表示する）。 */
  readonly partnerCompanyName: string | null;
  readonly status: MemberStatus;
  readonly joinedAt: string;
  readonly revokedAt: string | null;
  readonly lastLoginAt: string | null;
};

export type MemberListView = {
  readonly items: readonly MemberView[];
  /** 🔴 一覧と**同じ母集団**の件数（docs/05 §4.8）。別クエリで数え直さない。 */
  readonly total: number;
};

function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

/**
 * DB の `role` 列を `TenantRole` に狭める。
 * 🔴 CHECK 制約（docs/05 §3.3）があるため通常起きないが、**黙って握り潰さない**
 *    （未知のロールを「権限なし」として扱うと、権限の判定が静かにずれる）。
 */
function toTenantRole(value: string): TenantRole {
  if (!isTenantRole(value)) {
    throw new InternalError(`memberships.role に未知の値があります（${value}）。`);
  }
  return value;
}

function actorOf(ctx: AuthenticatedTenantCtx): MemberActor {
  return { role: ctx.role, partnerCompanyId: ctx.partnerCompanyId, userId: ctx.userId };
}

/** 判定の拒否理由を §15.2 の応答へ写像する（判定は `policy.ts` にしか無い）。 */
function denialError(reason: MemberDenialReason): Error {
  switch (reason) {
    case 'ACTOR_ROLE_NOT_ALLOWED':
      return new ForbiddenError();
    case 'OUT_OF_SCOPE':
      return new MemberOutOfScopeError();
    case 'SELF':
      return new MemberSelfManagementError();
    case 'TARGET_ROLE_NOT_ALLOWED':
      return new MemberRoleNotAssignableError();
    case 'ALREADY_REVOKED':
      return new MemberRevokedError();
    case 'LAST_OWNER':
      return new MemberLastOwnerError();
  }
}

type MembershipRow = {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly partnerCompanyId: string | null;
  readonly joinedAt: Date;
  readonly revokedAt: Date | null;
};

/**
 * `GET /api/members`（#83）。
 *
 * 🔴 関連（`include`）で氏名・メールを引かない。Prisma のネスト読みは第 2 防御
 *    （`$allOperations` フック）を通らず、境界の担保が RLS だけになる。**二重防御を保つ**ため、
 *    `memberships` で確定した ID を使って `users` / `partner_companies` を**別クエリで**引く
 *    （`partner-companies/service.ts` の `groupBy` と同じ方針）。
 * 🔴 ページングを持たない（#11 と同じ）。席数はプランの上限で抑えられており、
 *    `S-035` / `S-014` は 1 画面の表として全件を扱う。
 */
export async function listMembers(ctx: AuthenticatedTenantCtx): Promise<MemberListView> {
  return withTenant(ctx, async (db) => {
    const rows: readonly MembershipRow[] = await db.membership.findMany({
      select: {
        id: true,
        userId: true,
        role: true,
        partnerCompanyId: true,
        joinedAt: true,
        revokedAt: true,
      },
      // 🔴 決定的な順序（docs/05 §4.8）。所属した順に並べ、同時刻は ID で確定させる。
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });

    if (rows.length === 0) return { items: [], total: 0 };

    const userIds = rows.map((row) => row.userId);
    const partnerCompanyIds = [
      ...new Set(rows.flatMap((row) => (row.partnerCompanyId === null ? [] : [row.partnerCompanyId]))),
    ];

    const [users, partnerCompanies] = await Promise.all([
      db.user.findMany({
        // 🔴 `memberships` で確定した ID の分だけを引く。`users` の C8 は「ホスト所属の行は
        //    全員に見える」ため、条件を緩めるとパートナーの一覧にホスト社員が混ざる。
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, email: true, lastLoginAt: true },
      }),
      partnerCompanyIds.length === 0
        ? Promise.resolve([])
        : db.partnerCompany.findMany({
            where: { id: { in: partnerCompanyIds } },
            select: { id: true, name: true },
          }),
    ]);

    const userById = new Map(users.map((user) => [user.id, user]));
    const partnerNameById = new Map(partnerCompanies.map((company) => [company.id, company.name]));

    const items = rows.flatMap((row) => {
      const user = userById.get(row.userId);
      // 🔴 利用者の行が見えない所属は**出さない**（半端な行を作らない）。`memberships` と
      //    `users` の所属は DB トリガで一致が保証されているため通常起きない（docs/05 §3.3）。
      if (user === undefined) return [];
      return [
        {
          id: row.id,
          userId: row.userId,
          displayName: user.displayName,
          email: user.email,
          role: toTenantRole(row.role),
          partnerCompanyId: row.partnerCompanyId,
          partnerCompanyName:
            row.partnerCompanyId === null
              ? null
              : (partnerNameById.get(row.partnerCompanyId) ?? null),
          status: (row.revokedAt === null ? 'ACTIVE' : 'REVOKED') satisfies MemberStatus,
          joinedAt: row.joinedAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        } satisfies MemberView,
      ];
    });

    return { items, total: items.length };
  });
}

/** `withTenant` の内側で読んだ行を判定用の形にする。 */
function targetOf(row: MembershipRow): MemberTarget {
  return {
    userId: row.userId,
    role: toTenantRole(row.role),
    partnerCompanyId: row.partnerCompanyId,
    revoked: row.revokedAt !== null,
  };
}

/** 変更が起きたか（起きていなければ監査ログも書かない）。 */
export type MemberChangeResult = { readonly changed: boolean };

const TARGET_SELECT = {
  id: true,
  userId: true,
  role: true,
  partnerCompanyId: true,
  joinedAt: true,
  revokedAt: true,
} as const;

/**
 * 🔴 「読んだ集合に対する判定の結果で書く」経路の分離レベル（T-04-09 iteration 2）。
 *
 * `LAST_OWNER`（最後の有効な `OWNER` を降格・無効化させない）は
 * **`COUNT` → 判定 → `UPDATE`** の形をしており、`Read Committed` では守れない ——
 * `OWNER` が 2 人のときに 2 つの要求が同時に走ると、**互いの書き込みを見ないまま
 * 双方が「まだ 2 人居る」と判断して通過し、`OWNER` が 0 人のテナントが成立する**
 * （write skew。テナント側の操作では復旧できない不可逆状態であり、`CLAUDE.md` §10.1 の
 * 「契約者・支払者」が不在になる）。
 *
 * 🔴 **行ロック（`SELECT … FOR UPDATE`）ではなく `Serializable` を選んだ理由**:
 *    ①`TenantDb` は生 SQL の入口を型から除去しており（docs/05 §4.3 規約 3）、行ロックのために
 *      `packages/db` に raw の穴を開けると、その穴は他の用途にも使えてしまう
 *      ②守りたいのは「特定の行」ではなく**述語（有効な `OWNER` の集合）**であり、
 *      ロック対象の行が「これから増える行」を含まない以上、行ロックでは述語を守り切れない
 *      ③PostgreSQL の SSI は述語の読みと書きの依存を検出する仕組みそのものである。
 * 🔴 直列化失敗は `TransactionSerializationError` として上がり、API 境界が 409 に写像する
 *    （`ConcurrentUpdateError`）。**サーバ側で自動再試行しない**（判定をやり直さずに
 *    書き直すと、守ろうとしている不変条件がその場で破れる）。
 */
const OWNER_INVARIANT_TX = { isolationLevel: 'Serializable' } as const;

/**
 * `PUT /api/members/{id}/role`（#84。`F-002 AC-3` / `AC-4`）。
 *
 * 🔴 監査は**業務トランザクションの内側**で書く（`withApiRoute` の `audit` オプションではない）。
 *    `F-002 AC-3` が「実施者・対象・**変更前後のロール**・日時が残る」ことを要求しており、
 *    変更前のロールはハンドラの前（= 行を読む前）には分からない。
 *    記録できなければ更新も成立しない（同一トランザクション。`F-005`）。
 * 🔴 所属（`partnerCompanyId`）を書き換えない。所属の変更は第二境界の破壊そのものである
 *    （`policy.ts` の `decideMemberRoleChange` のコメント）。
 * 🔴 **並行実行に耐える形にする**（iteration 2）: ①トランザクションは `Serializable`
 *    （`OWNER_INVARIANT_TX`。`LAST_OWNER` の write skew を防ぐ）②`UPDATE` は読んだロールを
 *    条件に含める CAS（`beforeRole` が事実とずれない）。
 */
export async function changeMemberRole(
  ctx: AuthenticatedTenantCtx,
  input: { readonly membershipId: string; readonly role: TenantRole },
  meta: AuthAttemptMeta,
): Promise<MemberChangeResult> {
  return withTenant(
    ctx,
    async (db) => {
      // 🔴 母集団は RLS の C5 が決める。`where` に所属条件を書かない。見えなければ 404（§4.8）。
      const row = await db.membership.findFirst({
        where: { id: input.membershipId },
        select: TARGET_SELECT,
      });
      if (row === null) throw new NotFoundError();

      const verdict = decideMemberRoleChange(actorOf(ctx), targetOf(row), input.role, {
        // 🔴 パートナー文脈では C5 により `OWNER` の行が 1 つも見えず 0 になる。
        //    そもそも対象が `OWNER` になりえないため、判定に影響しない。
        activeOwnerCount: await db.membership.count({ where: { role: 'OWNER', revokedAt: null } }),
      });
      if (!verdict.allowed) throw denialError(verdict.reason);

      // 同じロールへの変更は何も起きていない。監査ログに「変更前後が同じ」行を残さない。
      if (row.role === input.role) return { changed: false };

      // 🔴 **条件付き UPDATE（CAS）**: 読んだロールを `where` に含める。
      //    これにより、①判定に使った `beforeRole` と ②実際に置き換えたロール が必ず一致する
      //    （`F-002 AC-3` の「変更前後のロール」が事実とずれない）。
      //    🔴 0 件は「並行して変更された」であり **409**（`ConcurrentUpdateError`）。
      //       404 に畳まない —— 行が消えたのか値が変わったのかで、利用者の次の行動が違う。
      const updated = await db.membership.updateMany({
        where: { id: row.id, role: row.role },
        data: { role: input.role },
      });
      if (updated.count !== 1) {
        // 行そのものが消えている（並行削除）なら 404、値が変わっているなら 409。
        const current = await db.membership.findFirst({
          where: { id: row.id },
          select: { id: true },
        });
        throw current === null ? new NotFoundError() : new ConcurrentUpdateError();
      }

      await writeAuditLog(db, {
        action: MEMBER_AUDIT_ACTIONS.roleChange,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: 'Membership',
        targetId: row.id,
        // 🔴 氏名・メールアドレス（PII）を入れない（docs/05 §16.2）。ID とロールだけを残す。
        summary: {
          targetUserId: row.userId,
          beforeRole: row.role,
          afterRole: input.role,
          partnerScoped: row.partnerCompanyId !== null,
        },
        ipAddress: meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });

      return { changed: true };
    },
    // 🔴 `LAST_OWNER` の不変条件を並行実行から守る（`OWNER_INVARIANT_TX` のコメント）。
    OWNER_INVARIANT_TX,
  );
}

/**
 * `POST /api/members/{id}/revoke`（#85。`F-002 AC-3` / `AC-4`）。
 *
 * 🔴 **`Membership.revokedAt` と `User.disabledAt` の両方を同一トランザクションで立てる。**
 *    片方だけでは無効化にならない:
 *      - `revokedAt` のみ … `loadTenantMembership` が `null` を返すので既存セッションは即座に
 *        業務データへ到達できなくなるが、**サインインの資格情報照合は通り続ける**
 *        （`lib/auth/credentials.ts` は `disabledAt` を見る）。パスワード再設定の発行経路
 *        （docs/05 §4.4.2 `withPasswordResetIssue`）も同じく `disabledAt` を見る。
 *      - `disabledAt` のみ … 既存セッションが生き続ける（ctx はロールを `memberships` から取る）。
 * 🔴 **データを 1 行も消さない**（`F-007 AC-2` と同じ規律。`docs/04` §S-035「無効化 → データは
 *    削除されない」）。エンジニア・提案・チャットはそのまま残る。
 * 🔴 **冪等である**（#13 の停止・再開と同じ）。すでに無効化済みなら時刻を上書きせず
 *    `changed: false` を返す（上書きすると「いつから無効か」が操作のたびに動く）。
 * 🔴 **並行実行に耐える形にする**（iteration 2）: ①トランザクションは `Serializable`
 *    （`OWNER_INVARIANT_TX`）②`UPDATE` は `revokedAt IS NULL` を条件に含める CAS。
 *    0 件のときは再読して「すでに無効化済み（冪等な no-op）」と「行が消えた（404）」を区別する。
 */
export async function revokeMember(
  ctx: AuthenticatedTenantCtx,
  input: { readonly membershipId: string; readonly now: Date },
  meta: AuthAttemptMeta,
): Promise<MemberChangeResult> {
  return withTenant(
    ctx,
    async (db) => {
      const row = await db.membership.findFirst({
        where: { id: input.membershipId },
        select: TARGET_SELECT,
      });
      if (row === null) throw new NotFoundError();

      const verdict = decideMemberRevoke(actorOf(ctx), targetOf(row), {
        activeOwnerCount: await db.membership.count({ where: { role: 'OWNER', revokedAt: null } }),
      });
      if (!verdict.allowed) throw denialError(verdict.reason);

      if (row.revokedAt !== null) return { changed: false };

      // 🔴 **条件付き UPDATE（CAS）**: `revokedAt IS NULL` を `where` に含める。
      //    これにより、並行する二重の無効化で **`revoked_at` が上書きされない**
      //    （「いつから無効か」が操作のたびに動かない）。監査ログも 1 件に保たれる。
      const revoked = await db.membership.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      if (revoked.count !== 1) {
        // 🔴 0 件の理由は 2 つある。**再読して区別する**（どちらも障害ではない）:
        //    ①すでに無効化されていた（並行実行に負けた）→ 冪等な no-op として `changed: false`。
        //      監査ログは書かない（実際には何も変えていない）。
        //    ②行が消えている（並行削除）→ 404（見えない ＝ 存在しない。docs/05 §4.8）。
        const current = await db.membership.findFirst({
          where: { id: row.id },
          select: { revokedAt: true },
        });
        if (current === null) throw new NotFoundError();
        return { changed: false };
      }

      const disabled = await db.user.updateMany({
        where: { id: row.userId },
        data: { disabledAt: input.now },
      });
      // 🔴 所属だけ無効化してアカウントが生きている状態を commit しない（fail-closed）。
      //    `users` の UPDATE は C3（自分の所属としてしか書けない）なので、射程外なら 0 件になる。
      if (disabled.count !== 1) {
        throw new InternalError('無効化の対象利用者を更新できませんでした（所属の不整合）。');
      }

      await writeAuditLog(db, {
        action: MEMBER_AUDIT_ACTIONS.revoke,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: 'Membership',
        targetId: row.id,
        summary: {
          targetUserId: row.userId,
          beforeRole: row.role,
          partnerScoped: row.partnerCompanyId !== null,
        },
        ipAddress: meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });

      return { changed: true };
    },
    // 🔴 `LAST_OWNER` の不変条件を並行実行から守る（`OWNER_INVARIANT_TX` のコメント）。
    OWNER_INVARIANT_TX,
  );
}
