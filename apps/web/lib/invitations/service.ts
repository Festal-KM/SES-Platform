// apps/web/lib/invitations/service.ts
// 招待の発行（docs/05 §6.4 #14）・参照（§6.3 #6）・受諾（§6.3 #7）。`F-002` / `S-002`。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/config` / argon2 のみ）。
//    結合テスト（`tests/isolation/invitations.test.ts`）がサーバを立てずに**同じ経路**を
//    実行できるようにするため（`lib/auth/credentials.ts` と同じ方針）。
//    HTTP とセッションの発行は Route Handler の責務。
//
// 🔴 未認証経路（#6 / #7）は docs/05 §4.4.2 の行由来コンテキストだけを使う。
//    `systemTenantCtx` を `apps/web` に持ち込まない（HTTP 経路が認証を迂回できるため。P-A-15）。
//    分離キーは常に**トークン照合で得た DB 行**から来る。
//
// 🔴 平文トークンの扱い（CLAUDE.md §3.4）:
//    - DB に入るのは `tokenHash`（SHA-256）だけ
//    - 平文は `account.mail` の payload（Redis）にしか渡さない
//    - 監査ログの `summary` にも、戻り値にも載せない
//      （`sandbox` の `inviteUrl` 表示（`F-007 AC-4`）は取引先招待の機能であり SP-04）
import { INVITATION_TTL_MS } from '@ses/config';
import {
  resolveRecipientClass,
  withInvitationAccept,
  withInvitationToken,
  withTenant,
  writeAuditLog,
  type AuditLogEntry,
  type AuthenticatedTenantCtx,
  type TenantRole,
} from '@ses/db';
import {
  ForbiddenError,
  InvitationEmailAlreadyMemberError,
  InvitationNotAcceptableError,
  PartnerInvitationNotAvailableError,
  UnprocessableError,
} from '../api/errors';
import type { AuthAttemptMeta } from '../auth/credentials';
import { hashPassword } from '../auth/password';
import { generateToken, hashToken } from '../auth/tokens';
import {
  requireAccountMailQueue,
  requireAccountMailRecipientClass,
  type AccountMailDeliveryState,
} from '../jobs/account-mail';
import { decideInvitation, isPartnerRole, type InvitationDenialReason } from './policy';

/** docs/05 §16.1 の `*.create` / `*.update` に対応する招待の監査アクション。 */
export const INVITATION_AUDIT_ACTIONS = {
  create: 'invitation.create',
  accept: 'invitation.accept',
} as const;

export type IssueInvitationInput = {
  readonly email: string;
  readonly role: TenantRole;
  /**
   * ホストの `OWNER` / `ADMIN` が取引先の担当者を招くときの宛先企業（`S-014`）。
   * 🔴 Phase 0 では常に未指定である（パートナーロール宛は下の Phase ゲートで拒否する）。
   */
  readonly partnerCompanyId?: string | null;
};

export type IssueInvitationResult = {
  readonly id: string;
  readonly deliveryState: AccountMailDeliveryState;
};

/**
 * 🔴 **認可**としての拒否（403 に写像する）。残り
 * （`PARTNER_COMPANY_REQUIRED` / `PARTNER_COMPANY_NOT_ALLOWED`）は入力の組み合わせの誤りで 422。
 * 🔴 「他社を指定した」も 403 に畳む（指定した企業が実在するかを漏らさない）。
 */
const AUTHORIZATION_DENIALS: ReadonlySet<InvitationDenialReason> = new Set([
  'ACTOR_ROLE_NOT_ALLOWED',
  'TARGET_ROLE_NOT_ALLOWED',
  'OTHER_PARTNER_COMPANY',
]);

/**
 * 招待を発行する（docs/05 §6.4 #14 / `F-002`）。
 *
 * 🔴 Phase 0 は**ホストロール宛のみ**（`docs/sprints/SP-03` T-03-03）。取引先の担当者宛は
 *    独自ドメインの検証（`F-007 AC-5` / docs/05 §8.3）が前提であり、その判定と保留は SP-04。
 *
 * 🔴 再発行で旧トークンを失効させる（同じ宛先・同じ所属の未受諾の招待を `revokedAt` で閉じる）。
 *    有効なリンクが複数同時に存在すると、「1 回限りの受諾」が実質的に破れる。
 */
