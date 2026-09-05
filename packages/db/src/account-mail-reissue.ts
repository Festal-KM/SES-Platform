// packages/db/src/account-mail-reissue.ts
// 🔴 保留（`HELD_DOMAIN_UNVERIFIED` / `HELD_PROVIDER_QUOTA`）に入った `account.mail` を、
//    **トークンの再発行**で復帰させる（docs/05 §8.3 の復帰手順 / §9.4 の `send.hold-release`）。T-04-05。
//
// ============================================================================
// 🔴 なぜ「再発行」以外に手が無いのか
// ============================================================================
// 招待・パスワード再設定の**平文トークンは payload（Redis）にしか載らない**（docs/05 §9.4 /
// §16.2）。保留に入った時点でジョブは正常終了し、payload と共に平文は消える。DB に残るのは
// `sha256(token)` だけであり、そこから平文は復元できない。したがって「保留していたメールを
// あとで送る」ことは原理的にできず、**新しいトークンを発行して新しい 1 通を作る**しかない。
//
// ============================================================================
// 🔴 同一トランザクションでなければならない理由（docs/05 §8.3 の復帰手順①〜③）
// ============================================================================
//   ① `email_dispatches` の CAS（`WHERE status = 保留状態`）… 「1 通」を担保する唯一の関門
//   ② 受諾期限 / 受諾済み / 取消済みの判定
//   ③ `Invitation.tokenHash` の差し替えと `expiresAt` の再設定
// ①だけ成立して③が失敗すると **招待が永久に届かない**。③だけ成立して①が失敗すると
// **同じ招待に有効なリンクが 2 本**生まれる（`send.hold-release` は 10 分ごとに走り、
// 実行が重なりうる）。どちらも 1 つのトランザクションに入れることでしか防げない。
//
// ============================================================================
// 🔴 パスワード再設定を**再発行しない**理由（docs/05 §8.3 への意図的な差分。T-04-05）
// ============================================================================
// docs/05 §8.3-Q は「招待・パスワード再設定はトークン再発行手順を共用する」と書いているが、
// 本実装は**パスワード再設定を再発行せず、保留行を `EXPIRED` として閉じる**。理由は 3 つある:
//   ① **意味論**: 再設定トークンの有効期間は 1 時間（`PASSWORD_RESET_TTL_MS`）である。保留は
//      ドメイン検証の完了（数時間〜数日）や送信基盤の枠の回復（最大 24 時間）を待つものであり、
//      **依頼から何時間も経って届く再設定リンクは、本人にとって「身に覚えのない」通知**である。
//      乗っ取りの兆候と区別できず、安全側の挙動とは言えない。
//   ② **代替手段がある**: 再設定は本人がいつでも `S-046`（#5）から再要求できる。応答は常に 204 で
//      あり、存在も漏れない。一方**招待は本人が再発行できない**（ホストの `ADMIN` の操作 #14 が
//      要る）ため、自動復帰の価値がまったく違う。
//   ③ **分離の制約**: パートナー所属利用者の再設定トークン列は、`users` の C3 UPDATE ポリシー
//      （`owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()`）により
//      **ジョブのホスト文脈からは書き換えられない**。書けるようにするには新しい分離バイパス
//      （docs/05 §4.4.2 の「これ以外を作らない」経路）を増やすことになり、
//      §3.1 のハードルールに照らして割に合わない。
// 🔴 この差分は docs/05 §8.3 / §9.4 に追記済みである（`CLAUDE.md` §8.7）。

import { Prisma } from '@prisma/client';
import type { HostTenantCtx } from './context.js';
import { closeHeldEmailDispatchSql, type EmailDispatchHoldStatus } from './email-dispatch.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * 復帰の結果（`send.hold-release` の `AccountMailReissue` seam の戻り値）。
 *
 * - `REISSUED`: 新しいトークンを発行した（呼び出し側が `account.mail` を enqueue する）
 * - `EXPIRED`:  期限切れ / 受諾済み / 取消済みで再発行しなかった（行は閉じた。再招待は #14）
 * - `SKIPPED`:  CAS が 0 件（他の実行が処理済み）。**正常系**であり、何もしない
 */
export type AccountMailReissueOutcome = 'REISSUED' | 'EXPIRED' | 'SKIPPED';

export type InvitationReissueInput = {
  readonly dispatchId: string;
  readonly fromStatus: EmailDispatchHoldStatus;
  readonly invitationId: string;
  /** 🔴 新しいトークンの **SHA-256**。平文は `packages/db` に渡さない。 */
  readonly tokenHash: string;
  /**
   * 新しい受諾期限。
   * 🔴 `now + INVITATION_TTL` である（docs/05 §8.3 の復帰手順③「保留期間を受諾期限から
   *    差し引かない」）。値の出所は `packages/config` であり、ここで計算しない。
   */
  readonly expiresAt: Date;
  /** 期限判定の基準時刻（テストから固定するため引数にする）。 */
  readonly now: Date;
};

/**
 * 🔴 保留中の招待をトークン再発行で置き換える（docs/05 §8.3 の復帰手順）。
 *
 * 🔴 **旧トークンを失効させて困る者はいない**: 保留中はメールが 1 通も出ておらず、
 *    `inviteUrl`（画面表示）は `sandbox` でしか返らない（`F-007 AC-4`）。
 *    `production` では旧トークンは誰にも配布されていない。
 * 🔴 新しい `dedupeKey` は `sha256(新トークン)` を含むので別の行になる。
 *    「1 通」を担保するのは `dedupeKey` の `UNIQUE` ではなく**①の CAS** である
 *    （`UNIQUE` は同一トークンでの再試行にしか効かない）。
 */
export async function reissueHeldInvitationToken(
  ctx: HostTenantCtx,
  input: InvitationReissueInput,
): Promise<AccountMailReissueOutcome> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      // ① CAS。0 件なら他の実行が処理済み（10 分ごとの実行が重なりうる）。
      const claimed = await tx.$queryRaw<Array<{ id: string }>>(
        closeHeldEmailDispatchSql({
          dispatchId: input.dispatchId,
          fromStatus: input.fromStatus,
          reason: 'REISSUED',
        }),
      );
      if (claimed.length !== 1) return 'SKIPPED';

      // ②③ 期限・受諾・取消の判定と差し替えを **1 つの UPDATE の WHERE** で行う。
      //    「読んでから書く」にすると、読んだ後・書く前に受諾された招待へ新しいリンクを
      //    発行しうる（同一トランザクションでも、判定を分けると意図が読めなくなる）。
      const reissued = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE invitations
           SET token_hash = ${input.tokenHash},
               expires_at = ${input.expiresAt}::timestamptz
         WHERE id = ${input.invitationId}::uuid
           AND accepted_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ${input.now}::timestamptz
        RETURNING id::text AS id`);
      if (reissued.length === 1) return 'REISSUED';

      // 🔴 再発行しなかったのだから、①で書いた `REISSUED` は事実に反する。**同じ行を
      //    `EXPIRED` に書き直す**（同一トランザクションなので、外からは中間状態が見えない）。
      //    再招待はホストの `ADMIN` の明示操作（#14）に委ねる（docs/05 §8.3 の復帰手順②）。
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE email_dispatches
           SET failure_reason = 'EXPIRED'
         WHERE id = ${input.dispatchId}::uuid
        RETURNING id::text AS id`);
      return 'EXPIRED';
    },
  );
}
