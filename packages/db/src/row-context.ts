// packages/db/src/row-context.ts
// 🔴 テナント文脈を持たない経路（docs/05 §4.4.2）。**この 5 関数以外を作らない。**
//
// なぜこの経路が要るか: ログイン・招待受諾・パスワード再設定は「まだテナントが確定していない」
// 段階で 1 行だけを引き当てる必要がある。`AuthenticatedTenantCtx` は認証済みセッションからしか
// 作れない（docs/05 §4.3）ので、これらは `withTenant` では書けない。
//
// 🔴 汎用の抜け道でない理由（docs/05 §4.4.2 の 5 点）:
//   ① 書ける表は users / memberships / invitations の 3 表、列も下記の固定列だけ。
//      引数に表名・列名・tenantId が無い
//   ② `SET LOCAL` する分離キーを決めるのは**トークン / メール照合で得た行**であり、
//      呼び出し側が指定できない（CLAUDE.md §3.1「分離キーはリクエスト入力から受け取らない」）
//   ③ `AuthenticatedTenantCtx` を生成しない（`resolveTenantCtx` が唯一の生成器のまま）
//   ④ 呼び出し元は ESLint で `apps/web/app/api/(main)/auth/**` と招待受諾ルートに限定する（SP-03）
//   ⑤ 戻り値はプレーンな ID / 認証に必要な最小限の列だけで、行オブジェクトを外へ出さない
//
// 🔴 第 1 段（資格情報）で見えるのは「完全一致する 1 行」だけである。追加 SELECT ポリシー
//    （migration 20260903050000 の §12）はいずれも先頭が `app_tenant_id() IS NULL` であり、
//    通常の `withTenant` 文脈からは 1 行も返らない。
//
// 🔴 本モジュールは Prisma 拡張（第 2 防御）を適用しない素のクライアントを使う。
//    テナントが未確定の段階では注入すべき tenantId が無いためであり、
//    ここでの防御は RLS（第 1 防御）と「触る表・列がコードとして固定であること」による。
import type { PrismaClient } from '@prisma/client';
import { getBaseClient } from './client.js';
import type { TenantRole } from './context.js';
import {
  rowCredentialScopeSql,
  rowDerivedTenantScopeSql,
  type RowCredential,
} from './scope-settings.js';

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** 招待の受諾が成立しなかった（同時受諾・取消）ことを表す内部センチネル。 */
class InvitationRaceError extends Error {
  constructor() {
    super('招待の受諾が競合しました（accepted_at の CAS が 0 件）。');
    this.name = 'InvitationRaceError';
  }
}

async function inRowContext<T>(
  credential: RowCredential,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return getBaseClient().$transaction(async (tx) => {
    await tx.$queryRaw(rowCredentialScopeSql(credential));
    return fn(tx);
  });
}

/**
 * 🔴 第 2 段。**読み出した行の値**でテナント文脈を立て直す（docs/05 §4.4.2）。
 * 引数は必ず第 1 段で読んだ行から取る（呼び出し側の入力を渡さない）。
 */
async function switchToRowDerivedScope(
  tx: TransactionClient,
  row: { tenantId: string; partnerCompanyId: string | null; actorUserId: string },
): Promise<void> {
  await tx.$queryRaw(
    rowDerivedTenantScopeSql({
      tenantId: row.tenantId,
      partnerCompanyId: row.partnerCompanyId,
      actorUserId: row.actorUserId,
    }),
  );
}

/** 🔴 第 2 段で actor が未確定（利用者がまだ存在しない）ときに入れる値。空文字 = 未設定。 */
const NO_ACTOR = '';

// ---------------------------------------------------------------------------
// withAuthLookup（docs/05 §4.4.2）
// ---------------------------------------------------------------------------

export type AuthLookupUser = {
  readonly userId: string;
  readonly tenantId: string;
  /** null = ホスト所属。 */
  readonly partnerCompanyId: string | null;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly disabledAt: Date | null;
};

/**
 * メールアドレスで `users` の該当 1 行だけを読む（読み取り専用）。
 * パスワード検証後はテナントが確定するので、2FA 検証以降は `withTenant` を使う。
 *
 * 🔴 同じメールが複数テナントに存在しうる（`@@unique([tenantId, email])`）。
 *    その場合は**どのテナントか特定できない**ため `null` を返す（推測でどれかを選ばない）。
 *    テナントの選択は SP-03 の認証フローが別途決める。
 */
