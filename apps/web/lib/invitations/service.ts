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
//    - 監査ログの `summary` に載せない
//    - 🔴 T-04-08: 戻り値に載るのは **`APP_ENV='sandbox'` かつ宛先分類 2** のときだけである
//      （`F-007 AC-4`。`sandbox` では取引先招待メールがモックになり、画面で手渡すしかない）。
//      判定は `buildInvitationIssueView`（`invite-link.ts`）の 1 箇所にあり、
//      **開示しない環境ではリンクを組み立てる材料（`appUrl`）を受け取らない**。
import { INVITATION_TTL_MS } from '@ses/config';
import {
  resolveRecipientClass,
  withInvitationAccept,
  withInvitationToken,
  withTenant,
  writeAuditLog,
  type AccountMailRecipientClass,
  type AuditLogEntry,
  type AuthenticatedTenantCtx,
  type TenantRole,
} from '@ses/db';
import {
  ForbiddenError,
  InvitationEmailAlreadyMemberError,
  InvitationNotAcceptableError,
  NotFoundError,
  PartnerCompanySuspendedError,
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
import type { SendingDomainResolver } from '../settings/sending-domains';
import {
  buildInvitationIssueView,
  type InvitationIssueView,
  type InviteUrlRuntimeResolver,
} from './invite-link';
import { decideInvitation, type InvitationDenialReason } from './policy';

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
   * 🔴 これは実行者の分離キーではなく**招待先の選択**である（`decideInvitation` を参照）。
   *    `PARTNER_ADMIN` は指定できず、常に自社になる（`F-002 AC-4`）。
   * 🔴 キー名を `partnerCompanyId` にしない（T-04-07 の決着。`api/isolation-keys.ts` の
   *    `TARGET_SELECTION_KEYS` を参照）。API の body と 1 対 1 にして、
   *    「実行者のスコープ」と読み違える余地を型の名前から消す。
   */
  readonly targetPartnerCompanyId?: string | null;
};

/**
 * 🔴 T-04-08: 発行の結果は **`SandboxInvitationView` / `ProductionInvitationView` の
 *    判別可能な合併**である（docs/05 §6.4 #14）。`inviteUrl` は片方の枝にしか存在しない。
 */
export type IssueInvitationResult = InvitationIssueView;

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
 * 招待を発行する（docs/05 §6.4 #14 / `F-002` / `F-007`）。
 *
 * 🔴 T-04-05: **取引先の担当者宛（パートナーロール）の発行を開放した。** SP-03 で
 *    `PartnerInvitationNotAvailableError` を置いていたのは、「未検証のドメインから取引先へ
 *    送る経路が一時的に開く」ことを避けるためであり、その判定
 *    （`evaluateSendingDomain` / `requireVerifiedSendingDomain`）と保留
 *    （`HELD_DOMAIN_UNVERIFIED`）が本タスクで入ったため、前提が解消した。
 *
 * 🔴 **未検証でも招待そのものは作る**（`F-007 AC-5`「招待そのものは作成できるが、送達は
 *    検証完了後」）。したがってここでは 422 にせず、`deliveryState='HELD_DOMAIN_UNVERIFIED'`
 *    を返す。**共通ドメインへフォールバックしない**（`BR-51`）—— 実際に送るかどうかを決めるのは
 *    `account.mail` の②（docs/05 §8.3）であり、この応答はその予測を利用者に見せるためのものである。
 *
 * 🔴 再発行で旧トークンを失効させる（同じ宛先・同じ所属の未受諾の招待を `revokedAt` で閉じる）。
 *    有効なリンクが複数同時に存在すると、「1 回限りの受諾」が実質的に破れる。
 */