export async function issueInvitation(
  ctx: AuthenticatedTenantCtx,
  input: IssueInvitationInput,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<IssueInvitationResult> {
  const verdict = decideInvitation(
    { role: ctx.role, partnerCompanyId: ctx.partnerCompanyId },
    { role: input.role, partnerCompanyId: input.partnerCompanyId ?? null },
  );
  // 🔴 判定の順序: ①認可 → ②Phase ゲート → ③入力の組み合わせ。
  //    ①を先に置くのは、権限の無い利用者に「その機能はまだ無い」と教えないため。
  //    ②を③より先に置くのは、Phase 0 で取引先企業を指定する術が無い（スキーマに無い）以上、
  //    「取引先企業が必要です」より「まだ発行できません」の方が利用者にとって正確だからである。
  if (!verdict.allowed && AUTHORIZATION_DENIALS.has(verdict.reason)) throw new ForbiddenError();
  if (isPartnerRole(input.role)) throw new PartnerInvitationNotAvailableError();
  if (!verdict.allowed) throw new UnprocessableError();

  // 🔴 副作用（招待行の作成）の前にキューの存在を確かめる。
  //    後から分かると「作られたのに永久に届かない招待」が残る（CLAUDE.md §11.1）。
  const queue = requireAccountMailQueue();

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  const created = await withTenant(ctx, async (db) => {
    // 🔴 予防ガード（`code-reviewer` 指摘）: すでに同じメールの利用者がテナントに存在するなら、
    //    その招待は**受諾できない**（`users` の `@@unique([tenantId, email])`）。
    //    作れてしまうと「リンクは届くのに、開くと必ず失敗する招待」が残るため、発行時に止める。
    //    🔴 これは受諾側の担保（`withInvitationAccept` の一意制約違反 → 409）の**代わりではない**:
    //    `users` の SELECT は C8 DIRECTORY であり、ホストからは**他パートナー所属の利用者が
    //    見えない**（＝ ここで見つけられないメールがある）。2 層とも要る。
    const existingUser = await db.user.findFirst({
      where: { email: input.email },
      select: { id: true },
    });
    if (existingUser !== null) throw new InvitationEmailAlreadyMemberError();

    // 🔴 再発行 = 旧リンクの失効。射程は「同じメール × 同じ所属」の未受諾・未取消に限る。
    const revoked = await db.invitation.updateMany({
      where: {
        email: input.email,
        partnerCompanyId: verdict.partnerCompanyId,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    const invitation = await db.invitation.create({
      data: {
        // 🔴 値の出どころは**認証コンテキスト**である（リクエスト入力ではない。CLAUDE.md §3.1）。
        //    Prisma 拡張（第 2 防御）は create の `data` にテナントキーを必ず注入するが、
        //    Prisma の型は必須列として要求するため明示する。ctx と異なる値を書こうとすれば
        //    拡張が `CrossTenantWriteError` で落とす（静かな書き換えにしない）。
        tenantId: ctx.tenantId,
        email: input.email,
        role: input.role,
        partnerCompanyId: verdict.partnerCompanyId,
        tokenHash,
        expiresAt,
        invitedBy: ctx.userId,
      },
      select: { id: true },
    });

    // 🔴 発行と同一トランザクションで記録する（`F-002 AC-3` / `F-005`）。
    //    summary にメールアドレス（PII）とトークンを入れない（docs/05 §16.2）。
    await writeAuditLog(db, {
      action: INVITATION_AUDIT_ACTIONS.create,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'Invitation',
      targetId: invitation.id,
      summary: {
        role: input.role,
        partnerScoped: verdict.partnerCompanyId !== null,
        revokedPrevious: revoked.count,
      },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

    // 🔴 宛先分類は**作成した招待行から機械的に導く**（docs/05 §8.2 / T-04-02）。
    //    `input.role` や `verdict.partnerCompanyId`（呼び出し側が組み立てた値）ではなく、
    //    DB に書かれた行を読み直す —— 分類の出所を「保存された所属」1 つに保つため。
    // 🔴 絞り込みも**トランザクションの中**で行う。分類 3 / 4 が導かれた（= 送れない）状態を
    //    commit してしまうと、「作られたのに永久に届かない招待」が残る（CLAUDE.md §11.1）。
    const recipientClass = requireAccountMailRecipientClass(
      await resolveRecipientClass(db, { invitationId: invitation.id }, 'CLIENT'),
    );

    return { ...invitation, recipientClass };
  });

  // 🔴 commit の後に enqueue する（未コミットの招待をワーカーが先に読む状態を作らない）。
  const deliveryState = await queue.enqueue({
    tenantId: ctx.tenantId,
    kind: 'INVITATION',
    targetId: created.id,
    recipientClass: created.recipientClass,
    token,
  });

  return { id: created.id, deliveryState };
}

/** `#6` の応答（docs/05 §6.3 #6 + docs/04 §S-002 の期限切れ / 使用済みの出し分け）。 */
export type InvitationView =
  | {
      readonly status: 'VALID';
      readonly tenantName: string;
      /** ホスト所属への招待では null（`S-002` の「所属」行を出さない）。 */
      readonly partnerCompanyName: string | null;
      readonly role: TenantRole;
      readonly email: string;
      readonly expiresAt: string;
    }
  /**
   * 🔴 期限切れ / 受諾済み / 取消済みでは**組織名だけ**を返す（docs/04 §S-002
   *    「+ 招待元の組織名のみ表示（担当者名は出さない）」）。ロール・メールアドレスは返さない。
   */
  | { readonly status: 'EXPIRED' | 'ACCEPTED' | 'REVOKED'; readonly tenantName: string };

/**
 * 招待トークンから表示内容を引く（docs/05 §6.3 #6。未認証）。
 * 該当が無ければ `null`（呼び出し側は 404。存在の有無以外を漏らさない）。
 */
export async function readInvitationByToken(
  token: string,
  now: Date = new Date(),
): Promise<InvitationView | null> {
  const row = await withInvitationToken(hashToken(token));
  if (row === null) return null;
  if (row.acceptedAt !== null) return { status: 'ACCEPTED', tenantName: row.tenantName };
  if (row.revokedAt !== null) return { status: 'REVOKED', tenantName: row.tenantName };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { status: 'EXPIRED', tenantName: row.tenantName };
  }
  return {
    status: 'VALID',
    tenantName: row.tenantName,
    partnerCompanyName: row.partnerCompanyName,
    role: row.role,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export type AcceptInvitationInput = {
  readonly displayName: string;
  /** 🔴 平文。ハッシュ化はこの関数の内側で行い、`packages/db` には渡さない。 */
  readonly password: string;
};

export type AcceptInvitationResult = {
  readonly userId: string;
  /** 受諾直後のサインイン（`S-002` → `S-003` / `S-004`）に使う。招待行から来る値。 */
  readonly email: string;
};

/**
 * 招待を受諾する（docs/05 §6.3 #7 / `F-002`）。
 *
 * 🔴 **1 回限り**である（`acceptedAt` の CAS。docs/05 §4.4.2）。2 回目は
 *    `InvitationNotAcceptableError`（409）になり、利用者もアカウントも増えない。
 * 🔴 所属（テナント / 取引先）とロールは**招待行**から決まる。入力に持たない（CLAUDE.md §3.1）。
 * 🔴 監査ログは受諾と同一トランザクションで書かれる（`buildAudit`。記録できなければ受諾も成立しない）。
 */
export async function acceptInvitation(
  token: string,
  input: AcceptInvitationInput,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(token);

  // 受諾できるかの最終判定は `withInvitationAccept`（同一トランザクションの CAS）が行う。
  // ここで読むのは「受諾後に返すメールアドレス」と「監査の summary に載せるロール」であり、
  // 判定を二重に持たない。
  const row = await withInvitationToken(tokenHash);
  if (row === null) throw new InvitationNotAcceptableError();

  const passwordHash = await hashPassword(input.password);
  const accepted = await withInvitationAccept(tokenHash, {
    displayName: input.displayName,
    passwordHash,
    now,
    buildAudit: (created): AuditLogEntry => ({
      action: INVITATION_AUDIT_ACTIONS.accept,
      actorKind: 'USER',
      actorId: created.userId,
      targetType: 'Invitation',
      targetId: row.invitationId,
      // 🔴 メールアドレス（PII）とトークンを入れない。
      summary: { role: row.role, partnerScoped: row.partnerCompanyId !== null },
      ipAddress: meta.ipAddress,
      deviceKind: meta.deviceKind,
    }),
  });
  if (accepted === null) throw new InvitationNotAcceptableError();

  return { userId: accepted.userId, email: row.email };
}