export async function withAuthLookup(email: string): Promise<AuthLookupUser | null> {
  return inRowContext({ kind: 'AUTH_EMAIL', value: email }, async (tx) => {
    const rows = await tx.user.findMany({
      select: {
        id: true,
        tenantId: true,
        ownerPartnerCompanyId: true,
        email: true,
        displayName: true,
        passwordHash: true,
        disabledAt: true,
      },
      take: 2,
    });
    if (rows.length !== 1) return null;
    const row = rows[0] as NonNullable<(typeof rows)[number]>;
    return {
      userId: row.id,
      tenantId: row.tenantId,
      partnerCompanyId: row.ownerPartnerCompanyId,
      email: row.email,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      disabledAt: row.disabledAt,
    };
  });
}

// ---------------------------------------------------------------------------
// withInvitationToken / withInvitationAccept（docs/05 §4.4.2）
// ---------------------------------------------------------------------------

export type InvitationRow = {
  readonly invitationId: string;
  readonly tenantId: string;
  /** null = ホスト所属への招待。 */
  readonly partnerCompanyId: string | null;
  readonly email: string;
  readonly role: TenantRole;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
};

async function readInvitation(tx: TransactionClient): Promise<InvitationRow | null> {
  const rows = await tx.invitation.findMany({
    select: {
      id: true,
      tenantId: true,
      partnerCompanyId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
    take: 2,
  });
  if (rows.length !== 1) return null; // token_hash は UNIQUE。2 件返るのは想定外なので fail-closed
  const row = rows[0] as NonNullable<(typeof rows)[number]>;
  return {
    invitationId: row.id,
    tenantId: row.tenantId,
    partnerCompanyId: row.partnerCompanyId,
    email: row.email,
    role: row.role as TenantRole,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
  };
}

/** 招待トークンのハッシュで `invitations` の該当 1 行だけを読む（未認証経路。docs/05 §4.4.2）。 */
export async function withInvitationToken(tokenHash: string): Promise<InvitationRow | null> {
  return inRowContext({ kind: 'INVITATION_TOKEN_HASH', value: tokenHash }, readInvitation);
}

export type InvitationAcceptInput = {
  readonly displayName: string;
  /** 🔴 ハッシュ化済み（Argon2id）。平文パスワードを packages/db に渡さない。 */
  readonly passwordHash: string;
  /** 期限判定の基準時刻（既定は現在時刻）。テストから固定するために引数にする。 */
  readonly now?: Date;
};

/**
 * 招待を受諾し、`users` と `memberships` を 1 行ずつ作る（docs/05 §4.4.2）。
 *
 * 受諾できない（トークン不一致 / 取消済み / 期限切れ / 受諾済み / 同時受諾に負けた）ときは `null`。
 * 🔴 所属（tenantId / partnerCompanyId）とロールは**招待行**から取る。引数に持たない。
 */
export async function withInvitationAccept(
  tokenHash: string,
  input: InvitationAcceptInput,
): Promise<{ readonly userId: string } | null> {
  const now = input.now ?? new Date();
  try {
    return await inRowContext({ kind: 'INVITATION_TOKEN_HASH', value: tokenHash }, async (tx) => {
      const invitation = await readInvitation(tx);
      if (invitation === null) return null;
      if (invitation.acceptedAt !== null) return null;
      if (invitation.revokedAt !== null) return null;
      if (invitation.expiresAt.getTime() <= now.getTime()) return null;

      // 🔴 第 2 段: 招待行の値でテナント文脈を立て直す（C3 / C5 の通常ポリシーの下で書く）。
      await switchToRowDerivedScope(tx, {
        tenantId: invitation.tenantId,
        partnerCompanyId: invitation.partnerCompanyId,
        actorUserId: NO_ACTOR,
      });

      const user = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          ownerPartnerCompanyId: invitation.partnerCompanyId,
          email: invitation.email,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
        },
        select: { id: true },
      });

      await tx.membership.create({
        data: {
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role,
          partnerCompanyId: invitation.partnerCompanyId,
          joinedAt: now,
        },
        select: { id: true },
      });

      // 🔴 1 回限りの受諾は accepted_at の CAS で担保する（docs/05 §3.3）。
      //    0 件なら他の受諾に負けたということなので、作った 2 行ごと巻き戻す。
      const accepted = await tx.invitation.updateMany({
        where: { id: invitation.invitationId, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: now, acceptedUserId: user.id },
      });
      if (accepted.count !== 1) throw new InvitationRaceError();

      return { userId: user.id };
    });
  } catch (error) {
    if (error instanceof InvitationRaceError) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// withPasswordResetIssue / withPasswordResetConfirm（docs/05 §4.4.2）
// ---------------------------------------------------------------------------

export type PasswordResetIssueInput = {
  /** 🔴 ハッシュ化済み（SHA-256）。平文トークンは packages/db に渡さない。 */
  readonly tokenHash: string;
  readonly expiresAt: Date;
};

/**
 * パスワード再設定トークンを 1 人分だけ発行する（`users` の 2 列を UPDATE）。
 *
 * 🔴 docs/05 §4.4.2 のとおり、トークンのハッシュと期限は引数で受け取る（生成を packages/db に
 *    持ち込むと乱数と有効期間の方針が DB 層に散るため、生成済みの値を引数で受け取る形にした。
 *    分離キーではないので §3.1 に抵触しない）。
 * 🔴 該当が無くても `null` を返すだけで、呼び出し側は応答を出し分けてはならない
 *    （アカウントの存在を漏らさない。docs/05 §4.8 / F-002 AC-4）。
 */
export async function withPasswordResetIssue(
  email: string,
  input: PasswordResetIssueInput,
): Promise<{ readonly tenantId: string; readonly userId: string } | null> {
  return inRowContext({ kind: 'AUTH_EMAIL', value: email }, async (tx) => {
    const rows = await tx.user.findMany({
      select: { id: true, tenantId: true, ownerPartnerCompanyId: true, disabledAt: true },
      take: 2,
    });
    if (rows.length !== 1) return null;
    const row = rows[0] as NonNullable<(typeof rows)[number]>;
    if (row.disabledAt !== null) return null;

    await switchToRowDerivedScope(tx, {
      tenantId: row.tenantId,
      partnerCompanyId: row.ownerPartnerCompanyId,
      actorUserId: row.id,
    });

    const updated = await tx.user.updateMany({
      where: { id: row.id },
      data: { passwordResetTokenHash: input.tokenHash, passwordResetExpiresAt: input.expiresAt },
    });
    if (updated.count !== 1) return null;
    return { tenantId: row.tenantId, userId: row.id };
  });
}

/**
 * パスワード再設定を確定する（`users.password_hash` の UPDATE + トークン列の消去）。
 * 期限切れ・トークン不一致・使用済みはすべて `null`。
 */
export async function withPasswordResetConfirm(
  tokenHash: string,
  passwordHash: string,
  now: Date = new Date(),
): Promise<{ readonly userId: string } | null> {
  return inRowContext({ kind: 'PASSWORD_RESET_TOKEN_HASH', value: tokenHash }, async (tx) => {
    const rows = await tx.user.findMany({
      select: {
        id: true,
        tenantId: true,
        ownerPartnerCompanyId: true,
        passwordResetExpiresAt: true,
        disabledAt: true,
      },
      take: 2,
    });
    if (rows.length !== 1) return null;
    const row = rows[0] as NonNullable<(typeof rows)[number]>;
    if (row.disabledAt !== null) return null;
    if (row.passwordResetExpiresAt === null) return null;
    if (row.passwordResetExpiresAt.getTime() <= now.getTime()) return null;

    await switchToRowDerivedScope(tx, {
      tenantId: row.tenantId,
      partnerCompanyId: row.ownerPartnerCompanyId,
      actorUserId: row.id,
    });

    // 🔴 CAS: トークンがまだ同じ値であることを条件に、同じ 1 行だけを更新する。
    const updated = await tx.user.updateMany({
      where: { id: row.id, passwordResetTokenHash: tokenHash },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
    if (updated.count !== 1) return null;
    return { userId: row.id };
  });
}