export async function issueInvitation(
  ctx: AuthenticatedTenantCtx,
  input: IssueInvitationInput,
  meta: AuthAttemptMeta,
  /**
   * 🔴 送信ドメインの検証状態の判定（`requireVerifiedSendingDomain` と**同じ関数**を使う）。
   *    **既定値を置かない** —— 既定を「検証不要」にすると、渡し忘れたルートだけが
   *    未検証のまま取引先へ送る経路になる（`CLAUDE.md` §11.1）。
   * 🔴 関数で受け取るのは、**分類 1（自社メンバー宛）では 1 度も呼ばれない**ことを
   *    構造で示すためである（`F-001 AC-5`。自社の招待は送信ドメインに依存しない）。
   */
  resolveSendingDomain: SendingDomainResolver,
  /**
   * 🔴 T-04-08: 招待リンクを応答に載せてよいか（`F-007 AC-4`）。**起動時に確定した値**を返す
   *    （`lib/db/bootstrap.ts` の `inviteUrlRuntime`）。リクエストごとに `APP_ENV` を見ない。
   * 🔴 `resolveSendingDomain` と同じく**関数で受け取り、既定値を置かない**。
   *    関数なのは、分類 1（自社メンバー宛）で**起動時 DI を 1 度も参照しない**ためである。
   *    既定値を置かないのは、渡し忘れに気づけなくなるためである
   *    （非 `sandbox` の呼び出し側は `() => INVITE_URL_NOT_DISCLOSED` を明示的に渡す）。
   */
  resolveInviteUrl: InviteUrlRuntimeResolver,
  now: Date = new Date(),
): Promise<IssueInvitationResult> {
  const verdict = decideInvitation(
    { role: ctx.role, partnerCompanyId: ctx.partnerCompanyId },
    { role: input.role, partnerCompanyId: input.targetPartnerCompanyId ?? null },
  );
  // 🔴 判定の順序: ①認可 → ②入力の組み合わせ。
  //    ①を先に置くのは、権限の無い利用者に対象の存在を教えないためである
  //    （「他社を指定した」も 403 に畳む）。
  if (!verdict.allowed && AUTHORIZATION_DENIALS.has(verdict.reason)) throw new ForbiddenError();
  if (!verdict.allowed) throw new UnprocessableError();

  // 🔴 副作用（招待行の作成）の前にキューの存在を確かめる。
  //    後から分かると「作られたのに永久に届かない招待」が残る（CLAUDE.md §11.1）。
  const queue = requireAccountMailQueue();

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  const created = await withTenant(ctx, async (db) => {
    // 🔴 T-04-07: **招待先の取引先企業を、母集団（RLS）に照合してから使う**（`F-007`）。
    //    ここを飛ばすと `invitations.partner_company_id` に**他テナントの取引先企業の ID**を
    //    書けてしまう（FK は `partner_companies(id)` を指すだけでテナントをまたいでも成立する）。
    //    🔴 母集団は RLS の C5 が決める（ホスト = 自テナント全社 / パートナー = 自社 1 行）。
    //    アプリ側に `tenantId` の絞り込みを書かない（`F-004 AC-1` / docs/05 §6.4 #11 と同じ規律）。
    //    🔴 見えなければ **404**（「見えない ＝ 存在しない」。docs/05 §4.8）。他テナントの
    //    取引先企業が実在するかどうかを応答から推測させない。
    if (verdict.partnerCompanyId !== null) {
      const partner = await db.partnerCompany.findFirst({
        where: { id: verdict.partnerCompanyId },
        select: { suspendedAt: true },
      });
      if (partner === null) throw new NotFoundError();
      // 🔴 停止中の取引先に新しいアカウントを増やさない（`F-007 AC-2` の意図）。
      //    配下アカウントの実行系を止めている最中に、招待だけ通れば停止の意味が失われる。
      if (partner.suspendedAt !== null) throw new PartnerCompanySuspendedError();
    }

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
        // 🔴 T-04-07（`F-007 AC-3`「取引先企業の…招待…が監査ログに残る」）: どの取引先への
        //    招待だったかを残す。取引先企業の内部 ID は PII ではなく、この監査ログを読む
        //    ホストの `OWNER` / `ADMIN` は `S-014` で同じ一覧を見られる立場である。
        targetPartnerCompanyId: verdict.partnerCompanyId,
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
  //    🔴 未検証でも **enqueue はする** —— 保留の判定と記録（`EmailDispatch` の
  //    `HELD_DOMAIN_UNVERIFIED`）は `account.mail` の内側で行われ、`send.hold-release` が
  //    検証完了後に自動で復帰させる（docs/05 §8.3）。ここで積むのをやめると、
  //    「検証したのに届かない招待」になる。
  const enqueued = await queue.enqueue({
    tenantId: ctx.tenantId,
    kind: 'INVITATION',
    targetId: created.id,
    recipientClass: created.recipientClass,
    token,
  });

  // 🔴 応答の組み立ては 1 箇所（`buildInvitationIssueView`）に閉じる。ここで
  //    `if (sandbox) { ... }` を書くと、開示条件がこの関数と画面の 2 箇所に散る。
  return buildInvitationIssueView({
    id: created.id,
    deliveryState: await predictDeliveryState(
      ctx,
      created.recipientClass,
      enqueued,
      resolveSendingDomain,
    ),
    recipientClass: created.recipientClass,
    token,
    resolveInviteUrl,
  });
}

/**
 * 🔴 #14 の応答に載せる送達の見込み（docs/05 §6.4 #14 / §8.3。`F-007 AC-5`）。
 *
 * 🔴 **これは予測であって記録ではない。** 実際に保留に入れるのは `account.mail` の②
 *    （docs/05 §8.3）であり、そちらが唯一の権威である。ここで返すのは
 *    「いま画面に何と表示すべきか」だけである（`docs/04` `S-014` / `S-036`）。
 * 🔴 予測がずれてよい向きは 1 つだけである: 判定の後・送信の前にドメインが検証済みになれば、
 *    `HELD` と返したものが実際には送られる（利用者にとって安全側）。逆向き
 *    （`QUEUED` と返して実際は保留）も**障害ではなく設定未了**として `S-036` に現れる。
 * 🔴 分類 1（自社メンバー）には適用しない —— 共通ドメインで送るため、検証状態に依存しない
 *    （`F-001 AC-5`。ここを分けないと、ドメイン未設定のテナントで自社の招待まで
 *    「保留」と表示され、開設フローが止まって見える）。
 */
async function predictDeliveryState(
  ctx: AuthenticatedTenantCtx,
  recipientClass: AccountMailRecipientClass,
  enqueued: AccountMailDeliveryState,
  resolveSendingDomain: SendingDomainResolver,
): Promise<AccountMailDeliveryState> {
  // 🔴 ここで打ち切ることが `F-001 AC-5` の実装である（判定を 1 度も呼ばない）。
  if (recipientClass !== 'PARTNER_MEMBER') return enqueued;
  const requirement = await resolveSendingDomain(ctx);
  return requirement.kind === 'UNVERIFIED' ? 'HELD_DOMAIN_UNVERIFIED' : enqueued;
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
